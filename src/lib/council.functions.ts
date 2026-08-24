import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Input = { query: string; country?: string; category?: string; lang?: string };

/**
 * 14'lü AI Konsey çalıştırıcısı.
 * - Aynı sorgu son 24 saatte yapıldıysa önbellekten döner ve KREDİ HARCAMAZ.
 * - Yeni sorguda 1 arama kredisi düşer, ardından konsey çalışır.
 */
export const runCouncilAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: Input) => {
    const query = String(input?.query ?? "")
      .trim()
      .slice(0, 140);
    if (query.length < 2) throw new Error("Lütfen bir ürün veya niş girin.");
    return {
      query,
      country: String(input?.country ?? "GLOBAL")
        .toUpperCase()
        .slice(0, 8),
      category: String(input?.category ?? "General").slice(0, 60),
      lang: String(input?.lang ?? "tr").slice(0, 5),
    };
  })
  .handler(async ({ data, context }) => {
    const { runCouncil, peekCouncil } = await import("@/lib/council.server");

    const cachedReport = await peekCouncil(data.query, data.country, data.category, data.lang);
    if (cachedReport) return cachedReport;

    const { error } = await context.supabase.rpc("deduct_credit");
    if (error) {
      throw new Error(
        error.message.includes("no_credits")
          ? "Arama krediniz bitti. Paketinizi yükseltin."
          : "Kredi düşülemedi, lütfen tekrar deneyin.",
      );
    }

    return runCouncil(data.query, data.country, data.category, data.lang);
  });
