/**
 * PADDLE İMZA DOĞRULAMASI — API anahtarından bağımsız.
 *
 * ÖLÇÜLEN HATA: webhook ayarları API anahtarı yoksa `null` dönüyordu ve imza
 * doğrulaması SDK istemcisiyle yapıldığı için API anahtarı olmadan webhook
 * hiç çalışmıyordu. Oysa imza yalnız webhook sırrı + ham gövde ister.
 * Bu testler iki şeyi sabitler:
 *   1. doğrulama API anahtarı OLMADAN da çalışır,
 *   2. yanlış/eski imza ve bozuk başlık reddedilir (güvenlik gevşemez).
 */
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { verifyPaddleSignature, verifyPaddleWebhook } from "./paddle.server";

const SECRET = "test-webhook-secret";
const BODY = JSON.stringify({
  event_id: "evt_signature_1",
  event_type: "transaction.completed",
  occurred_at: "2026-11-09T00:00:00.000Z",
  data: { id: "txn_signature_1" },
});
const NOW = Date.now();
const NOW_SEC = Math.floor(NOW / 1000);

const sign = (body: string, ts: number, secret = SECRET) =>
  `ts=${ts};h1=${createHmac("sha256", secret).update(`${ts}:${body}`).digest("hex")}`;

const ENV_KEYS = [
  "PADDLE_API_KEY",
  "PADDLE_WEBHOOK_SECRET_KEY",
  "PADDLE_WEBHOOK_SECRET",
  "PADDLE_CLIENT_TOKEN",
  "VITE_PADDLE_CLIENT_TOKEN",
] as const;
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  process.env.PADDLE_WEBHOOK_SECRET_KEY = SECRET;
});

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("verifyPaddleSignature", () => {
  it("geçerli imzayı kabul eder", () => {
    expect(verifyPaddleSignature(BODY, SECRET, sign(BODY, NOW_SEC), NOW)).toBe(true);
  });

  it("yanlış sır ile üretilen imzayı reddeder", () => {
    expect(verifyPaddleSignature(BODY, SECRET, sign(BODY, NOW_SEC, "wrong"), NOW)).toBe(false);
  });

  it("gövde değiştiyse imza geçersizdir", () => {
    expect(verifyPaddleSignature(`${BODY} `, SECRET, sign(BODY, NOW_SEC), NOW)).toBe(false);
  });

  it("5 saniyeden eski imzayı reddeder (replay koruması)", () => {
    const old = NOW_SEC - 30;
    expect(verifyPaddleSignature(BODY, SECRET, sign(BODY, old), NOW)).toBe(false);
  });

  it("anahtar rotasyonundaki birden çok h1'den geçerli olanı kabul eder", () => {
    const header = `ts=${NOW_SEC};h1=${"0".repeat(64)};h1=${createHmac("sha256", SECRET)
      .update(`${NOW_SEC}:${BODY}`)
      .digest("hex")}`;
    expect(verifyPaddleSignature(BODY, SECRET, header, NOW)).toBe(true);
  });

  it("eksik ya da bozuk başlığı reddeder", () => {
    expect(verifyPaddleSignature(BODY, SECRET, "", NOW)).toBe(false);
    expect(verifyPaddleSignature(BODY, SECRET, "h1=abc", NOW)).toBe(false);
    expect(verifyPaddleSignature(BODY, SECRET, "ts=abc;h1=def", NOW)).toBe(false);
    expect(verifyPaddleSignature(BODY, SECRET, `ts=${NOW_SEC};h1=zz`, NOW)).toBe(false);
  });
});

describe("verifyPaddleWebhook — API anahtarı olmadan", () => {
  it("geçerli imzayı çözer (webhook API anahtarına muhtaç değil)", async () => {
    expect(process.env.PADDLE_API_KEY).toBeUndefined();
    const event = await verifyPaddleWebhook(BODY, sign(BODY, NOW_SEC));
    expect(event).toMatchObject({
      eventId: "evt_signature_1",
      eventType: "transaction.completed",
      occurredAt: "2026-11-09T00:00:00.000Z",
      data: { id: "txn_signature_1" },
    });
  });

  it("geçersiz imzayı reddeder", async () => {
    await expect(verifyPaddleWebhook(BODY, `ts=${NOW_SEC};h1=${"0".repeat(64)}`)).rejects.toThrow();
  });

  it("webhook sırrı yoksa açıkça hata verir", async () => {
    delete process.env.PADDLE_WEBHOOK_SECRET_KEY;
    delete process.env.PADDLE_WEBHOOK_SECRET;
    await expect(verifyPaddleWebhook(BODY, sign(BODY, NOW_SEC))).rejects.toThrow(
      /webhook sırrı eksik/i,
    );
  });
});
