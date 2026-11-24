/**
 * META CONVERSIONS API — istek gövdesi ve güvenli davranış.
 *
 * Kilitlenen sözleşme:
 *   • E-posta / kullanıcı kimliği Meta'ya DÜZ METİN gitmez (SHA-256).
 *   • `Purchase` olay kimliği Paddle işlem kimliğinden türetilir (çift sayım yok).
 *   • Token yoksa istek atılmaz, çağrı fırlatmaz.
 *   • HTTP/network hatası ödeme akışını düşürmez; sonuç `sent: false` döner.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildMetaCapiPayload,
  hasMetaCapiConsent,
  normalizeMetaConsent,
  sanitizeMetaBrowserId,
  sanitizeMetaClientIp,
  sanitizeMetaUserAgent,
  sendMetaCapiEvent,
  sendMetaPurchase,
  sha256Hex,
  type MetaCapiOutboxLike,
} from "./meta-capi.server";

type CapiPayload = {
  data: Array<{
    event_name: string;
    event_id?: string;
    event_time: number;
    event_source_url?: string;
    user_data?: { em?: string[]; external_id?: string[]; fbp?: string; fbc?: string };
    custom_data?: Record<string, unknown>;
  }>;
  test_event_code?: string;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("CAPI pazarlama izni", () => {
  it("boolean ve string değerleri normalize eder", () => {
    expect(normalizeMetaConsent(true)).toBe("granted");
    expect(normalizeMetaConsent("GRANTED")).toBe("granted");
    expect(normalizeMetaConsent(false)).toBe("denied");
    expect(normalizeMetaConsent("denied")).toBe("denied");
    expect(normalizeMetaConsent(undefined)).toBe("unknown");
  });

  it("izin yoksa veya iki kaynak da bilinmiyorsa REDDEDER", () => {
    expect(hasMetaCapiConsent({})).toBe(false);
    expect(hasMetaCapiConsent({ account: undefined, checkout: undefined })).toBe(false);
  });

  it("en az bir açık izin varsa kabul eder", () => {
    expect(hasMetaCapiConsent({ account: true })).toBe(true);
    expect(hasMetaCapiConsent({ checkout: "granted" })).toBe(true);
  });

  it("açık bir RED varsa diğer kaynak izin verse bile göndermez", () => {
    expect(hasMetaCapiConsent({ account: false, checkout: "granted" })).toBe(false);
    expect(hasMetaCapiConsent({ account: true, checkout: "denied" })).toBe(false);
  });
});

describe("buildMetaCapiPayload", () => {
  it("e-posta ve kullanıcı kimliğini özetler, düz metin göndermez", () => {
    const payload = buildMetaCapiPayload({
      eventName: "Purchase",
      eventId: "purchase-txn_1",
      eventTime: 1_700_000_000,
      eventSourceUrl: "https://aroless.tech/pricing",
      userData: {
        email: "  Buyer@Example.com ",
        externalId: "user-1",
        fbp: "fb.1.1700000000000.123456",
      },
      value: 59,
      currency: "USD",
      customData: { content_name: "Pro" },
    }) as unknown as CapiPayload;

    const event = payload.data[0];
    expect(event.event_name).toBe("Purchase");
    expect(event.event_id).toBe("purchase-txn_1");
    expect(event.event_source_url).toBe("https://aroless.tech/pricing");
    expect(event.user_data?.em).toEqual([sha256Hex("buyer@example.com")]);
    expect(event.user_data?.external_id).toEqual([sha256Hex("user-1")]);
    expect(event.user_data?.fbp).toBe("fb.1.1700000000000.123456");
    expect(event.custom_data).toMatchObject({ content_name: "Pro", value: 59, currency: "USD" });

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("Buyer@Example.com");
    expect(serialized).not.toContain("buyer@example.com");
    expect(serialized).not.toContain("user-1");
  });

  it("geçersiz fbp/fbc/IP değerlerini göndermez, user-agent'ı sınırlar", () => {
    const payload = buildMetaCapiPayload({
      eventName: "Purchase",
      userData: {
        fbp: "kötü-niyetli-deger",
        fbc: "fb.1.1700000000000.IwAR123",
        clientIp: "not-an-ip",
        userAgent: "Mozilla/5.0\n\u0000test",
      },
    }) as unknown as CapiPayload;

    expect(payload.data[0]?.user_data?.fbp).toBeUndefined();
    expect(payload.data[0]?.user_data?.fbc).toBe("fb.1.1700000000000.IwAR123");
    expect(
      (payload.data[0]?.user_data as { client_ip_address?: string } | undefined)?.client_ip_address,
    ).toBeUndefined();
    expect(
      (payload.data[0]?.user_data as { client_user_agent?: string } | undefined)?.client_user_agent,
    ).toBe("Mozilla/5.0 test");
  });

  it("test event kodu yalnız tanımlıysa eklenir", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("META_TEST_EVENT_CODE", "TEST42");
    const payload = buildMetaCapiPayload({ eventName: "PageView" }) as unknown as CapiPayload;
    expect(payload.test_event_code).toBe("TEST42");
  });

  it("production dağıtımında test event kodunu YOK SAYAR", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("META_TEST_EVENT_CODE", "TEST42");
    const payload = buildMetaCapiPayload({ eventName: "PageView" }) as unknown as CapiPayload;
    expect(payload.test_event_code).toBeUndefined();
  });
});

describe("sendMetaCapiEvent", () => {
  it("token yoksa istek atmaz, sessizce atlar", async () => {
    vi.stubEnv("META_CAPI_ACCESS_TOKEN", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendMetaCapiEvent({ eventName: "Purchase" });
    expect(result).toEqual({ sent: false, skipped: "missing_token" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("token varsa Graph API'ye gönderir ve test kodunu taşır", async () => {
    vi.stubEnv("META_CAPI_ACCESS_TOKEN", "test-token");
    vi.stubEnv("META_TEST_EVENT_CODE", "TEST42");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendMetaCapiEvent({ eventName: "PageView" });
    expect(result).toEqual({ sent: true });

    const call = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(call[0]).toContain("/v23.0/1144034978511312/events");
    expect(call[0]).toContain("access_token=test-token");
    const body = JSON.parse(call[1].body) as CapiPayload;
    expect(body.test_event_code).toBe("TEST42");
  });

  it("HTTP hatasında fırlatmaz, sent:false döner", async () => {
    vi.stubEnv("META_CAPI_ACCESS_TOKEN", "test-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad request", { status: 400 })),
    );

    const result = await sendMetaCapiEvent({ eventName: "Purchase" });
    expect(result).toEqual({ sent: false, error: "http_400" });
  });

  it("ağ hatasında fırlatmaz, sent:false döner", async () => {
    vi.stubEnv("META_CAPI_ACCESS_TOKEN", "test-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const result = await sendMetaCapiEvent({ eventName: "Purchase" });
    expect(result).toEqual({ sent: false, error: "network" });
  });
});

describe("kullanıcı verisi doğrulama", () => {
  it("fbp/fbc yalnız Meta biçimindeyse kabul edilir", () => {
    expect(sanitizeMetaBrowserId("fb.1.1700000000000.123456")).toBe("fb.1.1700000000000.123456");
    expect(sanitizeMetaBrowserId("fb.2.1700000000000.IwAR_abc-123")).toBe(
      "fb.2.1700000000000.IwAR_abc-123",
    );
    expect(sanitizeMetaBrowserId("fb.1.123.abc")).toBeNull();
    expect(sanitizeMetaBrowserId("fb.1.1700000000000.<script>")).toBeNull();
    expect(sanitizeMetaBrowserId("   ")).toBeNull();
  });

  it("yalnız geçerli IPv4/IPv6 kabul edilir", () => {
    expect(sanitizeMetaClientIp("203.0.113.7")).toBe("203.0.113.7");
    expect(sanitizeMetaClientIp("2001:db8::1")).toBe("2001:db8::1");
    expect(sanitizeMetaClientIp("unknown")).toBeNull();
    expect(sanitizeMetaClientIp("1.2.3.4\n5.6.7.8")).toBeNull();
  });

  it("user-agent tek satıra indirilir ve 500 karakterle sınırlanır", () => {
    expect(sanitizeMetaUserAgent("  A\n\tB  ")).toBe("A B");
    expect(sanitizeMetaUserAgent("x".repeat(700))).toHaveLength(500);
    expect(sanitizeMetaUserAgent("   ")).toBeNull();
  });
});

describe("sendMetaPurchase (outbox)", () => {
  function fakeOutbox(
    enqueue: MetaCapiOutboxLike["enqueue"],
    dispatch: MetaCapiOutboxLike["dispatch"],
  ): MetaCapiOutboxLike {
    return { enqueue, dispatch };
  }

  it("Purchase'ı kalıcı kuyruğa yazar ve event_id'yi korur", async () => {
    vi.stubEnv("META_CAPI_ACCESS_TOKEN", "test-token");
    const enqueue = vi.fn<MetaCapiOutboxLike["enqueue"]>(async () => "enqueued");
    const dispatch = vi.fn<MetaCapiOutboxLike["dispatch"]>(async () => ({ sent: true }));

    const result = await sendMetaPurchase(
      {
        transactionId: "txn_abc",
        email: "buyer@example.com",
        userId: "user-1",
        value: 39,
        currency: "USD",
        plan: "Starter",
        attribution: {
          fbp: "fb.1.1700000000000.123456",
          fbc: "fb.1.1700000000000.IwAR123",
          clientIp: "203.0.113.7",
          userAgent: "Mozilla/5.0",
        },
      },
      { outbox: fakeOutbox(enqueue, dispatch) },
    );

    expect(result).toEqual({ sent: true });
    expect(dispatch).toHaveBeenCalledWith("purchase-txn_abc");
    const queued = enqueue.mock.calls[0]?.[0] as unknown as {
      eventId: string;
      eventName: string;
      event: {
        value: number;
        currency: string;
        userData: Record<string, unknown>;
        customData: Record<string, unknown>;
      };
    };
    expect(queued.eventId).toBe("purchase-txn_abc");
    expect(queued.eventName).toBe("Purchase");
    expect(queued.event.value).toBe(39);
    expect(queued.event.customData).toMatchObject({
      content_name: "Starter",
      content_type: "product",
    });
    expect(queued.event.userData).toMatchObject({
      email: "buyer@example.com",
      externalId: "user-1",
      fbp: "fb.1.1700000000000.123456",
      fbc: "fb.1.1700000000000.IwAR123",
      clientIp: "203.0.113.7",
      userAgent: "Mozilla/5.0",
    });
  });

  it("aynı event_id ikinci kez kuyruğa girmez; deduplicated döner", async () => {
    vi.stubEnv("META_CAPI_ACCESS_TOKEN", "test-token");
    const enqueue = vi.fn(async () => "duplicate" as const);
    const dispatch = vi.fn(async () => ({ sent: true }));

    const result = await sendMetaPurchase(
      { transactionId: "txn_abc", value: 59, currency: "USD", plan: "Pro" },
      { outbox: fakeOutbox(enqueue, dispatch) },
    );
    expect(result).toEqual({ sent: true, deduplicated: true });
  });

  it("token yoksa da kuyruğa yazar; gönderim retry'a bırakılır", async () => {
    vi.stubEnv("META_CAPI_ACCESS_TOKEN", "");
    const enqueue = vi.fn(async () => "enqueued" as const);
    const dispatch = vi.fn(async () => ({
      sent: false,
      queued: true,
      error: "missing_token",
    }));

    const result = await sendMetaPurchase(
      { transactionId: "txn_abc", value: 59, currency: "USD" },
      { outbox: fakeOutbox(enqueue, dispatch) },
    );
    expect(result).toEqual({ sent: false, queued: true, error: "missing_token" });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith("purchase-txn_abc");
  });

  it("outbox migration'ı yoksa doğrudan gönderime düşer", async () => {
    vi.stubEnv("META_CAPI_ACCESS_TOKEN", "test-token");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendMetaPurchase(
      { transactionId: "txn_abc", email: "buyer@example.com", value: 39, currency: "USD" },
      {
        outbox: fakeOutbox(
          async () => {
            throw new Error("Could not find the function public.enqueue_meta_capi_event");
          },
          vi.fn(async () => ({ sent: false })),
        ),
      },
    );

    expect(result).toEqual({ sent: true });
    const call = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    const body = JSON.parse(call[1].body) as CapiPayload;
    expect(body.data[0]?.event_id).toBe("purchase-txn_abc");
    expect(body.data[0]?.user_data?.em).toEqual([sha256Hex("buyer@example.com")]);
  });

  it("outbox DB hatasında olayı kaybetmez; doğrudan gönderir", async () => {
    vi.stubEnv("META_CAPI_ACCESS_TOKEN", "test-token");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendMetaPurchase(
      { transactionId: "txn_db", email: "buyer@example.com", value: 59, currency: "USD" },
      {
        outbox: fakeOutbox(async () => {
          throw new Error("connection refused");
        }, vi.fn() as never),
      },
    );

    expect(result).toEqual({ sent: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("dispatch hatasında da doğrudan gönderir; kuyruk kaydı cron'a kalır", async () => {
    vi.stubEnv("META_CAPI_ACCESS_TOKEN", "test-token");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendMetaPurchase(
      { transactionId: "txn_dispatch", value: 39, currency: "USD" },
      {
        outbox: fakeOutbox(
          async () => "enqueued" as const,
          async () => {
            throw new Error("claim failed");
          },
        ),
      },
    );

    expect(result).toEqual({ sent: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("işlem kimliği yoksa göndermez", async () => {
    vi.stubEnv("META_CAPI_ACCESS_TOKEN", "test-token");
    const result = await sendMetaPurchase(
      { transactionId: "  ", value: 1, currency: "USD" },
      { outbox: fakeOutbox(vi.fn() as never, vi.fn() as never) },
    );
    expect(result).toEqual({ sent: false, error: "missing_event_id" });
  });
});
