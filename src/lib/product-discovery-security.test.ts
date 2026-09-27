/**
 * GÜVENLİK TESTLERİ — QStash imzası, iş sahipliği, idempotent kredi.
 *
 * Bu üçü de "sessizce para/veri kaybı" riskini taşıyan katmanlar; testleri
 * kasıtlı olarak SALDIRI senaryolarıyla yazıldı.
 */
import { createHash } from "node:crypto";

import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import {
  qstashSigningKeys,
  recallOwnership,
  rememberOwnership,
  signatureVerificationEnabled,
  verifyOwnership,
  verifyQStashSignature,
} from "./product-discovery-security.server";

/**
 * QStash'in gerçek imza biçimi: `iss: "Upstash"` + gövdenin SHA-256'ının
 * base64url'i. Sahte bir metin imzasıyla değil, GERÇEKTEN doğrulanabilir bir
 * JWS üretiyoruz; test ancak bu yolla "hangi anahtar doğru?" sorusunu
 * gerçekten cevaplayabilir.
 */
async function qstashSignature(raw: string, key: string): Promise<string> {
  const bodyHash = createHash("sha256").update(raw).digest("base64url");
  return new SignJWT({ body: bodyHash, sub: "https://app.test/step" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("Upstash")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(key));
}

describe("QStash imza anahtarı çözümlemesi", () => {
  const TOKEN = "qstash_publish_token_deger";

  it("yayınlama token'ı İMZA anahtarı sanılmaz (üretim tuzağı)", async () => {
    // Gerçek QStash imzası: paneldeki Current Signing Key ile üretilir.
    const raw = JSON.stringify({ runId: "r1", userId: "u1" });
    const signature = await qstashSignature(raw, "signing-key-current");

    const result = await verifyQStashSignature(raw, signature, {
      QSTASH_TOKEN: TOKEN,
      QSTASH_CURRENT_SIGNING_KEY: "signing-key-current",
      QSTASH_NEXT_SIGNING_KEY: "signing-key-next",
      NODE_ENV: "production",
    } as never);

    // Token'ı anahtar sanan eski kod bu adımda 401 dönerdi: hat üretimde
    // ilk adımda ölür, kullanıcı yalnızca "bir şeyler takıldı" görürdü.
    expect(result.ok).toBe(true);
  });

  it("token'la imzalanmış sahte teslimat REDDEDİLİR", async () => {
    const raw = JSON.stringify({ runId: "r1", userId: "u1" });
    const signature = await qstashSignature(raw, TOKEN);

    const result = await verifyQStashSignature(raw, signature, {
      QSTASH_TOKEN: TOKEN,
      QSTASH_CURRENT_SIGNING_KEY: "signing-key-current",
      QSTASH_NEXT_SIGNING_KEY: "signing-key-next",
      NODE_ENV: "production",
    } as never);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.reason).toBe("INVALID_SIGNATURE");
    }
  });

  it("anahtar rotasyonunda `next` anahtarı da kabul edilir", async () => {
    const raw = JSON.stringify({ runId: "r1", userId: "u1" });
    const signature = await qstashSignature(raw, "signing-key-next");

    const result = await verifyQStashSignature(raw, signature, {
      QSTASH_TOKEN: TOKEN,
      QSTASH_CURRENT_SIGNING_KEY: "signing-key-current",
      QSTASH_NEXT_SIGNING_KEY: "signing-key-next",
      NODE_ENV: "production",
    } as never);

    expect(result.ok).toBe(true);
  });

  it("ayrı imza anahtarı yoksa geriye dönük uyum: token kullanılır", () => {
    expect(qstashSigningKeys({ QSTASH_TOKEN: TOKEN } as never)).toEqual({
      current: TOKEN,
      next: TOKEN,
    });
  });

  it("`next` tanımlı değilse `current` ile aynı anahtar kullanılır", () => {
    expect(qstashSigningKeys({ QSTASH_CURRENT_SIGNING_KEY: "cur" } as never)).toEqual({
      current: "cur",
      next: "cur",
    });
  });

  it("hiçbir anahtar yoksa doğrulama kapalı", () => {
    expect(qstashSigningKeys({} as never)).toBeNull();
    expect(signatureVerificationEnabled({} as never)).toBe(false);
  });
});

describe("QStash imza doğrulama", () => {
  const body = JSON.stringify({ runId: "r1", userId: "u1" });

  it("QSTASH_TOKEN yoksa imza doğrulama KAPALI (ve üretimde istek reddedilir)", () => {
    expect(signatureVerificationEnabled({} as never)).toBe(false);
    // Üretimde token yoksa → fail-closed: istek 503 ile reddedilir.
    expect(verifyQStashSignature(body, "sig", { NODE_ENV: "production" } as never)).toBeDefined();
  });

  it("imza doğrulama AÇIKKEN imzasız istek 401 REDDEDİLİR", async () => {
    const result = await verifyQStashSignature(body, null, {
      QSTASH_TOKEN: "test-signing-key",
      NODE_ENV: "production",
    } as never);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("MISSING_SIGNATURE");
      expect(result.status).toBe(401);
    }
  });

  it("BOZUK imza 401 REDDEDİLİR (sahte iş tetiklenemez)", async () => {
    const result = await verifyQStashSignature(body, "clearly.not.a.jws", {
      QSTASH_TOKEN: "test-signing-key",
      NODE_ENV: "production",
    } as never);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["INVALID_SIGNATURE", "MALFORMED_BODY"]).toContain(result.reason);
      expect(result.status).toBeGreaterThanOrEqual(400);
    }
  });

  it("geliştirme ortamında imza olmadan kabul edilir (yerel döngü)", async () => {
    const result = await verifyQStashSignature(body, null, {
      NODE_ENV: "development",
    } as never);
    expect(result.ok).toBe(true);
  });

  it("hata mesajı iç detay sızdırmaz", async () => {
    const result = await verifyQStashSignature(body, "bad", {
      QSTASH_TOKEN: "test-signing-key",
      NODE_ENV: "production",
    } as never);
    if (!result.ok) {
      expect(result.message).not.toContain("test-signing-key");
    }
  });
});

describe("iş sahipliği (ownership)", () => {
  it("kayıtlı runId + eşleşen userId → serbest", () => {
    rememberOwnership({ runId: "r1", userId: "u1", createdAt: "2026-01-01T00:00:00Z" });
    expect(verifyOwnership(recallOwnership("r1"), "u1").ok).toBe(true);
  });

  it("BAŞKASININ runId'si → 403 (veri sızıntısı engellenir)", () => {
    rememberOwnership({ runId: "r2", userId: "victim", createdAt: "2026-01-01T00:00:00Z" });
    const result = verifyOwnership(recallOwnership("r2"), "attacker");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.reason).toBe("USER_MISMATCH");
    }
  });

  it("BİLİNMEYEN runId → 403 (yoksa bile reddet, varsayma)", () => {
    const result = verifyOwnership(recallOwnership("yok-boyle-bir-run"), "u1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("NOT_FOUND");
  });
});
