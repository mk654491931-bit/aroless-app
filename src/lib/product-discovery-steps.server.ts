// ============================================================================
// PRODUCT DISCOVERY — ADIM YÜRÜTÜCÜSÜ (TEK KAYNAK).
//
// NEDEN AYRI DOSYA: aynı dört adım iki farklı taşıyıcıyla koşabilmelidir:
//
//   1. QStash teslimatı → `/api/product-discovery/step` (imza doğrulamalı)
//   2. Süreç içi / istek içi zincir → `product-discovery-runner.server.ts`
//
// Eskiden adım mantığı YALNIZ route dosyasının içindeydi. QStash anahtarları
// tanımlı değilse (ya da publish başarısızsa) hat hiçbir yerde çalışmıyor,
// `/start` `queue-failed` dönüyor ve arayüz sessizce eski yola düşüyordu —
// canlıda görülen "14 ajan çalışmıyor" belirtisinin yapısal nedeni budur.
// Mantığı buraya taşımak, iki taşıyıcının da AYNI işi yapmasını garanti eder.
//
// DURUM MAKİNESİ: her adım kendi geçişini yazar (`advanceDiscoveryStatus`) ve
// bu çağrı atomiktir. Aynı adım iki taşıyıcıdan birden gelirse yalnız biri
// ilerler, diğeri `false` görür ve hiçbir şey yapmaz. Yani QStash'i kapatmak
// yeni bir yarış koşulu yaratmaz.
//
// İADE: adım çökerse iş `failed` yapılır ve kredi TAM OLARAK BİR KEZ iade
// edilir (`failAndRefund` + `mark_discovery_credit_refunded`).
// ============================================================================

import { refundFeatureCredits } from "./credit-charge.server";
import {
  failAndRefund,
  finishDiscoveryJob,
  readDiscoveryJob,
  writeDiscoveryProgress,
} from "./product-discovery-jobs.server";
import {
  buildTopProducts,
  DISCOVERY_FINAL_N,
  runDeepAnalysisStep,
  runFinalRankStep,
  runGeminiShortlistStep,
  runScrapeFilterStep,
  type TopProduct,
} from "./product-discovery-pipeline.server";
import type { DiscoveryStep } from "./product-discovery-qstash.server";
import type {
  Consensus,
  FilterStats,
  NormalizedProduct,
  ProductDiscoveryInput,
  ProductDiscoveryStatus,
} from "./product-discovery.types";

/** Her adımın giriş/çıkış durumu ve ara ilerleme yüzdesi. */
export const STEP_TRANSITIONS: Record<
  DiscoveryStep,
  { from: ProductDiscoveryStatus; to: ProductDiscoveryStatus; progress: number }
> = {
  scrape_filter: { from: "queued", to: "scraping", progress: 15 },
  gemini: { from: "filtering", to: "gemini_shortlist", progress: 55 },
  deep: { from: "gemini_shortlist", to: "deep_analysis", progress: 80 },
  final: { from: "deep_analysis", to: "completed", progress: 100 },
};

export type StepOutcome =
  | {
      ok: true;
      step: DiscoveryStep;
      status: ProductDiscoveryStatus;
      progress: number;
      products: NormalizedProduct[];
      consensus: Consensus[];
      /**
       * Nihai 5 ürünün `top_products` sözleşmesi. Yalnız `final` adımı
       * doldurur; diğer adımlarda kazanan henüz seçilmediği için `undefined`.
       */
      topProducts?: TopProduct[];
      stats?: FilterStats;
      notes: string[];
    }
  | { ok: false; error: string };

/**
 * Adım çöktüğünde TEK yol: işi kapat ve krediyi bir kez iade et.
 *
 * `userId` çağırandan gelir ama iade hedefi satırdaki sahibe bağlanır
 * (`failAndRefund` iş kaydını yeniden okur) — gövdeye güvenilmez.
 */
async function failStep(runId: string, userId: string, message: string): Promise<void> {
  await failAndRefund(runId, message, (amount) =>
    refundFeatureCredits(userId, amount, "discovery_failed"),
  );
}

/**
 * TEK bir adımı çalıştırır ve sonucu döner.
 *
 * ÇAĞIRANIN SORUMLULUĞU: durum geçişini (`advanceDiscoveryStatus`) bu
 * fonksiyondan ÖNCE yapmak. Geçiş yapılamadıysa (başka teslimat aldı) adım
 * hiç çağrılmamalıdır; aksi hâlde aynı iş iki kez koşar.
 */
export async function executeProductDiscoveryStep(args: {
  step: DiscoveryStep;
  runId: string;
  userId: string;
  input: ProductDiscoveryInput;
  /** Önceki adımdan taşınan adaylar. */
  batch: unknown[];
  /** `deep` adımından taşınan oy satırları. */
  consensus: unknown[];
  /**
   * Bu adımın bitmesi gereken an (ms). Verilmezse adım kendi varsayılanını
   * kullanır (sunucu tarafı fonksiyonu için).
   *
   * NEDEN GEREKLİ: `deep` adımı 14 ajanı konuşturur ve dakikalar sürebilir.
   * Sürücü ona isteğin bitişine kadar zaman verdiğinde adım, platform isteği
   * KESMEDEN önce kendi kendine durur ve ara sonuçla döner; böylece iş yarıda
   * kalmaz, sonraki yoklama kaldığı yerden devam eder.
   */
  deadlineAt?: number;
}): Promise<StepOutcome> {
  const { step, runId, userId, input } = args;

  try {
    switch (step) {
      /* ---------------------------------------------------------- 1. adım */
      case "scrape_filter": {
        // AI YOK — saf kod. Kaynaklar fail-soft, her biri kendi tavanında.
        const result = await runScrapeFilterStep(input.niche, input.country, input.platform);
        if (!result.ok) {
          await failStep(runId, userId, "scrape_filter başarısız.");
          return { ok: false, error: "scrape_filter başarısız." };
        }

        // Filtre istatistikleri kalıcı yazılır: panel "neden bu sayı?" sorusunu
        // adım bittikten sonra da yanıtlayabilir.
        const stats = result.stats as FilterStats | undefined;
        await writeDiscoveryProgress(runId, {
          status: "filtering",
          progress: 35,
          step: "scrape_filter",
          stats,
        });

        const products = result.products as NormalizedProduct[];
        if (products.length === 0) {
          // Aday yoksa iş dürüstçe biter: sahte sonuç üretilmez, kredi iade edilir.
          const message = "Hiç kaynak doğrulanabilir ürün döndürmedi.";
          await failStep(runId, userId, message);
          return { ok: false, error: message };
        }
        return {
          ok: true,
          step,
          status: "filtering",
          progress: 35,
          products,
          consensus: [],
          stats,
          notes: result.notes,
        };
      }

      /* ---------------------------------------------------------- 2. adım */
      case "gemini": {
        // AI #1 — kısa liste (Top 75 → 25). Tek çağrı.
        const result = await runGeminiShortlistStep(
          args.batch as NormalizedProduct[],
          input.niche,
        );
        if (!result.ok) {
          await failStep(runId, userId, "gemini_shortlist başarısız.");
          return { ok: false, error: "gemini_shortlist başarısız." };
        }
        const products = result.products as NormalizedProduct[];
        if (products.length === 0) {
          const message = "Kısa listede aday kalmadı.";
          await failStep(runId, userId, message);
          return { ok: false, error: message };
        }
        await writeDiscoveryProgress(runId, { progress: 70, step: "gemini" });
        return {
          ok: true,
          step,
          status: "gemini_shortlist",
          progress: 70,
          products,
          consensus: [],
          notes: result.notes,
        };
      }

      /* ---------------------------------------------------------- 3. adım */
      case "deep": {
        // AI #2 — 14 AJAN GERÇEK OYU. Ölçülen hata: burada yalnız
        // `runCouncilOnProducts` çağrılıyordu, o da ikinci parametre
        // verilmediği için `deterministicVotes`a düşüyordu; ekranda "14 ajan"
        // yazarken modele hiçbir şey sorulmuyordu. Artık ROL BAŞINA tek çağrı
        // yapılır ve kaç rolün gerçekten konuştuğu loglanır.
        const result = await runDeepAnalysisStep(
          args.batch as NormalizedProduct[],
          input.niche,
          async (rows) => {
            const { runCouncilWithAi } = await import("./product-discovery-council-ai.server");
            const run = await runCouncilWithAi(rows as never, input.niche, {
              // Adımın kalan bütçesi: sonraki `final` adımına da zaman bırakılır.
              // Sürücü bir bitiş anı verdiyse o kullanılır (istek kesilmesin).
              deadlineAt: args.deadlineAt ?? Date.now() + 200_000,
            });
            console.log(
              `[discovery] konsey: ${run.aiAgents} rol gerçek AI, ` +
                `${run.fallbackAgents} rol deterministik yedek · ${run.ms}ms · ` +
                `ai roller: ${run.aiRoles.join(", ") || "-"}`,
            );
            return run.consensus;
          },
        );
        if (!result.ok) {
          await failStep(runId, userId, "deep_analysis başarısız.");
          return { ok: false, error: "deep_analysis başarısız." };
        }

        // Uzlaşma kayıtları `consensus` alanında taşınır (ürün şemasına
        // sığmaz), böylece `final` adımı gerçek oylarla sıralar.
        const consensus = (result.consensus ?? []) as Consensus[];
        if (consensus.length === 0) {
          const message = "Uzlaşma sonucu üretilemedi.";
          await failStep(runId, userId, message);
          return { ok: false, error: message };
        }
        await writeDiscoveryProgress(runId, { progress: 90, step: "deep" });
        return {
          ok: true,
          step,
          status: "deep_analysis",
          progress: 90,
          products: (result.products ?? []) as NormalizedProduct[],
          consensus,
          notes: result.notes,
        };
      }

      /* ---------------------------------------------------------- 4. adım */
      case "final": {
        // Uzlaşma (oy) satırları fingerprint ile aday ürünlere eşleşir.
        const byId = new Map(
          (args.batch as { fingerprint?: string }[]).map((p) => [String(p.fingerprint ?? ""), p]),
        );
        const ranked = runFinalRankStep(args.consensus as never, input.topN, byId as never);
        if (!ranked.ok) {
          await failStep(runId, userId, "final sıralama başarısız.");
          return { ok: false, error: "final sıralama başarısız." };
        }

        // NİHAİ 5 — 14 ajanın oyununun TEK çıktısı, dış sözleşmeye çevrilir.
        //
        // Buradaki sıralama 14 ajanın uzlaşmış `councilScore`'udur; bu
        // fonksiyon YENİDEN puanlama yapmaz, sadece kazanmış oyu dışarı
        // verilen `top_products` şekline çevirir. `ranked.products` YALNIZCA
        // kazananları içerir, bu yüzden `input.topN` (25) değil sonucun kendi
        // uzunluğu (5) kullanılır: 25 oy satırından 5'ini yeniden seçmek,
        // konseyin kararını ikinci bir kez sorgulamak olurdu.
        //
        // ÖNEMLİ: kaynak olarak `ranked.consensus` DEĞİL `ranked.products`
        // verilir. O satırlarda yalnız `candidateId` ve skor vardır; ürün adı,
        // parmak izi ve `signals` (talep/marj/rekabet) YOKTUR. Consensus
        // satırlarını verseydik her ürün `id:"unknown"`, `title:"İsimsiz ürün"`
        // ve "ölçülmedi" gerekçesiyle çıkardı — yani gerekçesiz bir liste.
        const { top_products } = buildTopProducts(
          (ranked.products ?? []) as never,
          DISCOVERY_FINAL_N,
        );

        const job = await readDiscoveryJob(runId);
        // Terminal yazma: `finish_discovery_job` yalnız `status='processing'`
        // iken yazar, bu yüzden iki teslimat çift sonuç üretemez.
        await finishDiscoveryJob(runId, {
          runId,
          input,
          products: ranked.products,
          consensus: ranked.consensus as Consensus[],
          stats: job?.stats ?? null,
          stepStats: {},
          sources: job?.stats?.perSource ?? [],
          // Nihai 5 ürünün sözleşmesi de KALICI SONUCUN parçasıdır: istemci
          // sonucu `searches.result`ten okur, adım yanıtından değil.
          topProducts: top_products,
        });

        return {
          ok: true,
          step,
          status: "completed",
          progress: 100,
          products: (ranked.products ?? []) as NormalizedProduct[],
          consensus: ranked.consensus as Consensus[],
          topProducts: top_products,
          notes: ranked.notes,
        };
      }

      default: {
        const message = `Bilinmeyen adım: ${String(step)}`;
        return { ok: false, error: message };
      }
    }
  } catch (error) {
    // Yakalanmamış hata: kullanıcı hata için ödemez.
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[discovery] adım ${step} çöktü:`, message);
    await failStep(runId, userId, `${step}: ${message}`);
    return { ok: false, error: message };
  }
}
