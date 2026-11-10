/**
 * MULTI CUSTOMER — 1.000 kişilik sentetik alıcı paneli.
 *
 * NEDEN VAR: Ürün Bulucu bir ürünün kaç kişiye hitap ettiğini tek bir skorla
 * söylüyordu. Bu motor, aynı ürünü 1.000 FARKLI karakterin gözünden simüle
 * eder: kim alır, kim almaz, hangi segmentte dönüşüm yüksek, hangi itiraz
 * tekrar ediyor?
 *
 * DÜRÜSTLÜK SINIRI:
 *   • Bu bir ÖLÇÜM DEĞİL, deterministik bir senaryo/simülasyondur.
 *   • Her karakterin kararı ürün sinyalleri + karakter özelliklerinden
 *     hesaplanır; kişi başına ayrı LLM çağrısı YAPILMAZ.
 *   • Fiyat/puan/yorum/satış yoksa 0 uydurulmaz; ilgili sinyal "ölçülmedi"
 *     kalır ve modelin güveni düşer.
 *   • 1.000 kişi, aynı girdi için HER ZAMAN aynı sonucu verir (test edilebilir).
 */

export const PANEL_SIZE = 1000;

export type DecisionStyle =
  | "Fiyat Avcısı"
  | "Hızlı Karar Veren"
  | "Araştırmacı"
  | "Marka Sadığı"
  | "Hediye Alıcısı"
  | "İhtiyaç Odaklı"
  | "Sosyal Kanıt Takipçisi"
  | "Şüpheci";

export type Channel = "TikTok" | "Instagram" | "YouTube" | "Amazon" | "Etsy" | "Google";
export type IncomeBand = "Düşük" | "Alt-orta" | "Orta" | "Üst-orta" | "Yüksek";
export type PriceSensitivity = "Çok yüksek" | "Yüksek" | "Orta" | "Düşük";
export type RiskTolerance = "Düşük" | "Orta" | "Yüksek";
export type AdTrust = "Reklama kapalı" | "Temkinli" | "Açık";
export type Occasion = "Kendisi için" | "Hediye" | "Ev" | "İş" | "Hobi";
export type Gender = "Kadın" | "Erkek" | "Belirtmedi";
export type Interest =
  | "Teknoloji"
  | "Ev & Yaşam"
  | "Güzellik"
  | "Fitness"
  | "Evcil Hayvan"
  | "Oyun"
  | "Moda"
  | "Bebek & Çocuk";
export type Sustainability = "Yüksek" | "Orta" | "Düşük";
export type PriceFit = "Rahat" | "Zorlanır" | "Çok pahalı" | "Fiyat yok";

export type MultiCustomerProduct = {
  name: string;
  description?: string;
  sellingPriceUsd?: number | null;
  targetAudience?: string;
  platform?: string;
  rating?: number | null;
  ratingCount?: number | null;
  salesVolume?: number | null;
  competitionLevel?: string | null;
  trendScore?: number | null;
  source?: string;
};

export type PersonaFactor = {
  label: string;
  delta: number;
};

export type Persona = {
  id: string;
  label: string;
  age: number;
  ageBand: string;
  gender: Gender;
  incomeBand: IncomeBand;
  monthlyIncomeUsd: number;
  decisionStyle: DecisionStyle;
  decisionStyleNote: string;
  channel: Channel;
  priceSensitivity: PriceSensitivity;
  riskTolerance: RiskTolerance;
  adTrust: AdTrust;
  occasion: Occasion;
  interest: Interest;
  sustainability: Sustainability;
  priceFit: PriceFit;
  propensity: number;
  threshold: number;
  buy: boolean;
  topReason: string;
  topObjection: string;
  positive: PersonaFactor[];
  negative: PersonaFactor[];
};

export type ProductProfile = {
  name: string;
  priceUsd: number | null;
  priceKnown: boolean;
  platformChannel: Channel | null;
  tags: Interest[];
  genderBias: "Kadın" | "Erkek" | null;
  ageBias: "genç" | "ileri yaş" | null;
  giftBias: boolean;
  rating: number | null;
  ratingCount: number | null;
  salesVolume: number | null;
  competitionLevel: string | null;
  trendScore: number | null;
  socialProof: number;
  socialProofMeasured: boolean;
  priceScore: number;
  competitionScore: number;
  signalsUsed: string[];
  missingSignals: string[];
};

export type DistributionRow = {
  label: string;
  total: number;
  buyers: number;
  nonBuyers: number;
  ratePct: number;
};

export type RankedDistributionRow = DistributionRow;

export type ReasonCount = {
  label: string;
  count: number;
  sharePct: number;
};

export type ObjectionCount = ReasonCount & {
  fix: string;
};

export type MultiCustomerResult = {
  panelSize: number;
  buyers: number;
  nonBuyers: number;
  penetrationPct: number;
  confidencePct: number;
  product: ProductProfile;
  personas: Persona[];
  distributions: Record<DistributionKey, DistributionRow[]>;
  topBuyerSegments: RankedDistributionRow[];
  topNonBuyerSegments: RankedDistributionRow[];
  topReasons: ReasonCount[];
  topObjections: ObjectionCount[];
  buyerExamples: Persona[];
  nonBuyerExamples: Persona[];
  narrative: string;
};

export type DistributionKey =
  | "decisionStyle"
  | "ageBand"
  | "incomeBand"
  | "channel"
  | "priceSensitivity"
  | "priceFit"
  | "gender"
  | "occasion"
  | "interest";

export const DISTRIBUTION_DIMENSIONS: Array<{
  key: DistributionKey;
  label: string;
  hint: string;
}> = [
  {
    key: "decisionStyle",
    label: "Karar tarzı",
    hint: "Ürünü hangi düşünme biçimiyle değerlendiriyor?",
  },
  { key: "ageBand", label: "Yaş", hint: "Hangi yaş grubu daha açık?" },
  { key: "incomeBand", label: "Gelir", hint: "Fiyat baskısı gelire göre nasıl değişiyor?" },
  { key: "channel", label: "Keşif kanalı", hint: "Ürünü nerede görürse satın alır?" },
  { key: "priceSensitivity", label: "Fiyat hassasiyeti", hint: "İndirim/prime etkisi." },
  { key: "priceFit", label: "Fiyat uyumu", hint: "Fiyat bu gelir için ne kadar rahat?" },
  { key: "gender", label: "Cinsiyet", hint: "Hedef kitle eğilimi." },
  { key: "occasion", label: "Alım amacı", hint: "Kendisi, hediye, ev, iş veya hobi." },
  { key: "interest", label: "İlgi alanı", hint: "Ürün kategorisiyle kesişim." },
];

const DECISION_STYLES: Array<{
  value: DecisionStyle;
  count: number;
  note: string;
}> = [
  {
    value: "Fiyat Avcısı",
    count: 125,
    note: "Önce indirim, kupon ve birim fiyat karşılaştırması yapar.",
  },
  {
    value: "Hızlı Karar Veren",
    count: 125,
    note: "Kısa videoda gördüğü anda karar verebilir; araştırmayı sevmez.",
  },
  {
    value: "Araştırmacı",
    count: 125,
    note: "Yorumları, puanı ve iade koşullarını okumadan almaz.",
  },
  {
    value: "Marka Sadığı",
    count: 125,
    note: "Tanıdığı markayı ve satıcıyı tercih eder; yeni markaya temkinli.",
  },
  {
    value: "Hediye Alıcısı",
    count: 125,
    note: "Paket, teslimat ve hediye notu onun için fiyattan önce gelir.",
  },
  {
    value: "İhtiyaç Odaklı",
    count: 125,
    note: "Somut bir problemi çözüyorsa fiyat ikinci plandadır.",
  },
  {
    value: "Sosyal Kanıt Takipçisi",
    count: 125,
    note: "Yorum sayısı, UGC ve satış hacmi kararını belirler.",
  },
  { value: "Şüpheci", count: 125, note: "Reklama ve abartılı vaatlere kapalı; kanıt ister." },
];

const AGE_BANDS: Array<{
  value: string;
  count: number;
  min: number;
  max: number;
}> = [
  { value: "18–24", count: 200, min: 18, max: 24 },
  { value: "25–34", count: 300, min: 25, max: 34 },
  { value: "35–44", count: 250, min: 35, max: 44 },
  { value: "45–54", count: 160, min: 45, max: 54 },
  { value: "55+", count: 90, min: 55, max: 70 },
];

const INCOME_BANDS: Array<{
  value: IncomeBand;
  count: number;
  monthlyUsd: number;
}> = [
  { value: "Düşük", count: 240, monthlyUsd: 900 },
  { value: "Alt-orta", count: 300, monthlyUsd: 1700 },
  { value: "Orta", count: 290, monthlyUsd: 3000 },
  { value: "Üst-orta", count: 120, monthlyUsd: 5500 },
  { value: "Yüksek", count: 50, monthlyUsd: 10000 },
];

const CHANNELS: Array<{ value: Channel; count: number }> = [
  { value: "TikTok", count: 250 },
  { value: "Instagram", count: 230 },
  { value: "YouTube", count: 130 },
  { value: "Amazon", count: 180 },
  { value: "Etsy", count: 90 },
  { value: "Google", count: 120 },
];

const PRICE_SENSITIVITIES: Array<{ value: PriceSensitivity; count: number }> = [
  { value: "Çok yüksek", count: 260 },
  { value: "Yüksek", count: 300 },
  { value: "Orta", count: 280 },
  { value: "Düşük", count: 160 },
];

const RISK_TOLERANCES: Array<{ value: RiskTolerance; count: number }> = [
  { value: "Düşük", count: 380 },
  { value: "Orta", count: 400 },
  { value: "Yüksek", count: 220 },
];

const AD_TRUST: Array<{ value: AdTrust; count: number }> = [
  { value: "Reklama kapalı", count: 300 },
  { value: "Temkinli", count: 400 },
  { value: "Açık", count: 300 },
];

const OCCASIONS: Array<{ value: Occasion; count: number }> = [
  { value: "Kendisi için", count: 520 },
  { value: "Hediye", count: 220 },
  { value: "Ev", count: 120 },
  { value: "İş", count: 80 },
  { value: "Hobi", count: 60 },
];

const GENDERS: Array<{ value: Gender; count: number }> = [
  { value: "Kadın", count: 500 },
  { value: "Erkek", count: 470 },
  { value: "Belirtmedi", count: 30 },
];

const INTERESTS: Array<{ value: Interest; count: number }> = [
  { value: "Teknoloji", count: 125 },
  { value: "Ev & Yaşam", count: 125 },
  { value: "Güzellik", count: 125 },
  { value: "Fitness", count: 125 },
  { value: "Evcil Hayvan", count: 125 },
  { value: "Oyun", count: 125 },
  { value: "Moda", count: 125 },
  { value: "Bebek & Çocuk", count: 125 },
];

const SUSTAINABILITIES: Array<{ value: Sustainability; count: number }> = [
  { value: "Yüksek", count: 220 },
  { value: "Orta", count: 380 },
  { value: "Düşük", count: 400 },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function fillBag<T>(groups: Array<{ value: T; count: number }>, random: () => number): T[] {
  const bag: T[] = [];
  for (const group of groups) {
    for (let i = 0; i < group.count; i++) bag.push(group.value);
  }
  if (bag.length !== PANEL_SIZE) {
    throw new Error(
      `Multi Customer panel ağırlıkları ${PANEL_SIZE} olmalı; ${bag.length} bulundu.`,
    );
  }
  return shuffle(bag, random);
}

function fillAges(random: () => number): number[] {
  const ages: number[] = [];
  for (const band of AGE_BANDS) {
    const width = band.max - band.min + 1;
    for (let i = 0; i < band.count; i++) {
      ages.push(band.min + (i % width));
    }
  }
  if (ages.length !== PANEL_SIZE) throw new Error("Multi Customer yaş dağılımı eksik.");
  return shuffle(ages, random);
}

function ageBandOf(age: number): string {
  if (age <= 24) return "18–24";
  if (age <= 34) return "25–34";
  if (age <= 44) return "35–44";
  if (age <= 54) return "45–54";
  return "55+";
}

function fold(value: string): string {
  return value
    .toLowerCase()
    .replace(/[çğıöşü]/g, (char) => {
      const map: Record<string, string> = {
        ç: "c",
        ğ: "g",
        ı: "i",
        ö: "o",
        ş: "s",
        ü: "u",
      };
      return map[char] ?? char;
    })
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hasWord(text: string, words: string[]): boolean {
  return words.some((word) => new RegExp(`\\b${word}\\b`, "i").test(text));
}

const TAG_RULES: Array<{ tag: Interest; words: string[] }> = [
  { tag: "Evcil Hayvan", words: ["pet", "kedi", "kopek", "cat", "dog", "evcil", "tas", "mama"] },
  {
    tag: "Güzellik",
    words: ["guzellik", "makyaj", "cilt", "sac", "beauty", "cosmetic", "serum", "parfum"],
  },
  {
    tag: "Fitness",
    words: ["fitness", "spor", "egzersiz", "gym", "yoga", "kas", "kilo", "workout"],
  },
  {
    tag: "Teknoloji",
    words: [
      "teknoloji",
      "tech",
      "usb",
      "bluetooth",
      "kamera",
      "telefon",
      "laptop",
      "gadget",
      "led",
    ],
  },
  { tag: "Oyun", words: ["oyun", "gaming", "game", "konsol", "joystick", "mouse", "klavye"] },
  {
    tag: "Ev & Yaşam",
    words: ["ev", "mutfak", "home", "kitchen", "dekor", "organizer", "temizlik", "bahce"],
  },
  {
    tag: "Moda",
    words: ["moda", "fashion", "kiyafet", "taki", "canta", "ayakkabi", "saat", "gozluk"],
  },
  {
    tag: "Bebek & Çocuk",
    words: ["bebek", "cocuk", "baby", "kids", "oyuncak", "mama", "bez", "stroller"],
  },
];

const FEMALE_WORDS = ["kadin", "anne", "kiz", "female", "women", "woman", "makeup", "makyaj"];
const MALE_WORDS = ["erkek", "baba", "male", "men", "man", "gaming", "tiras", "sakal"];
const YOUNG_WORDS = ["genc", "teen", "ogrenci", "student", "z kusagi", "universite"];
const OLDER_WORDS = ["yasli", "senior", "emekli", "50+", "ileri yas"];

export function inferProductTags(product: MultiCustomerProduct): Interest[] {
  const text = fold(
    `${product.name ?? ""} ${product.description ?? ""} ${product.targetAudience ?? ""}`,
  );
  return TAG_RULES.filter((rule) => hasWord(text, rule.words)).map((rule) => rule.tag);
}

function inferGenderBias(text: string): "Kadın" | "Erkek" | null {
  const female = hasWord(text, FEMALE_WORDS);
  const male = hasWord(text, MALE_WORDS);
  if (female && !male) return "Kadın";
  if (male && !female) return "Erkek";
  return null;
}

function inferAgeBias(text: string): "genç" | "ileri yaş" | null {
  const young = hasWord(text, YOUNG_WORDS);
  const older = hasWord(text, OLDER_WORDS);
  if (young && !older) return "genç";
  if (older && !young) return "ileri yaş";
  return null;
}

function mapPlatformToChannel(platform?: string): Channel | null {
  const value = fold(platform ?? "");
  if (value.includes("tiktok")) return "TikTok";
  if (value.includes("instagram") || value.includes("meta") || value.includes("facebook"))
    return "Instagram";
  if (value.includes("youtube")) return "YouTube";
  if (value.includes("amazon")) return "Amazon";
  if (value.includes("etsy")) return "Etsy";
  if (value.includes("google") || value.includes("search")) return "Google";
  return null;
}

function priceScoreFor(price: number | null): number {
  if (price === null) return 50;
  if (price <= 15) return 85;
  if (price <= 25) return 76;
  if (price <= 40) return 66;
  if (price <= 60) return 54;
  if (price <= 90) return 42;
  if (price <= 150) return 30;
  return 18;
}

function competitionScoreFor(level?: string | null): number {
  const value = fold(level ?? "");
  if (value === "low" || value.includes("dusuk")) return 80;
  if (value === "high" || value.includes("yuksek")) return 28;
  if (value === "medium" || value.includes("orta")) return 54;
  return 50;
}

export function buildProductProfile(product: MultiCustomerProduct): ProductProfile {
  const price =
    typeof product.sellingPriceUsd === "number" &&
    Number.isFinite(product.sellingPriceUsd) &&
    product.sellingPriceUsd > 0
      ? product.sellingPriceUsd
      : null;
  const rating =
    typeof product.rating === "number" && Number.isFinite(product.rating) && product.rating > 0
      ? clamp(product.rating, 0, 5)
      : null;
  const ratingCount =
    typeof product.ratingCount === "number" &&
    Number.isFinite(product.ratingCount) &&
    product.ratingCount >= 0
      ? Math.round(product.ratingCount)
      : null;
  const salesVolume =
    typeof product.salesVolume === "number" &&
    Number.isFinite(product.salesVolume) &&
    product.salesVolume >= 0
      ? Math.round(product.salesVolume)
      : null;
  const trendScore =
    typeof product.trendScore === "number" &&
    Number.isFinite(product.trendScore) &&
    product.trendScore >= 0
      ? clamp(product.trendScore, 0, 100)
      : null;

  const ratingScore = rating === null ? null : clamp(((rating - 3.2) / 1.8) * 100, 0, 100);
  const reviewScore =
    ratingCount === null ? null : clamp((Math.log10(1 + ratingCount) / 4) * 100, 0, 100);
  const salesScore =
    salesVolume === null ? null : clamp((Math.log10(1 + salesVolume) / 5) * 100, 0, 100);
  const socialScores = [ratingScore, reviewScore, salesScore].filter(
    (value): value is number => value !== null,
  );
  const socialProof =
    socialScores.length > 0
      ? socialScores.reduce((sum, value) => sum + value, 0) / socialScores.length
      : 50;

  const text = fold(
    `${product.name ?? ""} ${product.description ?? ""} ${product.targetAudience ?? ""}`,
  );

  const signalsUsed = [
    price !== null ? "fiyat" : "",
    rating !== null ? "puan" : "",
    ratingCount !== null ? "yorum sayısı" : "",
    salesVolume !== null ? "satış hacmi" : "",
    trendScore !== null ? "trend skoru" : "",
    product.competitionLevel ? "rekabet" : "",
  ].filter(Boolean);

  const missingSignals = [
    price === null ? "fiyat" : "",
    rating === null ? "puan" : "",
    ratingCount === null ? "yorum sayısı" : "",
    salesVolume === null ? "satış hacmi" : "",
    trendScore === null ? "trend skoru" : "",
    !product.competitionLevel ? "rekabet" : "",
  ].filter(Boolean);

  return {
    name: product.name,
    priceUsd: price,
    priceKnown: price !== null,
    platformChannel: mapPlatformToChannel(product.platform),
    tags: inferProductTags(product),
    genderBias: inferGenderBias(text),
    ageBias: inferAgeBias(text),
    giftBias: hasWord(text, ["hediye", "gift", "paket", "set"]),
    rating,
    ratingCount,
    salesVolume,
    competitionLevel: product.competitionLevel ?? null,
    trendScore,
    socialProof,
    socialProofMeasured: socialScores.length > 0,
    priceScore: priceScoreFor(price),
    competitionScore: competitionScoreFor(product.competitionLevel),
    signalsUsed,
    missingSignals,
  };
}

function priceFitFor(price: number | null, monthlyIncomeUsd: number): PriceFit {
  if (price === null) return "Fiyat yok";
  const ratio = price / monthlyIncomeUsd;
  if (ratio <= 0.03) return "Rahat";
  if (ratio <= 0.08) return "Zorlanır";
  return "Çok pahalı";
}

function thresholdFor(
  persona: Pick<
    Persona,
    "riskTolerance" | "priceSensitivity" | "adTrust" | "decisionStyle" | "priceFit"
  >,
): number {
  let threshold = 0.3;
  if (persona.riskTolerance === "Düşük") threshold += 0.08;
  if (persona.riskTolerance === "Yüksek") threshold -= 0.08;
  if (persona.priceSensitivity === "Çok yüksek") threshold += 0.06;
  if (persona.priceSensitivity === "Yüksek") threshold += 0.03;
  if (persona.priceSensitivity === "Düşük") threshold -= 0.04;
  if (persona.adTrust === "Reklama kapalı") threshold += 0.05;
  if (persona.adTrust === "Açık") threshold -= 0.03;
  if (persona.decisionStyle === "Şüpheci") threshold += 0.08;
  if (persona.decisionStyle === "Araştırmacı") threshold += 0.03;
  if (persona.decisionStyle === "Hızlı Karar Veren") threshold -= 0.08;
  if (persona.priceFit === "Çok pahalı") threshold += 0.04;
  if (persona.priceFit === "Rahat") threshold -= 0.02;
  return clamp(threshold, 0.16, 0.58);
}

function evaluatePersona(
  base: Omit<Persona, "threshold" | "propensity" | "buy" | "topReason" | "topObjection">,
  product: ProductProfile,
): Persona {
  let score = 50;
  const positive: PersonaFactor[] = [];
  const negative: PersonaFactor[] = [];

  const add = (label: string, delta: number) => {
    score += delta;
    if (delta > 0) positive.push({ label, delta });
    if (delta < 0) negative.push({ label, delta });
  };

  if (product.priceUsd !== null) {
    const ratio = product.priceUsd / base.monthlyIncomeUsd;
    if (ratio <= 0.015) add("Fiyat gelire göre rahat", 10);
    else if (ratio <= 0.03) add("Fiyat bütçeye uygun", 5);
    else if (ratio <= 0.06) add("Fiyat bütçeyi zorluyor", -5);
    else if (ratio <= 0.1) add("Fiyat bütçeye yüksek", -11);
    else add("Fiyat bütçenin çok üstünde", -20);

    if (base.priceSensitivity === "Çok yüksek" && product.priceUsd > 25)
      add("İndirim/kupon bekliyor", -5);
    if (base.priceSensitivity === "Düşük" && product.priceUsd <= 80)
      add("Fiyat esnekliği düşük", 4);
    if (base.decisionStyle === "Fiyat Avcısı" && product.priceUsd <= 30)
      add("Fiyat avcısı için cazip", 5);
  } else {
    add("Fiyat bilgisi yok", -2);
  }

  if (product.rating !== null) {
    if (product.rating >= 4.5) add("Yüksek ürün puanı", 5);
    else if (product.rating < 4) add("Ürün puanı düşük", -6);
  } else {
    add("Puan ölçülmedi", -2);
  }

  if (product.ratingCount !== null) {
    if (product.ratingCount >= 1000) add("Güçlü yorum tabanı", 7);
    else if (product.ratingCount >= 100) add("Yeterli yorum var", 4);
    else if (product.ratingCount < 20) add("Yorum sayısı çok az", -5);
  } else {
    add("Yorum sayısı ölçülmedi", -2);
  }

  if (product.salesVolume !== null) {
    if (product.salesVolume >= 1000) add("Satış geçmişi güçlü", 5);
    else if (product.salesVolume < 50) add("Satış geçmişi zayıf", -4);
  }

  if (product.trendScore !== null) {
    if (product.trendScore >= 65) add("Trend yukarı", 3);
    else if (product.trendScore <= 35) add("Trend aşağı", -3);
  }

  if (product.competitionLevel) {
    if (product.competitionScore >= 70) add("Rekabet görece düşük", 4);
    else if (product.competitionScore <= 35) add("Rekabet çok yoğun", -5);
  }

  if (product.platformChannel !== null) {
    if (product.platformChannel === base.channel)
      add("Ürünü zaten kullandığım kanalda görüyor", 10);
    else add("Farklı kanalda keşfediyor", -2);
  }

  if (product.tags.includes(base.interest)) {
    add(`İlgi alanına uyuyor (${base.interest})`, 14);
  }

  if (product.genderBias !== null) {
    if (product.genderBias === base.gender) add("Hedef kitleyle cinsiyet uyumu", 6);
    else if (base.gender !== "Belirtmedi") add("Cinsiyet uyumsuzluğu", -5);
  }

  if (product.ageBias === "genç" && base.age <= 29) add("Genç hedef kitleyle uyum", 4);
  if (product.ageBias === "ileri yaş" && base.age >= 45) add("İleri yaş hedef kitleyle uyum", 4);
  if (product.ageBias === "genç" && base.age >= 45) add("Yaş aralığı uzak", -3);
  if (product.ageBias === "ileri yaş" && base.age <= 24) add("Yaş aralığı uzak", -3);

  if (product.giftBias && base.occasion === "Hediye") add("Hediye paketi/ürünü", 7);
  if (base.occasion === "Hediye" && product.priceUsd !== null && product.priceUsd <= 80)
    add("Hediye bütçesine uygun", 3);

  switch (base.decisionStyle) {
    case "Fiyat Avcısı":
      if (product.priceUsd !== null && product.priceUsd > 40) add("Daha iyi fiyat arıyor", -3);
      break;
    case "Hızlı Karar Veren":
      if (base.channel === "TikTok" || base.channel === "Instagram")
        add("Kısa videoda hızlı karar", 3);
      if (base.riskTolerance === "Düşük") add("Dürtüsel alıma kapalı", -2);
      break;
    case "Araştırmacı":
      if (product.ratingCount !== null && product.ratingCount >= 200)
        add("Yorumları inceledi, kanıt var", 5);
      else add("Yeterli yorum kanıtı yok", -5);
      if (product.rating !== null && product.rating >= 4.5) add("Puanı yeterli buldu", 3);
      if (product.rating !== null && product.rating < 4) add("Puanı düşük buldu", -4);
      break;
    case "Marka Sadığı":
      add("Markayı tanımıyor", -6);
      break;
    case "Hediye Alıcısı":
      if (product.giftBias) add("Hediye olarak uygun", 5);
      break;
    case "İhtiyaç Odaklı":
      if (!product.tags.includes(base.interest)) add("Somut ihtiyaç bağı zayıf", -3);
      break;
    case "Sosyal Kanıt Takipçisi":
      if (product.socialProofMeasured && product.socialProof >= 65) add("Sosyal kanıt güçlü", 7);
      else if (!product.socialProofMeasured) add("Sosyal kanıt ölçülmedi", -3);
      else if (product.socialProof <= 40) add("Sosyal kanıt zayıf", -5);
      break;
    case "Şüpheci":
      add("Reklam vaatlerine temkinli", -7);
      if (
        product.rating !== null &&
        product.ratingCount !== null &&
        product.rating >= 4.5 &&
        product.ratingCount >= 500
      )
        add("Bağımsız kanıt yeterli", 3);
      else add("Kanıt eşiğini karşılamıyor", -2);
      break;
  }

  if (base.riskTolerance === "Düşük") add("İade/teslimat riski istemiyor", -5);
  if (base.riskTolerance === "Yüksek") add("Yeni ürün denemeye açık", 3);
  if (base.adTrust === "Reklama kapalı") add("Reklama güvenmiyor", -6);
  if (base.adTrust === "Açık") add("Yeni ürünlere açık", 3);
  if (base.sustainability === "Yüksek") {
    add(
      product.tags.includes("Ev & Yaşam")
        ? "Sürdürülebilir/ev odaklı ürün"
        : "Sürdürülebilirlik beklentisi",
      product.tags.includes("Ev & Yaşam") ? 5 : -2,
    );
  }

  const propensity = clamp(0.06 + (score - 50) * 0.0055, 0.01, 0.72);
  const threshold = thresholdFor(base);
  const buy = propensity >= threshold;

  const topReason =
    [...positive].sort((a, b) => b.delta - a.delta)[0]?.label ??
    "Ürünle ilgili yeterli olumlu sinyal yok";
  const topObjection =
    [...negative].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0]?.label ??
    "Karar için yeterli ikna sinyali yok";

  return {
    ...base,
    propensity,
    threshold,
    buy,
    topReason,
    topObjection,
    positive: positive.sort((a, b) => b.delta - a.delta).slice(0, 5),
    negative: negative.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 5),
  };
}

export function generatePersonas(product: MultiCustomerProduct): Persona[] {
  const profile = buildProductProfile(product);
  const random = mulberry32(hashString(`${product.name}|${product.sellingPriceUsd ?? ""}`));
  const ages = fillAges(random);
  const styles = fillBag(DECISION_STYLES, random);
  const incomes = fillBag(INCOME_BANDS, random);
  const channels = fillBag(CHANNELS, random);
  const priceSensitivities = fillBag(PRICE_SENSITIVITIES, random);
  const risks = fillBag(RISK_TOLERANCES, random);
  const trust = fillBag(AD_TRUST, random);
  const occasions = fillBag(OCCASIONS, random);
  const genders = fillBag(GENDERS, random);
  const interests = fillBag(INTERESTS, random);
  const sustainability = fillBag(SUSTAINABILITIES, random);
  const styleNotes = new Map(DECISION_STYLES.map((style) => [style.value, style.note]));
  const monthlyIncome = new Map(INCOME_BANDS.map((band) => [band.value, band.monthlyUsd]));

  return Array.from({ length: PANEL_SIZE }, (_, index) => {
    const style = styles[index];
    const age = ages[index];
    const income = incomes[index];
    const baseIncome = monthlyIncome.get(income) ?? 0;
    const jitter = 0.85 + random() * 0.3;
    const monthlyIncomeUsd = Math.round(baseIncome * jitter);
    const base: Omit<Persona, "threshold" | "propensity" | "buy" | "topReason" | "topObjection"> = {
      id: `MC-${String(index + 1).padStart(4, "0")}`,
      label: `${style} · ${age} yaş · ${income} gelir · #${String(index + 1).padStart(4, "0")}`,
      age,
      ageBand: ageBandOf(age),
      gender: genders[index],
      incomeBand: income,
      monthlyIncomeUsd,
      decisionStyle: style,
      decisionStyleNote: styleNotes.get(style) ?? "",
      channel: channels[index],
      priceSensitivity: priceSensitivities[index],
      riskTolerance: risks[index],
      adTrust: trust[index],
      occasion: occasions[index],
      interest: interests[index],
      sustainability: sustainability[index],
      priceFit: priceFitFor(profile.priceUsd, monthlyIncomeUsd),
      positive: [],
      negative: [],
    };
    return evaluatePersona(base, profile);
  });
}

export function distribution(personas: Persona[], key: DistributionKey): DistributionRow[] {
  const grouped = new Map<string, { total: number; buyers: number }>();
  for (const persona of personas) {
    const label = String(persona[key]);
    const current = grouped.get(label) ?? { total: 0, buyers: 0 };
    current.total += 1;
    if (persona.buy) current.buyers += 1;
    grouped.set(label, current);
  }
  return [...grouped.entries()]
    .map(([label, value]) => ({
      label,
      total: value.total,
      buyers: value.buyers,
      nonBuyers: value.total - value.buyers,
      ratePct: value.total > 0 ? (value.buyers / value.total) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, "tr"));
}

const OBJECTION_FIXES: Array<{ pattern: RegExp; fix: string }> = [
  {
    pattern: /fiyat|bütçe|indirim|kupon/i,
    fix: "Kademeli fiyat, küçük giriş paketi veya süreli indirim test et; fiyatı gelir segmentine göre ayrıştır.",
  },
  {
    pattern: /yorum|puan|sosyal kanıt/i,
    fix: "İlk 20 siparişte fotoğraflı yorum topla; UGC ve gerçek kullanıcı ekran görüntülerini PDP'ye ekle.",
  },
  {
    pattern: /marka|satıcı/i,
    fix: "Kurucu hikâyesi, garanti, iade politikası ve şeffaf iletişimle güveni görünür yap.",
  },
  {
    pattern: /risk|iade|teslimat/i,
    fix: "Teslimat süresi, iade garantisi ve güvenli ödeme bilgisini fiyatın yanında göster.",
  },
  {
    pattern: /reklam|vaat|şüphe/i,
    fix: "Reklam vaadi yerine karşılaştırmalı kanıt, önce/sonra ve bağımsız yorum kullan.",
  },
  {
    pattern: /ihtiyaç|ilgi|bağ/i,
    fix: "Hedef kitleyi daralt; somut problemi gösteren kreatif ve kategori bazlı açılış sayfası kullan.",
  },
  {
    pattern: /kanal|keşif/i,
    fix: "Ürünün keşfedildiği kanalda organik + ücretli içerik testi yap; kanal bazlı teklif ayrıştır.",
  },
  {
    pattern: /yaş|cinsiyet/i,
    fix: "Yaş/cinsiyet uyumsuz segmentleri dışla; kreatif ve mesajı en yüksek dönüşümlü segmente odakla.",
  },
];

function objectionFix(label: string): string {
  return (
    OBJECTION_FIXES.find((item) => item.pattern.test(label))?.fix ??
    "Bu itirazı azaltacak somut bir kanıt veya teklif ekle."
  );
}

function countReasons(personas: Persona[], key: "topReason" | "topObjection"): ReasonCount[] {
  const counts = new Map<string, number>();
  for (const persona of personas) {
    const label = persona[key];
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const total = personas.length || 1;
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count, sharePct: (count / total) * 100 }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "tr"));
}

function diverseExamples(personas: Persona[], buy: boolean, limit = 6): Persona[] {
  const candidates = personas
    .filter((persona) => persona.buy === buy)
    .sort((a, b) => (buy ? b.propensity - a.propensity : a.propensity - b.propensity));
  const seen = new Set<string>();
  const result: Persona[] = [];
  for (const persona of candidates) {
    if (seen.has(persona.decisionStyle)) continue;
    seen.add(persona.decisionStyle);
    result.push(persona);
    if (result.length >= limit) break;
  }
  for (const persona of candidates) {
    if (result.length >= limit) break;
    if (!result.includes(persona)) result.push(persona);
  }
  return result;
}

export function simulateMultiCustomer(product: MultiCustomerProduct): MultiCustomerResult {
  const profile = buildProductProfile(product);
  const personas = generatePersonas(product);
  const buyers = personas.filter((persona) => persona.buy).length;
  const nonBuyers = personas.length - buyers;
  const penetrationPct = (buyers / personas.length) * 100;
  const distributions = Object.fromEntries(
    DISTRIBUTION_DIMENSIONS.map((dimension) => [
      dimension.key,
      distribution(personas, dimension.key),
    ]),
  ) as Record<DistributionKey, DistributionRow[]>;

  const topBuyerSegments = distribution(personas, "decisionStyle")
    .filter((row) => row.total >= 40)
    .sort((a, b) => b.ratePct - a.ratePct || b.buyers - a.buyers)
    .slice(0, 5);
  const topNonBuyerSegments = distribution(personas, "decisionStyle")
    .filter((row) => row.total >= 40)
    .sort((a, b) => b.nonBuyers - a.nonBuyers || a.ratePct - b.ratePct)
    .slice(0, 5);

  const buyerReasons = countReasons(
    personas.filter((persona) => persona.buy),
    "topReason",
  );
  const objections = countReasons(
    personas.filter((persona) => !persona.buy),
    "topObjection",
  );
  const topObjections = objections.slice(0, 5).map((item) => ({
    ...item,
    fix: objectionFix(item.label),
  }));

  const confidencePct = clamp(40 + profile.signalsUsed.length * 7, 40, 82);
  const bestSegment = topBuyerSegments[0];
  const worstSegment = topNonBuyerSegments[0];
  const narrative = [
    `${buyers}/1.000 kişi (%${penetrationPct.toFixed(1)}) bu ürünü satın alırdı; ${nonBuyers} kişi almazdı.`,
    bestSegment
      ? `En açık segment ${bestSegment.label}: ${bestSegment.buyers}/${bestSegment.total} (%${bestSegment.ratePct.toFixed(1)}).`
      : "",
    worstSegment
      ? `En dirençli segment ${worstSegment.label}: ${worstSegment.nonBuyers}/${worstSegment.total} almazdı.`
      : "",
    objections[0] ? `En sık itiraz: “${objections[0].label}”.` : "",
    profile.priceKnown
      ? `Fiyat $${profile.priceUsd?.toFixed(2)} olarak simülasyona girdi.`
      : "Fiyat ölçülmedi; fiyat etkisi nötr kabul edildi ve güven düşük tutuldu.",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    panelSize: personas.length,
    buyers,
    nonBuyers,
    penetrationPct,
    confidencePct,
    product: profile,
    personas,
    distributions,
    topBuyerSegments,
    topNonBuyerSegments,
    topReasons: buyerReasons.slice(0, 5),
    topObjections,
    buyerExamples: diverseExamples(personas, true),
    nonBuyerExamples: diverseExamples(personas, false),
    narrative,
  };
}

export function toMultiCustomerProduct(product: {
  name?: string;
  description?: string;
  selling_price_usd?: string | number | null;
  target_audience?: string;
  platform_fit?: string[] | null;
  measured?: {
    rating?: number | null;
    ratingCount?: number | null;
    salesVolume?: number | null;
  } | null;
  competition_level?: string | null;
  trend_score?: number | null;
  data_sources?: string[] | null;
}): MultiCustomerProduct {
  const parsePrice = (value: string | number | null | undefined): number | null => {
    if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
    if (typeof value !== "string") return null;
    const parsed = Number(value.replace(/[^0-9.]/g, ""));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  return {
    name: product.name?.trim() || "İsimsiz ürün",
    description: product.description ?? "",
    sellingPriceUsd: parsePrice(product.selling_price_usd),
    targetAudience: product.target_audience ?? "",
    platform: product.platform_fit?.[0] ?? "",
    rating: product.measured?.rating ?? null,
    ratingCount: product.measured?.ratingCount ?? null,
    salesVolume: product.measured?.salesVolume ?? null,
    competitionLevel: product.competition_level ?? null,
    trendScore: product.trend_score ?? null,
    source: product.data_sources?.[0],
  };
}
