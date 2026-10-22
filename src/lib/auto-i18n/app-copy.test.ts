/**
 * UYGULAMA EKRANLARI ÇEVİRİ KATMANI — REGRESYON TESTİ.
 *
 * NEDEN VAR: `dict-*` sözlükleri otomatik üretildiği için sonradan eklenen
 * ekranlar (ürün kartı, fiyatlandırma, ayarlar, üst bar, panel) orada yoktu ve
 * dil değiştirildiğinde Türkçe kalıyordu. `APP_COPY` bu boşluğu kapatır.
 *
 * SÖZLEŞME:
 *   1. Anahtar, kaynak dosyadaki metnin birebir kendisidir (boşluklar tek
 *      boşluğa inmiş, HTML varlıkları çözülmüş hâli). Bir harf farkı çeviriyi
 *      sessizce devre dışı bırakır — test onu yakalar.
 *   2. Beş hedef dilin (en/es/de/fr/ar) hepsinde karşılık vardır.
 *   3. `extrasFor` her dili bu kayıtlarla çözebilir.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { APP_COPY, type AppCopyLang } from "./app-copy";
import { extrasFor } from "./extras";

const LANGS: AppCopyLang[] = ["en", "es", "de", "fr", "ar"];

/** Kaynak dosyayı çeviri katmanıyla aynı biçime getirir. */
const normalized = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/"\s*\+\s*"/g, "")
    .replace(/\s+/g, " ");

const SOURCES = [
  normalized("../../components/app-topbar.tsx"),
  normalized("../../routes/dashboard.tsx"),
  normalized("../../features/finder/components/product-card.tsx"),
  normalized("../../features/finder/components/discovery-winner-card.tsx"),
  normalized("../../components/search-states.tsx"),
  normalized("../../routes/pricing.tsx"),
  normalized("../../components/pricing-card.tsx"),
  normalized("../../routes/settings.tsx"),
  normalized("../../features/finder/components/discovery-progress.tsx"),
  normalized("../../components/analysis-pipeline-modal.tsx"),
];

const entries = Object.entries(APP_COPY);

describe("APP_COPY", () => {
  it("kayıt boş değil", () => {
    expect(entries.length).toBeGreaterThan(80);
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
