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
  | { status: "processing"; pollIntervalMs: number; pollMaxMs: number }
  /**
   * Ağır iş HİÇBİR yolla koşturulamadı: fonksiyon süresi limiti ağır analize
   * yetmiyor (ör. 60 sn'ye daraltılmış) ve uzak worker da yok. İstek içinde
   * koşturmak 504 üretirdi; bunun yerine hızlı ve açık hata döneriz. Kredi bu
   * durumda DÜŞÜLMEZ (ya da iade edilir).
   *
   * Vercel Hobby'nin 300 sn'si bu sınıra girmez: orada plan `inline` olur ve
   * konsey `fast` profille istek içinde, 300 sn'ye sığarak biter.
   */
  | { status: "unavailable"; error: string };

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
 * - Kalıcı süreçte (Render) konsey süreç içi arka plan kuyruğunda koşar.
 * - Sunucusuz ortamda (Vercel) iş, QStash ile **uzak Render worker'ına**
 *   (`WORKER_URL` → `/api/jobs`) gönderilir; tetikleyici anında döner.
 * - Uzak worker yoksa istek içinde koşturmak yerine açık hata döneriz: 504
 *   yerine anlaşılır bir mesaj ve **kredi iadesi**.
 * Kredi düşmeden önce aynı işin çalışıp çalışmadığı sorulur, böylece çift
 * tıklama iki kez kredi harcamaz.
 */
export const runCouncilAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(normalize)
  .handler(async ({ data, context }): Promise<CouncilAnalysisStart> => {
    const { runCouncil, peekCouncil } = await import("@/lib/council.server");

    const cachedReport = await peekCouncil(data.query, data.country, data.category, data.lang);
    if (cachedReport) return { status: "ready", report: cachedReport };

    const jobs = await import("@/lib/discovery-jobs.server");
    const runner = await import("@/lib/job-runner.server");
    const poll = { pollIntervalMs: jobs.JOB_POLL_INTERVAL_MS, pollMaxMs: jobs.clientWaitMs() };

    const plan = jobs.longJobPlan();

    // Fonksiyon limiti ağır hatta yetmiyor ve uzak worker da yok: istek içinde
    // koşturmak 504 olurdu. Kredi düşmeden hızlı ve açık bir hata döneriz.
    if (plan === "unavailable") {
      return {
        status: "unavailable",
        error:
          "Konsey bu ortamda başlatılamıyor: fonksiyon süresi limiti ağır analize yetmiyor (en az 300 sn gerekir). Süreyi 300 sn'ye çıkar ya da WORKER_URL (Render servis adresi) tanımla.",
      };
    }

    const work = () =>
      withCreditRefund(context.userId, () =>
        runCouncil(data.query, data.country, data.category, data.lang),
      );

    // Yerel geliştirme veya (worker'sız) süre limiti yeten sunucusuz ortam:
    // konsey İSTEK İÇİNDE koşar. Bütçe platformdan gelir (`runCouncil` →
    // `defaultCouncilBudgetMs`), yani Vercel Hobby'de 300 sn'ye sığan `fast`
    // profille 14 ajan çalışır ve istek kendi kendine biter — 504 yok.
    if (plan === "inline") {
      const { error } = await context.supabase.rpc("deduct_product_finder_credit");
      if (error) throw creditError(error.message);
      return { status: "ready", report: await work() };
    }

    const key = councilJobKey(data);

    // Aynı sorgu zaten arkada çalışıyor: KREDİ DÜŞMEDEN yalnızca beklemeyi söyle.
    if (plan === "in-process" && runner.isBackgroundJobRunning(key)) {
      return { status: "processing", ...poll };
    }

    const { error } = await context.supabase.rpc("deduct_product_finder_credit");
    if (error) throw creditError(error.message);

    // Hibrit kurulum: işi Render'daki kalıcı worker'a QStash ile yolla.
    if (plan === "qstash-worker") {
      const enqueued = await jobs.enqueueRemoteJob({
        kind: "council",
        payload: { userId: context.userId, ...data },
        dedupeId: key,
      });
      if (!enqueued.ok) {
        await refundCredit(context.userId, 1, "council_dispatch_failed");
        return {
          status: "unavailable",
          error:
            "Konsey başlatılamadı (worker'a ulaşılamadı). Krediniz iade edildi, lütfen tekrar deneyin.",
        };
      }
      return { status: "processing", ...poll };
    }

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
