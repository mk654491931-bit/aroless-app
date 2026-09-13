/**
 * İstemci tarafı asenkron arama yardımcısı (Publish → Poll).
 *
 * Kullanım:
 * ```ts
 * const { jobId } = await startSearchJob(input);
 * const result = await waitForSearchResult(jobId, { onTick: (s) => setStatus(s) });
 * ```
 * `waitForSearchResult` önce Supabase Realtime (`postgres_changes`) aboneliği
 * kurar, ek olarak 3 saniyelik yoklama ile de kaydı kontrol eder — Realtime
 * kapalı olsa bile sonuç kesinlikle yakalanır.
 */
import { supabase } from "@/integrations/supabase/client";

export type SearchJobStatus = "processing" | "completed" | "failed";

export type SearchJobRow = {
  id: string;
  status: SearchJobStatus;
  result: unknown;
  error: string | null;
};

export class SearchJobError extends Error {}

/** `/api/search`'ü tetikler ve `jobId` döner (ağır işi beklemez). */
export async function startSearchJob(input: unknown): Promise<{ jobId: string }> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new SearchJobError("Oturum bulunamadı — tekrar giriş yapın.");

  const res = await fetch("/api/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(input),
  });

  const payload = (await res.json().catch(() => null)) as
    | { success?: boolean; jobId?: string; error?: string }
    | null;

  if (!res.ok || !payload?.success || !payload.jobId) {
    throw new SearchJobError(payload?.error || `Arama başlatılamadı (${res.status})`);
  }
  return { jobId: payload.jobId };
}

async function readJob(jobId: string): Promise<SearchJobRow | null> {
  const { data, error } = await supabase
    .from("searches")
    .select("id, status, result, error")
    .eq("id", jobId)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as SearchJobRow;
}

/**
 * Kayıt `completed` olana kadar bekler. Realtime + yoklama birlikte çalışır.
 * `failed` olursa hata fırlatır, süre aşımında da hata fırlatır.
 */
export async function waitForSearchResult<T = unknown>(
  jobId: string,
  opts?: { timeoutMs?: number; pollIntervalMs?: number; onTick?: (status: SearchJobStatus) => void },
): Promise<T> {
  const timeoutMs = opts?.timeoutMs ?? 300_000;
  const pollIntervalMs = opts?.pollIntervalMs ?? 3_000;
  const deadline = Date.now() + timeoutMs;

  let wake: (() => void) | null = null;
  const channel = supabase
    .channel(`searches:${jobId}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "searches", filter: `id=eq.${jobId}` },
      () => wake?.(),
    )
    .subscribe();

  try {
    for (;;) {
      const row = await readJob(jobId);
      if (row?.status === "completed") return row.result as T;
      if (row?.status === "failed") {
        throw new SearchJobError(row.error || "Arama tamamlanamadı.");
      }
      opts?.onTick?.(row?.status ?? "processing");

      if (Date.now() + pollIntervalMs >= deadline) {
        throw new SearchJobError(
          "Analiz beklenenden uzun sürdü. Sonuç hazır olduğunda geçmişte görünecek.",
        );
      }

      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          wake = null;
          resolve();
        }, pollIntervalMs);
        wake = () => {
          clearTimeout(timer);
          wake = null;
          resolve();
        };
      });
    }
  } finally {
    wake = null;
    supabase.removeChannel(channel);
  }
}
