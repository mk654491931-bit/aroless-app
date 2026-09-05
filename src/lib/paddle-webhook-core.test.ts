import { describe, expect, it } from "vitest";
import {
  processPaddleWebhook,
  type SupabaseLike,
} from "@/lib/paddle-webhook-core";

const SECRET = "pdl_ntfset_test_secret";
const USER_ID = "11111111-1111-1111-1111-111111111111";

// Canonical env name (PADDLE_WEBHOOK_SECRET_KEY) — bu test aynı zamanda
// yeni ortam değişkeni adının uçtan uca çalıştığını doğrular.
process.env["PADDLE_WEBHOOK_SECRET_KEY"] = SECRET;
delete process.env["PADDLE_WEBHOOK_SECRET"];

async function sign(body: string): Promise<string> {
  const ts = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}:${body}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `ts=${ts};h1=${hex}`;
}

type Call = { table: string; op: string; values?: unknown; where?: string };

/** processPaddleWebhook'un ihtiyaç duyduğu Supabase yüzeyini kaydeden stub. */
class FakeSupabase {
  calls: Call[] = [];
  existingEventId: string | null = null;

  from(table: string) {
    return {
      select: () => ({
        eq: (_col: string, _val: string) => ({
          maybeSingle: async () =>
            this.existingEventId && table === "paddle_webhook_events"
              ? { data: { event_id: this.existingEventId }, error: null }
              : { data: null, error: null },
        }),
      }),
      update: (values: unknown) => ({
        eq: (col: string, val: string) => {
          this.calls.push({ table, op: "update", values, where: `${col}=${val}` });
          return Promise.resolve({ error: null });
        },
      }),
      insert: (values: unknown) => {
        this.calls.push({ table, op: "insert", values });
        return Promise.resolve({ error: null });
      },
      upsert: (values: unknown, opts?: { onConflict?: string }) => {
        this.calls.push({ table, op: "upsert", values, where: opts?.onConflict });
        return Promise.resolve({ error: null });
      },
    };
  }

  rpc = async () => ({ error: null });
}

function subEvent(eventType: string, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    event_id: "evt_test_" + Math.random().toString(36).slice(2),
    event_type: eventType,
    occurred_at: new Date().toISOString(),
    data: {
      id: "sub_123",
      status: "active",
      customer: { id: "cus_1", email: "user@example.com" },
      custom_data: { user_id: USER_ID },
      items: [{ price: { id: "pri_1", name: "Pro (monthly)" } }],
      billing_period: { start: "2026-09-01T00:00:00Z", finish: "2026-10-01T00:00:00Z" },
      ...overrides,
    },
  });
}

describe("processPaddleWebhook", () => {
  it("returns 401 for an invalid signature without touching the DB", async () => {
    const db = new FakeSupabase();
    const result = await processPaddleWebhook({
      raw: subEvent("subscription.updated"),
      signatureHeader: "ts=1;h1=deadbeef",
      supabase: db as unknown as SupabaseLike,
    });
    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: "Invalid signature" });
    expect(db.calls).toHaveLength(0);
  });

  it("returns 500 for a malformed payload so Paddle retries", async () => {
    const db = new FakeSupabase();
    const body = "{ not json";
    const result = await processPaddleWebhook({
      raw: body,
      signatureHeader: await sign(body),
      supabase: db as unknown as SupabaseLike,
    });
    expect(result.status).toBe(500);
    expect(db.calls).toHaveLength(0);
  });

  it("acknowledges known event types with { status: 'success' }", async () => {
    const db = new FakeSupabase();
    const body = subEvent("subscription.updated");
    const result = await processPaddleWebhook({
      raw: body,
      signatureHeader: await sign(body),
      supabase: db as unknown as SupabaseLike,
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ status: "success" });
  });

  it("subscription.updated upserts into subscriptions and syncs profiles", async () => {
    const db = new FakeSupabase();
    const body = subEvent("subscription.updated");
    const result = await processPaddleWebhook({
      raw: body,
      signatureHeader: await sign(body),
      supabase: db as unknown as SupabaseLike,
    });

    expect(result.status).toBe(200);
    const subUpsert = db.calls.find((c) => c.table === "subscriptions" && c.op === "upsert");
    expect(subUpsert).toBeDefined();
    expect(subUpsert!.where).toBe("id");
    expect(subUpsert!.values).toMatchObject({
      id: "sub_123",
      user_id: USER_ID,
      customer_id: "cus_1",
      status: "active",
      price_id: "pri_1",
    });
    expect((subUpsert!.values as Record<string, unknown>).updated_at).toEqual(
      expect.any(String),
    );
    // Kanonik profiles güncellemesi de yapılır.
    expect(
      db.calls.some((c) => c.table === "profiles" && c.op === "update" && c.where === "id=" + USER_ID),
    ).toBe(true);
  });

  it("subscription.canceled sets status to canceled in subscriptions and restricts profiles", async () => {
    const db = new FakeSupabase();
    const body = subEvent("subscription.canceled", { status: "canceled" });
    const result = await processPaddleWebhook({
      raw: body,
      signatureHeader: await sign(body),
      supabase: db as unknown as SupabaseLike,
    });

    expect(result.status).toBe(200);
    const subUpdate = db.calls.find((c) => c.table === "subscriptions" && c.op === "update");
    expect(subUpdate).toBeDefined();
    expect(subUpdate!.where).toBe("id=sub_123");
    expect(subUpdate!.values).toMatchObject({ status: "canceled" });
    const profileUpdate = db.calls.find((c) => c.table === "profiles" && c.op === "update");
    expect(profileUpdate!.values).toMatchObject({
      paddle_subscription_status: "canceled",
      subscription_tier: "Free",
    });
  });

  it("transaction.completed activates the subscription (subscriptions upsert + profiles)", async () => {
    const db = new FakeSupabase();
    const body = JSON.stringify({
      event_id: "evt_txn_1",
      event_type: "transaction.completed",
      occurred_at: new Date().toISOString(),
      data: {
        id: "txn_1",
        subscription_id: "sub_123",
        status: "completed",
        customer: { id: "cus_1", email: "user@example.com" },
        custom_data: { user_id: USER_ID },
        items: [{ price: { id: "pri_1" } }],
        totals: { total: "59.00", currency: "USD" },
        billing_period: { start: "2026-09-01T00:00:00Z", finish: "2026-10-01T00:00:00Z" },
      },
    });
    const result = await processPaddleWebhook({
      raw: body,
      signatureHeader: await sign(body),
      supabase: db as unknown as SupabaseLike,
    });

    expect(result.status).toBe(200);
    const subUpsert = db.calls.find((c) => c.table === "subscriptions" && c.op === "upsert");
    expect(subUpsert!.values).toMatchObject({
      id: "sub_123",
      user_id: USER_ID,
      customer_id: "cus_1",
      status: "active", // completed → active
      price_id: "pri_1",
    });
    expect(
      db.calls.some((c) => c.table === "transactions" && c.op === "insert"),
    ).toBe(true);
  });

  it("skips duplicate events (idempotency) without writing", async () => {
    const db = new FakeSupabase();
    db.existingEventId = "evt_dup_1";
    // İmzayı event_id'si belli payload üzerinden üret.
    const raw = JSON.stringify({
      event_id: "evt_dup_1",
      event_type: "subscription.updated",
      data: {
        id: "sub_123",
        status: "active",
        customer: { id: "cus_1" },
        custom_data: { user_id: USER_ID },
        items: [{ price: { id: "pri_1" } }],
      },
    });
    const result = await processPaddleWebhook({
      raw,
      signatureHeader: await sign(raw),
      supabase: db as unknown as SupabaseLike,
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ status: "success", duplicate: true });
    expect(db.calls.some((c) => c.table === "profiles")).toBe(false);
    expect(db.calls.some((c) => c.table === "subscriptions")).toBe(false);
  });

  it("still works when the legacy PADDLE_WEBHOOK_SECRET name is set instead", async () => {
    process.env["PADDLE_WEBHOOK_SECRET"] = SECRET;
    delete process.env["PADDLE_WEBHOOK_SECRET_KEY"];
    try {
      const db = new FakeSupabase();
      const body = subEvent("subscription.updated");
      const result = await processPaddleWebhook({
        raw: body,
        signatureHeader: await sign(body),
        supabase: db as unknown as SupabaseLike,
      });
      expect(result.status).toBe(200);
    } finally {
      process.env["PADDLE_WEBHOOK_SECRET_KEY"] = SECRET;
      delete process.env["PADDLE_WEBHOOK_SECRET"];
    }
  });
});