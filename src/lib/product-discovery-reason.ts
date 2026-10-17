/**
 * KAZANAN GEREKÇESİ — DİLE GÖRE METİN ŞABLONLARI.
 *
 * NEDEN VAR: nihai 5 ürünün kartında okunan gerekçe (`selection_reason`) hattın
 * `final` adımında SERVER tarafında üretilir ve önceden yalnız Türkçe
 * şablonlardan geliyordu. Kullanıcı arayüzü İspanyolca ya da Arapça olsa bile
 * kart Türkçe gerekçe gösteriyordu; DOM çeviri katmanı (`auto-i18n`) ise
 * içinde ölçülmüş SAYI taşıyan dinamik cümleleri eşleştiremez (sözlük anahtarı
 * sabit metindir).
 *
 * Bu yüzden gerekçe şablonları da kullanıcının seçtiği dilde kurulur. Model
 * burada KULLANILMAZ: metin ölçülmüş sinyallerden deterministik olarak
 * türetilir, yani her dilde aynı sayıyla aynı anlamı söyler ve ek AI maliyeti
 * doğurmaz.
 *
 * SAF MODÜL: ağ/dosya/React yok — testler doğrudan çağırır.
 */

import { normalizeAiLanguage, type AiLanguage } from "./ai-language";

export type ReasonCopy = {
  /** Trend sinyali ölçülmediyse. */
  trendUnknown: string;
  /** @param confidence 0-100 güven skoru (ölçüldüyse). */
  trend: (demand: number, confidence?: number) => string;
  /** Marj/fiyat sinyali ölçülmediyse. */
  priceUnknown: string;
  /** @param priceUsd ölçülmüş fiyat; yoksa `null`. */
  margin: (margin: number, priceUsd: number | null) => string;
  competitionUnknown: string;
  competitionLow: (score: number) => string;
  competitionHigh: (score: number) => string;
  completeness: (slots: number) => string;
  sourcesConfirmed: (count: number) => string;
  /** Ürün başlığı boşsa gösterilen yer tutucu. */
  untitled: string;
};

const en: ReasonCopy = {
  trendUnknown: "No trend evidence (not measured)",
  trend: (demand, confidence) =>
    `Demand strength ${demand}/100${confidence !== undefined ? ` · confidence ${confidence}` : ""}`,
  priceUnknown: "Price band not measured",
  margin: (margin, priceUsd) =>
    `Margin score ${margin}/100${priceUsd === null ? "" : ` · price $${priceUsd}`}`,
  competitionUnknown: "Competition not measured",
  competitionLow: (score) => `Low competition (${score}/100) — niche not saturated`,
  competitionHigh: (score) => `High competition (${score}/100) — niche saturated`,
  completeness: (slots) => `Evidence ${slots}/5 slots filled`,
  sourcesConfirmed: (count) => `Confirmed by ${count} sources`,
  untitled: "Untitled product",
};

const tr: ReasonCopy = {
  trendUnknown: "Trend kanıtı yok (ölçülmedi)",
  trend: (demand, confidence) =>
    `Trend gücü ${demand}/100${confidence !== undefined ? ` · güven ${confidence}` : ""}`,
  priceUnknown: "Fiyat bandı ölçülmedi",
  margin: (margin, priceUsd) =>
    `Marj skoru ${margin}/100${priceUsd === null ? "" : ` · fiyat $${priceUsd}`}`,
  competitionUnknown: "Rekabet ölçülmedi",
  competitionLow: (score) => `Rekabet düşük (${score}/100) — doygunluk yok`,
  competitionHigh: (score) => `Rekabet yüksek (${score}/100) — niş doymuş`,
  completeness: (slots) => `Kanıt ${slots}/5 dolu`,
  sourcesConfirmed: (count) => `${count} kaynak doğruladı`,
  untitled: "İsimsiz ürün",
};

const es: ReasonCopy = {
  trendUnknown: "Sin evidencia de tendencia (no medida)",
  trend: (demand, confidence) =>
    `Fuerza de demanda ${demand}/100${confidence !== undefined ? ` · confianza ${confidence}` : ""}`,
  priceUnknown: "Banda de precio no medida",
  margin: (margin, priceUsd) =>
    `Puntuación de margen ${margin}/100${priceUsd === null ? "" : ` · precio $${priceUsd}`}`,
  competitionUnknown: "Competencia no medida",
  competitionLow: (score) => `Competencia baja (${score}/100) — nicho sin saturar`,
  competitionHigh: (score) => `Competencia alta (${score}/100) — nicho saturado`,
  completeness: (slots) => `Evidencia ${slots}/5 campos completos`,
  sourcesConfirmed: (count) => `Confirmado por ${count} fuentes`,
  untitled: "Producto sin título",
};

const de: ReasonCopy = {
  trendUnknown: "Kein Trendbeleg (nicht gemessen)",
  trend: (demand, confidence) =>
    `Nachfragestärke ${demand}/100${confidence !== undefined ? ` · Konfidenz ${confidence}` : ""}`,
  priceUnknown: "Preisband nicht gemessen",
  margin: (margin, priceUsd) =>
    `Margen-Score ${margin}/100${priceUsd === null ? "" : ` · Preis $${priceUsd}`}`,
  competitionUnknown: "Wettbewerb nicht gemessen",
  competitionLow: (score) => `Geringer Wettbewerb (${score}/100) — Nische nicht gesättigt`,
  competitionHigh: (score) => `Hoher Wettbewerb (${score}/100) — Nische gesättigt`,
  completeness: (slots) => `Belege ${slots}/5 Felder gefüllt`,
  sourcesConfirmed: (count) => `Von ${count} Quellen bestätigt`,
  untitled: "Unbenanntes Produkt",
};

const fr: ReasonCopy = {
  trendUnknown: "Aucune preuve de tendance (non mesurée)",
  trend: (demand, confidence) =>
    `Force de la demande ${demand}/100${confidence !== undefined ? ` · confiance ${confidence}` : ""}`,
  priceUnknown: "Bande de prix non mesurée",
  margin: (margin, priceUsd) =>
    `Score de marge ${margin}/100${priceUsd === null ? "" : ` · prix $${priceUsd}`}`,
  competitionUnknown: "Concurrence non mesurée",
  competitionLow: (score) => `Concurrence faible (${score}/100) — niche non saturée`,
  competitionHigh: (score) => `Concurrence élevée (${score}/100) — niche saturée`,
  completeness: (slots) => `Preuves ${slots}/5 champs remplis`,
  sourcesConfirmed: (count) => `Confirmé par ${count} sources`,
  untitled: "Produit sans titre",
};

const ar: ReasonCopy = {
  trendUnknown: "لا دليل على الاتجاه (لم يُقس)",
  trend: (demand, confidence) =>
    `قوة الطلب ${demand}/100${confidence !== undefined ? ` · الثقة ${confidence}` : ""}`,
  priceUnknown: "نطاق السعر لم يُقس",
  margin: (margin, priceUsd) =>
    `تقييم الهامش ${margin}/100${priceUsd === null ? "" : ` · السعر $${priceUsd}`}`,
  competitionUnknown: "المنافسة لم تُقس",
  competitionLow: (score) => `منافسة منخفضة (${score}/100) — السوق غير مشبع`,
  competitionHigh: (score) => `منافسة عالية (${score}/100) — السوق مشبع`,
  completeness: (slots) => `الأدلة ${slots}/5 حقول مكتملة`,
  sourcesConfirmed: (count) => `أكّدته ${count} مصادر`,
  untitled: "منتج بلا اسم",
};

const BY_LANG: Record<AiLanguage, ReasonCopy> = { tr, en, es, de, fr, ar };

/** Seçilen dilin gerekçe şablonları; tanınmayan dil İngilizce'ye düşer. */
export function reasonCopy(lang?: string): ReasonCopy {
  return BY_LANG[normalizeAiLanguage(lang)];
}
