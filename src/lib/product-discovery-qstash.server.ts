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
  DiscoveryStepPayloadSchema,
  ProductDiscoveryInputSchema,
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
  progress: z.number().min(0).max(100).default(0),
});

/** Adım ucunun mutlak adresi. `PUBLIC_ORIGIN` yoksa istek origin'i kullanılır. */
export function stepEndpoint(origin: string, step: DiscoveryStep): string {
  return `${origin.replace(/\/$/, "")}/api/product-discovery/step?step=${step}`;
}

/** QStash'e yayınlanacak gövdeyi kurar (test edilebilir saf fonksiyon). */
export function buildStepBody(args: z.infer<typeof StepPublishSchema>): DiscoveryStepPayload {
  return DiscoveryStepPayloadSchema.parse({
    runId: args.runId,
    userId: args.userId,
    input: args.input,
    batch: args.products,
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
  progress: number;
  origin?: string;
}): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  const parsed = StepPublishSchema.safeParse({
    runId: args.runId,
    userId: args.userId,
    input: args.input,
    step: args.step,
    products: args.products,
    progress: args.progress,
  });
  if (!parsed.success) {
    return { ok: false, error: `INVALID_STEP_PAYLOAD:${parsed.error.issues[0]?.code ?? "?"}` };
  }

  const origin =
    (args.origin ??
    process.env["PUBLIC_ORIGIN"] ??
    process.env["VERCEL_URL"]?.replace(/^https?:\/\//, ""))
      ? `https://${(process.env["PUBLIC_ORIGIN"] ?? process.env["VERCEL_URL"] ?? "").replace(/^https?:\/\//, "")}`
      : "";

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
