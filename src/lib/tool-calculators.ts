/**
 * ARAÇ MODÜLLERİNİN ORTAK HESAP MOTORU.
 *
 * NEDEN VAR: Sol menüdeki finans ve büyüme modülleri AI'dan önce de
 * kullanıcıya hesabı göstermeli. Aksi hâlde "Landed Cost Calculator" gibi bir
 * araç, sonucu yalnız modelden bekleyen bir forma dönüşüyor; kullanıcı yazdığı
 * sayıların nereye gittiğini göremiyor.
 *
 * Buradaki formüller AI tahmini DEĞİLDİR. Kanal profilleri yayınlanmış ücret
 * oranlarına dayanan MODEL varsayımlarıdır; hesaplanan her kalem UI'da
 * "model/hesaplandı" olarak etiketlenir, ölçüm gibi sunulmaz.
 */

export type ChannelProfile = {
  /** Kanalın kısa kimliği; kullanıcı seçiminde ve testte kullanılır. */
  id: "amazon" | "amazon-eu" | "tiktok" | "etsy" | "shopify" | "trendyol" | "ebay" | "walmart";
  label: string;
  /** Pazaryeri referral/komisyon oranı (retail'in yüzdesi). */
  referralPct: number;
  /** Kanalın kendi fulfillment/kargo tahmini (sipariş başına USD). */
  fulfillmentUsd: number;
  /** Ödeme sağlayıcısı işlem yüzdesi. */
  paymentPct: number;
  /** Ödeme sağlayıcısı sipariş başına sabit ücreti. */
  paymentFixedUsd: number;
  /** İade/hasar rezervi (retail'in yüzdesi). */
  returnsPct: number;
  /** Reklam/TACoS payı (retail'in yüzdesi). */
  adsPct: number;
  /** Ambalaj, destek, uygulama gibi sipariş başına küçük gider. */
  miscUsd: number;
  /** Bu profilin dayandığı ücret sayfası; UI'da şeffaflık için gösterilir. */
  source: string;
};

export const CHANNEL_PROFILES: readonly ChannelProfile[] = [
  {
    id: "amazon",
    label: "Amazon US",
    referralPct: 15,
    fulfillmentUsd: 4.75,
    paymentPct: 0,
    paymentFixedUsd: 0,
    returnsPct: 5,
    adsPct: 12,
    miscUsd: 0.45,
    source: "Amazon referral + FBA tahmini",
  },
  {
    id: "amazon-eu",
    label: "Amazon EU",
    referralPct: 15,
    fulfillmentUsd: 5.25,
    paymentPct: 0,
    paymentFixedUsd: 0,
    returnsPct: 6,
    adsPct: 12,
    miscUsd: 0.45,
    source: "Amazon EU referral + FBA tahmini",
  },
  {
    id: "tiktok",
    label: "TikTok Shop US",
    referralPct: 8,
    fulfillmentUsd: 4.5,
    paymentPct: 0,
    paymentFixedUsd: 0,
    returnsPct: 8,
    adsPct: 15,
    miscUsd: 0.45,
    source: "TikTok Shop komisyon + fulfillment tahmini",
  },
  {
    id: "etsy",
    label: "Etsy",
    referralPct: 6.5,
    fulfillmentUsd: 4.5,
    paymentPct: 3,
    paymentFixedUsd: 0.25,
    returnsPct: 4,
    adsPct: 10,
    miscUsd: 0.45,
    source: "Etsy transaction + payment + listing tahmini",
  },
  {
    id: "trendyol",
    label: "Trendyol / HB / n11",
    referralPct: 19,
    fulfillmentUsd: 2.5,
    paymentPct: 0,
    paymentFixedUsd: 0,
    returnsPct: 8,
    adsPct: 8,
    miscUsd: 0.35,
    source: "TR pazaryeri komisyon + kargo tahmini",
  },
  {
    id: "ebay",
    label: "eBay",
    referralPct: 13.2,
    fulfillmentUsd: 4.5,
    paymentPct: 0,
    paymentFixedUsd: 0,
    returnsPct: 6,
    adsPct: 8,
    miscUsd: 0.45,
    source: "eBay final value + fulfillment tahmini",
  },
  {
    id: "walmart",
    label: "Walmart Marketplace",
    referralPct: 13,
    fulfillmentUsd: 4.5,
    paymentPct: 0,
    paymentFixedUsd: 0,
    returnsPct: 5,
    adsPct: 10,
    miscUsd: 0.45,
    source: "Walmart referral + fulfillment tahmini",
  },
  {
    id: "shopify",
    label: "Shopify / kendi mağaza",
    referralPct: 0,
    fulfillmentUsd: 4.75,
    paymentPct: 2.9,
    paymentFixedUsd: 0.3,
    returnsPct: 5,
    adsPct: 20,
    miscUsd: 0.45,
    source: "Shopify Payments + kendi mağaza CAC tahmini",
  },
];

/**
 * Serbest metin kanal adını profile çevirir. Kullanıcı alanı serbest metin
 * olduğu için "Amazon.de", "amazon eu", "Trendyol" gibi yazımlar eşleşmeli;
 * eşleşmezse kendi mağaza profili kullanılır ve UI bunu açıkça yazar.
 */
export function channelProfile(channel: string | undefined): ChannelProfile {
  const raw = (channel ?? "").toLowerCase();
  if (raw.includes("amazon") && /(eu|de|fr|it|es|uk|europe|avrupa)/.test(raw)) {
    return CHANNEL_PROFILES.find((p) => p.id === "amazon-eu")!;
  }
  if (raw.includes("amazon")) return CHANNEL_PROFILES.find((p) => p.id === "amazon")!;
  if (raw.includes("tiktok")) return CHANNEL_PROFILES.find((p) => p.id === "tiktok")!;
  if (raw.includes("etsy")) return CHANNEL_PROFILES.find((p) => p.id === "etsy")!;
  if (/(trendyol|hepsi|hepsiburada|n11)/.test(raw)) {
    return CHANNEL_PROFILES.find((p) => p.id === "trendyol")!;
  }
  if (raw.includes("ebay")) return CHANNEL_PROFILES.find((p) => p.id === "ebay")!;
  if (raw.includes("walmart")) return CHANNEL_PROFILES.find((p) => p.id === "walmart")!;
  return CHANNEL_PROFILES.find((p) => p.id === "shopify")!;
}

const money = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const pct = (v: unknown, max = 95) => Math.max(0, Math.min(max, num(v)));

export type ReverseCostPlan = {
  profile: ChannelProfile;
  retail: number;
  targetMarginPct: number;
  targetProfit: number;
  fees: number;
  maxCogs: number;
  breakEvenCogs: number;
  feasible: boolean;
  breakdown: { label: string; amount: number; kind: "fee" | "profit" }[];
};

/**
 * Hedef net marjdan geriye doğru MAKSİMUM tedarikçi maliyeti.
 *
 * Net marj; referral, fulfillment, ödeme, iade, reklam ve küçük giderler
 * düşüldükten sonraki kârdır. Tedarikçi fiyatı bu tavanın altındaysa hedef
 * marj tutar; üstündeyse model açıkça "ulaşılamaz" der.
 */
export function reverseCostPlan(input: {
  retail: unknown;
  marginPct: unknown;
  channel?: string;
}): ReverseCostPlan {
  const profile = channelProfile(input.channel);
  const retail = Math.max(0, num(input.retail));
  const targetMarginPct = pct(input.marginPct, 95);
  const referral = retail * (profile.referralPct / 100);
  const payment = retail * (profile.paymentPct / 100) + profile.paymentFixedUsd;
  const returns = retail * (profile.returnsPct / 100);
  const ads = retail * (profile.adsPct / 100);
  const fees = referral + profile.fulfillmentUsd + payment + returns + ads + profile.miscUsd;
  const targetProfit = retail * (targetMarginPct / 100);
  const maxCogs = retail - fees - targetProfit;
  const breakEvenCogs = retail - fees;

  return {
    profile,
    retail: money(retail),
    targetMarginPct,
    targetProfit: money(targetProfit),
    fees: money(fees),
    maxCogs: money(maxCogs),
    breakEvenCogs: money(breakEvenCogs),
    feasible: maxCogs > 0,
    breakdown: [
      { label: `${profile.label} komisyonu`, amount: money(referral), kind: "fee" },
      { label: "Fulfillment / kargo", amount: money(profile.fulfillmentUsd), kind: "fee" },
      { label: "Ödeme işlemi", amount: money(payment), kind: "fee" },
      { label: `İade rezervi (%${profile.returnsPct})`, amount: money(returns), kind: "fee" },
      { label: `Reklam / TACoS (%${profile.adsPct})`, amount: money(ads), kind: "fee" },
      { label: "Ambalaj + destek", amount: money(profile.miscUsd), kind: "fee" },
      { label: `Hedef net kâr (%${targetMarginPct})`, amount: money(targetProfit), kind: "profit" },
    ],
  };
}

export type LandedCostPlan = {
  goods: number;
  duty: number;
  freight: number;
  extra: number;
  total: number;
  perUnit: number;
  freightPerUnit: number;
  dutyPerUnit: number;
  dutyPct: number;
  qty: number;
  effectiveLandedMultiple: number;
};

/** EXW/FOB + navlun + gümrük + ek ücretlerin şeffaf dökümü. */
export function landedCostPlan(input: {
  unit: unknown;
  qty: unknown;
  freight: unknown;
  dutyPct: unknown;
  extra: unknown;
}): LandedCostPlan {
  const unit = Math.max(0, num(input.unit));
  const qty = Math.max(0, Math.round(num(input.qty)));
  const freight = Math.max(0, num(input.freight));
  const dutyPct = pct(input.dutyPct, 100);
  const extra = Math.max(0, num(input.extra));
  const goods = unit * qty;
  const duty = goods * (dutyPct / 100);
  const total = goods + duty + freight + extra;
  const perUnit = qty > 0 ? total / qty : 0;

  return {
    goods: money(goods),
    duty: money(duty),
    freight: money(freight),
    extra: money(extra),
    total: money(total),
    perUnit: money(perUnit),
    freightPerUnit: money(qty > 0 ? freight / qty : 0),
    dutyPerUnit: money(qty > 0 ? duty / qty : 0),
    dutyPct,
    qty,
    effectiveLandedMultiple: unit > 0 ? money(perUnit / unit) : 0,
  };
}

export type CapitalPlan = {
  inventory: number;
  freight: number;
  adsDuringLeadTime: number;
  total: number;
  stockoutDays: number;
  reorderInDays: number;
  reorderDate: string;
  safetyStock: number;
  dailyAdSpend: number;
};

const DAY_MS = 86_400_000;

/** ISO tarihine gün ekler; saat dilimi kaymasını önlemek için UTC kullanır. */
export function addDays(isoDate: string, days: number): string {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(isoDate)
    ? new Date(`${isoDate}T00:00:00.000Z`)
    : new Date();
  if (Number.isNaN(base.getTime())) return new Date().toISOString().slice(0, 10);
  base.setUTCDate(base.getUTCDate() + Math.round(days));
  return base.toISOString().slice(0, 10);
}

export function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Stok, navlun ve tedarik süresi boyunca reklam harcamasını birlikte planlar.
 * Emniyet stoğu, tedarik süresi boyunca beklenen satışın %20'si olarak
 * modellenir; bu bir ölçüm değil, nakit planlama tamponudur.
 */
export function capitalPlan(input: {
  units: unknown;
  unit: unknown;
  freight: unknown;
  adsPerDay: unknown;
  velocity: unknown;
  leadTime: unknown;
  today?: string;
}): CapitalPlan {
  const units = Math.max(0, Math.round(num(input.units)));
  const unit = Math.max(0, num(input.unit));
  const freight = Math.max(0, num(input.freight));
  const ads = Math.max(0, num(input.adsPerDay));
  const velocity = Math.max(0, num(input.velocity));
  const leadTime = Math.max(0, Math.round(num(input.leadTime)));
  const inventory = units * unit;
  const adsDuringLeadTime = ads * leadTime;
  const total = inventory + freight + adsDuringLeadTime;
  const stockoutDays = velocity > 0 ? units / velocity : 0;
  const reorderInDays = stockoutDays - leadTime;
  const leadDemand = velocity * leadTime;
  const safetyStock = Math.ceil(leadDemand * 0.2);

  return {
    inventory: money(inventory),
    freight: money(freight),
    adsDuringLeadTime: money(adsDuringLeadTime),
    total: money(total),
    stockoutDays: Math.round(stockoutDays * 10) / 10,
    reorderInDays: Math.round(reorderInDays * 10) / 10,
    reorderDate: addDays(input.today ?? todayIso(), Math.max(0, reorderInDays)),
    safetyStock,
    dailyAdSpend: money(ads),
  };
}

export type DesiPlan = {
  volumetricKg: number;
  actualKg: number;
  billableKg: number;
  divisor: number;
  isVolumetric: boolean;
};

/** FBA/kargo kademesi — ölçü ve ağırlıktan yaklaşık ABD FBA sınıfı. */
export type ParcelTier = {
  tier: "small-standard" | "large-standard" | "large-bulky" | "extra-large";
  label: string;
  /** Uzun kenar (inç). */
  longestIn: number;
  /** Uzun kenar + 2 × (orta + kısa kenar), inç. */
  girthIn: number;
  weightLb: number;
  /** Kademeyi belirleyen sınır; kullanıcıya hangi ölçünün taştığını söyler. */
  blocker: string | null;
};

/** Hacimsel ağırlık: cm³ / 5000. FBA ve hava kargo için yaygın metrik. */
export function desiPlan(input: { l: unknown; w: unknown; h: unknown; weight: unknown }): DesiPlan {
  const l = Math.max(0, num(input.l));
  const w = Math.max(0, num(input.w));
  const h = Math.max(0, num(input.h));
  const actualKg = Math.max(0, num(input.weight));
  const divisor = 5000;
  const volumetricKg = (l * w * h) / divisor;
  return {
    volumetricKg: Math.round(volumetricKg * 100) / 100,
    actualKg: Math.round(actualKg * 100) / 100,
    billableKg: Math.round(Math.max(volumetricKg, actualKg) * 100) / 100,
    divisor,
    isVolumetric: volumetricKg > actualKg,
  };
}

/**
 * Amazon FBA ABD kademesini YAKLAŞIK olarak sınıflandırır.
 *
 * Ücret tarifesi yıllara ve ürün türüne göre değişebildiği için bu sonuç bir
 * "hangi kademedeyim" ön kontrolüdür; kesin ücret için Amazon'un resmi
 * hesaplayıcısı doğrulanmalıdır. Sınırlar inç/pound cinsindendir.
 */
export function fbaSizeTier(input: {
  l: unknown;
  w: unknown;
  h: unknown;
  weight: unknown;
}): ParcelTier {
  const sides = [Math.max(0, num(input.l)), Math.max(0, num(input.w)), Math.max(0, num(input.h))]
    .map((cm) => cm / 2.54)
    .sort((a, b) => b - a);
  const [longestIn, middleIn, shortestIn] = sides as [number, number, number];
  const girthIn = longestIn + 2 * (middleIn + shortestIn);
  const weightLb = Math.max(0, num(input.weight)) * 2.20462;
  const rounded = (value: number) => Math.round(value * 10) / 10;

  const base = {
    longestIn: rounded(longestIn),
    girthIn: rounded(girthIn),
    weightLb: rounded(weightLb),
  };
  if (longestIn <= 15 && middleIn <= 12 && shortestIn <= 0.75 && weightLb <= 1) {
    return { ...base, tier: "small-standard", label: "Small standard", blocker: null };
  }
  if (longestIn <= 18 && middleIn <= 14 && shortestIn <= 8 && weightLb <= 20) {
    return { ...base, tier: "large-standard", label: "Large standard", blocker: null };
  }
  if (longestIn <= 59 && middleIn <= 33 && shortestIn <= 33 && girthIn <= 130 && weightLb <= 50) {
    return { ...base, tier: "large-bulky", label: "Large bulky", blocker: null };
  }

  const blocker =
    weightLb > 50
      ? `Ağırlık ${rounded(weightLb)} lb — 50 lb üstü ekstra büyük sınıf`
      : girthIn > 130
        ? `Çevre ${rounded(girthIn)} inç — 130 inç üstü ekstra büyük sınıf`
        : longestIn > 59
          ? `Uzun kenar ${rounded(longestIn)} inç — 59 inç üstü ekstra büyük sınıf`
          : "Ölçüler büyük hacimli sınıfın üstünde";
  return { ...base, tier: "extra-large", label: "Extra-large / oversized", blocker };
}

/**
 * Kanal bazlı gerçek marj karşılaştırması — AI beklemeden ilk cevap.
 *
 * Aynı satış fiyatı ve landed maliyetle her kanalın komisyon, fulfillment,
 * iade, reklam ve KDV yükünü düşer. `amazon-eu` profilinde %20 KDV varsayımı
 * vardır; bu bir modeldir, ülkeye göre değişir.
 */
export type ChannelMarginRow = {
  id: ChannelProfile["id"];
  label: string;
  vatPct: number;
  fees: number;
  vat: number;
  netProfit: number;
  marginPct: number;
  breakEvenPrice: number;
  feasible: boolean;
};

export type ChannelMarginPlan = {
  price: number;
  cost: number;
  rows: ChannelMarginRow[];
  best: ChannelMarginRow | null;
  worst: ChannelMarginRow | null;
  spread: number;
};

const VAT_BY_CHANNEL: Partial<Record<ChannelProfile["id"], number>> = {
  "amazon-eu": 20,
};

function feeModel(profile: ChannelProfile, retail: number) {
  const referral = retail * (profile.referralPct / 100);
  const payment = retail * (profile.paymentPct / 100) + profile.paymentFixedUsd;
  const returns = retail * (profile.returnsPct / 100);
  const ads = retail * (profile.adsPct / 100);
  const fixed = profile.fulfillmentUsd + profile.paymentFixedUsd + profile.miscUsd;
  const variablePct =
    profile.referralPct + profile.paymentPct + profile.returnsPct + profile.adsPct;
  return {
    referral,
    payment,
    returns,
    ads,
    fixed,
    variablePct,
    total: referral + payment + returns + ads + profile.miscUsd + profile.fulfillmentUsd,
  };
}

function breakEvenAt(profile: ChannelProfile, cost: number, vatPct: number, extraMarginPct = 0) {
  const fees = feeModel(profile, 0);
  const denominator = 1 - (fees.variablePct + vatPct + extraMarginPct) / 100;
  if (denominator <= 0.01) return 0;
  return Math.max(0, (cost + fees.fixed) / denominator);
}

export function channelMarginPlan(input: {
  price: unknown;
  cost: unknown;
  channels?: readonly ChannelProfile["id"][];
}): ChannelMarginPlan {
  const price = Math.max(0, num(input.price));
  const cost = Math.max(0, num(input.cost));
  const wanted = input.channels ?? (["amazon", "amazon-eu", "tiktok", "etsy"] as const);
  const rows = CHANNEL_PROFILES.filter((profile) => wanted.includes(profile.id)).map((profile) => {
    const fees = feeModel(profile, price);
    const vatPct = VAT_BY_CHANNEL[profile.id] ?? 0;
    const vat = price * (vatPct / 100);
    const netProfit = price - cost - fees.total - vat;
    return {
      id: profile.id,
      label: profile.label,
      vatPct,
      fees: money(fees.total),
      vat: money(vat),
      netProfit: money(netProfit),
      marginPct: price > 0 ? Math.round((netProfit / price) * 1000) / 10 : 0,
      breakEvenPrice: money(breakEvenAt(profile, cost, vatPct)),
      feasible: netProfit > 0,
    };
  });
  const sorted = [...rows].sort((a, b) => b.netProfit - a.netProfit);
  return {
    price: money(price),
    cost: money(cost),
    rows,
    best: sorted[0] ?? null,
    worst: sorted[sorted.length - 1] ?? null,
    spread: sorted.length ? money(sorted[0].netProfit - sorted[sorted.length - 1].netProfit) : 0,
  };
}

/** Fiyat metninden ("24.99, $27.50, 19,99") güvenli sayı listesi. */
export function parsePriceList(raw: string): number[] {
  const matches = String(raw ?? "").match(
    /\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/g,
  );
  if (!matches) return [];
  return matches
    .map((token) => {
      const hasComma = token.includes(",");
      const hasDot = token.includes(".");
      let normalized = token;
      if (hasComma && hasDot) {
        normalized =
          token.lastIndexOf(",") > token.lastIndexOf(".")
            ? token.replace(/\./g, "").replace(",", ".")
            : token.replace(/,/g, "");
      } else if (hasComma) {
        normalized = /,\d{1,2}$/.test(token) ? token.replace(",", ".") : token.replace(/,/g, "");
      }
      const value = Number(normalized);
      return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 0;
    })
    .filter((value) => value > 0)
    .slice(0, 20);
}

export type PriceStrategyPlan = {
  profile: ChannelProfile;
  cost: number;
  targetMarginPct: number;
  breakEvenPrice: number;
  floorPrice: number;
  suggestedPrice: number;
  netProfitAtSuggested: number | null;
  marginAtSuggested: number | null;
  competitor: { count: number; min: number; max: number; average: number; median: number } | null;
  positioning: "değer" | "pazar ortalaması" | "premium" | "veri yok";
  feasible: boolean;
};

export function priceStrategyPlan(input: {
  cost: unknown;
  competitors: string;
  channel?: string;
  targetMarginPct?: unknown;
}): PriceStrategyPlan {
  const profile = channelProfile(input.channel);
  const cost = Math.max(0, num(input.cost));
  const targetMarginPct = Math.max(0, Math.min(70, num(input.targetMarginPct ?? 20)));
  const prices = parsePriceList(input.competitors).sort((a, b) => a - b);
  const breakEvenPrice = breakEvenAt(profile, cost, 0);
  const floorPrice = breakEvenAt(profile, cost, 0, targetMarginPct);
  const median = prices.length
    ? prices.length % 2
      ? prices[Math.floor(prices.length / 2)]
      : (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2
    : 0;
  const suggestedPrice = prices.length
    ? Math.max(floorPrice, Math.min(Math.max(median, floorPrice), median * 1.35))
    : floorPrice;
  const fees = feeModel(profile, suggestedPrice);
  const netProfit = suggestedPrice > 0 ? suggestedPrice - cost - fees.total : null;
  const marginPct =
    suggestedPrice > 0 && netProfit !== null ? (netProfit / suggestedPrice) * 100 : null;
  const positioning: PriceStrategyPlan["positioning"] = !prices.length
    ? "veri yok"
    : suggestedPrice > median * 1.08
      ? "premium"
      : suggestedPrice < median * 0.92
        ? "değer"
        : "pazar ortalaması";
  return {
    profile,
    cost: money(cost),
    targetMarginPct,
    breakEvenPrice: money(breakEvenPrice),
    floorPrice: money(floorPrice),
    suggestedPrice: money(suggestedPrice),
    netProfitAtSuggested: netProfit === null ? null : money(netProfit),
    marginAtSuggested: marginPct === null ? null : Math.round(marginPct * 10) / 10,
    competitor: prices.length
      ? {
          count: prices.length,
          min: prices[0],
          max: prices[prices.length - 1],
          average: money(prices.reduce((sum, value) => sum + value, 0) / prices.length),
          median: money(median),
        }
      : null,
    positioning,
    feasible: floorPrice > 0 && breakEvenPrice > 0,
  };
}

export type MilestonePlan = {
  amount: number;
  depositPct: number;
  deposit: number;
  balance: number;
  qcDay: number;
  balanceDay: number;
};

/** %30 depozito / %70 bakiye planının tutarlar ve günleri. */
export function milestonePlan(input: {
  amount: unknown;
  leadTime: unknown;
  depositPct?: unknown;
}): MilestonePlan {
  const amount = Math.max(0, num(input.amount));
  const leadTime = Math.max(0, Math.round(num(input.leadTime)));
  const depositPct = pct(input.depositPct ?? 30, 100);
  const deposit = amount * (depositPct / 100);
  return {
    amount: money(amount),
    depositPct,
    deposit: money(deposit),
    balance: money(amount - deposit),
    qcDay: Math.round(leadTime * 0.7),
    balanceDay: leadTime,
  };
}

export type LeadTimePlan = {
  totalDays: number;
  stockoutDays: number;
  reorderInDays: number;
  reorderDate: string;
  stockoutDate: string;
  safetyStock: number;
  reorderPoint: number;
  overdueDays: number;
};

/**
 * Üretim + transit + depo girişini toplar; yeniden sipariş tarihini ve
 * tükenme tarihini takvim günü olarak verir. Tedarik süresi bugünkü stok
 * tükenmesinden uzunsa `overdueDays` ile "geç kaldın" der.
 */
export function leadTimePlan(input: {
  today: string;
  production: unknown;
  transit: unknown;
  checkin: unknown;
  stock: unknown;
  velocity: unknown;
}): LeadTimePlan {
  const production = Math.max(0, Math.round(num(input.production)));
  const transit = Math.max(0, Math.round(num(input.transit)));
  const checkin = Math.max(0, Math.round(num(input.checkin)));
  const stock = Math.max(0, num(input.stock));
  const velocity = Math.max(0, num(input.velocity));
  const totalDays = production + transit + checkin;
  const stockoutDays = velocity > 0 ? stock / velocity : 0;
  const reorderInDays = stockoutDays - totalDays;
  const safetyStock = Math.ceil(velocity * totalDays * 0.2);
  const reorderPoint = Math.ceil(velocity * totalDays + safetyStock);

  return {
    totalDays,
    stockoutDays: Math.round(stockoutDays * 10) / 10,
    reorderInDays: Math.round(reorderInDays * 10) / 10,
    reorderDate: addDays(input.today, Math.max(0, reorderInDays)),
    stockoutDate: addDays(input.today, stockoutDays),
    safetyStock,
    reorderPoint,
    overdueDays: Math.max(0, Math.ceil(-reorderInDays)),
  };
}

/** UI'da tutarlı USD biçimi; route'lardaki yerel kopyaların tek kaynağı. */
export function formatUsd(value: number): string {
  return `$${(Math.round(value * 100) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

/** Sayıyı Türkçe ondalıkla, gereksiz sıfır olmadan gösterir. */
export function formatDays(value: number): string {
  return Number.isInteger(value) ? `${value} gün` : `${value.toFixed(1)} gün`;
}

export { DAY_MS };
