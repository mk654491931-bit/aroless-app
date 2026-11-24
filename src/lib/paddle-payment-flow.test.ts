/**
 * PADDLE ÖDEME → HESAP → JETON — UÇTAN UCA SÖZLEŞME TESTİ.
 *
 * Gerçek Paddle ve Supabase yok; ama webhook'un GERÇEK işleyicisi çalışır:
 * imza doğrulanır, olay eşlenir, kullanıcı atfı yapılır ve veritabanına
 * gönderilen `process_paddle_event` argümanları yakalanır.
 *
 * Bu testin kilitlediği sözleşme:
 *   • ödeme sonrası profil DOĞRU pakete (Starter/Pro/Business) açılır,
 *   • paketin dört aylık hakkının toplamı kadar jeton istenir,
 *   • simülatör jetonu paketin yarısı kadardır,
 *   • işlem kimliği ve abonelik kimliği aynen veritabanına geçer
 *     (kredi idempotansı bu anahtara dayanır).
 */
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => {
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const result = { data: null as unknown, error: null as { message: string } | null };
  const userMetadata: Record<string, unknown> = { cookie_marketing_consent: true };
  /** Meta CAPI outbox RPC'lerini taklit eden satırlar (event_id → kayıt). */
  const outboxRows = new Map<string, Record<string, unknown>>();
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gte", "ilike", "is", "update", "order", "limit"]) {
    chain[method] = () => chain;
  }
  chain["maybeSingle"] = async () => result;
  chain["single"] = async () => result;
  chain["then"] = (resolve: (value: unknown) => unknown) => resolve(result);
  return {
    rpcCalls,
    userMetadata,
    outboxRows,
    admin: {
      from: () => chain,
      auth: {
        admin: {
          getUserById: async () => ({
            data: { user: { user_metadata: userMetadata } },
            error: null,
          }),
        },
      },
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args });

        // KALICI OUTBOX: enqueue → claim → finish üçlüsü gerçek akıştaki gibi
        // taklit edilir; aksi hâlde webhook hiçbir Meta isteği atmaz.
        if (name === "enqueue_meta_capi_event") {
          const eventId = String(args["_event_id"]);
          if (outboxRows.has(eventId)) return { data: "duplicate", error: null };
          outboxRows.set(eventId, {
            id: `row-${outboxRows.size + 1}`,
            event_id: eventId,
            event_name: args["_event_name"],
            payload: args["_payload"],
            attempts: 1,
            max_attempts: 8,
          });
          return { data: "enqueued", error: null };
        }
        if (name === "claim_meta_capi_outbox") {
          const eventId = args["_event_id"] ? String(args["_event_id"]) : null;
          const limit = Math.max(1, Math.min(Number(args["_limit"] ?? 20), 100));
          const rows = [...outboxRows.values()].filter(
            (row) => !eventId || row["event_id"] === eventId,
          );
          return { data: rows.slice(0, limit), error: null };
        }
        if (name === "finish_meta_capi_outbox") {
          return { data: "sent", error: null };
        }
        return { data: "ok", error: null };
      },
    },
  };
});

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakes.admin }));

const SECRET = "whsec_payment_flow_test";
const USER_ID = "11111111-1111-1111-1111-111111111111";
const NOW_SEC = Math.floor(Date.now() / 1000);

const priceFor = { Starter: "pri_starter", Pro: "pri_pro", Business: "pri_business" } as const;
const amountFor = { Starter: "3900", Pro: "5900", Business: "19900" } as const;

const sign = (body: string) =>
  `ts=${NOW_SEC};h1=${createHmac("sha256", SECRET).update(`${NOW_SEC}:${body}`).digest("hex")}`;

function paymentBody(
  plan: keyof typeof priceFor,
  marketingConsent: "granted" | "denied" = "granted",
) {
  return JSON.stringify({
    event_id: `evt_pay_${plan}`,
    event_type: "transaction.completed",
    occurred_at: new Date().toISOString(),
    data: {
      id: `txn_${plan}`,
      subscriptionId: `sub_${plan}`,
      customerId: `cus_${plan}`,
      currencyCode: "USD",
      status: "completed",
      details: { totals: { grandTotal: amountFor[plan] } },
      billingPeriod: { startsAt: "2026-11-09T00:00:00Z", endsAt: "2026-12-09T00:00:00Z" },
      items: [{ price: { id: priceFor[plan], productId: `pro_${plan}` } }],
      customData: { userId: USER_ID, plan, marketingConsent },
    },
  });
}

const requestFor = (body: string) =>
  new Request("https://aroless.tech/api/webhooks/paddle", {
    method: "POST",
    headers: { "content-type": "application/json", "paddle-signature": sign(body) },
    body,
  });

const ENV_KEYS = [
  "PADDLE_API_KEY",
  "PADDLE_WEBHOOK_SECRET_KEY",
  "PADDLE_WEBHOOK_SECRET",
  "PADDLE_CLIENT_TOKEN",
  "VITE_PADDLE_CLIENT_TOKEN",
  "PADDLE_STARTER_PRICE_ID",
  "PADDLE_PRO_PRICE_ID",
  "PADDLE_BUSINESS_PRICE_ID",
] as const;
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  process.env.PADDLE_WEBHOOK_SECRET_KEY = SECRET;
  process.env.PADDLE_CLIENT_TOKEN = "test-client-token";
  process.env.PADDLE_STARTER_PRICE_ID = priceFor.Starter;
  process.env.PADDLE_PRO_PRICE_ID = priceFor.Pro;
  process.env.PADDLE_BUSINESS_PRICE_ID = priceFor.Business;
  // API anahtarı BİLİNÇLİ olarak yok: imza ve plan çözümü ona muhtaç değil.
  fakes.rpcCalls.length = 0;
  fakes.outboxRows.clear();
  fakes.userMetadata.cookie_marketing_consent = true;
});

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function cancellationBody() {
  return JSON.stringify({
    event_id: "evt_cancel_1",
    event_type: "subscription.canceled",
    occurred_at: new Date().toISOString(),
    data: {
      id: "sub_Pro",
      status: "canceled",
      customerId: "cus_Pro",
      items: [{ price: { id: priceFor.Pro } }],
      customData: { userId: USER_ID, plan: "Pro" },
    },
  });
}

describe("Paddle ödeme → hesap açma + jeton", () => {
  const cases = [
    { plan: "Starter", search: 48, sim: 5 },
    { plan: "Pro", search: 136, sim: 10 },
    { plan: "Business", search: 430, sim: 25 },
  ] as const;

  for (const item of cases) {
    it(`${item.plan} ödemesi hesabı doğru tier'a açar ve ${item.search} jeton ister`, async () => {
      const { handlePaddleWebhook } = await import("./paddle-webhook.server");
      const res = await handlePaddleWebhook(requestFor(paymentBody(item.plan)));

      expect(res.status).toBe(200);
      const processed = fakes.rpcCalls.filter((call) => call.name === "process_paddle_event");
      expect(processed).toHaveLength(1);
      const args = processed[0]!.args;
      expect(args["_user_id"]).toBe(USER_ID);
      expect(args["_tier"]).toBe(item.plan);
      expect(args["_status"]).toBe("active");
      expect(args["_transaction_id"]).toBe(`txn_${item.plan}`);
      expect(args["_paddle_subscription_id"]).toBe(`sub_${item.plan}`);
      expect(args["_price_id"]).toBe(priceFor[item.plan]);
      expect(args["_amount_cents"]).toBe(Number(amountFor[item.plan]));
      expect(args["_search_credits"]).toBe(item.search);
      expect(args["_sim_credits"]).toBe(item.sim);
    });
  }

  it("iptal olayı hesabı Free'ye indirir ve jeton istemez", async () => {
    const { handlePaddleWebhook } = await import("./paddle-webhook.server");
    const res = await handlePaddleWebhook(requestFor(cancellationBody()));

    expect(res.status).toBe(200);
    const processed = fakes.rpcCalls.filter((call) => call.name === "process_paddle_event");
    expect(processed).toHaveLength(1);
    const args = processed[0]!.args;
    expect(args["_tier"]).toBe("Free");
    expect(args["_status"]).toBe("canceled");
    expect(args["_search_credits"]).toBe(0);
    expect(args["_sim_credits"]).toBe(0);
  });

  it("pazarlama izni yoksa Meta CAPI'ye Purchase GÖNDERMEZ", async () => {
    process.env.META_CAPI_ACCESS_TOKEN = "test-token";
    fakes.userMetadata.cookie_marketing_consent = false;
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { handlePaddleWebhook } = await import("./paddle-webhook.server");
      const res = await handlePaddleWebhook(requestFor(paymentBody("Pro", "granted")));
      expect(res.status).toBe(200);

      const calls = fetchMock.mock.calls as unknown as Array<[string]>;
      expect(calls.some(([url]) => String(url).includes("/1144034978511312/events"))).toBe(false);
    } finally {
      delete process.env.META_CAPI_ACCESS_TOKEN;
      vi.unstubAllGlobals();
    }
  });

  it("başarılı ödemede Meta'ya işlem kimliğiyle Purchase bildirir", async () => {
    process.env.META_CAPI_ACCESS_TOKEN = "test-token";
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { handlePaddleWebhook } = await import("./paddle-webhook.server");
      const res = await handlePaddleWebhook(requestFor(paymentBody("Pro")));
      expect(res.status).toBe(200);

      const calls = fetchMock.mock.calls as unknown as Array<[string, { body: string }]>;
      const call = calls.find(([url]) => String(url).includes("/1144034978511312/events"));
      expect(call).toBeDefined();
      const body = JSON.parse(call![1].body) as { data: Array<Record<string, unknown>> };
      expect(body.data[0]).toMatchObject({
        event_name: "Purchase",
        event_id: "purchase-txn_Pro",
        custom_data: { value: 59, currency: "USD", content_name: "Pro", content_type: "product" },
      });
    } finally {
      delete process.env.META_CAPI_ACCESS_TOKEN;
      delete process.env.META_TEST_EVENT_CODE;
      vi.unstubAllGlobals();
    }
  });
});
