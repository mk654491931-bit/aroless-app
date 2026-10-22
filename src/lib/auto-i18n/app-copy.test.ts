/**
 * UYGULAMA EKRANLARI ÇEVİRİ KATMANI — REGRESYON TESTİ.
 *
 * NEDEN VAR: `dict-*` sözlükleri otomatik üretildiği için sonradan eklenen
 * ekranlar (ürün kartı, fiyatlandırma, ayarlar, üst bar, panel, arama hataları)
 * orada yoktu ve dil değiştirildiğinde Türkçe kalıyordu. `APP_COPY` +
 * `APP_COPY_EXTRA` bu boşluğu kapatır.
 *
 * SÖZLEŞME:
 *   1. Anahtar, kaynak dosyadaki metnin birebir kendisidir (boşluklar tek
 *      boşluğa inmiş, HTML varlıkları çözülmüş hâli). Bir harf farkı çeviriyi
 *      sessizce devre dışı bırakır — test onu yakalar.
 *   2. Beş hedef dilin (en/es/de/fr/ar) hepsinde karşılık vardır.
 *   3. `extrasFor` her dili bu kayıtlarla çözebilir.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { APP_COPY, type AppCopyLang } from "./app-copy";
import { APP_COPY_EXTRA } from "./app-copy-extra";
import { extrasFor } from "./extras";

const LANGS: AppCopyLang[] = ["en", "es", "de", "fr", "ar"];
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Tüm kaynak dosyalar (testler ve çeviri katmanının kendisi hariç).
 *
 * `.ts` dosyaları da taranıyor: birçok kullanıcı metni bileşende değil, veri
 * modülünde (araç kataloğu, e-posta şablonları, feed başlıkları) duruyor ve
 * yine de ekrana basılıyor. `auto-i18n` bilinçli olarak dışlanır — sözlügün
 * kendisini taramak "anahtar kaynakta var" kontrolünü anlamsız kılardı.
 */
function uiSources(dir = ROOT): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "auto-i18n", "__tests__"].includes(entry.name)) continue;
      if (entry.name.startsWith(".")) continue;
      out.push(...uiSources(full));
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) {
      out.push(full);
    }
  }
  return out;
}

/** Kaynak dosyayı çeviri katmanıyla aynı biçime getirir. */
const normalized = (path: string) =>
  readFileSync(path, "utf8")
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/"\s*\+\s*"/g, "")
    .replace(/\s+/g, " ");

const SOURCES = uiSources().map(normalized);
const entries = [...Object.entries(APP_COPY), ...Object.entries(APP_COPY_EXTRA)];

describe("APP_COPY + APP_COPY_EXTRA", () => {
  it("kayıt boş değil", () => {
    expect(entries.length).toBeGreaterThan(150);
  });

  it("her anahtarın beş dilde karşılığı var", () => {
    const missing: string[] = [];
    for (const [source, copy] of entries) {
      for (const lang of LANGS) {
        if (!copy[lang]?.trim()) missing.push(`${lang}: ${source}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("her anahtar kaynak dosyalarda birebir geçiyor", () => {
    const drift = entries
      .map(([source]) => source)
      .filter((key) => !SOURCES.some((text) => text.includes(key)));
    expect(drift).toEqual([]);
  });

  it("runtime her dilde çözebiliyor (extrasFor)", () => {
    const unresolved: string[] = [];
    for (const lang of LANGS) {
      const dict = extrasFor(lang);
      for (const [source] of entries) {
        if (!dict[source]) unresolved.push(`${lang}: ${source}`);
      }
    }
    expect(unresolved).toEqual([]);
  });

  it("İngilizce karşılıklar kaynaktan farklı (kopyala-yapıştır değil)", () => {
    const identical = entries
      .filter(([source, copy]) => copy.en === source && /[çğıöşüÇĞİÖŞÜ]/.test(source))
      .map(([source]) => source);
    expect(identical).toEqual([]);
  });
});
