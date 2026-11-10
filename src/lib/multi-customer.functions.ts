import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callAiMesh, extractJson, withDeadline } from "@/lib/ai.server";
import { chargeForAi, withCreditRefund } from "@/lib/credit-guard.server";

/**
 * Multi Customer'ın OPSİYONEL AI yorumu.
 *
 * 1.000 kişilik panelin kendisi deterministik ve yerel çalışır; bu fonksiyon
 * yalnızca aynı sonucu okunur bir stratejiye çevirmek için TEK bir LLM çağrısı
 * yapar. Böylece "1.000 kişi = 1.000 AI çağrısı" maliyeti oluşmaz.
 *
 * Vercel/env tarafında yapılandırılmış AI anahtarları (`GEMINI_API_KEY_*`,
 * `GROQ_API_KEY_*`, `OPENROUTER_API_KEY_*` vb.) mevcut `callAiMesh` havuzu
 * üzerinden kullanılır. Anahtar yoksa yalnız bu opsiyonel yorum başarısız olur;
 * simülasyon çalışmaya devam eder.
 */

const MULTI_CUSTOMER_FEATURE = "tool:multi-customer";

export const MultiCustomerAiInput = z.object({
  productName: z.string().min(1).max(200),
  priceUsd: z.number().nullable().optional(),
  platform: z.string().max(80).optional().default(""),
  audience: z.string().max(300).optional().default(""),
  buyers: z.number().int().min(0).max(1000),
  nonBuyers: z.number().int().min(0).max(1000),
  penetrationPct: z.number().min(0).max(100),
  confidencePct: z.number().min(0).max(100),
  signals: z.array(z.string().max(40)).max(10).optional().default([]),
  missingSignals: z.array(z.string().max(40)).max(10).optional().default([]),
  segments: z
    .array(
      z.object({
        label: z.string().max(80),
        total: z.number().int().min(0).max(1000),
        buyers: z.number().int().min(0).max(1000),
        ratePct: z.number().min(0).max(100),
      }),
    )
    .max(10)
    .optional()
    .default([]),
  reasons: z
    .array(z.object({ label: z.string().max(120), count: z.number().int().min(0) }))
    .max(8)
    .optional()
    .default([]),
  objections: z
    .array(z.object({ label: z.string().max(120), count: z.number().int().min(0) }))
    .max(8)
    .optional()
    .default([]),
});

export type MultiCustomerAiInsight = {
  summary: string;
  buyer_profile: string;
  non_buyer_profile: string;
  segments: Array<{ label: string; verdict: string; action: string }>;
  objections: Array<{ objection: string; fix: string }>;
  actions: string[];
  caveat: string;
};

export const explainMultiCustomer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => MultiCustomerAiInput.parse(input))
  .handler(async ({ data, context }): Promise<MultiCustomerAiInsight> => {
    await chargeForAi(() => context.supabase.rpc("deduct_product_finder_credit"), 1, {
      userId: context.userId,
      feature: MULTI_CUSTOMER_FEATURE,
      db: context.supabase,
    });

    return withCreditRefund(
      context.userId,
      async () => {
        const segmentLines = data.segments
          .map(
            (segment) =>
              `- ${segment.label}: ${segment.buyers}/${segment.total} alıcı (%${segment.ratePct.toFixed(1)})`,
          )
          .join("\n");
        const reasonLines = data.reasons
          .map((reason) => `- ${reason.label} (${reason.count} kişi)`)
          .join("\n");
        const objectionLines = data.objections
          .map((objection) => `- ${objection.label} (${objection.count} kişi)`)
          .join("\n");

        const prompt = `Sen bir e-ticaret müşteri araştırması analistisin. Aşağıdaki 1.000 kişilik SENTETİK panel simülasyonunu yorumla. Yeni istatistik, pazar payı veya ölçüm UYDURMA; yalnızca verilen sayıları kullan. Bu bir gerçek anket değil, deterministik senaryo simülasyonudur.

ÜRÜN
- Ad: ${data.productName}
- Fiyat: ${data.priceUsd !== null && data.priceUsd !== undefined ? `$${data.priceUsd.toFixed(2)}` : "ölçülmedi"}
- Platform: ${data.platform || "belirtilmedi"}
- Hedef kitle: ${data.audience || "belirtilmedi"}
- Panel: ${data.buyers}/1000 alıcı (%${data.penetrationPct.toFixed(1)}), ${data.nonBuyers} almayan
- Model güveni: %${data.confidencePct}
- Kullanılan sinyaller: ${data.signals.join(", ") || "yok"}
- Eksik sinyaller: ${data.missingSignals.join(", ") || "yok"}

SEGMENTLER
${segmentLines || "- segment verisi yok"}

ALIM NEDENLERİ
${reasonLines || "- neden verisi yok"}

İTİRAZLAR
${objectionLines || "- itiraz verisi yok"}

Görev:
1. Kimlerin aldığını ve kimlerin almadığını 2-3'er cümleyle profille.
2. En önemli 3 segment için kısa hüküm + somut aksiyon yaz.
3. En önemli 3 itiraz için düzeltme öner.
4. 4-6 maddelik uygulanabilir aksiyon listesi ver.
5. Tek cümlelik dürüstlük uyarısı ekle: simülasyonun sınırı.

SADECE şu JSON'u döndür (Türkçe):
{
  "summary": "2-4 cümlelik genel yorum",
  "buyer_profile": "kimler alır",
  "non_buyer_profile": "kimler almaz",
  "segments": [{"label":"...", "verdict":"...", "action":"..."}],
  "objections": [{"objection":"...", "fix":"..."}],
  "actions": ["..."],
  "caveat": "..."
}`;

        const text = await withDeadline(
          callAiMesh(prompt, { temperature: 0.35, grounded: false }),
          25_000,
          "multi-customer-ai",
        );
        const parsed = extractJson<Partial<MultiCustomerAiInsight>>(text, {});
        const summary = String(parsed.summary ?? "").trim();
        if (!summary) throw new Error("AI yorumu boş döndü; simülasyon sonucu yine de geçerli.");

        const list = <T>(value: unknown, map: (item: Record<string, unknown>) => T): T[] => {
          if (!Array.isArray(value)) return [];
          return value
            .filter((item): item is Record<string, unknown> =>
              Boolean(item && typeof item === "object"),
            )
            .map(map)
            .filter((item) => Boolean(item))
            .slice(0, 8);
        };

        return {
          summary: summary.slice(0, 1600),
          buyer_profile: String(parsed.buyer_profile ?? "")
            .trim()
            .slice(0, 1200),
          non_buyer_profile: String(parsed.non_buyer_profile ?? "")
            .trim()
            .slice(0, 1200),
          segments: list(parsed.segments, (item) => ({
            label: String(item.label ?? "")
              .trim()
              .slice(0, 100),
            verdict: String(item.verdict ?? "")
              .trim()
              .slice(0, 500),
            action: String(item.action ?? "")
              .trim()
              .slice(0, 500),
          })).filter((item) => item.label),
          objections: list(parsed.objections, (item) => ({
            objection: String(item.objection ?? "")
              .trim()
              .slice(0, 200),
            fix: String(item.fix ?? "")
              .trim()
              .slice(0, 500),
          })).filter((item) => item.objection),
          actions: Array.isArray(parsed.actions)
            ? parsed.actions
                .map((action) => String(action).trim())
                .filter(Boolean)
                .slice(0, 6)
            : [],
          caveat:
            String(parsed.caveat ?? "")
              .trim()
              .slice(0, 500) ||
            "Bu çıktı sentetik panel simülasyonudur; gerçek pazar talebi veya anket sonucu değildir.",
        };
      },
      1,
      null,
      MULTI_CUSTOMER_FEATURE,
    );
  });
