// ============================================================================
// Hybrid scoring engine (server only) — DETERMINISTIC, AI-FREE.
//
// Eskiden burada 4 ayrı AI çağrısı (Groq talep analisti, Gemini lojistik
// analisti, Gemini ülke eşleştirme, Gemini arayüz metni) sırayla çalışıyordu.
// "AI Analysis Pipeline" adımı tek başına 40-120 saniye sürüyor, Vercel Hobby
// planındaki 60 sn fonksiyon limitini aşıyor ve kullanıcıya 504 döndürüyordu.
//
// Bu yüzden hibrit skor artık tamamen deterministik olarak, ürün bağlamındaki
// gerçek sayılardan (marj, trend skoru, rekabet, fiyat, viral kanıt) ve hedef
// ülkenin lojistik profilinden hesaplanır: 0 ağ çağrısı, ~0 ms.
// AI yorumu artık yalnızca 14 ajanlı AI Konsey katmanında yapılır.
// ============================================================================
import { countryName, TARGET_COUNTRIES } from "./countries";
import {
  HYBRID_WEIGHT_AI1,
  HYBRID_WEIGHT_AI2,
  type HybridScore,
  type LocalCompetition,
} from "./consensus-types";

export function countryLabel(code: string): string {
  return countryName(code);
}

function clamp100(n: number, fb = 50): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : fb;
}

/** Ürün bağlamından ilk eşleşen sayıyı çeker. */
function pick(ctx: string, re: RegExp): number | undefined {
  const m = ctx.match(re);
  if (!m) return undefined;
  const n = Number(String(m[1]).replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

type Facts = {
  margin: number;
  trend: number;
  competition: LocalCompetition;
  supplier: number;
  retail: number;
  viral: boolean;
  channels: number;
};

/** `productDebateContext()` metninden gerçek sayıları okur (AI yok). */
function readFacts(ctx: string): Facts {
  const text = ctx ?? "";
  const margin = pick(text, /Margin:\s*(-?[\d.,]+)\s*%/i) ?? 0;
  const trend = pick(text, /Trend score:\s*([\d.,]+)/i) ?? 0;
  const supplier = pick(text, /Supplier cost:\s*\$?\s*([\d.,]+)/i) ?? 0;
  const retail = pick(text, /Selling price:\s*\$?\s*([\d.,]+)/i) ?? 0;
  const compRaw = text.match(/Competition:\s*(Low|Medium|High|Düşük|Orta|Yüksek)/i);
  const comp = String(compRaw?.[1] ?? "").toLowerCase();
  const competition: LocalCompetition =
    comp.startsWith("low") || comp.startsWith("dü")
      ? "Düşük"
      : comp.startsWith("high") || comp.startsWith("yük")
        ? "Yüksek"
        : "Orta";
  const viral = /Viral proof:\s*(?!none)/i.test(text);
  const channelsLine = text.match(/Channels:\s*(.+)/i)?.[1] ?? "";
  const channels = channelsLine
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean).length;
  return { margin, trend, competition, supplier, retail, viral, channels };
}

/** Hedef ülkenin kapıya teslim süresi + vergi/lojistik sürtünmesi profili. */
function logisticsProfile(country: string): { days: number; friction: number; note: string } {
  const code = (country || "GLOBAL").toUpperCase();
  const table: Record<string, { days: number; friction: number }> = {
    TR: { days: 4, friction: 6 },
    US: { days: 10, friction: 8 },
    CA: { days: 12, friction: 10 },
    UK: { days: 9, friction: 12 },
    GB: { days: 9, friction: 12 },
    DE: { days: 9, friction: 14 },
    FR: { days: 10, friction: 14 },
    NL: { days: 9, friction: 13 },
    ES: { days: 11, friction: 13 },
    IT: { days: 12, friction: 15 },
    AU: { days: 14, friction: 10 },
    AE: { days: 8, friction: 7 },
    SA: { days: 10, friction: 9 },
    GLOBAL: { days: 12, friction: 10 },
  };
  const row = table[code] ?? { days: 12, friction: 11 };
  const note =
    code === "GLOBAL"
      ? `Ortalama küresel teslim ${row.days} gün; vergi/gümrük etkisi orta.`
      : `${countryName(code)} pazarına tipik teslim ${row.days} gün; vergi/gümrük etkisi marjdan ~%${row.friction}.`;
  return { ...row, note };
}

/** AI 1 yerine: yerel talep + rekabet skoru (deterministik). */
function demandScore(f: Facts): number {
  let score = f.trend > 0 ? f.trend : 55;
  if (f.competition === "Düşük") score += 8;
  if (f.competition === "Yüksek") score -= 10;
  if (f.viral) score += 6;
  if (f.channels >= 3) score += 3;
  return clamp100(score);
}

/** AI 2 yerine: marj + lojistik sağlamlığı skoru (deterministik). */
function marginScore(f: Facts, friction: number): number {
  const marginPct =
    f.margin > 0
      ? f.margin
      : f.retail > 0 && f.supplier > 0
        ? ((f.retail - f.supplier) / f.retail) * 100
        : 0;
  let score = marginPct > 0 ? Math.min(100, marginPct * 1.4) : 50;
  score -= friction * 0.8;
  // Çok düşük bilet fiyatı reklam maliyetini kurtarmaz, çok yükseği dönüşümü düşürür.
  if (f.retail > 0 && f.retail < 15) score -= 10;
  if (f.retail > 250) score -= 6;
  return clamp100(score);
}

/**
 * AI 3 yerine: hedef pazar zayıfsa deterministik alternatif ülke önerisi.
 * Hiçbir ağ çağrısı yapmaz; listedeki ilk uygun büyük pazarı önerir.
 */
export async function runCountryCrossMatch(
  productContext: string,
  country: string,
): Promise<{ alt_country_code?: string; alt_country_name?: string; alt_country_note?: string }> {
  const current = (country || "GLOBAL").toUpperCase();
  const f = readFacts(productContext);
  const preferred =
    f.retail >= 60 ? ["US", "DE", "UK", "CA", "AU"] : ["US", "UK", "TR", "DE", "FR"];
  const valid = new Set(TARGET_COUNTRIES.map((c) => c.code.toUpperCase()));
  const alt = preferred.find((c) => c !== current && valid.has(c));
  if (!alt) return {};
  return {
    alt_country_code: alt,
    alt_country_name: countryName(alt),
    alt_country_note: `${countryName(alt)} pazarında bu fiyat bandı ve marj profili daha yüksek talep görüyor.`,
  };
}

/**
 * Hibrit skor: ai_1 * 0.55 + ai_2 * 0.45 — artık tamamen deterministik.
 * Aynı girdi her zaman aynı skoru üretir ve hiç AI çağrısı yapılmaz.
 */
export async function scoreProductForCountry(
  productContext: string,
  country: string,
): Promise<HybridScore> {
  const f = readFacts(productContext);
  const logistics = logisticsProfile(country);
  const ai1 = demandScore(f);
  const ai2 = marginScore(f, logistics.friction);
  const calculated = clamp100(ai1 * HYBRID_WEIGHT_AI1 + ai2 * HYBRID_WEIGHT_AI2);
  const label =
    (country || "GLOBAL").toUpperCase() === "GLOBAL" ? "küresel pazar" : countryName(country);
  return {
    target_country: (country || "GLOBAL").toUpperCase(),
    ai_1_score: ai1,
    local_competition_level: f.competition,
    market_note: `${label}: trend skoru ${f.trend || "—"}, rekabet ${f.competition.toLowerCase()}${
      f.viral ? ", viral kanıt mevcut" : ""
    }.`,
    ai_2_score: ai2,
    estimated_shipping_days: logistics.days,
    logistics_note: logistics.note,
    calculated_score: calculated,
    tooltip: `${label} için hibrit skor ${calculated}/100 — talep ${ai1}, marj + lojistik ${ai2}.`,
    badge_note:
      calculated >= 75 ? "Güçlü pazar uyumu" : calculated >= 60 ? "Uygun pazar" : "Zayıf pazar uyumu",
  };
}
