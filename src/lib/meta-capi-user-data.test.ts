/**
 * META CAPI ATTRIBUTION — istekten doğrulanmış veri çıkarma.
 *
 * Kilitlenen sözleşme:
 *   • `_fbp`/`_fbc` yalnız Meta biçimindeyse alınır; serbest metin atlanır.
 *   • IP yalnız geçerli IPv4/IPv6 ise alınır (başlık uydurması kabul edilmez).
 *   • User-agent tek satıra indirilir ve 500 karakterle sınırlanır.
 *   • Pazarlama izni olmadan bu modül ÇAĞRILMAZ; `load` ayrıca kapıyı zorunlu
 *     tutar (izin yoksa hiçbir okuma yapılmaz).
 */
import { describe, expect, it, vi } from "vitest";

import { loadMetaPurchaseAttribution, metaAttributionFromRequest } from "./meta-attribution.server";

describe("metaAttributionFromRequest", () => {
  it("geçerli fbp/fbc, IP ve user-agent'ı çıkarır", () => {
    const request = new Request("https://aroless.tech/api/checkout", {
      headers: {
        cookie: "_fbp=fb.1.1700000000000.123456; _fbc=fb.1.1700000000000.IwAR_abc-123",
        "user-agent": "Mozilla/5.0 (Macintosh)",
        "x-forwarded-for": "198.51.100.4",
      },
    });

    expect(metaAttributionFromRequest(request)).toEqual({
      fbp: "fb.1.1700000000000.123456",
      fbc: "fb.1.1700000000000.IwAR_abc-123",
      clientIp: "198.51.100.4",
      userAgent: "Mozilla/5.0 (Macintosh)",
    });
  });

  it("bozuk çerez ve IP değerlerini sessizce atlar", () => {
    const request = new Request("https://aroless.tech/api/checkout", {
      headers: {
        cookie: "_fbp=<script>alert(1)</script>; _fbc=kisa",
        "x-forwarded-for": "not-an-ip",
      },
    });

    expect(metaAttributionFromRequest(request)).toEqual({
      fbp: null,
      fbc: null,
      clientIp: null,
      userAgent: null,
    });
  });

  it("çerez yoksa null döner (istek düşmez)", () => {
    const request = new Request("https://aroless.tech/api/checkout");
    expect(metaAttributionFromRequest(request)).toEqual({
      fbp: null,
      fbc: null,
      clientIp: null,
      userAgent: null,
    });
  });
});

describe("loadMetaPurchaseAttribution izin kapısı", () => {
  it("izin yoksa veritabanına HİÇ gitmez", async () => {
    const result = await loadMetaPurchaseAttribution("txn_1", { consentGranted: false });
    expect(result).toBeNull();
  });

  it("işlem kimliği boşsa null döner", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const result = await loadMetaPurchaseAttribution("  ", { consentGranted: true });
    expect(result).toBeNull();
    vi.unstubAllEnvs();
  });
});
