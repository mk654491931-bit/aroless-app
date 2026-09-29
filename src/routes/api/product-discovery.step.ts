/**
 * POST /api/product-discovery/step?step=<adım> — QStash adım işçisi.
 *
 * ZINCIR:
 *   /start ──► step(scrape_filter) ──► step(gemini) ──► step(deep) ──► step(final)
 *
 * Her adım kendi isteğinde BİTER ve bir sonrakini QStash'e yayınlar. Sunucusuz
 * ortamda tek bir istek tüm zinciri taşıyamaz; bölme bu yüzden zorunlu.
 *
 * ARTIK ZORUNLU DEĞİL: QStash anahtarları eksikse (üç anahtardan biri: token,
 * worker sırrı, imza anahtarı) zincir bu uçtan hiç geçmez; aynı işi
 * `product-discovery-runner.server.ts` ya süreç içi arka planda ya da tarayıcı
 * yoklamasının sürdüğü zincirde koşar. Adım mantığı ikisinde ORTAKTIR
 * (`executeProductDiscoveryStep`), böylece iki yol farklı davranamaz.
 *
 * GÜVENLİK (hepsi fail-closed):
 *   1. QStash JWS imzası doğrulanır (`verifyQStashSignature`). İmzasız istek
 *      401 alır; bu uç sahte iş tetiklemeye kapalıdır.
 *   2. Gövde `DiscoveryStepPayloadSchema` ile doğrulanır (zod).
 *   3. SAHİPLİK DB'DEN okunur: `searches.user_id` gövdedeki `userId` ile
 *      eşleşmezse 403. Gövdeye ASLA tek başına güvenilmez.
 *
 * İADE: Adım çökerse iş `failed` yapılır ve kredi TAM OLARAK BİR KEZ iade edilir
 * (bayrak veritabanında tutulur).
 */
import { createFileRoute } from "@tanstack/react-router";

import { appOrigin } from "@/lib/discovery-jobs.server";
import { DiscoveryStepPayloadSchema } from "@/lib/product-discovery.types";
import {
  jsonResponse,
  signatureRejection,
  verifyOwnership,
  verifyQStashSignature,
} from "@/lib/product-discovery-security.server";
import { readDiscoveryJob } from "@/lib/product-discovery-jobs.server";
import {
  enqueueDiscoveryStep,
  type DiscoveryStep,
} from "@/lib/product-discovery-qstash.server";
import { runOneDiscoveryStep } from "@/lib/product-discovery-runner.server";

export const Route = createFileRoute("/api/product-discovery/step")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const step = new URL(request.url).searchParams.get("step") ?? "scrape_filter";

        // 1) İMZA — ham gövde üzerinden doğrulanır (parse ÖNCE yapılmaz).
        const raw = await request.text();
        const signature =
          request.headers.get("upstash-signature") ??
          new URL(request.url).searchParams.get("upstash-signature");
        const verified = await verifyQStashSignature(
          raw,
          signature,
          undefined,
          // İkinci kabul yolu: yayıncının ilettiği paylaşılan işçi sırrı.
          request.headers.get("x-job-secret") ??
            request.headers.get("upstash-forward-x-job-secret"),
        );
        if (!verified.ok) {
          console.warn(`[discovery] imza reddi: ${verified.reason}`);
          return signatureRejection(verified);
        }

        // 2) ŞEMA
        const parsed = DiscoveryStepPayloadSchema.safeParse(verified.body);
        if (!parsed.success) {
          return jsonResponse({ error: "Geçersiz adım gövdesi.", issues: parsed.error.issues }, 400);
        }
        const payload = parsed.data;
        const { runId, userId, input } = payload;

        // 3) SAHİPLİK — KALICI kayıttan okunur. Gövde tek başına kanıt DEĞİLDİR.
        const job = await readDiscoveryJob(runId);
        if (!job) {
          console.warn(`[discovery] bilinmeyen runId: ${runId}`);
          return jsonResponse({ error: "İş kaydı bulunamadı." }, 403);
        }
        const owned = verifyOwnership({ runId, userId: job.userId, createdAt: "" }, userId);
        if (!owned.ok) {
          console.warn(`[discovery] sahiplik reddi: ${owned.reason}`);
          return jsonResponse({ error: "Bu işe erişim yok." }, 403);
        }

        // 4) ADIMI SAHİPLEN VE ÇALIŞTIR (tek kaynak: runner).
        const result = await runOneDiscoveryStep({
          runId,
          userId: job.userId,
          input,
          step: step as DiscoveryStep,
          batch: payload.batch,
          consensus: payload.consensus,
        });
        if (!result.ok) {
          // ÖNEMLİ: 5xx DÖNDÜRÜLÜR, 200 DEĞİL.
          //
          // QStash bir teslimatı 2xx gördüğünde onu BAŞARILI sayar ve yeniden
          // denemez. Adım çöktüğünde 200 dönmek, zincirin o adımda sessizce
          // SON BULMASI demekti: satır `processing`e takılıyor, sonraki adım
          // hiç yayınlanmıyor ve kullanıcı ekranda "çalışıyor" yazısını
          // yarım saat görüyordu. 5xx ise QStash'ı YENİDEN DENEMEYE zorlar
          // (`Upstash-Retries: 3`) — yani hat kendini kendine tamir eder.
          //
          // Yeniden denemenin pahalıya mal olmamasının garantisi: `claimDiscoveryStep`
          // atomik CAS ile çalışır, iş zaten `failed` olduysa yeniden deneme
          // adımı çalıştırmaz ve ucuzca `terminal` döner.
          console.error(`[discovery] adım hatası: ${step} → ${result.error}`);
          return jsonResponse({ ok: false, status: "failed", error: result.error }, 500);
        }
        if (result.deduped) {
          // Bu adım başka bir taşıyıcı tarafından alınmış (ya da iş bitmiş).
          // Yeni bir kuyruk mesajı ÜRETMEYİZ: aksi hâlde aynı adım iki kez
          // yayınlanır ve gereksiz teslimat trafiği oluşur.
          return jsonResponse({ ok: true, deduped: true, progress: job.discoveryProgress }, 200);
        }

        // 5) SONRAKİ ADIMI KUYRUĞA AL — yalnız bu adım bizde koştuktan sonra.
        const { products, consensus, status, topProducts } = result.outcome;
        const nextStep =
          status === "filtering"
            ? "gemini"
            : status === "gemini_shortlist"
              ? "deep"
              : status === "deep_analysis"
                ? "final"
                : null;

        if (!nextStep) {
          // `final` adımı sonucu zaten yazdı (`finishDiscoveryJob`).
          //
          // Nihai 5 ürünün `top_products` sözleşmesi de burada dönüyor: 14 ajanın
          // oyununun TEK çıktısı istemcinin okuyabilmesi için gerekliydi. Ürün
          // satırları DB'de, bu sözleşme yanıtta — ikisi ayrı yerde durur.
          return jsonResponse(
            { ok: true, completed: true, progress: 100, top_products: topProducts ?? [] },
            200,
          );
        }

        const queued = await enqueueDiscoveryStep({
          runId,
          userId: job.userId,
          input,
          step: nextStep,
          products,
          // Oy satırları YALNIZ `final` adımına taşınır: ondan önceki adımlar
          // için anlamsızdır ve gereksiz yük olurdu.
          consensus: nextStep === "final" ? consensus : undefined,
          progress: nextStep === "gemini" ? 45 : nextStep === "deep" ? 70 : 90,
          origin: appOrigin(request),
        });
        if (!queued.ok) {
          // Kuyruk yoksa iş ÖLMEZ: aynı adımı tarayıcı yoklamasının sürdürdüğü
          // zincir devralır (ara nokta DB'de). Bu yüzden burada işi
          // başarısız saymıyoruz — yalnız bilgilendirici bir yanıt dönüyoruz.
          console.warn(`[discovery] sonraki adım kuyruğa alınamadı: ${queued.error}`);
          return jsonResponse(
            { ok: true, next: `inline:${nextStep}`, queueError: queued.error, progress: 50 },
            200,
          );
        }
        return jsonResponse({ ok: true, next: `queued:${nextStep}` }, 200);
      },
    },
  },
});
