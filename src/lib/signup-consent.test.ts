import { describe, it, expect } from "vitest";
import {
  applyConsent,
  requiredConsentGiven,
  toggleConsent,
  type LegalConsent,
} from "./signup-consent";

const none: LegalConsent = { terms: false, kvkk: false, marketing: false };

describe("toggleConsent", () => {
  it("yalnızca hedef onayı çevirir", () => {
    const next = toggleConsent(none, "terms");
    expect(next).toEqual({ terms: true, kvkk: false, marketing: false });
  });

  it("ikinci kez çevirince başlangıç durumuna döner (mobilde tek tıklama = tek değişim)", () => {
    expect(toggleConsent(toggleConsent(none, "kvkk"), "kvkk")).toEqual(none);
  });

  it("girdi nesnesini değiştirmez", () => {
    const source = { ...none };
    toggleConsent(source, "marketing");
    expect(source).toEqual(none);
  });
});

describe("applyConsent", () => {
  it("hedef değeri uygular", () => {
    expect(applyConsent(none, "terms", true).terms).toBe(true);
    expect(applyConsent({ ...none, terms: true }, "terms", false).terms).toBe(false);
  });

  it("değer zaten aynıysa aynı referansı döndürür (gereksiz render yok)", () => {
    const value = { ...none, kvkk: true };
    expect(applyConsent(value, "kvkk", true)).toBe(value);
    expect(applyConsent(value, "kvkk", false)).not.toBe(value);
  });
});

describe("requiredConsentGiven", () => {
  it("zorunlu iki onay olmadan false döner", () => {
    expect(requiredConsentGiven(none)).toBe(false);
    expect(requiredConsentGiven({ terms: true, kvkk: false, marketing: true })).toBe(false);
  });

  it("pazarlama isteğe bağlıdır", () => {
    expect(requiredConsentGiven({ terms: true, kvkk: true, marketing: false })).toBe(true);
  });
});
