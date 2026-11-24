/**
 * META CAPI OUTBOX — kalıcı kuyruk ve yeniden deneme işçisi.
 *
 * TASARIM:
 *   • Olay önce veritabanına yazılır (`enqueue`), sonra gönderilir.
 *   • `event_id` UNIQUE olduğu için aynı Paddle işlemi ikinci kez kuyruğa
 *     girmez; Meta'ya giden `event_id` de aynıdır → çift `Purchase` yok.
 *   • Başarısız gönderim üstel geri çekilmeyle (`60s → 5m → 15m → 1h → 6h`)
 *     yeniden denenir. 4xx (429 hariç) kalıcı hatadır; tekrar denenmez.
 *   • 46 saatten eski kayıtlar Meta'nın tekilleştirme penceresi dışına çıktığı
 *     için GÖNDERİLMEZ (SQL tarafında `failed` işaretlenir).
 *
 * TEST EDİLEBİLİRLİK: DB istemcisi ve `fetch` sarmalayıcısı enjekte
 * edilebilir; bu dosyadaki kararlar Supabase olmadan test edilir.
 */
import type { MetaCapiEventInput, MetaCapiOutboxLike, MetaCapiResult } from "./meta-capi.server";
import { sendMetaCapiEvent } from "./meta-capi.server";

/** Deneme tavanı — 46 saatlik pencereden önce tükenir. */
export const META_CAPI_MAX_ATTEMPTS = 8;

/** Deneme sayısına göre bekleme (saniye). Son değer tekrar eder. */
const RETRY_DELAYS_SECONDS = [60, 300, 900, 3600, 21600, 21600, 21600] as const;

/**
 * Kaçıncı denemeden SONRA ne kadar bekleneceği.
 * `attempts` = şimdiye kadar yapılmış deneme sayısı (claim sonrası 1'den başlar).
 */
export function metaCapiRetryDelaySeconds(attempts: number): number {
  const index = Math.min(Math.max(Math.floor(attempts) - 1, 0), RETRY_DELAYS_SECONDS.length - 1);
  return RETRY_DELAYS_SECONDS[index] as number;
}

/**
 * Hata yeniden denenmeli mi?
 *
 * 400/401/403 gibi kalıcı hatalar (geçersiz yük, yanlış token, izin yok)
 * tekrar denendiğinde asla başarılı olmaz; kuyruğu gereksiz meşgul etmemek için
 * `dead` işaretlenir. 429 ve 5xx geçicidir. Ağ hatası ve bilinmeyen hata
 * güvenli tarafta kalır: yeniden denenir.
 */
export function isRetryableMetaError(
  error?: string | null,
  skipped?: MetaCapiResult["skipped"],
): boolean {
  if (skipped === "missing_token") return true;
  if (!error) return true;
  if (error === "network" || error === "api_error" || error === "outbox") return true;
  const match = /^http_(\d{3})$/.exec(error);
  if (!match) return true;
  const status = Number(match[1]);
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export type MetaCapiOutboxRow = {
  id: string;
  event_id: string;
  event_name: string;
  payload: MetaCapiEventInput;
  attempts: number;
  max_attempts: number;
};

export type MetaCapiRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export type MetaCapiSend = (input: MetaCapiEventInput) => Promise<MetaCapiResult>;

export type MetaCapiOutbox = MetaCapiOutboxLike & {
  /** Cron/elle tetikleme için toplu işleme. */
  drain(limit?: number): Promise<{
    claimed: number;
    sent: number;
    retried: number;
    dead: number;
  }>;
  /** Saklama sınırı temizliği (outbox 30 gün, attribution 7 gün). */
  cleanup(): Promise<{ events: number; attribution: number } | null>;
};

type ProcessOutcome = "sent" | "retry" | "dead";

async function defaultRpc(name: string, args: Record<string, unknown>) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const rpc = supabaseAdmin.rpc as unknown as MetaCapiRpc;
  return rpc(name, args);
}

/**
 * Outbox istemcisi.
 *
 * `rpc` ve `send` yalnız testlerde enjekte edilir; üretimde Supabase servis
 * rolü istemcisi ve gerçek Graph API çağrısı kullanılır.
 */
export function createSupabaseMetaCapiOutbox(
  deps: { rpc?: MetaCapiRpc; send?: MetaCapiSend } = {},
): MetaCapiOutbox {
  const rpc = deps.rpc ?? defaultRpc;
  const send = deps.send ?? sendMetaCapiEvent;

  async function enqueue(event: {
    eventId: string;
    eventName: string;
    event: MetaCapiEventInput;
  }): Promise<"enqueued" | "duplicate"> {
    const { data, error } = await rpc("enqueue_meta_capi_event", {
      _event_id: event.eventId,
      _event_name: event.eventName,
      _payload: event.event,
    });
    if (error) throw new Error(error.message);
    return String(data) === "duplicate" ? "duplicate" : "enqueued";
  }

  async function claim(limit: number, eventId: string | null): Promise<MetaCapiOutboxRow[]> {
    const { data, error } = await rpc("claim_meta_capi_outbox", {
      _limit: Math.max(1, Math.min(Math.floor(limit), 100)),
      _event_id: eventId,
    });
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? (data as MetaCapiOutboxRow[]) : [];
  }

  async function finish(
    row: MetaCapiOutboxRow,
    status: "sent" | "retry" | "dead",
    error?: string | null,
    nextAttemptAt?: string | null,
  ): Promise<void> {
    const { error: rpcError } = await rpc("finish_meta_capi_outbox", {
      _id: row.id,
      _status: status,
      _error: error ?? null,
      _next_attempt_at: nextAttemptAt ?? null,
    });
    if (rpcError) {
      // Satır 'processing' kalır; 10 dakika sonra claim onu geri alır.
      console.warn(`[Meta CAPI] outbox durumu yazılamadı: ${rpcError.message}`);
    }
  }

  async function processRow(row: MetaCapiOutboxRow): Promise<{
    outcome: ProcessOutcome;
    error?: string;
  }> {
    let result: MetaCapiResult;
    try {
      result = await send(row.payload);
    } catch (error) {
      result = {
        sent: false,
        error: error instanceof Error ? `network:${error.message.slice(0, 80)}` : "network",
      };
    }

    if (result.sent) {
      await finish(row, "sent");
      return { outcome: "sent" };
    }

    const reason = result.error ?? result.skipped ?? "unknown";
    const permanent = !isRetryableMetaError(result.error, result.skipped);
    if (permanent || row.attempts >= row.max_attempts) {
      await finish(row, "dead", reason);
      return { outcome: "dead", error: reason };
    }

    const delaySeconds = metaCapiRetryDelaySeconds(row.attempts);
    const nextAttemptAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
    await finish(row, "retry", reason, nextAttemptAt);
    return { outcome: "retry", error: reason };
  }

  async function dispatch(eventId: string): Promise<MetaCapiResult> {
    const rows = await claim(1, eventId);
    if (rows.length === 0) {
      // Başka bir işçi gönderiyor/gönderdi ya da geri çekilme süresi dolmadı.
      return { sent: false, queued: true };
    }
    const { outcome, error } = await processRow(rows[0] as MetaCapiOutboxRow);
    if (outcome === "sent") return { sent: true };
    if (outcome === "retry") return { sent: false, queued: true, error };
    return { sent: false, error };
  }

  async function drain(limit = 50) {
    const rows = await claim(limit, null);
    const summary = { claimed: rows.length, sent: 0, retried: 0, dead: 0 };
    for (const row of rows) {
      const { outcome } = await processRow(row);
      if (outcome === "sent") summary.sent += 1;
      else if (outcome === "retry") summary.retried += 1;
      else summary.dead += 1;
    }
    return summary;
  }

  async function cleanup() {
    const { data, error } = await rpc("cleanup_meta_capi_outbox", {});
    if (error) {
      console.warn(`[Meta CAPI] outbox temizliği çalışmadı: ${error.message}`);
      return null;
    }
    const row = (data ?? {}) as { events?: unknown; attribution?: unknown };
    return {
      events: Number(row.events ?? 0),
      attribution: Number(row.attribution ?? 0),
    };
  }

  return { enqueue, dispatch, drain, cleanup };
}
