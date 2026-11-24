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
  sendMetaCapiEvent,
  sendMetaPurchase,
  sha256Hex,
} from "./meta-capi.server";

type CapiPayload = {
  data: Array<{
    event_name: string;
    event_id?: string;
    event_time: number;
    event_source_url?: string;
    user_data?: { em?: string[]; external_id?: string[]; fbp?: string };
    custom_data?: Record<string, unknown>;
  }>;
  test_event_code?: string;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("buildMetaCapiPayload", () => {
  it("e-posta ve kullanıcı kimliğini özetler, düz metin göndermez", () => {
    const payload = buildMetaCapiPayload({
      eventName: "Purchase",
      eventId: "purchase-txn_1",
      eventTime: 1_700_000_000,
      eventSourceUrl: "https://aroless.tech/pricing",
      userData: { email: "  Buyer@Example.com ", externalId: "user-1", fbp: "fb.1.123" },
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
    expect(event.user_data?.fbp).toBe("fb.1.123");
    expect(event.custom_data).toMatchObject({ content_name: "Pro", value: 59, currency: "USD" });

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("Buyer@Example.com");
    expect(serialized).not.toContain("buyer@example.com");
    expect(serialized).not.toContain("user-1");
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

describe("sendMetaPurchase", () => {
  it("Purchase'ı işlem kimliğiyle ve gerçek tutarla gönderir", async () => {
    vi.stubEnv("META_CAPI_ACCESS_TOKEN", "test-token");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendMetaPurchase({
      transactionId: "txn_abc",
      email: "buyer@example.com",
      userId: "user-1",
      value: 39,
      currency: "USD",
      plan: "Starter",
    });
    expect(result).toEqual({ sent: true });

    const call = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    const body = JSON.parse(call[1].body) as CapiPayload;
    expect(body.data[0]).toMatchObject({
      event_name: "Purchase",
      event_id: "purchase-txn_abc",
      custom_data: { content_name: "Starter", content_type: "product", value: 39, currency: "USD" },
    });
    expect(body.data[0].user_data?.em).toEqual([sha256Hex("buyer@example.com")]);
  });
});
