// Unit tests for the site-wide language preference rules.
import { describe, expect, it } from "vitest";
import { shouldAdoptProfileLanguage, storedLanguagePreference } from "./language-preference";

describe("shouldAdoptProfileLanguage", () => {
  it("adopts the saved account language on a fresh device", () => {
    expect(
      shouldAdoptProfileLanguage({
        profileLanguage: "tr",
        storedLanguage: null,
        activeLanguage: "en",
      }),
    ).toBe("tr");
  });

  it("lets an explicit device choice win over the account language", () => {
    expect(
      shouldAdoptProfileLanguage({
        profileLanguage: "tr",
        storedLanguage: "de",
        activeLanguage: "en",
      }),
    ).toBe(null);
  });

  it("does nothing when the account language is already active", () => {
    expect(
      shouldAdoptProfileLanguage({
        profileLanguage: "tr",
        storedLanguage: null,
        activeLanguage: "tr",
      }),
    ).toBe(null);
  });

  it("treats locale variants as the same language", () => {
    expect(
      shouldAdoptProfileLanguage({
        profileLanguage: "tr",
        storedLanguage: null,
        activeLanguage: "tr-TR",
      }),
    ).toBe(null);
    expect(
      shouldAdoptProfileLanguage({
        profileLanguage: "de-AT",
        storedLanguage: null,
        activeLanguage: "en-US",
      }),
    ).toBe("de");
  });

  it("ignores unsupported or missing account languages", () => {
    for (const profileLanguage of [undefined, null, "", "pt-BR", 7]) {
      expect(
        shouldAdoptProfileLanguage({ profileLanguage, storedLanguage: null, activeLanguage: "en" }),
      ).toBe(null);
    }
  });

  it("ignores an unusable stored preference", () => {
    // Boş/eski bir cache değeri cihaz seçimi sayılmaz.
    expect(
      shouldAdoptProfileLanguage({
        profileLanguage: "fr",
        storedLanguage: "zz",
        activeLanguage: "en",
      }),
    ).toBe("fr");
  });
});

describe("storedLanguagePreference", () => {
  it("returns null instead of throwing without localStorage", () => {
    expect(storedLanguagePreference()).toBe(null);
  });
});
