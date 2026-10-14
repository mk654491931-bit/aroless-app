/**
 * PUBLIC SAYFA ÇEVİRİ KATMANI REGRESYON TESTİ.
 *
 * NEDEN VAR: landing ve /affiliate metinlerinin altı dilde karşılığı yoktu —
 * dil değiştirildiğinde bu sayfalar Türkçe kalıyordu. Katmanı eklemek tek
 * başına yetmez: anahtar, kaynak dosyadaki metnin BİREBİR kendisi olmalıdır
 * (tek boşluğa indirgenmiş hâli). Bir harf, bir kesme işareti ya da bir tire
 * farkı çeviriyi sessizce devre dışı bırakır — bu test onu yakalar.
 *
 * İKİ SÖZLEŞME:
 *   1. Her anahtarın beş hedef dilde (en/es/de/fr/ar) boş olmayan karşılığı var.
 *   2. Her anahtar, kaynak bileşen dosyalarında birebir geçiyor.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extrasFor } from "./extras";
import { PUBLIC_COPY, type PublicCopyLang } from "./public-copy";

const LANGS: PublicCopyLang[] = ["en", "es", "de", "fr", "ar"];

/**
 * Kaynak metni karşılaştırılabilir hâle getirir.
 *
 * - Boşluklar tek boşluğa iner (JSX metni satırlara bölünebilir).
 * - Parça parça yazılmış dizgiler birleştirilir: `"a " + "b"`, DOM'da tek bir
 *   metin düğümü olur ama dosyada ardışık görünmez. Bu adım olmadan test,
 *   doğru bir anahtarı yanlışlıkla "kayma" sayardı.
 */
const readNormalized = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
    .replace(/"\s*\+\s*"/g, "")
    .replace(/\s+/g, " ");

const SOURCES = [
  readNormalized("../../components/marketing-landing.tsx"),
  readNormalized("../../components/affiliate-program-page.tsx"),
  readNormalized("../../components/landing/sections.tsx"),
  // Public araç merkezi (/tools) — sayfa metinleri + araç kataloğu.
  readNormalized("../../components/tools-showcase-page.tsx"),
  readNormalized("../../lib/tools-catalog.ts"),
];

const keys = Object.keys(PUBLIC_COPY);

describe("PUBLIC_COPY", () => {
  it("kayıt boş değil", () => {
    expect(keys.length).toBeGreaterThan(80);
  });

  it("her anahtarın beş dilde karşılığı var", () => {
    const missing: string[] = [];
    for (const [source, copy] of Object.entries(PUBLIC_COPY)) {
      for (const lang of LANGS) {
        if (!copy[lang]?.trim()) missing.push(`${lang}: ${source}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("her anahtar kaynak dosyalarda birebir geçiyor", () => {
    const drift = keys.filter((key) => !SOURCES.some((text) => text.includes(key)));
    expect(drift).toEqual([]);
  });

  it("runtime her dilde çözebiliyor (extrasFor)", () => {
    const unresolved: string[] = [];
    for (const lang of LANGS) {
      const dict = extrasFor(lang);
      for (const key of keys) {
        if (!dict[key]) unresolved.push(`${lang}: ${key}`);
      }
    }
    expect(unresolved).toEqual([]);
  });

  it("kritik public metinler her dilde çevrilir", () => {
    const critical = [
      "Piyasa sinyallerini kârlı ürün kararlarına çevir.",
      "Ücretsiz başla",
      "Aroless'u paylaş, aylık komisyon kazan.",
      "%30 oran",
      "30 gün bekleme",
      "$75 eşiği",
      "Affiliate programını gör",
      "Başvuru için giriş yap",
      "Gerçek fiyatlar için /pricing →",
      "Tüm AI araçlarını tek panelde çalıştır.",
      "Modülü aç",
    ];
    for (const lang of LANGS) {
      const dict = extrasFor(lang);
      for (const source of critical) {
        const value = dict[source];
        expect(value, `${lang} · ${source}`).toBeTruthy();
        expect(value.length, `${lang} · ${source}`).toBeGreaterThan(1);
      }
    }
  });

  it("Türkçe hariç her dilde çeviri kaynaktan farklı (kopyala-yapıştır değil)", () => {
    const identical = keys.filter(
      (key) => PUBLIC_COPY[key].en === key && /[çğıöşüÇĞİÖŞÜ]/.test(key),
    );
    expect(identical).toEqual([]);
  });
});
