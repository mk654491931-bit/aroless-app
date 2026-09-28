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
import {
  createDiscoveryJob,
  failAndRefund,
  readDiscoveryJob,
  readDiscoveryResult,
} from "@/lib/product-discovery-jobs.server";
import { enqueueDiscoveryStep } from "@/lib/product-discovery-qstash.server";
import { ConsensusSchema } from "@/lib/product-discovery.types";

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
} {
  const record = (raw ?? {}) as Record<string, unknown>;
  const products = z.array(DiscoveryWinnerSchema).safeParse(record["products"]);
  const consensus = z.array(ConsensusSchema).safeParse(record["consensus"]);
  return {
    products: products.success ? products.data : [],
    consensus: consensus.success ? consensus.data : [],
  };
}

/** Bu özellik hangi kredi kovalından düşüyor? Mevcut `generateProducts` ile aynı. */
const FEATURE = "agent-pipeline" as const;

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
  /** Yalnız terminal durumda dolar: kazanan ürünler + uzlaşma. */
  result: { products: DiscoveryWinner[]; consensus: z.infer<typeof ConsensusSchema>[] } | null;
  error: string | null;
};

/* --------------------------------------------------------------- Başlat */

/**
 * Yeni hatta bir koşu başlatır.
 *
 * KREDİ SIRASI (para kaybını önleyen sıra): düş → kayıt aç → kuyruğa al.
 *   • kredi düşüldü ama kayıt açılamadıysa → hemen iade
 *   • kayıt açıldı ama kuyruğa alınamadıysa → `failAndRefund` (tam bir kez)
 * Kuyruk/hat kurulamadığında `ok:false` döner; arayüz eski hatta düşer.
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
    if (!queued.ok) {
      await failAndRefund(runId, `queue_failed: ${queued.error}`, (amount) =>
        refundFeatureCredits(context.userId, amount, "queue_failed"),
      );
      return { ok: false, reason: "queue-failed", detail: queued.error };
    }

    return { ok: true, runId, charged: charge.charged };
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
    const job = await readDiscoveryJob(data.runId);
    if (!job || job.userId !== context.userId) return { ok: false };

    const terminal = job.discoveryStatus === "completed" || job.discoveryStatus === "failed";
    const result =
      terminal && job.discoveryStatus === "completed"
        ? parseDiscoveryResult(await readDiscoveryResult(data.runId))
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
  });
