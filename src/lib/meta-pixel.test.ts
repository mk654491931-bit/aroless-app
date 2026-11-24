/**
 * META PIXEL — izin kapısı ve `fbq` çağrı biçimi.
 *
 * Bu testlerin kilitlediği sözleşme:
 *   • Pazarlama izni YOKKEN piksel script'i hiç oluşturulmaz.
 *   • İzin VARKEN resmi snippet'in kuyruğu kurulur, `init` bir kez çağrılır.
 *   • `Purchase` gibi olaylar `eventID` seçeneğiyle gönderilir (CAPI tekilleştirmesi).
 *   • Paddle işlem kimliğinden üretilen kimlik iki tarafta AYNI biçimdedir.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

function stubLocalStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const localStorage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
  vi.stubGlobal("window", { localStorage });
  return map;
}

function consentStored(marketing: boolean) {
  return {
    aroless_cookie_consent: JSON.stringify({
      essential: true,
      analytics: true,
      marketing,
      decidedAt: "2026-01-01T00:00:00.000Z",
    }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("çerez izni", () => {
  it("karar yoksa pazarlama izni yoktur", async () => {
    stubLocalStorage();
    const { hasMarketingConsent } = await import("./cookie-consent");
    expect(hasMarketingConsent()).toBe(false);
  });

  it("marketing=true ise izin vardır", async () => {
    stubLocalStorage(consentStored(true));
    const { hasMarketingConsent } = await import("./cookie-consent");
    expect(hasMarketingConsent()).toBe(true);
  });

  it("marketing=false ise izin yoktur", async () => {
    stubLocalStorage(consentStored(false));
    const { hasMarketingConsent } = await import("./cookie-consent");
    expect(hasMarketingConsent()).toBe(false);
  });

  it("bozuk JSON çökmez ve izin vermez", async () => {
    stubLocalStorage({ aroless_cookie_consent: "{bozuk" });
    const { hasMarketingConsent } = await import("./cookie-consent");
    expect(hasMarketingConsent()).toBe(false);
  });

  it("tercih kaydı kalıcıdır ve okunabilir", async () => {
    const map = stubLocalStorage();
    const { readCookieConsent, saveCookieConsent } = await import("./cookie-consent");
    saveCookieConsent({ analytics: true, marketing: true });
    expect(map.has("aroless_cookie_consent")).toBe(true);
    expect(readCookieConsent()).toMatchObject({ analytics: true, marketing: true });
  });
});

describe("fbq olay gönderimi", () => {
  it("izin yokken piksel kurulmaz (fbq yok, script yok)", async () => {
    stubLocalStorage(consentStored(false));
    const appended: unknown[] = [];
    vi.stubGlobal("document", {
      getElementById: () => null,
      createElement: () => ({}),
      head: { appendChild: (el: unknown) => appended.push(el) },
    });

    const { trackMetaEvent } = await import("./meta-pixel");
    trackMetaEvent("PageView");

    const w = window as unknown as { fbq?: unknown };
    expect(w.fbq).toBeUndefined();
    expect(appended).toHaveLength(0);
  });

  it("VITE_META_PIXEL_DISABLED=1 ise izin olsa da yüklenmez", async () => {
    stubLocalStorage(consentStored(true));
    vi.stubEnv("VITE_META_PIXEL_DISABLED", "1");
    const appended: unknown[] = [];
    vi.stubGlobal("document", {
      getElementById: () => null,
      createElement: () => ({}),
      head: { appendChild: (el: unknown) => appended.push(el) },
    });

    const { trackMetaEvent } = await import("./meta-pixel");
    trackMetaEvent("PageView");

    expect((window as unknown as { fbq?: unknown }).fbq).toBeUndefined();
    expect(appended).toHaveLength(0);
  });

  it("izin varken init + Purchase eventID ile kuyruğa girer", async () => {
    stubLocalStorage(consentStored(true));
    const appended: { id?: string; src?: string; async?: boolean }[] = [];
    vi.stubGlobal("document", {
      getElementById: () => null,
      createElement: () => ({}),
      head: {
        appendChild: (el: { id?: string; src?: string; async?: boolean }) => appended.push(el),
      },
    });

    const { trackMetaEvent } = await import("./meta-pixel");
    trackMetaEvent("Purchase", { value: 59, currency: "USD" }, "purchase-txn_123");

    const fbq = (window as unknown as { fbq?: { queue: unknown[][] } }).fbq;
    expect(fbq?.queue).toContainEqual(["init", "1144034978511312"]);
    expect(fbq?.queue).toContainEqual([
      "track",
      "Purchase",
      { value: 59, currency: "USD" },
      { eventID: "purchase-txn_123" },
    ]);
    expect(appended).toHaveLength(1);
    expect(appended[0]?.src).toContain("connect.facebook.net");
    expect(appended[0]?.async).toBe(true);
  });
});

describe("Purchase tekilleştirme kimliği", () => {
  it("Paddle işlem kimliğinden sabit biçimde türetilir", async () => {
    const { purchaseEventId } = await import("./meta-config");
    expect(purchaseEventId("txn_01abc")).toBe("purchase-txn_01abc");
    expect(purchaseEventId("  txn_trim  ")).toBe("purchase-txn_trim");
    expect(purchaseEventId("")).toBeNull();
    expect(purchaseEventId(null)).toBeNull();
  });
});
