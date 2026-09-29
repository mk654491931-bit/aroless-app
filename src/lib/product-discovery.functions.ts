// ============================================================================
// PRODUCT DISCOVERY — ARAYÜZ SUNUCU FONKSİYONLARI.
//
// Neden HTTP ucu değil de sunucu fonksiyonu:
//   `/api/product-discovery/stream` bir `EventSource` tüketicisi için
//   tasarlanmıştı; ancak `requireUser` `Authorization: Bearer` başlığı
//   zorunlu kılıyor ve tarayıcı `EventSource`'ı BAŞLIK GÖNDEREMEZ. Bu yüzden
//   tarayıcı yolu iki sunucu fonksiyonu üzerinden kurulur: oturum jetonu
//   sunucuda zaten mevcut, kimlik doğrulama otomatik.
//
// HAT NEREDE? Değişen bir şey yok: başlatma bu fonksiyondan yapılır, dört
// adımın tamamı `/api/product-discovery/step` üzerinden QStash'e yayınlanır.
// Yani ağır iş sunucusuz sınırına girmez; burada yalnız iki hızlı istek var.
//
// GERİ DÜŞME: `startDiscoveryRun` kuyruğa alamazsa `ok:false` döner ve
// çağıran (arayüz) ESKİ hatta düşer. Böylece yeni hat bir nedenle kurulamazsa
// ürün arama özelliği hiç çalışmaz olmaz.
// ============================================================================

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  chargeOnce,
  noCreditsResponse,
  creditUnavailableResponse,
  refundFeatureCredits,
} from "@/lib/credit-charge.server";
import { appOrigin } from "@/lib/discovery-jobs.server";
import { backgroundJobTimeoutMs, platformDurationSeconds } from "@/lib/host-runtime.server";
import { isBackgroundJobRunning, runInBackground } from "@/lib/job-runner.server";
import {
  createDiscoveryJob,
  failAndRefund,
  readDiscoveryInput,
  readDiscoveryJob,
  readDiscoveryResult,
} from "@/lib/product-discovery-jobs.server";
import { enqueueDiscoveryStep } from "@/lib/product-discovery-qstash.server";
import {
  clientDrivesChain,
  discoveryRunnerMode,
  MIN_STEP_BUDGET_MS,
  runDiscoveryChain,
} from "@/lib/product-discovery-runner.server";
import { ConsensusSchema, TopProductSchema, type TopProduct } from "@/lib/product-discovery.types";

/**
 * Sunucu fonksiyonu JSON'a çevrilmek ZORUNDA olduğu için sonuç `unknown`
 * olamaz. Bu yüzden veritabanındaki serbest JSON, TEK bir şemaya eşlenir.
 *
 * Bu sadece tip zorunluluğu değil, güvenlik sınırıdır: `searches.result`
 * sütunu ham JSON'dur ve şema burada elenir. Tanınmayan alan düşürülür, hatalı
 * tipler `.catch()` ile varsayılana düşer — arayüz ASLA patlamaz, en kötü
 * eksik alan görür.
 */
const SignalsSchema = z
  .object({
    demand: z.number().catch(50),
    competition: z.number().catch(50),
    margin: z.number().catch(50),
    rating: z.number().catch(50),
    availability: z.number().catch(50),
  })
  .catch({ demand: 50, competition: 50, margin: 50, rating: 50, availability: 50 });

export const DiscoveryWinnerSchema = z.object({
  name: z.string().catch(""),
  brand: z.string().catch(""),
  seller: z.string().catch(""),
  category: z.string().catch(""),
  priceUsd: z.number().nullable().catch(null),
  rating: z.number().nullable().catch(null),
  ratingCount: z.number().nullable().catch(null),
  inStock: z.boolean().nullable().catch(null),
  sources: z.array(z.string()).catch([]),
  url: z.string().catch(""),
  notes: z.string().catch(""),
  preScore: z.number().catch(0),
  dataCompleteness: z.number().catch(0),
  fingerprint: z.string().catch(""),
  signals: SignalsSchema,
  // 14 ajan konsesyinden gelen alanlar (`final` adımı bunları üstüne yazar).
  councilScore: z.number().catch(0),
  confidenceScore: z.number().catch(0),
  votes: z.number().catch(0),
  agreement: z.number().catch(0),
  evidence: z.array(z.string()).catch([]),
});
export type DiscoveryWinner = z.infer<typeof DiscoveryWinnerSchema>;

/** DB'deki ham sonucu arayüze gönderilebilir tek şemaya indirger. */
export function parseDiscoveryResult(raw: unknown): {
  products: DiscoveryWinner[];
  consensus: z.infer<typeof ConsensusSchema>[];
  /**
   * Nihai 5 ürünün sözleşmesi.
   *
   * ZORUNLU DEĞİL: `final` adımından ÖNCE yazılmış satırlarda ve eski
   * koşularda bu alan yoktur. O durumda boş liste döner (arayüz gerekçeyi
   * göstermek yerine ürün kartlarını olduğu gibi basar), hata fırlatmaz —
   * bir sonuç okunamadığında kullanıcı hata görür, boş gerekçe görmez.
   */
  topProducts: TopProduct[];
} {
  const record = (raw ?? {}) as Record<string, unknown>;
  const products = z.array(DiscoveryWinnerSchema).safeParse(record["products"]);
  const consensus = z.array(ConsensusSchema).safeParse(record["consensus"]);
  const topProducts = z.array(TopProductSchema).safeParse(record["topProducts"]);
  return {
    products: products.success ? products.data : [],
    consensus: consensus.success ? consensus.data : [],
    topProducts: topProducts.success ? topProducts.data : [],
  };
}

/** Bu özellik hangi kredi kovalından düşüyor? Mevcut `generateProducts` ile aynı. */
const FEATURE = "agent-pipeline" as const;

/**
 * Bir yoklamanın sürücüye verebileceği en uzun süre (ms).
 *
 * NEDEN 150 SN: işin en pahalı adımı 14 ajanın konuştuğu `deep` adımıdır ve
 * konsey, süre bitince kalan rolleri deterministiğe düşürerek HER ZAMAN
 * tamamlanır. 150 sn, 14 rolün tamamına (rol başına ~6 sn) yetecek kadar geniş,
 * ama arayüzün "tıkla → sonuç" penceresini (280 sn) tek bir yoklamada yakmaya
 * yetmeyecek kadar dardır. Böylece zincir en kötü durumda bile sözünü tutar.
 */
const DRIVER_BUDGET_MS = 150_000;

/**
 * HİÇBİR TAŞIYICI İLERLEME KAYDETMEDEN GEÇEBİLECEĞİ EN UZUN SÜRE.
 *
 * NEDEN VAR: zincirin sahibi QStash'tir ve bir adım teslimatı başarısız
 * olduğunda (401, zaman aşımı, yeniden denemelerin bitmesi) SATIR HİÇBİR
 * ZAMAN GÜNCELLENMEZ — `processing`e takılı kalır. Ölçülen belirti: kullanıcı
 * "Analiz sunucuda çalışmaya devam ediyor" yazısını yarım saat gördü.
 *
 * Değer `STALE_STEP_TAKEOVER_MS`in (90 sn) birçok katıdır: 90 sn, yoklamanın
 * "kuyruk ölmüş olabilir, devral" demesi için gereken süredir; bu eşik ise
 * devralma da yetmezse işin GERÇEKTEN ölü sayılacağı noktadır. Aradaki
 * fark dürüstlük payıdır: adımlar kuyrukta beklerken satır güncellenmez.
 */
const STALLED_RUN_ABANDON_MS = 20 * 60_000;

/**
 * Sürücü bütçesi: platformun istek tavanından türetilir (yanıt için 20 sn pay).
 *
 * NEDEN `interactiveRequestBudgetMs` DEĞİL: o bütçe etkileşimli (hızlı) uçlar
 * içindir ve kalıcı süreçte 45 sn'dir. Bu yoklama ise doğrudan "ağır adımı
 * koştur" çağrısıdır; sınırı platformun kendi tavanıdır — Vercel'de 300 sn,
 * kalıcı süreçte 900 sn. Kısa bir bütçe vermek 14 ajanın yalnız birkaçının
 * konuşmasına yol açardı (yani özellik "çalışıyor ama eksik" görünürdü).
 */
function driverBudgetMs(): number {
  const usable = platformDurationSeconds() * 1000 - 20_000;
  return Math.min(DRIVER_BUDGET_MS, Math.max(MIN_STEP_BUDGET_MS, usable));
}

const StartSchema = z.object({
  niche: z.string().min(2).max(120),
  country: z.string().min(2).max(4).default("US"),
  platform: z.string().max(40).default("General"),
  topN: z.number().int().min(1).max(10).default(5),
});

const StatusSchema = z.object({ runId: z.string().uuid() });

/** İstekten ham erişim jetonunu okur (kredi düşme sunucu tarafında çalışır). */
function bearerToken(): string {
  try {
    const request = getRequest();
    return (request?.headers?.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  } catch {
    return "";
  }
}

export type DiscoveryRunStatus = {
  ok: true;
  runId: string;
  status: string;
  progress: number;
  step: string;
  /** Yalnız terminal durumda dolar: kazanan ürünler + uzlaşma + nihai 5'in gerekçesi. */
  result: {
    products: DiscoveryWinner[];
    consensus: z.infer<typeof ConsensusSchema>[];
    topProducts: TopProduct[];
  } | null;
  error: string | null;
};

/* --------------------------------------------------------------- Başlat */

/**
 * Yeni hatta bir koşu başlatır.
 *
 * KREDİ SIRASI (para kaybını önleyen sıra): düş → kayıt aç → ZİNCİRİ TAŞI.
 *   • kredi düşüldü ama kayıt açılamadıysa → hemen iade
 *   • kayıt açıldı ama zincir hiçbir taşıyıcıyla kurulamadıysa → `failAndRefund`
 *
 * TAŞIYICI SEÇİMİ (`discoveryRunnerMode`) — ÖNCEKİ HATANIN KÖKÜ BURASIYDI:
 * zincir yalnız QStash'e bağlıydı ve üç anahtardan biri eksikse hat sessizce
 * ölüyordu. Artık:
 *   • `qstash`     → anahtarlar tam: adım kuyruğa yayınlanır (en verimli yol).
 *   • `in-process` → kalıcı süreç: zincir arka planda koşar; istemci sekmeyi
 *                    kapatsa bile iş biter.
 *   • `inline`     → ikisi de yok: zinciri istemcinin yoklaması sürer
 *                    (`advanceDiscoveryRun`). Bu yolda `/start` ASLA
 *                    `queue-failed` dönüp eski hatta düşmez.
 */
export const startDiscoveryRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(StartSchema)
  .handler(async ({ data, context }) => {
    const token = bearerToken();
    const runId = crypto.randomUUID();

    const charge = await chargeOnce({
      userId: context.userId,
      token,
      feature: FEATURE,
      chargeKey: `discovery:${runId}`,
    });
    if (!charge.ok) {
      // Kredi uçları 403/402 döner; arayüz bu iki durumu zaten tanıyor.
      if (charge.reason === "NO_CREDITS") {
        noCreditsResponse(1, FEATURE);
        return { ok: false, reason: "no-credits" };
      }
      creditUnavailableResponse();
      return { ok: false, reason: "credit-unavailable" };
    }

    try {
      await createDiscoveryJob({
        runId,
        userId: context.userId,
        input: data,
        chargedCredits: charge.charged,
      });
    } catch (error) {
      await refundFeatureCredits(
        context.userId,
        charge.charged,
        "job_row_failed",
        // Aynı koşu için iki ayrı hata yolu çalışsa (kayıt + kuyruk) kredi
        // bir kez iade edilir: anahtar veritabanında tekilleştirilir.
        `discovery:${runId}:job_row_failed`,
      );
      return {
        ok: false,
        reason: "queue-failed",
        detail: error instanceof Error ? error.message : "job_row_failed",
      };
    }

    const mode = discoveryRunnerMode();

    if (mode === "in-process") {
      // Kalıcı süreçte iş arka planda koşar: istek ANINDA döner, kullanıcı
      // sekmesini kapatsa bile zincir tamamlanır.
      const started = runInBackground(
        "product-discovery",
        () =>
          runDiscoveryChain({
            runId,
            userId: context.userId,
            input: data,
            budgetMs: backgroundJobTimeoutMs(),
          }),
        { key: runId },
      );
      if (!started.started && started.reason !== "duplicate") {
        // Arka plan kuyruğu yok → istek içi yol devralır (istemci yoklar).
        console.warn(`[discovery] arka plan başlatılamadı: ${started.reason}`);
        return { ok: true, runId, charged: charge.charged, mode: "inline" };
      }
      return { ok: true, runId, charged: charge.charged, mode };
    }

    if (mode === "qstash") {
      let origin = "";
      try {
        const request = getRequest();
        if (request) origin = appOrigin(request);
      } catch {
        origin = "";
      }
      const queued = await enqueueDiscoveryStep({
        runId,
        userId: context.userId,
        input: data,
        step: "scrape_filter",
        products: [],
        progress: 10,
        origin,
      });
      if (queued.ok) return { ok: true, runId, charged: charge.charged, mode };

      // Kuyruk yapılandırılmış ama yayın başarısız. İş ASLA ölmez: zinciri
      // istemcinin yoklaması sürdürür (ara nokta DB'de). Eskiden burada iş
      // başarısız sayılıp kredi iade ediliyordu — yani kullanıcı özelliği
      // hiç kullanamıyordu. Artık yalnız uyarı loglanır ve hat inline devam eder.
      console.warn(`[discovery] QStash yayını başarısız, inline devam: ${queued.error}`);
    }

    // `inline`: zinciri istemci yoklaması sürer. `/start` yalnız kaydı açar.
    return { ok: true, runId, charged: charge.charged, mode: "inline" };
  });

/* ------------------------------------------------------------- Teşhis */

/**
 * Hat çalışmaya hazır mı? (tarayıcıdan çağrılabilen TEK yol)
 *
 * NEDEN SUNUCU FONKSİYONU ve neden ayrıca bir HTTP ucu yetmiyor: bu projenin
 * `requireUser`/`requireSupabaseAuth` koruması `Authorization: Bearer <jeton>`
 * başlığını ZORUNLU tutuyor. Bir tarayıcı adres çubuğu bu başlığı gönderemez
 * (gönderirse sayfa geçersiz olur). Yani aynı bilgiyi döndüren bir
 * `GET /api/...` ucu kurmak, kullanıcıya "giriş yapmalısınız" cevabından başka
 * bir şey göstermiyor — ölçüldü: kullanıcı adresi açtı ve tam olarak bu cevabı
 * aldı. Sunucu fonksiyonu ise oturum jetonunu sunucuda okur, bu yüzden
 * uygulamanın İÇİNDEN çağrılabilir.
 *
 * Hata YUTMAZ: teşhis aracının kendisi çökerse `ok:false` döner; çağıran yine
 * de ham sebebi gösterebilir.
 */
export const getDiscoveryPreflight = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({}))
  .handler(async () => {
    const { runDiscoveryPreflight } = await import("@/lib/product-discovery-preflight.server");
    try {
      return await runDiscoveryPreflight();
    } catch (error) {
      return {
        ok: false as const,
        checks: [],
        summary: "Kurulum durumu okunamadı",
        error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      };
    }
  });

/* ---------------------------------------------------------------- Durum */

/**
 * Koşunun durumunu (ve terminal ise sonucunu) okur.
 *
 * SAHİPLİK KONTROLÜ ZORUNLU: `runId` gövdeden gelir, bu yüzden satırın
 * `user_id`'si çağıran kullanıcıyla karşılaştırılır. Başkasının koşusu okunamaz
 * (403) — sonuçta onun satın alma verisi de vardır.
 */
export const getDiscoveryRun = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(StatusSchema)
  .handler(async ({ data, context }) => {
    const snapshot = await readRunSnapshot(data.runId, context.userId);
    return snapshot ?? { ok: false as const };
  });

/**
 * Koşunun durumunu (ve terminal ise sonucunu) TEK biçimde okur.
 *
 * İki sunucu fonksiyonu da (`getDiscoveryRun`, `advanceDiscoveryRun`) aynı
 * gövdeyi döndürür; arayüzün yoklama döngüsü hangisini çağırdığını bilmek
 * zorunda kalmasın diye tek yerde tutulur.
 */
async function readRunSnapshot(
  runId: string,
  userId: string,
): Promise<DiscoveryRunStatus | { ok: false } | null> {
  const job = await readDiscoveryJob(runId);
  // SAHİPLİK: `runId` gövdeden gelir, satırın sahibi karşılaştırılır.
  if (!job || job.userId !== userId) return null;

  const result =
    job.discoveryStatus === "completed"
      ? parseDiscoveryResult(await readDiscoveryResult(runId))
      : null;

  return {
    ok: true,
    runId: job.id,
    status: job.discoveryStatus,
    progress: job.discoveryProgress,
    step: job.discoveryStep,
    result,
    error: job.error,
  };
}

/* --------------------------------------------------------------- Sürücü */

/**
 * Zinciri BİR ADIM İLERLETİR ve güncel durumu döner.
 *
 * NEDEN AYRI FONKSİYON: kuyruk (QStash) yapılandırılmamış bir kurulumda
 * ağır işi taşıyacak başka bir şey yoktur. Ağır işi istek İÇİNDE bir kerede
 * koşturmak sunucusuz süre tavanına dayanır; bunun yerine iş PARÇALARA
 * bölünür ve her yoklama bir parça ilerletir. İlerleme veritabanındaki ara
 * noktada tutulduğu için sekme kapansa da kalan yoklamalar/kurulum devam eder.
 *
 * `runDiscoveryChain` sahiplemeyi compare-and-swap ile yapar: adımı başka bir
 * taşıyıcı (ör. aynı anda gelen bir QStash teslimatı) aldıysa bu çağrı hiçbir
 * şey yapmaz. Yani iki yol birlikte açıkken bile iş iki kez koşmaz.
 */
export const advanceDiscoveryRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(StatusSchema)
  .handler(async ({ data, context }) => {
    const job = await readDiscoveryJob(data.runId);
    if (!job || job.userId !== context.userId) return { ok: false as const };

    const terminal = job.status === "completed" || job.status === "failed";
    // Arka plan işi (kalıcı süreç) bu koşuyu zaten sürüyorsa ikinci bir
    // sürücü başlatmayız: iş ikiye katlanır ve gereksiz AI maliyeti doğar.
    const backgroundOwned = isBackgroundJobRunning(data.runId);

    // SUNUCU WATCHDOG'U — ÖLÜ NOKTANIN KAPANMASI.
    //
    // Ölçülen hata: bir koşu `processing` durumunda KALICI olarak takılabiliyor
    // (QStash teslimatı 401 alır, yeniden denemeler biter, bir adım çöküp
    // zincir sonraki adımı yayınlamaz). Ölçülen belirti: kullanıcı EKRANDA
    // "Analiz sunucuda çalışmaya devam ediyor" yazısını YARIM SAAT gördü ve
    // mesaj asla değişmedi — çünkü satır ne `completed` ne `failed` oluyordu.
    // Yani bu bir "yavaşlık" değil, sessiz bir ÖLÜM'dü ve kullanıcıya
    // ne sebep ne de sonuç gösteriliyordu.
    //
    // DÜZELTME: hiçbir taşıyıcı ilerleme kaydetmemişse iş dürüstçe `failed`
    // yapılır ve kredi bir kez iade edilir. Böylece "yarım saat" yerine
    // kullanıcı GERÇEK SEBEBİ görür.
    if (!terminal && !backgroundOwned && job.updatedAt !== null) {
      if (Date.now() - job.updatedAt > STALLED_RUN_ABANDON_MS) {
        await failAndRefund(
          data.runId,
          "stalled_no_carrier",
          (amount) => refundFeatureCredits(job.userId, amount, "stalled"),
        );
        return (await readRunSnapshot(data.runId, context.userId)) ?? { ok: false as const };
      }
    }

    // QSTASH SAHİPLERİNİ, YOKLAMA DEĞİL.
    //
    // Ölçülen hata: yoklama isteği zinciri KOŞUDUĞU için QStash'e yayınlanan
    // adımlar kuyrukta beklerken aynı adım tarayıcının isteği içinde
    // çalışıyordu. Yani kuyruk kurulu olmasına rağmen ağır iş yine tek bir
    // HTTP isteğinde bitiyor, o istek platform tavanına dayanıyor ve kullanıcı
    // "Arka plan analizi zaman aşımına uğradı" kartını görüyordu.
    //
    // DÜZELTME: kuyruk yapılandırılmışsa yoklama yalnız DURUMU okur
    // (`clientDrivesChain`). Zinciri kuyruğun taşıması için istemci sekmesinin
    // açık kalmasına gerek yok. Satır bayatladığında yoklama devralır, yani
    // kuyruk sessizce ölürse iş yine bırakılmaz.
    const queueDrives = !clientDrivesChain(discoveryRunnerMode(), job.updatedAt);

    if (!terminal && !backgroundOwned && !queueDrives) {
      try {
        // Girdi (niş/ülke/platform/topN) `/start`ta `searches.params`e yazıldı:
        // istemciden yeniden almak, her yoklamada gövde taşımak ve gövdeye
        // güvenmek demek olurdu. Hat kendi girdisini kendi deposundan okur.
        const input = await readDiscoveryInput(data.runId);
        if (input) {
          await runDiscoveryChain({
            runId: data.runId,
            userId: job.userId,
            input,
            budgetMs: driverBudgetMs(),
          });
        } else {
          // Girdi okunamıyorsa hat koşturulamaz. İşi sonsuza kadar "kuyrukta"
          // bırakmak, kullanıcının ödediği krediyi sessizce yakmak olurdu:
          // dürüst bir hata + TAM BİR KEZ iade.
          await failAndRefund(data.runId, "discovery_input_unreadable", (amount) =>
            refundFeatureCredits(job.userId, amount, "input_unreadable"),
          );
        }
      } catch (error) {
        // Sürücü çökerse istemcinin yoklaması DURMAZ: durum yine okunur ve
        // kullanıcı gerçek durumu görür (sessizce "takılı" ekran yerine).
        console.warn(
          `[discovery] sürücü hatası: ${error instanceof Error ? error.message : "unknown"}`,
        );
      }
    }

    return (await readRunSnapshot(data.runId, context.userId)) ?? { ok: false as const };
  });
