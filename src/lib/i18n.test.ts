// Unit tests for the language helpers that keep every switcher in sync.
import { describe, expect, it } from "vitest";
import { LANGUAGES, findLanguage, isSupportedLang, normalizeLang } from "./i18n";

describe("normalizeLang", () => {
  it("keeps a supported two-letter code", () => {
    expect(normalizeLang("tr")).toBe("tr");
    expect(normalizeLang("ar")).toBe("ar");
  });

  it("reduces browser locales to their base language", () => {
    expect(normalizeLang("en-US")).toBe("en");
    expect(normalizeLang("tr_TR")).toBe("tr");
    expect(normalizeLang("de-AT")).toBe("de");
  });

  it("is case and whitespace insensitive", () => {
    expect(normalizeLang("  DE ")).toBe("de");
    expect(normalizeLang("FR")).toBe("fr");
  });

  it("falls back to English for unknown, unsupported or non-string values", () => {
    expect(normalizeLang("pt-BR")).toBe("en");
    expect(normalizeLang("zz")).toBe("en");
    expect(normalizeLang(undefined)).toBe("en");
    expect(normalizeLang(null)).toBe("en");
    expect(normalizeLang(42)).toBe("en");
  });
});

describe("isSupportedLang", () => {
  it("accepts locale variants of supported languages", () => {
    expect(isSupportedLang("en-US")).toBe(true);
    expect(isSupportedLang("tr_TR")).toBe(true);
    expect(isSupportedLang("ar")).toBe(true);
  });

  it("rejects unsupported or non-string values", () => {
    expect(isSupportedLang("pt-BR")).toBe(false);
    expect(isSupportedLang("")).toBe(false);
    expect(isSupportedLang(undefined)).toBe(false);
    expect(isSupportedLang(7)).toBe(false);
  });
});

describe("findLanguage", () => {
  it("resolves a locale code to the right entry", () => {
    expect(findLanguage("tr-TR").code).toBe("tr");
    expect(findLanguage("tr-TR").label).toBe("Türkçe");
    expect(findLanguage("en-US").flag).toBe("🇺🇸");
  });

  it("falls back to English instead of an empty switcher", () => {
    expect(findLanguage(undefined).code).toBe("en");
    expect(findLanguage("nope").code).toBe("en");
  });

  it("lists every supported language exactly once", () => {
    const codes = LANGUAGES.map((l) => l.code);
    expect(codes).toEqual(["en", "tr", "es", "de", "fr", "ar"]);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
