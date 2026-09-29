/**
 * PADDLE WEBHOOK — rota sözleşmesi testi (ağ YOK, Supabase'ye gitmez).
 *
 * Burada kilitlenen şey davranış değil, YOL ve KAPI SIRASI:
 *   1. Paddle, hangi adrese POST atarsa atsın işleyiciye ULAŞIR (404 dönmez).
 *      Ölçülen hata tam olarak buydu: panelde `/api/webhooks/paddle` yazılıydı,
 *      uygulama yalnız `/api/public/webhook/paddle` sunuyordu.
 *   2. Yapılandırma yoksa işleyici İMZA DOĞRULAMADAN ÖNCE 500 döner —
 *      çünkü doğrulamanın kendisi eksik anahtara dayanır. Yanlış imzalı bir
 *      istek 400 almalı, sessizce 500 almamalıdır.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const PADDLE_ENV = [
  "PADDLE_API_KEY",
  "PADDLE_WEBHOOK_SECRET_KEY",
  "PADDLE_WEBHOOK_SECRET",
  "PADDLE_CLIENT_TOKEN",
  "VITE_PADDLE_CLIENT_TOKEN",
] as const;

const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of PADDLE_ENV) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const post = (body = '{"event_id":"evt_1","event_type":"transaction.completed"}') =>
  new Request("https://aroless.tech/api/webhooks/paddle", {
    method: "POST",
    headers: { "content-type": "application/json", "paddle-signature": "ts=1;sig=bogus" },
    body,
  });

describe("Paddle webhook — yapılandırma kapısı", () => {
  it("anahtarlar yoksa 500 döner ve 'Paddle not configured' der", async () => {
    const { handlePaddleWebhook } = await import("./paddle-webhook.server");
    const res = await handlePaddleWebhook(post());
    expect(res.status).toBe(500);
    await expect(res.text()).resolves.toContain("Paddle not configured");
  });

  it("yapılandırma kapısı İMZA DOĞRULAMASINDAN ÖNCE çalışır", async () => {
    // Anahtarlar yokken doğrulama yapılamaz; kapı önce devreye girer ve 500
    // döner. Aksi hâlde imza hatası 400 dönerdi ve "yapılandırma eksik"
    // gizlenirdi.
    const { handlePaddleWebhook } = await import("./paddle-webhook.server");
    const res = await handlePaddleWebhook(post());
    expect(res.status).not.toBe(400);
  });

  it("çok büyük gövde 413 ile reddedilir (imzadan ÖNCE, iş yükü büyütülmez)", async () => {
    // Yapılandırma kapısından önce çalışsa bu test 500 görürdü; 413 görmek
    // boyut korumasının gerçekten ayrı ve erken bir adım olduğunu gösterir.
    process.env.PADDLE_API_KEY = "test-key";
    process.env.PADDLE_WEBHOOK_SECRET_KEY = "test-secret";
    process.env.PADDLE_CLIENT_TOKEN = "test-token";
    const { handlePaddleWebhook } = await import("./paddle-webhook.server");
    const res = await handlePaddleWebhook(
      new Request("https://aroless.tech/api/webhooks/paddle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "x".repeat(1_000_001),
      }),
    );
    expect(res.status).toBe(413);
  });
});

describe("Paddle webhook — her iki yol aynı işleyiciyi çağırır", () => {
  const read = (p: string) => import("node:fs").then((fs) => fs.readFileSync(p, "utf8"));

  it("iki rota da aynı işleyici modülünü çağırır (kopyalanmış mantık yok)", async () => {
    // Kopyalanmış bir ikinci uygulama, bir gün diğerinden ayrışır ve iki adres
    // farklı davranır. Tek uygulama şart.
    const canonical = await read("src/routes/api/public/webhook/paddle.ts");
    const alias = await read("src/routes/api/webhooks/paddle.ts");
    expect(canonical).toContain("@/lib/paddle-webhook.server");
    expect(alias).toContain("@/lib/paddle-webhook.server");
    // Rotaların kendi mantığı yok: yalnız devretmeli.
    expect(canonical).toContain("handlePaddleWebhook");
    expect(alias).toContain("handlePaddleWebhook");
  });

  it("her iki yol da route ağacına kayıtlıdır (yoksa istek 404 alır)", async () => {
    // 404'ün ÖLÇÜLEN sebebiydi: rota ağacında olmayan bir adres. Ağacın her iki
    // yolu da içerdiğini sabitliyoruz.
    const tree = await read("src/routeTree.gen.ts");
    expect(tree).toContain("/api/public/webhook/paddle");
    expect(tree).toContain("/api/webhooks/paddle");
  });
});
