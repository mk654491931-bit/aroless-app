/**
 * i18next KURULUM ZAMANI regresyon testi.
 *
 * Ölçülen kusur (düzeltmeden önce): örnek yalnızca `__root` effect'inde
 * kuruluyordu. React ilk kareyi effect'lerden önce çizdiği için ilk boyamada
 * hiçbir örnek yoktu; `react-i18next` şu uyarıyı basıp ANAHTARI döndürüyordu:
 *   react-i18next:: useTranslation: You will need to pass in an i18next
 *   instance … { code: 'NO_I18NEXT_INSTANCE' }
 * Yani kullanıcı bir an "hero_1" gibi ham anahtarlar görüyor, sunucuda da
 * (SSR) metin hiç çevrilmiyordu.
 *
 * Kural: örnek MODÜL yüklenirken kurulmuş olmalı ve sunucuda/istemcinin ilk
 * karesinde deterministik olarak "en" üretmeli.
 */
import { describe, expect, it } from "vitest";
import i18n, {
  LANGUAGES,
  LANGUAGE_STORAGE_KEY,
  RESOURCES,
  activeLang,
  initI18n,
  isSupportedLang,
  normalizeLang,
} from "./i18n";

describe("i18next örneği modül yüklenirken kurulur", () => {
  it("import edildiği anda hazırdır (effect beklemez)", () => {
    expect(i18n.isInitialized).toBe(true);
  });

  it("ilk karede ham anahtar DEĞİL, çeviri döner", () => {
    // Düzeltmeden önce bu değer "hero_1" idi.
    expect(i18n.t("hero_1")).toBe(RESOURCES.en.common.hero_1);
    expect(i18n.t("hero_1")).not.toBe("hero_1");
  });

  it("sunucu/ilk istemci karesi sabit 'en' (hydration deterministik)", () => {
    expect(normalizeLang(i18n.language)).toBe("en");
    expect(activeLang()).toBe("en");
  });

  it("tüm diller ve tek anahtar uzayı kayıtlıdır", () => {
    expect(Object.keys(RESOURCES).sort()).toEqual(LANGUAGES.map((l) => l.code).sort());
    expect(i18n.options.defaultNS).toBe("common");
    expect(i18n.options.fallbackLng).toEqual(["en"]);
  });

  it("sunucuda initI18n() hiçbir şeyi bozmaz ve 'en' döner", () => {
    // Test ortamı node: `window` yok.
    expect(typeof window).toBe("undefined");
    expect(initI18n()).toBe("en");
    expect(normalizeLang(i18n.language)).toBe("en");
  });
});

describe("dil tercihi anahtarı tek kaynak", () => {
  it("kalıcı anahtar i18next'in okuduğu adla aynıdır", () => {
    expect(LANGUAGE_STORAGE_KEY).toBe("i18nextLng");
  });

  it("desteklenmeyen değerler 'en'e indirgenir, geçerli olanlar korunur", () => {
    expect(isSupportedLang("tr-TR")).toBe(true);
    expect(normalizeLang("tr-TR")).toBe("tr");
    expect(isSupportedLang("xx")).toBe(false);
    expect(normalizeLang("xx")).toBe("en");
  });

  it("her dilin bir kaynağı vardır (anahtar boşluğu sessizce yaşanmaz)", () => {
    for (const { code } of LANGUAGES) {
      const dict = RESOURCES[code].common as Record<string, unknown>;
      expect(dict["app_name"], `${code} app_name eksik`).toBeTruthy();
      expect(dict["hero_1"], `${code} hero_1 eksik`).toBeTruthy();
    }
  });
});
