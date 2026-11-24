/**
 * META CAPI OUTBOX — kalıcı kuyruk, idempotency ve retry sözleşmesi.
 *
 * Kilitlenen davranış:
 *   • Aynı `event_id` ikinci kez kuyruğa girmez (UNIQUE + duplicate yanıtı).
 *   • Geçici hata (5xx/429/network) üstel geri çekilmeyle yeniden denenir.
 *   • Kalıcı hata (400/401/403) `dead` işaretlenir; kuyruk boşa meşgul edilmez.
 *   • Deneme tavanı aşılırsa yeniden denenmez.
 *   • `missing_token` yeniden denenebilir (token sonradan eklenebilir).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createSupabaseMetaCapiOutbox,
  isRetryableMetaError,
  metaCapiRetryDelaySeconds,
  type MetaCapiOutboxRow,
} from "./meta-capi-outbox.server";
import type { MetaCapiEventInput } from "./meta-capi.server";

const EVENT: MetaCapiEventInput = {
  eventName: "Purchase",
  eventId: "purchase-txn_1",
  eventTime: 1_700_000_000,
  userData: { email: "buyer@example.com" },
  value: 59,
  currency: "USD",
};

function row(overrides: Partial<MetaCapiOutboxRow> = {}): MetaCapiOutboxRow {
  return {
    id: "row-1",
    event_id: "purchase-txn_1",
    event_name: "Purchase",
    payload: EVENT,
    attempts: 1,
    max_attempts: 8,
    ...overrides,
  };
}

type RpcCall = { name: string; args: Record<string, unknown> };

function rpcWith(handlers: Record<string, (args: Record<string, unknown>) => unknown>) {
  const calls: RpcCall[] = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    const handler = handlers[name];
    if (!handler) return { data: null, error: { message: `missing function ${name}` } };
    return { data: handler(args), error: null };
  });
  return { rpc, calls };
}

function finishCall(calls: RpcCall[]) {
  return calls.find((call) => call.name === "finish_meta_capi_outbox");
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("retry politikası", () => {
  it("bekleme süresi deneme sayısıyla artar ve 6 saatte tavanlanır", () => {
    expect(metaCapiRetryDelaySeconds(1)).toBe(60);
    expect(metaCapiRetryDelaySeconds(2)).toBe(300);
    expect(metaCapiRetryDelaySeconds(3)).toBe(900);
    expect(metaCapiRetryDelaySeconds(4)).toBe(3600);
    expect(metaCapiRetryDelaySeconds(5)).toBe(21600);
    expect(metaCapiRetryDelaySeconds(99)).toBe(21600);
  });

  it("geçici hataları yeniden dener, kalıcı 4xx'i denemez", () => {
    expect(isRetryableMetaError("network")).toBe(true);
    expect(isRetryableMetaError("api_error")).toBe(true);
    expect(isRetryableMetaError("http_429")).toBe(true);
    expect(isRetryableMetaError("http_500")).toBe(true);
    expect(isRetryableMetaError("http_503")).toBe(true);
    expect(isRetryableMetaError("http_400")).toBe(false);
    expect(isRetryableMetaError("http_401")).toBe(false);
    expect(isRetryableMetaError("http_403")).toBe(false);
    expect(isRetryableMetaError(undefined, "missing_token")).toBe(true);
  });
});

describe("kuyruk", () => {
  it("enqueue aynı event_id için 'duplicate' döner", async () => {
    const { rpc } = rpcWith({ enqueue_meta_capi_event: () => "duplicate" });
    const outbox = createSupabaseMetaCapiOutbox({ rpc, send: vi.fn() });

    await expect(
      outbox.enqueue({ eventId: "purchase-txn_1", eventName: "Purchase", event: EVENT }),
    ).resolves.toBe("duplicate");
  });

  it("başarılı gönderimi 'sent' olarak kapatır", async () => {
    const { rpc, calls } = rpcWith({
      claim_meta_capi_outbox: () => [row()],
      finish_meta_capi_outbox: () => "sent",
    });
    const send = vi.fn(async () => ({ sent: true }));
    const outbox = createSupabaseMetaCapiOutbox({ rpc, send });

    await expect(outbox.dispatch("purchase-txn_1")).resolves.toEqual({ sent: true });
    expect(send).toHaveBeenCalledWith(EVENT);
    expect(finishCall(calls)?.args).toMatchObject({ _id: "row-1", _status: "sent" });
  });

  it("5xx hatasını 60 saniye sonrasına planlar", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-24T12:00:00.000Z"));
    const { rpc, calls } = rpcWith({
      claim_meta_capi_outbox: () => [row({ attempts: 1 })],
      finish_meta_capi_outbox: () => "retry",
    });
    const outbox = createSupabaseMetaCapiOutbox({
      rpc,
      send: vi.fn(async () => ({ sent: false, error: "http_500" })),
    });

    await expect(outbox.dispatch("purchase-txn_1")).resolves.toMatchObject({
      sent: false,
      queued: true,
      error: "http_500",
    });
    expect(finishCall(calls)?.args).toMatchObject({
      _status: "retry",
      _next_attempt_at: "2026-11-24T12:01:00.000Z",
    });
  });

  it("400 hatasını kalıcı sayar (dead) ve yeniden denemez", async () => {
    const { rpc, calls } = rpcWith({
      claim_meta_capi_outbox: () => [row({ attempts: 1 })],
      finish_meta_capi_outbox: () => "dead",
    });
    const outbox = createSupabaseMetaCapiOutbox({
      rpc,
      send: vi.fn(async () => ({ sent: false, error: "http_400" })),
    });

    await expect(outbox.dispatch("purchase-txn_1")).resolves.toEqual({
      sent: false,
      error: "http_400",
    });
    expect(finishCall(calls)?.args).toMatchObject({ _status: "dead", _error: "http_400" });
  });

  it("deneme tavanına ulaşınca 5xx olsa da dead işaretler", async () => {
    const { rpc, calls } = rpcWith({
      claim_meta_capi_outbox: () => [row({ attempts: 8, max_attempts: 8 })],
      finish_meta_capi_outbox: () => "dead",
    });
    const outbox = createSupabaseMetaCapiOutbox({
      rpc,
      send: vi.fn(async () => ({ sent: false, error: "http_500" })),
    });

    await outbox.dispatch("purchase-txn_1");
    expect(finishCall(calls)?.args).toMatchObject({ _status: "dead" });
  });

  it("token yoksa kaydı tüketmez; yeniden denenecek şekilde bırakır", async () => {
    const { rpc, calls } = rpcWith({
      claim_meta_capi_outbox: () => [row()],
      finish_meta_capi_outbox: () => "retry",
    });
    const outbox = createSupabaseMetaCapiOutbox({
      rpc,
      send: vi.fn(async () => ({ sent: false, skipped: "missing_token" as const })),
    });

    await outbox.dispatch("purchase-txn_1");
    expect(finishCall(calls)?.args).toMatchObject({
      _status: "retry",
      _error: "missing_token",
    });
  });

  it("sahiplenilecek kayıt yoksa 'queued' döner", async () => {
    const { rpc } = rpcWith({ claim_meta_capi_outbox: () => [] });
    const outbox = createSupabaseMetaCapiOutbox({ rpc, send: vi.fn() });
    await expect(outbox.dispatch("purchase-txn_1")).resolves.toEqual({
      sent: false,
      queued: true,
    });
  });

  it("drain toplu işler ve sayıları döner", async () => {
    const rows = [row({ id: "a" }), row({ id: "b", event_id: "purchase-txn_2" }), row({ id: "c" })];
    const { rpc } = rpcWith({
      claim_meta_capi_outbox: () => rows,
      finish_meta_capi_outbox: () => "ok",
    });
    const responses = [
      { sent: true },
      { sent: false, error: "http_500" },
      { sent: false, error: "http_400" },
    ];
    let index = 0;
    const outbox = createSupabaseMetaCapiOutbox({
      rpc,
      send: vi.fn(async () => responses[index++] as never),
    });

    await expect(outbox.drain(10)).resolves.toEqual({
      claimed: 3,
      sent: 1,
      retried: 1,
      dead: 1,
    });
  });

  it("finish RPC hatası gönderimi düşürmez; yalnız uyarır", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_meta_capi_outbox") return { data: [row()], error: null };
      return { data: null, error: { message: "boom" } };
    });
    const outbox = createSupabaseMetaCapiOutbox({
      rpc,
      send: vi.fn(async () => ({ sent: true })),
    });

    await expect(outbox.dispatch("purchase-txn_1")).resolves.toEqual({ sent: true });
    expect(warn).toHaveBeenCalled();
  });
});
