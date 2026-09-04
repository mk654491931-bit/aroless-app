import { describe, expect, it } from "vitest";
import {
  parsePaddleSignatureHeader,
  verifyPaddleWebhook,
} from "@/lib/paddle.server";

const SECRET = "pdl_ntfset_test_secret";
const BODY = JSON.stringify({ alert_name: "test", event_id: "evt_123" });

async function sign(ts: number, body: string, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}:${body}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `ts=${ts};h1=${hex}`;
}

// getPaddleEnv() reads process.env; inject the test secret.
process.env["PADDLE_API_KEY"] = "test";
process.env["PADDLE_CLIENT_TOKEN"] = "test";
process.env["PADDLE_WEBHOOK_SECRET"] = SECRET;

describe("parsePaddleSignatureHeader", () => {
  it("parses ts and h1", () => {
    const parsed = parsePaddleSignatureHeader("ts=1700000000;h1=abc123");
    expect(parsed).toEqual({ ts: 1700000000, h1: "abc123" });
  });

  it("returns null when h1 is missing", () => {
    expect(parsePaddleSignatureHeader("ts=1700000000")).toBeNull();
  });

  it("returns null when ts is not numeric", () => {
    expect(parsePaddleSignatureHeader("ts=abc;h1=abc123")).toBeNull();
  });

  it("returns null for garbage input", () => {
    expect(parsePaddleSignatureHeader("not-a-signature")).toBeNull();
    expect(parsePaddleSignatureHeader("")).toBeNull();
  });
});

describe("verifyPaddleWebhook", () => {
  const now = 1_700_000_000;

  it("accepts a valid signature", async () => {
    const header = await sign(now, BODY);
    expect(await verifyPaddleWebhook(BODY, header, now)).toBe(true);
  });

  it("rejects a tampered body", async () => {
    const header = await sign(now, BODY);
    expect(await verifyPaddleWebhook(BODY + " ", header, now)).toBe(false);
  });

  it("rejects a wrong secret", async () => {
    const header = await sign(now, BODY, "pdl_ntfset_wrong_secret");
    expect(await verifyPaddleWebhook(BODY, header, now)).toBe(false);
  });

  it("rejects a stale timestamp (replay)", async () => {
    const header = await sign(now - 400, BODY);
    expect(await verifyPaddleWebhook(BODY, header, now)).toBe(false);
  });

  it("accepts a signature within the 5-minute window", async () => {
    const header = await sign(now - 299, BODY);
    expect(await verifyPaddleWebhook(BODY, header, now)).toBe(true);
  });

  it("rejects timestamps too far in the future", async () => {
    const header = await sign(now + 120, BODY);
    expect(await verifyPaddleWebhook(BODY, header, now)).toBe(false);
  });

  it("rejects a missing signature header", async () => {
    expect(await verifyPaddleWebhook(BODY, "", now)).toBe(false);
  });

  it("rejects a legacy base64-format header (old bug)", async () => {
    expect(await verifyPaddleWebhook(BODY, "aGVsbG8gd29ybGQ=", now)).toBe(false);
  });
});
