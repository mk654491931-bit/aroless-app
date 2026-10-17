// Unit tests for the language helpers that keep every switcher in sync.
import { describe, expect, it } from "vitest";
import { LANGUAGES, RESOURCES, findLanguage, isSupportedLang, normalizeLang } from "./i18n";

/** Bir bölümün tüm anahtar yollarını düzleştirir ("affiliate.badge" gibi). */
function keyPaths(node: unknown, prefix = ""): string[] {
  if (!node || typeof node !== "object") return prefix ? [prefix] : [];
  return Object.entries(node as Record<string, unknown>)
    .flatMap(([key, value]) => keyPaths(value, prefix ? `${prefix}.${key}` : key))
    .sort();
}

/** Metindeki {{placeholder}} adlarını (sırasız) döndürür. */
function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
}

function at(node: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, part) => {
    return acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined;
  }, node);
}

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

describe("çeviri kaynakları — yeni eklenen ekranlar her dilde TAM", () => {
  const langs = Object.keys(RESOURCES) as Array<keyof typeof RESOURCES>;
  // Bu iki bölüm ürünün yeni ekranlarını besler (affiliate ödeme akışı +
  // bulucu sonuç metinleri). Biri çevrilmeden eklenirse ekran sabit Türkçe
  // kalır — bu test o sessiz gerilemeyi yakalar.
  const SECTIONS: Array<{ key: "affiliate" | "finder"; min: number }> = [
    { key: "affiliate", min: 40 },
    { key: "finder", min: 10 },
  ];

  it("her dil aynı anahtar kümesini taşır (eksik anahtar yok)", () => {
    for (const section of SECTIONS) {
      const reference = keyPaths(at(RESOURCES.en, `common.${section.key}`));
      expect(reference.length, `${section.key} boş olamaz`).toBeGreaterThan(section.min);
      for (const lng of langs) {
        expect(
          keyPaths(at(RESOURCES[lng], `common.${section.key}`)),
          `${lng}.${section.key}`,
        ).toEqual(reference);
      }
    }
  });

  it("hiçbir dizede değer boş değil", () => {
    for (const lng of langs) {
      for (const section of SECTIONS) {
        for (const key of keyPaths(at(RESOURCES[lng], `common.${section}`))) {
          const value = at(RESOURCES[lng], `common.${section}.${key}`);
          expect(typeof value, `${lng}.${section}.${key}`).toBe("string");
          expect(String(value).trim().length, `${lng}.${section}.${key}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("interpolasyon yer tutucuları dilde kaybolmaz ({{amount}} gibi)", () => {
    for (const section of SECTIONS) {
      for (const key of keyPaths(at(RESOURCES.en, `common.${section}`))) {
        const expected = placeholders(String(at(RESOURCES.en, `common.${section}.${key}`)));
        if (expected.length === 0) continue;
        for (const lng of langs) {
          expect(
            placeholders(String(at(RESOURCES[lng], `common.${section}.${key}`))),
            `${lng}.${section}.${key}`,
          ).toEqual(expected);
        }
      }
    }
  });
});
