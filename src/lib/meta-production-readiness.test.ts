/**
 * META PRODUCTION HAZIRLIĞI — değişmemesi gereken ürün/ortam sözleşmeleri.
 *
 * Bu testler canlı Meta/Paddle bağlantısı KURMAZ; yalnız kod ve yapılandırma
 * üzerinden şunları kilitler:
 *   • Katalog fiyatları Starter 39 / Pro 59 / Business 199 USD.
 *   • Paddle kimlikleri ortam değişkenlerinden okunur (kodda sabit değer yok).
 *   • Ücretsiz deneme (trial) akışı YOK; bu yüzden `Lead` olayı da yok.
 *   • Preview ortamı production Paddle'a bağlıysa uyarı üretilir.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { paddlePreviewEnvironmentWarning } from "./paddle.server";
import { PLANS } from "./plans";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

/** `src` altındaki test dışı kaynak dosyaları dolaşır. */
function sourceFiles(dir = join(ROOT, "src")): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

describe("ürün ve fiyat eşlemesi", () => {
  it("Starter $39, Pro $59, Business $199 — değişmedi", () => {
    expect(Object.fromEntries(PLANS.map((plan) => [plan.id, plan.usd]))).toEqual({
      Starter: 39,
      Pro: 59,
      Business: 199,
    });
  });

  it("Paddle fiyat/ürün kimlikleri ortam değişkenlerinden okunur", () => {
    const source = read("src/lib/paddle.server.ts");
    for (const key of [
      "PADDLE_STARTER_PRICE_ID",
      "PADDLE_PRO_PRICE_ID",
      "PADDLE_BUSINESS_PRICE_ID",
      "PADDLE_STARTER_PRODUCT_ID",
      "PADDLE_PRO_PRODUCT_ID",
      "PADDLE_BUSINESS_PRODUCT_ID",
    ]) {
      expect(source).toContain(key);
    }
    // Fiyatlar tek kaynaktan (`plans.ts`) türetilir; checkout'ta sabit tutar yok.
    expect(source).toContain("PLAN_PRICE_CENTS");
  });
});

describe("ücretsiz deneme ve Lead olayı", () => {
  it("Paddle transaction'ı trial period ile oluşturulmaz", () => {
    const source = read("src/lib/paddle.server.ts");
    expect(source).not.toMatch(/trialPeriod|trial_period/);
  });

  it("hiçbir yerde Lead olayı gönderilmez (deneme akışı yok)", () => {
    const offenders = sourceFiles().filter((path) =>
      /trackMetaEvent(?:Once)?\(\s*["']Lead["']/.test(readFileSync(path, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("CompleteRegistration gerçek kayıt doğrulamasında gönderilir", () => {
    const source = read("src/routes/auth.tsx");
    expect(source).toContain("trackMetaEventOnce");
    expect(source).toContain("CompleteRegistration");
    expect(source).toContain("signInWithPassword");
  });
});

describe("preview / production ayrımı", () => {
  it("preview ortamı production Paddle'a bağlıysa uyarır", () => {
    expect(paddlePreviewEnvironmentWarning("production", "preview")).toContain("PRODUCTION");
    expect(paddlePreviewEnvironmentWarning("sandbox", "preview")).toBeNull();
    expect(paddlePreviewEnvironmentWarning("production", "production")).toBeNull();
    expect(paddlePreviewEnvironmentWarning("production", undefined)).toBeNull();
  });

  it("test olay kodu production'da yok sayılır (kod düzeyinde)", () => {
    const source = read("src/lib/meta-capi.server.ts");
    expect(source).toMatch(
      /if \(testEventCode && !isProductionDeployment\(\)\) payload\.test_event_code = testEventCode;/,
    );
  });

  it("piksel yalnız açık pazarlama izniyle yüklenir", () => {
    const source = read("src/lib/meta-pixel.ts");
    expect(source).toContain("if (!hasMarketingConsent()) return false;");
    expect(source).toContain("VITE_META_PIXEL_DISABLED");
  });
});
