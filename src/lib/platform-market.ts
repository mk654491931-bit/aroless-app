// ============================================================================
// Platform ↔ ülke uygunluk haritası.
// İstemci güvenli, saf veri: hangi platform hangi ülkede gerçekten satış
// yapılabiliyor, o ülkedeki komisyon aralığı, tipik teslimat süresi ve ödeme
// alışkanlığı. Ürün bulucu hem arayüzde uyarı vermek hem de istemi ve elemeyi
// ülkeye/platforma göre sıkılaştırmak için kullanır.
// ============================================================================
import type { Platform } from "@/lib/gemini.functions";
import { countryByCode } from "@/lib/countries";

export type CountryFit = "native" | "cross-border" | "unavailable";

type PlatformMarket = {
  /** Platformun yerel (native) satıcı programı olan ülkeler. */
  native: string[];
  /** Yerel programı olmasa da bu ülkelere sınır ötesi satış yapılabiliyor. */
  crossBorder?: string[];
  /** Her ülkede geçerli mi (Shopify/WooCommerce gibi kendi mağazan). */
  global?: boolean;
  /** Tipik referans/komisyon aralığı, %. */
  commission: [number, number];
  /** Yerel pazarda tipik teslimat süresi (gün). */
  nativeShipDays: [number, number];
  /** Ülke bağımsız notlar (ödeme, kargo, uyum). */
  note: string;
  /** Komisyon kaynağı. */
  source?: string;
};

const EU = ["DE", "FR", "IT", "ES", "NL", "SE", "PL"];

export const PLATFORM_MARKETS: Record<Platform, PlatformMarket> = {
  Amazon: {
    native: [
      "GLOBAL",
      "US",
      "UK",
      "DE",
      "FR",
      "IT",
      "ES",
      "NL",
      "SE",
      "PL",
      "CA",
      "AU",
      "JP",
      "AE",
      "SA",
      "MX",
      "BR",
      "IN",
      "SG",
      "TR",
    ],
    commission: [8, 15],
    nativeShipDays: [1, 3],
    note: "FBA ile 1-2 gün teslimat; marka/IP şikâyetleri ve kategori onayı sık.",
    source: "Amazon Seller Central – Referral fees",
  },
  eBay: {
    native: ["GLOBAL", "US", "UK", "DE", "FR", "IT", "ES", "NL", "AU", "CA"],
    crossBorder: ["PL", "SE", "AE", "MX", "BR", "IN", "SG", "JP", "TR"],
    commission: [10, 13],
    nativeShipDays: [3, 8],
    note: "Sınır ötesi satışa açık, ikinci el/yedek parça talebi güçlü.",
    source: "eBay – Selling fees",
  },
  AliExpress: {
    native: ["GLOBAL", "US", "ES", "FR", "BR", "PL", "KR", "SA", "AE", "MX", "IT", "NL", "TR"],
    crossBorder: ["UK", "DE", "SE", "CA", "AU", "SG", "IN", "JP"],
    commission: [5, 8],
    nativeShipDays: [7, 20],
    note: "Daha çok tedarik kanalı; satıcı tarafında düşük fiyat rekabeti sert.",
  },
  Walmart: {
    native: ["US", "GLOBAL", "MX", "CA"],
    commission: [6, 15],
    nativeShipDays: [2, 5],
    note: "Sadece ABD/Meksika/Kanada; satıcı onayı (US business entity) gerekir.",
    source: "Walmart Marketplace – Referral fees",
  },
  Etsy: {
    native: ["GLOBAL", "US", "UK", "CA", "AU", "DE", "FR", "NL", "ES", "IT", "SE", "PL"],
    crossBorder: ["JP", "SG", "AE", "MX", "BR", "TR"],
    commission: [6.5, 9],
    nativeShipDays: [3, 10],
    note: "El yapımı/kişiselleştirilmiş ürün zorunluluğu; jenerik dropshipping yasak.",
    source: "Etsy – Fees & payments policy",
  },
  Shopify: {
    native: [],
    global: true,
    commission: [2.9, 3.5],
    nativeShipDays: [3, 12],
    note: "Kendi mağazan: her ülkede kurulabilir, trafiği reklamla sen üretirsin.",
  },
  WooCommerce: {
    native: [],
    global: true,
    commission: [2.9, 3.4],
    nativeShipDays: [3, 12],
    note: "Self-hosted mağaza: komisyon yok, sadece ödeme işlem ücreti.",
  },
  Rakuten: {
    native: ["JP"],
    crossBorder: ["GLOBAL", "US", "FR"],
    commission: [8, 13],
    nativeShipDays: [1, 4],
    note: "Japonya odaklı; Japonca listeleme ve yerel iade adresi şart.",
  },
  Zalando: {
    native: ["DE", "NL", "FR", "IT", "ES", "SE", "PL"],
    commission: [5, 25],
    nativeShipDays: [2, 5],
    note: "Sadece moda/ayakkabı/aksesuar; Avrupa'da yüksek iade oranı (%40+).",
  },
  "Mercado Libre": {
    native: ["MX", "BR"],
    commission: [11, 20],
    nativeShipDays: [2, 8],
    note: "LATAM lideri; Mercado Envios ve yerel vergi kaydı gerekir.",
  },
  Shopee: {
    native: ["SG"],
    crossBorder: ["BR", "MX"],
    commission: [5, 12],
    nativeShipDays: [2, 7],
    note: "Güneydoğu Asya + Brezilya; fiyat hassasiyeti çok yüksek.",
  },
  Lazada: {
    native: ["SG"],
    commission: [3, 8],
    nativeShipDays: [3, 8],
    note: "Güneydoğu Asya pazarı; Avrupa/ABD hedefi için uygun değil.",
  },
  Temu: {
    native: [
      "GLOBAL",
      "US",
      "UK",
      "DE",
      "FR",
      "IT",
      "ES",
      "NL",
      "PL",
      "SE",
      "CA",
      "AU",
      "MX",
      "BR",
      "JP",
      "KR",
      "SA",
      "AE",
    ],
    commission: [5, 10],
    nativeShipDays: [5, 15],
    note: "Ultra fiyat rekabeti; marj çok ince, farklılaşma zor.",
  },
  Shein: {
    native: [
      "GLOBAL",
      "US",
      "UK",
      "DE",
      "FR",
      "IT",
      "ES",
      "NL",
      "PL",
      "SE",
      "MX",
      "BR",
      "SA",
      "AE",
      "TR",
    ],
    commission: [5, 15],
    nativeShipDays: [6, 15],
    note: "Moda/aksesuar ağırlıklı; hızlı trend döngüsü.",
  },
  Ozon: {
    native: [],
    crossBorder: [],
    commission: [5, 20],
    nativeShipDays: [2, 7],
    note: "Rusya pazarı; listedeki hedef ülkeler için satış kanalı değil.",
  },
  "JD.com": {
    native: [],
    crossBorder: [],
    commission: [2, 10],
    nativeShipDays: [1, 4],
    note: "Çin iç pazarı; yerel tüzel kişilik zorunlu.",
  },
  Taobao: {
    native: [],
    crossBorder: [],
    commission: [0, 5],
    nativeShipDays: [1, 5],
    note: "Çin iç pazarı / tedarik kanalı.",
  },
  Tmall: {
    native: [],
    crossBorder: [],
    commission: [2, 8],
    nativeShipDays: [1, 4],
    note: "Çin iç pazarı; marka belgesi ve depozito gerekir.",
  },
  Pinduoduo: {
    native: [],
    crossBorder: [],
    commission: [0, 3],
    nativeShipDays: [2, 6],
    note: "Çin iç pazarı.",
  },
  "TikTok Shop": {
    native: ["GLOBAL", "US", "UK", "ES", "IT", "FR", "DE", "SG", "MX", "BR", "JP"],
    crossBorder: ["NL", "SE", "PL", "CA", "AU", "AE", "SA"],
    commission: [5, 8],
    nativeShipDays: [2, 7],
    note: "Viral video → satış; ülkede TikTok Shop açık değilse organik satış yok.",
  },
  Trendyol: {
    native: ["TR"],
    crossBorder: ["DE", "NL", "PL", "AE", "SA"],
    commission: [12, 22],
    nativeShipDays: [1, 3],
    note: "Türkiye pazarı; TR dışı için sadece sınır ötesi program (TGO).",
  },
  Hepsiburada: {
    native: ["TR"],
    commission: [9, 20],
    nativeShipDays: [1, 3],
    note: "Sadece Türkiye; TR vergi mükellefiyeti şart.",
  },
};

/** Bir platformun hedef ülkedeki durumu. */
export function countryFit(platform: Platform, code: string | undefined): CountryFit {
  const c = (code ?? "GLOBAL").toUpperCase();
  const m = PLATFORM_MARKETS[platform];
  if (!m) return "cross-border";
  if (m.global) return "native";
  if (m.native.includes(c)) return "native";
  if ((m.crossBorder ?? []).includes(c)) return "cross-border";
  return "unavailable";
}

export function fitLabel(fit: CountryFit): string {
  return fit === "native"
    ? "Yerel pazar"
    : fit === "cross-border"
      ? "Sınır ötesi"
      : "Bu ülkede kullanılamıyor";
}

/** Hedef ülkede yerel olarak çalışan platformlar (öneri listesi). */
export function platformsForCountry(code: string | undefined): Platform[] {
  return (Object.keys(PLATFORM_MARKETS) as Platform[]).filter(
    (p) => countryFit(p, code) === "native",
  );
}

/** Ülke için önerilen küçük ve gerçekçi başlangıç seti. */
export function recommendedPlatforms(code: string | undefined): Platform[] {
  const c = (code ?? "GLOBAL").toUpperCase();
  const priority: Platform[] =
    c === "TR"
      ? ["Trendyol", "Hepsiburada", "Amazon", "Shopify"]
      : c === "JP"
        ? ["Amazon", "Rakuten", "Shopify"]
        : c === "MX" || c === "BR"
          ? ["Mercado Libre", "Amazon", "Shopify", "TikTok Shop"]
          : c === "SG"
            ? ["Shopee", "Lazada", "Amazon", "Shopify"]
            : c === "IN"
              ? ["Amazon", "Shopify"]
              : EU.includes(c) || c === "UK"
                ? ["Amazon", "eBay", "Etsy", "Shopify", "TikTok Shop"]
                : ["Amazon", "Shopify", "TikTok Shop", "eBay"];
  const native = platformsForCountry(c);
  const picks = priority.filter((p) => native.includes(p));
  return picks.length ? picks.slice(0, 5) : native.slice(0, 4);
}

/** Ülke + platform komisyon aralığı (yerel değilse sınır ötesi ek maliyet payı). */
export function commissionRange(platform: Platform, code: string | undefined): [number, number] {
  const m = PLATFORM_MARKETS[platform];
  if (!m) return [10, 15];
  const fit = countryFit(platform, code);
  if (fit === "cross-border") return [m.commission[0] + 2, m.commission[1] + 3];
  return m.commission;
}

export function shipDays(platform: Platform, code: string | undefined): [number, number] {
  const m = PLATFORM_MARKETS[platform];
  if (!m) return [5, 12];
  const fit = countryFit(platform, code);
  if (fit === "cross-border") return [m.nativeShipDays[0] + 7, m.nativeShipDays[1] + 12];
  return m.nativeShipDays;
}

/** İsteme gömülecek, ülke + seçili platform gerçeklerini anlatan blok. */
export function marketBriefBlock(platforms: Platform[], code: string | undefined): string {
  const country = countryByCode(code);
  const lines = platforms.map((p) => {
    const fit = countryFit(p, code);
    const [lo, hi] = commissionRange(p, code);
    const [d1, d2] = shipDays(p, code);
    const m = PLATFORM_MARKETS[p];
    return `  • ${p}: ${fitLabel(fit)} · komisyon %${lo}-%${hi} · teslimat ${d1}-${d2} gün · ${m?.note ?? ""}`;
  });
  const blocked = platforms.filter((p) => countryFit(p, code) === "unavailable");
  return [
    `TARGET MARKET (mandatory): ${country.name} (${country.code}) · currency ${country.currency} · tax ${country.vat_label} (${country.vat_pct}%)`,
    `Market advantages: ${country.strengths.join("; ")}`,
    `Market obstacles you MUST respect: ${country.challenges.join("; ")}`,
    `Selected sales channels in this country:`,
    ...lines,
    blocked.length
      ? `WARNING: ${blocked.join(", ")} cannot be used to sell in ${country.name}. Do not build the strategy around them; recommend a working channel instead and say so in platform_strategy.`
      : "",
    `HARD RULES:`,
    `- Demand evidence (search interest, best-seller ranks, viral posts) must come from the ${country.name} market, not a generic global average.`,
    `- Prices must be realistic for ${country.name} shoppers and quoted in ${country.currency} (keep a USD figure in parentheses when the currency is not USD).`,
    `- Apply the real commission range above for the top channel in cost_breakdown, plus ${country.vat_pct}% ${country.vat_label} and local last-mile shipping.`,
    `- Drop any product that is blocked, restricted or needs certification that a small seller cannot obtain in ${country.name} (e.g. certification, customs or packaging-registration barriers listed above). If you keep it, state the barrier explicitly in risks.`,
    `- platform_fit must only contain channels that actually work in ${country.name}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Ülkeye özel arama açıları (yerel trend + yerel platform çok satanları). */
export function countryAngles(code: string | undefined, platforms: Platform[]): string[] {
  const country = countryByCode(code);
  const local = platforms.filter((p) => countryFit(p, code) === "native").slice(0, 2);
  const channel = local[0] ?? platforms[0] ?? "Amazon";
  return [
    `Local trend: products whose search interest is rising specifically in ${country.name} right now (local-language keywords included).`,
    `Local best-sellers: products currently climbing the ${channel} ${country.name} best-seller / trending lists.`,
  ];
}
