/**
 * Uygulama genelinde paylaşılan yapay zekâ çıktı kuralları ve yasal uyarı metni.
 * Sunucu tarafında prompt'lara, istemci tarafında rapor altlıklarına eklenir.
 */

/** Prompt'a iki kez eklenmesini engelleyen işaret. */
export const ESTIMATION_RULE_MARKER = "[AROLESS_ESTIMATION_RULES]";

/**
 * Tüm modüllerde sayısal tahminlerin tekil kesin değer yerine gerçekçi
 * aralık olarak üretilmesini zorunlu kılan kural.
 */
export const ESTIMATION_RANGE_RULE = `${ESTIMATION_RULE_MARKER}
OUTPUT RULES — PROBABILISTIC ESTIMATES (mandatory):
1. Every forecast expressed in human-readable text (profit, margin, revenue, CPC/CPM, ad spend, sales volume, conversion rate, ROI, payback, lead time) MUST be written as a realistic range, never as a single exact figure. Examples: "$1,200 - $1,800", "%18 - %24", "300 - 450 adet/ay", "0.35$ - 0.60$ CPC".
2. Ranges must be plausible and reasonably tight (upper bound typically 1.2x-1.6x the lower bound), based on real supplier/marketplace benchmarks — never invented precision, never absurdly wide.
3. JSON fields that are strictly typed as a number must still contain a single number (use the midpoint of your range); the accompanying label/text field carries the range.
4. Any string field holding a metric value ("value", "priceRange", "metrics[].value", headlines, bullets, summaries) uses the range form.
5. Never imply certainty: prefer "tahmini", "yaklaşık", "beklenen aralık" wording. These are estimates, not guarantees or financial advice.`;

/** Prompt'un başına tahmin aralığı kuralını (tek sefer) ekler. */
export function withEstimationRules(prompt: string): string {
  if (!prompt || prompt.includes(ESTIMATION_RULE_MARKER)) return prompt;
  return `${ESTIMATION_RANGE_RULE}\n\n${prompt}`;
}

/** Tüm AI çıktılarının altında gösterilen yasal uyarı. */
export const AI_DISCLAIMER_TR =
  "Aroless AI verileri tahmini analizlere dayanmaktadır ve hata yapabilir. Sunulan metrikler yatırım, finans veya hukuk tavsiyesi niteliği taşımaz; doğabilecek ticari riskler kullanıcıya aittir.";

export const AI_DISCLAIMER_EN =
  "Aroless AI output is based on probabilistic estimates and may be wrong. The metrics shown are not investment, financial or legal advice; all commercial risk rests with the user.";
