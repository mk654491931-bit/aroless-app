// ============================================================================
// PRODUCT DISCOVERY — QSTASH YAYINLAYICI.
//
// Var olan `discovery-jobs.server.ts` QStash'i ham REST ile çağırır ve işi
// `/api/worker` ucuna bırakır. Bu modül AYNI altyapıyı kullanır farklı bir
// iş hattı kurar: adımları `/api/product-discovery/step` ucuna, HER BİRİ
// AYRI bir QStash mesajı olarak yayınlar.
//
// Neden ayrı modül (var olanı değiştirmeden):
//   • Mevcut ürün bulucu hattı çalışıyor ve testleri var; dokunulmaz.
//   • Bu hat FARKLI bir sözleşme taşır (75/15/14/5 adımları).
//   • `qstashFanOut` yeniden kullanılır → tek QStash istemci, tek ayar yeri.
//
// DEDUPE: `Upstash-Deduplication-Id` her adım için `runId:step` olur. QStash
// aynı kimliği 5 dakika içinde tekrar ederse mesajı TEKRARLAMAZ — yani bir
// ağ hatasında adım iki kez çalışmaz, kredi iki kez düşmez.
// ============================================================================

import { z } from "zod";

import {
  ConsensusSchema,
  DiscoveryStepPayloadSchema,
  ProductDiscoveryInputSchema,
  type Consensus,
  type DiscoveryStepPayload,
  type ProductDiscoveryInput,
} from "./product-discovery.types";

/** Bu hattın adımları. */
export const DISCOVERY_STEPS = ["scrape_filter", "gemini", "deep", "final"] as const;
export type DiscoveryStep = (typeof DISCOVERY_STEPS)[number];

const StepPublishSchema = z.object({
  runId: z.string().min(1),
  userId: z.string().min(1),
  input: ProductDiscoveryInputSchema,
  step: z.enum(DISCOVERY_STEPS),
  products: z.array(z.any()).default([]),
  consensus: z.array(ConsensusSchema).default([]),
  progress: z.number().min(0).max(100).default(0),
});

/** `enqueueDiscoveryStep` argümanı — `consensus` isteğe bağlıdır. */
type StepPublishArgs = Omit<z.input<typeof StepPublishSchema>, "consensus"> & {
  consensus?: unknown[];
};

/** Adım ucunun mutlak adresi. `PUBLIC_ORIGIN` yoksa istek origin'i kullanılır. */
export function stepEndpoint(origin: string, step: DiscoveryStep): string {
  return `${origin.replace(/\/$/, "")}/api/product-discovery/step?step=${step}`;
}

/**
 * QStash'in geri çağıracağı KENDİ AÇIK adresimizi çözer.
 *
 * DÜZELTME: Önceki sürüm `args.origin` değerini koşulda kontrol ediyor ama
 * gövdede yalnız ortam değişkenlerini okuyordu. Sonuç: açıkça geçilen origin
 * SESSİZCE yok sayılıyor, ortam değişkenleri de boşsa hedef `https://` gibi
 * geçersiz bir adrese dönüşüyordu ve hat ilk adımda ölüyordu. Artık
 * öncelik sırası: açık argüman → ortam → boş.
 *
 * Boş dönmesi "bilmiyorum" demektir; çağıran dürüstçe `NO_ORIGIN` hatası
 * verip işi kuyruğa almaz — sahte bir kuyruk onayı üretmek, kullanıcıdan
 * para alıp işi yapmamak anlamına gelirdi.
 */
export function resolveOrigin(explicit?: string, envMap: NodeJS.ProcessEnv = process.env): string {
  const raw =
    explicit?.trim() ||
    envMap["APP_URL"]?.trim() ||
    envMap["PUBLIC_APP_URL"]?.trim() ||
    envMap["PUBLIC_ORIGIN"]?.trim() ||
    envMap["VERCEL_PROJECT_PRODUCTION_URL"]?.trim() ||
    envMap["VERCEL_URL"]?.trim() ||
    "";
  if (!raw) return "";
  // `https://` öneki zaten varsa elle eklenmez (çift önek `https://https://` yapar).
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, "")}`;
  return withScheme.replace(/\/+$/, "");
}

/** QStash'e yayınlanacak gövdeyi kurar (test edilebilir saf fonksiyon). */
export function buildStepBody(args: StepPublishArgs): DiscoveryStepPayload {
  return DiscoveryStepPayloadSchema.parse({
    runId: args.runId,
    userId: args.userId,
    input: args.input,
    batch: args.products,
    consensus: args.consensus,
    progress: args.progress,
    status: "queued",
  });
}

/**
 * Bir adımı QStash'e yayınlar.
 *
 * QStash YAPILANDIRILMAMIŞSA hata fırlatmaz, `{ok:false}` döner: çağıran taraf
 * "iş kuyruğa alınamadı" diye dürüstçe kullanıcıya bildirip krediyi iade
 * edebilir. Sahte bir "kuyruğa alındı" yanıtı üretmek, kullanıcıdan para alıp
 * işi yapmamak anlamına gelirdi.
 */
export async function enqueueDiscoveryStep(args: {
  runId: string;
  userId: string;
  input: ProductDiscoveryInput;
  step: DiscoveryStep;
  products: unknown[];
  consensus?: Consensus[];
  progress: number;
  origin?: string;
}): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  const parsed = StepPublishSchema.safeParse({
    runId: args.runId,
    userId: args.userId,
    input: args.input,
    step: args.step,
    products: args.products,
    consensus: args.consensus ?? [],
    progress: args.progress,
  });
  if (!parsed.success) {
    return { ok: false, error: `INVALID_STEP_PAYLOAD:${parsed.error.issues[0]?.code ?? "?"}` };
  }

  const origin = resolveOrigin(args.origin);
  if (!origin) return { ok: false, error: "NO_ORIGIN" };

  // Mevcut istemciyi kullanır (QSTASH_TOKEN, timeout, forward başlıkları).
  const { qstashFanOut } = await import("./discovery-jobs.server");
  return qstashFanOut({
    url: stepEndpoint(origin, parsed.data.step),
    body: buildStepBody(parsed.data) as unknown as Record<string, unknown>,
    // AYNI İŞ İKİ KEZ ÇALIŞMAZ: runId+adım kimliği.
    dedupeId: `${parsed.data.runId}:${parsed.data.step}`,
  });
}
