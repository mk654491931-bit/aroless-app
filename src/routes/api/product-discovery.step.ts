/**
 * POST /api/product-discovery/step?step=<adım> — QStash adım işçisi.
 *
 * ZINCIR:
 *   /start ──► step(scrape_filter) ──► step(gemini) ──► step(deep) ──► step(final)
 *
 * DİLİMLER (10 sn kuralı) — BİR İSTEK = BİR DİLİM:
 *
 * Bu uç artık bir adımın TAMAMINI değil, en fazla bir DİLİMİNİ koşar
 * (`DISCOVERY_SLICE_MS`, varsayılan 10 sn; uzun adımlar için bkz.
 * `product-discovery-slices.server.ts`). Adım dilim içinde bitmezse:
 *   1. o ana kadarki ilerleme ARA NOKTAYA yazılır (ör. konseyde hangi roller
 *      konuştu ve puanları),
 *   2. AYNI adımın sıradaki dilimi QStash'e yayınlanır (`slice: n + 1`),
 *   3. zincir böylece dilim dilim ilerler ve HİÇBİR fonksiyon uzun koşmaz.
 *
 * Neden: Vercel Hobby'de bir isteği dakikalarca açık tutmak, platform işi
 * öldürdüğünde ne sonuç ne ara nokta bırakır. Adım tamamlandığında ise yine
 * eskisi gibi SONRAKİ adım (slice 0) yayınlanır.
 *
 * KUYRUK TAMİRİ: bir dilim ara noktayı yazdıktan SONRA, sıradakini yayınlamadan
 * ÖNCE ölebilir (istek kesildi, ağ koptu). Bu yüzden devam dilimlerinde
 * tekrar teslimat alındığında sıradaki dilim YENİDEN yayınlanır; QStash kimliği
 * dilim başına sabit olduğu için bu idempotenttir (çift iş üretmez).
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
import { enqueueDiscoveryStep, type DiscoveryStep } from "@/lib/product-discovery-qstash.server";
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
          return jsonResponse(
            { error: "Geçersiz adım gövdesi.", issues: parsed.error.issues },
            400,
          );
        }
        const payload = parsed.data;
        const { runId, userId, input } = payload;
        // Bu teslimatın dilim numarası: 0 = adımın ilk dilimi.
        const slice = payload.slice ?? 0;

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
          // Zincirin mutlak bitiş anı (varsa): adım yalnız bu ana kadar koşar ve
          // kalan işi deterministiğe düşürerek BİTİRİR.
          deadlineAt: payload.deadlineAtMs,
          // DİLİM: adımın tamamı değil, bu dilimi koşar (en fazla ~10 sn).
          slice,
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
          // Bu adım/dilim başka bir taşıyıcı tarafından alınmış (ya da iş bitmiş).
          //
          // DEVAM DİLİMLERİNDE BİR İSTİSNA VAR — KUYRUĞUN KENDİNİ TAMİRİ.
          //
          // Bir dilim ilerlemeyi ara noktaya yazdıktan SONRA, sıradakini
          // yayınlamadan önce ölmüş olabilir (istek kesildi, ağ koptu, platform
          // 504 döndü). O anda dilim defteri ileridedir (`next = slice + 1`) ama
          // zincirde o halka YOKTUR; yoklama devralmadan zincir dakikalarca
          // durur. Bu yüzden devam dilimlerinde sıradaki dilimi yeniden
          // yayınlarız. Güvenli, çünkü QStash kimliği dilim başına sabittir
          // (`runId:step:slice`): zaten kuyrukta olan bir mesaj tekrar
          // üretilmez. Yani onarım turu bedava ve idempotenttir.
          if (slice > 0) {
            const repaired = await enqueueDiscoveryStep({
              runId,
              userId: job.userId,
              input,
              step: step as DiscoveryStep,
              products: payload.batch,
              consensus: payload.consensus,
              progress: payload.progress,
              origin: appOrigin(request),
              deadlineAtMs: payload.deadlineAtMs,
              slice: slice + 1,
            });
            return jsonResponse(
              {
                ok: true,
                deduped: true,
                repair: repaired.ok ? `queued:${step}#${slice + 1}` : repaired.error,
              },
              200,
            );
          }
          // İlk dilimlerde yeni bir kuyruk mesajı ÜRETMEYİZ: aksi hâlde aynı adım
          // iki kez yayınlanır ve gereksiz teslimat trafiği oluşur.
          return jsonResponse({ ok: true, deduped: true, progress: job.discoveryProgress }, 200);
        }

        // 4b) DİLİM BİTTİ, ADIM BİTMEDİ → AYNI adımın sıradaki dilimi yayınlanır.
        //
        // Kullanıcının istediği kuralın kalbi burasıdır: hiçbir fonksiyon uzun
        // koşmaz, iş dilim dilim ilerler ve her dilim kendi kısa mesajını alır.
        // İlerleme (hangi roller konuştu, hangi kaynaklar okundu) ara noktada
        // olduğu için sıradaki dilim tam kaldığı yerden devam eder.
        if (result.outcome.partial) {
          const carried = result.outcome.products.length ? result.outcome.products : payload.batch;
          const queued = await enqueueDiscoveryStep({
            runId,
            userId: job.userId,
            input,
            step: step as DiscoveryStep,
            products: carried,
            // Oy satırları yalnız `deep`→`final` aktarımında anlamlıdır; burada
            // varsa da aynen taşınır (adım kendi girdisini korur).
            consensus: payload.consensus,
            progress: result.outcome.progress,
            origin: appOrigin(request),
            deadlineAtMs: payload.deadlineAtMs,
            slice: slice + 1,
          });
          if (!queued.ok) {
            // Kuyruk yoksa iş ÖLMEZ: aynı adımı tarayıcı yoklamasının sürdürdüğü
            // zincir devralır (ilerleme ara noktada duruyor).
            console.warn(`[discovery] devam dilimi kuyruğa alınamadı: ${queued.error}`);
            return jsonResponse(
              { ok: true, next: `inline:${step}`, queueError: queued.error },
              200,
            );
          }
          return jsonResponse(
            { ok: true, partial: true, next: `queued:${step}#${slice + 1}` },
            200,
          );
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
          // Zincir sözü adım adım TAŞINIR: her adım aynı bitiş anını görür.
          deadlineAtMs: payload.deadlineAtMs,
          // Yeni adım her zaman İLK dilimden başlar.
          slice: 0,
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
