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
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "ilike", "is", "update", "order", "limit"]) {
    chain[method] = () => chain;
  }
  chain["maybeSingle"] = async () => result;
  chain["single"] = async () => result;
  chain["then"] = (resolve: (value: unknown) => unknown) => resolve(result);
  return {
    rpcCalls,
    admin: {
      from: () => chain,
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args });
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

function paymentBody(plan: keyof typeof priceFor) {
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
      customData: { userId: USER_ID, plan },
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
});
