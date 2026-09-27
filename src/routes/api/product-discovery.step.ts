/**
 * POST /api/product-discovery/step — QStash adım işçisi (İMZA DOĞRULAMALI).
 *
 * ZINCIR:
 *   /start ──► step(scrape_filter) ──► step(gemini) ──► step(deep) ──► step(final)
 *
 * Her adım kendi fonksiyonunda BİTER ve bir sonrakini QStash'e yayınlar.
 * Vercel Hobby'de tek bir istek bu zinciri taşıyamaz; bölme bu yüzden zorunlu.
 *
 * GÜVENLİK (3 katman, hepsi fail-closed):
 *   1. QStash JWS imzası doğrulanır (`verifyQStashSignature`). İmzasız istek
 *      401 alır. Bu, uç noktayı sahte iş tetiklemeye karşı korur.
 *   2. Gövde `DiscoveryStepPayloadSchema` ile doğrulanır (zod).
 *   3. SAHİPLİK DB'DEN okunur: `searches.user_id` ile gövdedeki `userId`
 *      eşleşmezse 403. Gövdeye ASLA tek başına güvenilmez.
 *
 * SAHİPLİĞİN NEREDEN GELDİĞİ (önceki sürümün en önemli hatası):
 *   Daha önce sahiplik bellekte (`Map`) tutuluyordu. Sunucusuz çalışma
 *   zamanında her QStash adımı ayrı ve soğuk bir örnekte koşar → bellek
 *   boş → `NOT_FOUND` → hattın tamamı üretimde 403 ile ölürdü. Artık kayıt
 *   `searches` tablosundadır ve her adımda yeniden okunur.
 *
 * DURUM MAKİNESİ: Adım başlarken `queued → <adım durumu>` geçişi DB'de
 * atomik olarak yapılır (`advance_discovery_status`). Geçersiz veya zaten
 * ilerlemiş bir geçiş reddedilir; böylece QStash retry'ı aynı adımı iki kez
 * çalıştırmaz, kredi iki kez düşmez.
 *
 * İADE: Adım çökerse iş `failed` yapılır ve kredi `failAndRefund` ile TAM
 * OLARAK BİR KEZ iade edilir (bayrak DB'de tutulur).
 */
import { createFileRoute } from "@tanstack/react-router";

import { appOrigin } from "@/lib/discovery-jobs.server";
import { refundFeatureCredits } from "@/lib/credit-charge.server";
import { DiscoveryStepPayloadSchema } from "@/lib/product-discovery.types";
import {
  jsonResponse,
  signatureRejection,
  verifyOwnership,
  verifyQStashSignature,
} from "@/lib/product-discovery-security.server";
import {
  runDeepAnalysisStep,
  runFinalRankStep,
  runGeminiShortlistStep,
  runScrapeFilterStep,
} from "@/lib/product-discovery-pipeline.server";
import {
  advanceDiscoveryStatus,
  failAndRefund,
  finishDiscoveryJob,
  readDiscoveryJob,
} from "@/lib/product-discovery-jobs.server";
import { enqueueDiscoveryStep } from "@/lib/product-discovery-qstash.server";
import type { Consensus, FilterStats, ProductDiscoveryStatus } from "@/lib/product-discovery.types";

/** Adımın girişte bulunması beklenen durum ve bitişteki durum. */
const STEP_TRANSITIONS: Record<
  string,
  { from: ProductDiscoveryStatus; to: ProductDiscoveryStatus; progress: number }
> = {
  scrape_filter: { from: "queued", to: "scraping", progress: 15 },
  gemini: { from: "filtering", to: "gemini_shortlist", progress: 55 },
  deep: { from: "gemini_shortlist", to: "deep_analysis", progress: 80 },
  final: { from: "deep_analysis", to: "completed", progress: 100 },
};

/**
 * Adım çökerse: işi kapat, krediyi bir kez iade et.
 *
 * `userId` burada `readDiscoveryJob` ile gelen KALICI kayıttan gelir; gövde
 * doğrulanmış olsa bile iade hedefi satırdaki sahibe bağlanır, saldırganın
 * gönderdiği kimliğe değil.
 */
async function failStep(runId: string, userId: string, message: string): Promise<Response> {
  await failAndRefund(runId, message, (amount) =>
    refundFeatureCredits(userId, amount, "discovery_failed"),
  );
  return jsonResponse({ ok: false, status: "failed", error: message }, 200);
}

async function handleStep(request: Request, step: string): Promise<Response> {
  // 1) İMZA — ham gövde üzerinden doğrulanır (parse ÖNCE yapılmaz).
  const raw = await request.text();
  const signature =
    request.headers.get("upstash-signature") ??
    new URL(request.url).searchParams.get("upstash-signature");
  const verified = await verifyQStashSignature(raw, signature);
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
  const transition = STEP_TRANSITIONS[step];
  if (!transition) {
    return jsonResponse({ error: `Bilinmeyen adım: ${step}` }, 400);
  }

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

  // 4) DURUM GEÇİŞİ — atomik. Zaten ilerlemişse (QStash retry) adım atlanır.
  //    `status='completed'` olan bir iş asla yeniden işlenmez.
  if (job.status === "completed") {
    return jsonResponse({ ok: true, status: "completed", deduped: true, progress: 100 }, 200);
  }
  const advanced = await advanceDiscoveryStatus({
    runId,
    from: transition.from,
    to: transition.to,
    progress: transition.progress,
    step,
  });
  if (!advanced) {
    // Başka bir teslimat bu adımı zaten almış; ikinci kez çalıştırma.
    const current = await readDiscoveryJob(runId);
    return jsonResponse(
      {
        ok: true,
        status: current?.discoveryStatus ?? transition.from,
        deduped: true,
        progress: current?.discoveryProgress ?? transition.progress,
      },
      200,
    );
  }

  // 5) ADIMI ÇALIŞTIR
  try {
    switch (step) {
      case "scrape_filter": {
        // AI YOK — saf kod. Kaynaklar fail-soft, her biri kendi tavanında.
        const result = await runScrapeFilterStep(input.niche, input.country, input.platform);
        if (!result.ok) return failStep(runId, job.userId, "scrape_filter başarısız.");

        // Filtre istatistikleri kalıcı yazılır: panel "neden bu sayı?" sorusunu
        // adım bittikten sonra da yanıtlayabilir.
        await advanceDiscoveryStatus({
          runId,
          from: "scraping",
          to: "filtering",
          progress: 35,
          step: "scrape_filter",
          stats: result.stats as FilterStats,
        });

        if (result.products.length === 0) {
          // Aday yoksa iş dürüstçe biter: sahte sonuç üretilmez, kredi iade edilir.
          return failStep(runId, job.userId, "Hiç kaynak doğrulanabilir ürün döndürmedi.");
        }
        // El sırasındaki adımı kuyruğa al. YAYIN BAŞARISIZSA iş asla
        // "sırada bekliyor" gibi görünmez: kullanıcı parasını ödemiş, ortada
        // ilerlemeyen bir iş kalmasındansa hata açıkça bildirilir ve kredi
        // iade edilir.
        const queued = await enqueueDiscoveryStep({
          runId,
          userId,
          input,
          step: "gemini",
          products: result.products as never,
          progress: 45,
          origin: appOrigin(request),
        });
        if (!queued.ok) {
          return failStep(runId, job.userId, `gemini adımı kuyruğa alınamadı: ${queued.error}`);
        }
        return jsonResponse({ ...result, next: "queued:gemini", progress: 35 }, 200);
      }

      case "gemini": {
        // AI #1 — Gemini kısa listesi (Top 75 → 15).
        const result = await runGeminiShortlistStep(payload.batch as never, input.niche);
        if (!result.ok) return failStep(runId, job.userId, "gemini_shortlist başarısız.");
        if (result.products.length === 0) {
          return failStep(runId, job.userId, "Kısa listede aday kalmadı.");
        }
        const queued = await enqueueDiscoveryStep({
          runId,
          userId,
          input,
          step: "deep",
          products: result.products as never,
          progress: 70,
          origin: appOrigin(request),
        });
        if (!queued.ok) {
          return failStep(runId, job.userId, `deep adımı kuyruğa alınamadı: ${queued.error}`);
        }
        return jsonResponse({ ...result, next: "queued:deep", progress: 70 }, 200);
      }

      case "deep": {
        // AI #2 — 14 ajan derin analizi (deterministik oylar, $0 token).
        const result = await runDeepAnalysisStep(
          payload.batch as never,
          input.niche,
          async (rows) => {
            const { runCouncilOnProducts } = await import("@/lib/product-discovery-council.server");
            return runCouncilOnProducts(rows);
          },
        );
        if (!result.ok) return failStep(runId, job.userId, "deep_analysis başarısız.");

        // Uzlaşma kayıtları `consensus` alanında taşınır (ürün şemasına
        // sığmaz), böylece `final` adımı gerçek oylarla sıralar.
        const consensus = (result.consensus ?? []) as Consensus[];
        if (consensus.length === 0) {
          return failStep(runId, job.userId, "Uzlaşma sonucu üretilemedi.");
        }

        // Nihai sıralama AYRI bir adım olarak kuyruğa alınır: `deep` ve
        // `final` ayrı fonksiyonlarda bölmelenir, hiçbir istek zinciri taşımaz.
        //
        // `products` BİLEREK boş GÖNDERİLMEZ: uzlaşma satırı ürünün kendisi
        // değildir, yalnız oy skorudur. Arayüzün fiyat/marka/görsel görebilmesi
        // için aday ürünler de taşınır; `final` ikisini fingerprint ile
        // birleştirir.
        const queued = await enqueueDiscoveryStep({
          runId,
          userId,
          input,
          step: "final",
          products: result.products ?? [],
          consensus,
          progress: 90,
          origin: appOrigin(request),
        });
        if (!queued.ok) {
          return failStep(runId, job.userId, `final adımı kuyruğa alınamadı: ${queued.error}`);
        }
        return jsonResponse({ ...result, next: "queued:final", progress: 80 }, 200);
      }

      case "final": {
        // Uzlaşma (oy) satırları fingerprint ile aday ürünlere eşleşir.
        const byId = new Map(
          (payload.batch as { fingerprint?: string }[]).map((p) => [
            String(p.fingerprint ?? ""),
            p,
          ]),
        );
        const ranked = runFinalRankStep(payload.consensus as never, input.topN, byId as never);
        if (!ranked.ok) return failStep(runId, job.userId, "final sıralama başarısız.");
        // Terminal yazma: `finish_discovery_job` `status='processing'` koşuluyla
        // çalıştığı için iki teslimat çift sonuç üretemez.
        const written = await finishDiscoveryJob(runId, {
          runId,
          input,
          products: ranked.products,
          consensus: ranked.consensus as Consensus[],
          stats: job.stats,
          stepStats: {},
          sources: job.stats?.perSource ?? [],
        });
        return jsonResponse(
          { ...ranked, progress: 100, completed: written, deduped: !written },
          200,
        );
      }

      default:
        return jsonResponse({ error: `Bilinmeyen adım: ${step}` }, 400);
    }
  } catch (error) {
    // Yakalanmamış hata: kullanıcı hata için ödemez.
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[discovery] adım ${step} çöktü:`, message);
    return failStep(runId, job.userId, `${step}: ${message}`);
  }
}

export const Route = createFileRoute("/api/product-discovery/step")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const step = new URL(request.url).searchParams.get("step") ?? "scrape_filter";
        return handleStep(request, step);
      },
    },
  },
});
