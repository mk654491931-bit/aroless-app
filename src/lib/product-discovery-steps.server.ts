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
  GEMINI_SHORTLIST_SIZE,
  geminiShortlistSelector,
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

/**
 * `gemini` adımı için en fazla kaç DİLİM harcanır.
 *
 * NEDEN 3: tek bir dilim yetmezse (soğuk anahtar havuzu, geçici 429) adım
 * hemen deterministik yedeğe düşerdi; bunun yerine 2 kez daha denenir. Üçüncü
 * denemeden sonra adım YİNE deterministik sıralamayla BİTER, yani hat modele
 * asla takılı kalmaz. 3 dilim ≈ 30 sn üst sınır demektir.
 */
export const GEMINI_MAX_SLICES = 3;

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
      /**
       * `true` → ADIM BU DİLİMDE BİTMEDİ.
       *
       * Çağıran (runner/route) bu durumda `done`e yazmaz, ilerlemeyi dilim
       * defterine kaydeder ve AYNI adımın sıradaki dilimini koşar. Uzun adımlar
       * (`gemini`, `deep`) böylece tek bir sunucusuz fonksiyonu dakikalarca
       * meşgul etmez; her teslimat en fazla bir dilim sürer.
       */
      partial?: boolean;
      /** Sıradaki dilime taşınacak kısmi durum (ör. konseyde konuşan roller). */
      sliceState?: unknown;
      /** Adım bitmediyse kalan iş birimi sayısı (teşhis/log). */
      sliceRemaining?: number;
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
  /** BU dilimin bitmesi gereken an (ms) — tüm model çağrıları bunu aşamaz. */
  sliceDeadlineAt?: number;
  /** Bu teslimatın dilim numarası (0 tabanlı). */
  slice?: number;
  /** Önceki dilimlerden taşınan kısmi durum (adıma özel). */
  sliceState?: unknown;
  /** Zincir süresi bitti: adım kalan işi deterministiğe düşürüp BİTMELİ. */
  forceFinish?: boolean;
}): Promise<StepOutcome> {
  const { step, runId, userId, input } = args;
  // DİLİM BAĞLAMI — tek yerde çözülür ki tüm adımlar aynı pencereyi görsün.
  const slice = Number.isFinite(args.slice) && (args.slice as number) > 0 ? Math.floor(args.slice as number) : 0;
  const sliceDeadline = args.sliceDeadlineAt ?? args.deadlineAt ?? Date.now() + 8_000;
  const forceFinish = args.forceFinish === true;

  try {
    switch (step) {
      /* ---------------------------------------------------------- 1. adım */
      case "scrape_filter": {
        // AI YOK — saf kod. Kaynaklar fail-soft, PARALEL ve her biri kendi
        // tavanında koşar; ayrıca DİLİM tavanına kırpılır.
        //
        // NEDEN KIRPMA: kaynak zaman aşımları 3-8 sn arasındadır ve 10 sn'lik
        // dilime normalde sığar. Ama yavaş bir kaynak (ağ, yavaş DNS) adımı
        // dilimin ötesine taşırsa istek platform tarafından kesilir ve o anda
        // ne ürün ne ara nokta yazılmış olur — kullanıcı için "hiç olmamış"
        // gibi görünür. Kırpma, dilimin HER ZAMAN kendi sınırında dönmesini
        // sağlar; geç kalan kaynak "çalışmadı" olarak raporlanır (kaynak
        // raporu dürüst kalır, uydurma veri üretilmez).
        const sourceCapMs = Math.max(2_000, sliceDeadline - Date.now() - 1_000);
        const result = await runScrapeFilterStep(
          input.niche,
          input.country,
          input.platform,
          undefined,
          { sourceCapMs },
        );
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
        // AI #1 — kısa liste (Top 75 → 25).
        //
        // DİLİM PLANI: her dilim modeli EN FAZLA BİR KEZ dener.
        //
        // ÖLÇÜLEN HATA (dilimlemeden önce): `callGemini` 5 anahtar × 4 model
        // deniyor ve teorik olarak ~240 sn sürebiliyordu. Tek başına zincirin
        // kalanına yer bırakmadığı için sonuç ya gelmiyor ya da 300 sn sonra
        // geliyordu. Artık deneme penceresi DİLİMDİR: pencere dolarsa çağrı
        // kesilir, ilerleme kaydedilir ve sıradaki dilim yeniden dener. Birkaç
        // denemede de model konuşmazsa adım deterministik sıralamayla biter —
        // yani hat modele TAKILI KALMAZ, yalnız gerçekten cevap verirse onu
        // kullanır (uydurma değil, dürüst yedek).
        const candidates = args.batch as NormalizedProduct[];
        const picks = await geminiShortlistSelector(candidates, input.niche, sliceDeadline);

        if (!picks.length && !forceFinish && slice + 1 < GEMINI_MAX_SLICES) {
          console.log(
            `[discovery] gemini dilimi ${slice + 1}/${GEMINI_MAX_SLICES}: yanıt yok, ` +
              `${GEMINI_MAX_SLICES - (slice + 1)} deneme kaldı`,
          );
          return {
            ok: true,
            step,
            // Durum İLERLEMEZ: adım bitmedi, yalnız bir dilim harcandı.
            status: "gemini_shortlist",
            progress: 55,
            products: candidates,
            consensus: [],
            partial: true,
            sliceRemaining: GEMINI_MAX_SLICES - (slice + 1),
            notes: [
              `Gemini bu dilimde yanıt vermedi (deneme ${slice + 1}/${GEMINI_MAX_SLICES}); ` +
                `sıradaki dilim yeniden denenecek.`,
            ],
          };
        }

        // Model konuştuysa ONUN seçimi kullanılır; konuşmadıysa boş liste
        // verilir ve `selectWithGemini` deterministik sırayla tamamlar.
        const result = await runGeminiShortlistStep(
          candidates,
          input.niche,
          GEMINI_SHORTLIST_SIZE,
          async () => picks,
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
        //
        // DİLİM PLANI: her dilim EN FAZLA BİR DALGA (varsayılan 4 rol) koşar.
        // Konuşan roller ve puanları ara noktaya yazılır; sıradaki dilim tam
        // olarak kaldığı yerden devam eder. Böylece 14 ajanlı konsey tek bir
        // fonksiyonu dakikalarca meşgul etmez (kullanıcının istediği 10 sn'lik
        // dilim kuralı) ve hiçbir model çağrısı İKİ KEZ yapılmaz (`done` defteri).
        const candidates = args.batch as NormalizedProduct[];
        const { runCouncilSlice } = await import("./product-discovery-council-ai.server");
        const council = await runCouncilSlice(candidates as never, input.niche, {
          state: (args.sliceState ?? undefined) as never,
          sliceDeadlineAt: sliceDeadline,
          // Dilimin YARISI kadar süre kaldıysa yeni dalga başlatılır: sabit 4 sn
          // eşiği, kısaltılmış dilimlerde (ör. 5 sn) konseyi hiç konuşturmazdı.
          minCallMs: Math.min(4_000, Math.max(1_500, Math.floor((sliceDeadline - Date.now()) / 2))),
          // Zincir süresi bittiyse adım kalan rolleri deterministiğe düşürüp
          // BİTİR: yeni dilim yayınlamak 280 sn sözünü aşardı.
          force: forceFinish,
        });

        if (council.partial) {
          const tried = council.state.done.length;
          console.log(
            `[discovery] konsey dilimi ${slice + 1}: ${tried} rol denendi, ` +
              `${council.remaining} rol kaldı · ${council.ms}ms`,
          );
          return {
            ok: true,
            step,
            // Durum İLERLEMEZ: adım bitmedi, yalnız bir dilim harcandı.
            status: "deep_analysis",
            progress: 85,
            products: candidates,
            consensus: [],
            partial: true,
            sliceState: council.state,
            sliceRemaining: council.remaining,
            notes: [
              `Konsey dilimi ${slice + 1}: ${tried} rol denendi, ` +
                `${council.remaining} rol sıradaki dilimde konuşacak.`,
            ],
          };
        }

        console.log(
          `[discovery] konsey: ${council.aiAgents} rol gerçek AI, ` +
            `${council.fallbackAgents} rol deterministik yedek · ${council.ms}ms · ` +
            `ai roller: ${council.aiRoles.join(", ") || "-"}`,
        );

        // Uzlaşma kayıtları `consensus` alanında taşınır (ürün şemasına
        // sığmaz), böylece `final` adımı gerçek oylarla sıralar.
        const consensus = council.consensus as Consensus[];
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
          products: candidates,
          consensus,
          notes: [
            `14 ajan ${candidates.length} adayı değerlendirdi ` +
              `(${council.aiAgents} rol gerçek AI, ${council.fallbackAgents} rol deterministik yedek).`,
          ],
        };
      }

      /* ---------------------------------------------------------- 4. adım */
      case "final": {
        // Uzlaşma (oy) satırları adaylara İKİ ANAHTARLA eşleşir: ürünün parmak
        // izi VE konseyin sıra anahtarı (`P7`).
        //
        // Ölçülen hata: eski eşleme YALNIZ parmak izine bakıyordu; konsey bir
        // ürünün parmak izini boş görüp `candidateId: "P7"` yazdığında o
        // kazanan ürün eşleşemiyor ve **listeden düşüyordu**. Kullanıcı 14
        // ajanın seçtiği ürünler yerine eksik ya da boş bir liste
        // görebiliyordu. İki anahtar da yazılır: 14 ajanın seçtiği ürün HER
        // ZAMAN teslim edilir.
        const byId = new Map<string, NormalizedProduct>();
        (args.batch as NormalizedProduct[]).forEach((product, index) => {
          const fingerprint = String(product.fingerprint ?? "");
          if (fingerprint) byId.set(fingerprint, product);
          byId.set(`P${index + 1}`, product);
        });
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
