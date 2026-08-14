// ============================================================================
// Winner Score — tek, açıklanabilir "bu gerçekten kazanan ürün mü?" puanı.
// Saf fonksiyon: sunucu ve istemcide aynı sonucu verir, ek AI çağrısı yok.
// Mevcut skorların (hybrid / council / unified / realism) yerine geçmez;
// hepsini tek bir karara indirger.
// ============================================================================
import { netMarginOf } from "./profitability";
import { parseMoney } from "./unit-economics";
import type { MarketEvidence } from "./market-evidence";

/** Bir bileşenin puanını üreten tek bir kanıt satırı. */
export type ScoreEvidence = {
  /** Ölçülen metrik adı, ör. "Trend momentumu (30g)". */
  metric: string;
  /** Ölçülen değer, ör. "+18%". */
  value: string;
  /** Verinin nereden geldiği, ör. "Google Trends (canlı)" / "AI tahmini". */
  source: string;
  /** Bu kanıtın bileşen puanı içindeki ağırlığı (0-1). */
  weight?: number;
  /** Kanıt gerçek bir kaynaktan mı doğrulandı? */
  verified: boolean;
  /** Varsa tıklanabilir kaynak bağlantısı. */
  url?: string;
};

export type ScoreComponent = {
  key: "demand" | "competition" | "margin" | "logistics" | "differentiation" | "evidence";
  label: string;
  score: number; // 0-100
  weight: number; // 0-1
  reason: string;
  /** Puanın nasıl hesaplandığını açıklayan kısa formül. */
  formula?: string;
  /** Puanı destekleyen örnek kanıtlar. */
  evidence?: ScoreEvidence[];
};


export type EvidenceLevel = "verified" | "partial" | "ai_only";

export type WinnerBreakdown = {
  winner_score: number;
  components: ScoreComponent[];
  evidence_level: EvidenceLevel;
  penalties: string[];
  flags: string[];
  verdict: "Kazanan" | "Güçlü aday" | "Riskli" | "Zayıf";
};

type ScorableProduct = {
  name?: string;
  description?: string;
  selling_price_usd?: string;
  supplier_price_usd?: string;
  competition_level?: string;
  trend_score?: number;
  profit_margin_pct?: number;
  unified_score?: number;
  realism_score?: number;
  differentiation?: string[];
  review_pain_points?: Array<{ complaint: string; fix: string }>;
  bundles?: Array<unknown>;
  risks?: Array<{ risk: string; severity?: string; mitigation?: string }>;
  viral_proof?: Array<{ url?: string; views?: string }>;
  market_saturation?: { score?: number; verdict?: string; entry_window?: string };
  market_evidence?: MarketEvidence;
  hybrid?: { calculated_score?: number };
  council?: { velora_score?: number };
  cost_breakdown?: { supplier_cost?: string; net_margin_pct?: number };
  platform_fit?: string[];
  sourcing?: { lead_time_days?: string; moq?: string; shipping_method?: string };
};

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));

/** Kargo/lojistik dostu mu? Ürün adı + fiyat + tedarik verisinden türetilir. */
const BULKY = /(koltuk|kanepe|masa|treadmill|koşu bandı|buzdolabı|fridge|mattress|yatak|sofa|desk|bisiklet|bicycle|tv |televizyon|akvaryum|aquarium|piyano|piano)/i;
const FRAGILE = /(cam |glass|seramik|ceramic|ayna|mirror|porselen|porcelain)/i;
const REGULATED = /(pil|battery|lityum|lithium|vape|elektronik sigara|kozmetik|cosmetic|serum|krem|cream|supplement|takviye|ilaç|drug|lazer|laser|drone|silah|knife|bıçak)/i;

export function computeWinnerScore(p: ScorableProduct): WinnerBreakdown {
  const name = `${p.name ?? ""} ${p.description ?? ""}`;
  const ev = p.market_evidence;
  const penalties: string[] = [];
  const flags: string[] = [];

  // ---- 1. Talep momentumu -------------------------------------------------
  const trend = clamp(p.trend_score ?? 55);
  const momentum = ev?.trend_momentum_pct ?? 0;
  const momentumBoost = clamp(50 + momentum * 1.2, 0, 100);
  const viral = (p.viral_proof ?? []).some((v) => /^https?:\/\//i.test(v?.url ?? ""));
  let demand = Math.round(trend * 0.55 + momentumBoost * 0.35 + (viral ? 100 : 45) * 0.1);
  demand = clamp(demand);
  const demandReason = [
    `Trend skoru ${trend}`,
    ev?.trend_source === "google-trends" ? `Google Trends momentumu ${momentum > 0 ? "+" : ""}${momentum}%` : "trend verisi tahmini",
    viral ? "canlı viral kanıt var" : "viral kanıt yok",
  ].join(" · ");

  // ---- 2. Rekabet / doygunluk --------------------------------------------
  const compRaw = String(p.competition_level ?? "Medium").toLowerCase();
  const compBase = compRaw.startsWith("low") || compRaw.startsWith("dü") ? 88 : compRaw.startsWith("high") || compRaw.startsWith("yük") ? 34 : 62;
  const satScore = Number(p.market_saturation?.score);
  const sellerCount = ev?.sellers?.length ?? 0;
  const sellerPenalty = sellerCount >= 8 ? 18 : sellerCount >= 5 ? 10 : 0;
  const competition = clamp(
    (Number.isFinite(satScore) ? (compBase + (100 - clamp(satScore))) / 2 : compBase) - sellerPenalty,
  );
  const competitionReason = [
    `Rekabet: ${p.competition_level ?? "Orta"}`,
    sellerCount ? `${sellerCount} canlı satıcı ilanı bulundu` : "canlı satıcı taraması boş",
    p.market_saturation?.entry_window ? `Giriş penceresi: ${p.market_saturation.entry_window}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  // ---- 3. Kâr marjı -------------------------------------------------------
  const netMargin = netMarginOf(p);
  const margin = clamp(netMargin * 2.2); // %45 net marj ≈ 100
  const price = parseMoney(p.selling_price_usd);
  if (price > 0 && price < 12) {
    penalties.push("Satış fiyatı $12 altında — reklam maliyetini kaldırması zor.");
  }
  const marginReason = `Net marj ≈ %${Math.round(netMargin)}${price ? ` · satış fiyatı $${price.toFixed(2)}` : ""}`;

  // ---- 4. Lojistik --------------------------------------------------------
  let logistics = 78;
  if (BULKY.test(name)) {
    logistics -= 40;
    flags.push("Hacimli/ağır ürün — kargo maliyeti marjı yer.");
  }
  if (FRAGILE.test(name)) {
    logistics -= 18;
    flags.push("Kırılgan ürün — iade/hasar riski.");
  }
  const lead = Number(String(p.sourcing?.lead_time_days ?? "").match(/\d+/)?.[0] ?? 0);
  if (lead > 25) {
    logistics -= 15;
    flags.push(`Tedarik süresi uzun (${lead} gün).`);
  }
  if (price > 0 && price >= 25 && price <= 120) logistics += 10;
  logistics = clamp(logistics);
  const logisticsReason = [
    BULKY.test(name) ? "hacimli" : "kargoya uygun boyut",
    lead ? `${lead} gün tedarik` : "tedarik süresi bilinmiyor",
  ].join(" · ");

  // ---- 5. Farklılaşma -----------------------------------------------------
  const diffCount = (p.differentiation ?? []).length;
  const painCount = (p.review_pain_points ?? []).length;
  const bundleCount = (p.bundles ?? []).length;
  const differentiation = clamp(35 + diffCount * 14 + painCount * 9 + bundleCount * 6);
  const differentiationReason = `${diffCount} farklılaşma açısı · ${painCount} rakip şikâyeti fırsatı · ${bundleCount} paket fikri`;

  // ---- 6. Kanıt seviyesi --------------------------------------------------
  const realism = Number.isFinite(p.realism_score) ? clamp(p.realism_score as number) : 45;
  const verifiedSignals = ev?.verified_signals?.length ?? 0;
  const evidenceScore = clamp(realism * 0.7 + Math.min(verifiedSignals, 5) * 6);
  const evidence_level: EvidenceLevel =
    realism >= 75 && verifiedSignals >= 2 ? "verified" : realism >= 45 || verifiedSignals >= 1 ? "partial" : "ai_only";
  const evidenceReason = `Gerçeklik puanı ${realism} · ${verifiedSignals} doğrulanmış sinyal`;

  // ---- Risk cezaları ------------------------------------------------------
  if (REGULATED.test(name)) penalties.push("Mevzuat/onay riski (pil, kozmetik, takviye vb.).");
  for (const r of p.risks ?? []) {
    if (String(r?.severity ?? "").toLowerCase().startsWith("high")) penalties.push(`Yüksek risk: ${r.risk}`);
  }
  if (ev && ev.market_price_usd > 0 && Math.abs(ev.price_delta_pct) > 45) {
    penalties.push(`Fiyat piyasa medyanından %${Math.round(Math.abs(ev.price_delta_pct))} sapıyor.`);
  }

  const components: ScoreComponent[] = [
    { key: "demand", label: "Talep momentumu", score: demand, weight: 0.26, reason: demandReason },
    { key: "margin", label: "Kâr marjı", score: margin, weight: 0.22, reason: marginReason },
    { key: "competition", label: "Rekabet açığı", score: competition, weight: 0.18, reason: competitionReason },
    { key: "evidence", label: "Kanıt gücü", score: evidenceScore, weight: 0.16, reason: evidenceReason },
    { key: "differentiation", label: "Farklılaşma", score: differentiation, weight: 0.10, reason: differentiationReason },
    { key: "logistics", label: "Lojistik", score: logistics, weight: 0.08, reason: logisticsReason },
  ];

  const weighted = components.reduce((s, c) => s + c.score * c.weight, 0);
  const penalty = Math.min(24, penalties.length * 6);
  const evidencePenalty = evidence_level === "ai_only" ? 10 : evidence_level === "partial" ? 3 : 0;
  const winner_score = clamp(weighted - penalty - evidencePenalty);

  const verdict: WinnerBreakdown["verdict"] =
    winner_score >= 80 ? "Kazanan" : winner_score >= 65 ? "Güçlü aday" : winner_score >= 50 ? "Riskli" : "Zayıf";

  return { winner_score, components, evidence_level, penalties, flags, verdict };
}

export function evidenceLabel(level: EvidenceLevel): string {
  return level === "verified" ? "Doğrulanmış" : level === "partial" ? "Kısmen doğrulanmış" : "Yalnızca AI tahmini";
}

export function evidenceStyle(level: EvidenceLevel): string {
  return level === "verified"
    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
    : level === "partial"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
      : "border-rose-500/40 bg-rose-500/10 text-rose-300";
}

/**
 * Sunucudan Winner Score gelmeyen yollar (ör. Hugging Face motoru) için
 * istemci tarafında aynı puanı hesaplar. Zaten puanlı ürünler dokunulmaz.
 */
export function attachWinnerScores<T extends ScorableProduct & { winner_score?: number; score_breakdown?: WinnerBreakdown; evidence_level?: EvidenceLevel }>(
  products: T[],
): T[] {
  return products.map((p) => {
    if (typeof p.winner_score === "number" && p.score_breakdown) return p;
    const breakdown = computeWinnerScore(p);
    return { ...p, winner_score: breakdown.winner_score, score_breakdown: breakdown, evidence_level: breakdown.evidence_level };
  });
}
