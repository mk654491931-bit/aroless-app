import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { refundCredit, withCreditRefund } from "@/lib/credit-guard.server";
import type { CouncilReport } from "@/lib/council.server";

type Input = { query: string; country?: string; category?: string; lang?: string };

type NormalizedInput = { query: string; country: string; category: string; lang: string };

function normalizeInput(input: Input): NormalizedInput {
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
}

const normalize = (input: unknown) => normalizeInput((input ?? {}) as Input);

/**
 * Aynı sorgunun iki kez çalışmasını önleyen arka plan anahtarı.
 * Konsey pahalıdır: yarışan iki istek aynı işi iki kez başlatmamalı.
 */
export function councilJobKey(input: NormalizedInput): string {
  return `council:${[input.query, input.country, input.category, input.lang]
    .map((part) => part.trim().toLowerCase())
    .join("|")}`;
}

/**
 * İstemcinin gördüğü iki durum:
 *  - `ready`      → rapor (önbellekten ya da istek içinde tamamlandı)
 *  - `processing` → konsey ARKA PLANDA çalışıyor; `pollCouncilAnalysis` ile sor
 *
 * Render'da konsey 5-10 dakika sürebilir. Bunu istek içinde beklemek 504'ün
 * ta kendisidir; bu yüzden kalıcı süreçte iş arka plana atılır ve tarayıcı
 * kısa yoklamalarla sonucu alır.
 */
export type CouncilAnalysisStart =
  | { status: "ready"; report: CouncilReport }
  | { status: "processing"; pollIntervalMs: number; pollMaxMs: number };

export type CouncilAnalysisPoll =
  | { status: "ready"; report: CouncilReport }
  | { status: "processing" };

function creditError(message: string | null | undefined): Error {
  return new Error(
    String(message ?? "").includes("no_credits")
      ? "Arama krediniz bitti. Paketinizi yükseltin."
      : "Kredi düşülemedi, lütfen tekrar deneyin.",
  );
}

/**
 * 14'lü AI Konsey çalıştırıcısı.
 * - Aynı sorgu son 24 saatte yapıldıysa önbellekten döner ve KREDİ HARCAMAZ.
 * - Yeni sorguda 1 arama kredisi düşer, ardından konsey çalışır.
 * - Kalıcı süreçte (Render) konsey arka planda koşar; istek anında `processing`
 *   döner ve 504 oluşmaz. Kredi düşmeden önce aynı işin çalışıp çalışmadığı
 *   sorulur, böylece çift tıklama iki kez kredi harcamaz.
 */
export const runCouncilAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(normalize)
  .handler(async ({ data, context }): Promise<CouncilAnalysisStart> => {
    const { runCouncil, peekCouncil } = await import("@/lib/council.server");

    const cachedReport = await peekCouncil(data.query, data.country, data.category, data.lang);
    if (cachedReport) return { status: "ready", report: cachedReport };

    const runner = await import("@/lib/job-runner.server");
    const { JOB_POLL_INTERVAL_MS, clientWaitMs } = await import("@/lib/discovery-jobs.server");
    const poll = { pollIntervalMs: JOB_POLL_INTERVAL_MS, pollMaxMs: clientWaitMs() };

    const work = () =>
      withCreditRefund(context.userId, () =>
        runCouncil(data.query, data.country, data.category, data.lang),
      );

    // Sunucusuz ortam (veya arka plan kapalı): eski davranış — istek içinde koş.
    if (!runner.backgroundJobsEnabled()) {
      const { error } = await context.supabase.rpc("deduct_product_finder_credit");
      if (error) throw creditError(error.message);
      return { status: "ready", report: await work() };
    }

    const key = councilJobKey(data);

    // Aynı sorgu zaten arkada çalışıyor: KREDİ DÜŞMEDEN yalnızca beklemeyi söyle.
    if (runner.isBackgroundJobRunning(key)) return { status: "processing", ...poll };

    const { error } = await context.supabase.rpc("deduct_product_finder_credit");
    if (error) throw creditError(error.message);

    const started = runner.runInBackground("council-analysis", work, { key });
    if (!started.started) {
      // Yarışı kaybettik (başka bir istek aynı işi başlattı): krediyi iade et.
      await refundCredit(context.userId, 1, "duplicate_council_job");
      return { status: "processing", ...poll };
    }
    return { status: "processing", ...poll };
  });

/**
 * Arka plandaki konseyin sonucunu yoklar (yalnızca önbellek okuması — çok hafif).
 * Sonuç hazır olduğunda `runCouncil`'un yazdığı 24 saatlik önbellekten gelir.
 */
export const pollCouncilAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(normalize)
  .handler(async ({ data }): Promise<CouncilAnalysisPoll> => {
    const { peekCouncil } = await import("@/lib/council.server");
    const report = await peekCouncil(data.query, data.country, data.category, data.lang);
    return report ? { status: "ready", report } : { status: "processing" };
  });
