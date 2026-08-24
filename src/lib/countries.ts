// Client-safe target-country catalog used by the finder filters, the search
// payload, the product-card badges, the deep-dive modal and the country karne.

export type TargetCountry = {
  code: string;
  label: string;
  name: string;
  flag: string;
  /** Consumption tax / VAT applied on import + sale, in percent. */
  vat_pct: number;
  vat_label: string;
  currency: string;
  /** 🟢 Kolaylıklar */
  strengths: string[];
  /** 🔴 Zorluklar & engeller */
  challenges: string[];
};

export const TARGET_COUNTRIES: TargetCountry[] = [
  {
    code: "GLOBAL",
    label: "Global / US",
    name: "Global / United States",
    flag: "🌍",
    vat_pct: 0,
    vat_label: "Eyalet bazlı sales tax",
    currency: "USD",
    strengths: [
      "Dünyanın en büyük tüketici pazarı",
      "Yüksek alım gücü",
      "Olgun 3PL / fulfillment altyapısı",
    ],
    challenges: [
      "Çok yüksek reklam maliyeti (CPC)",
      "Doygun rekabet",
      "Eyalet bazlı vergi karmaşası",
    ],
  },
  {
    code: "US",
    label: "United States (US)",
    name: "United States",
    flag: "🇺🇸",
    vat_pct: 0,
    vat_label: "Sales tax (eyalet bazlı, ~%7)",
    currency: "USD",
    strengths: ["Devasa talep hacmi", "Hızlı FBA teslimat ağı", "Yüksek ortalama sepet"],
    challenges: ["Meta/Google CPC çok yüksek", "Marka/IP şikâyetleri sık", "İade oranı yüksek"],
  },
  {
    code: "DE",
    label: "Germany (DE)",
    name: "Germany",
    flag: "🇩🇪",
    vat_pct: 19,
    vat_label: "%19 MwSt",
    currency: "EUR",
    strengths: [
      "Avrupa'nın en büyük e-ticaret pazarı",
      "Yüksek alım gücü",
      "Güçlü DHL/Hermes lojistiği",
    ],
    challenges: [
      "%50'ye varan iade oranları",
      "LUCID & VerpackG ambalaj kaydı zorunlu",
      "OSS/IOSS KDV uyumu",
    ],
  },
  {
    code: "UK",
    label: "United Kingdom (UK)",
    name: "United Kingdom",
    flag: "🇬🇧",
    vat_pct: 20,
    vat_label: "%20 VAT",
    currency: "GBP",
    strengths: [
      "Tek dil, tek vergi rejimi",
      "Yüksek online alışveriş alışkanlığı",
      "Hızlı yerel kargo",
    ],
    challenges: [
      "Brexit sonrası gümrük evrakı",
      "£135 altı için VAT tahsil zorunluluğu",
      "UKCA işaretleme",
    ],
  },
  {
    code: "FR",
    label: "France (FR)",
    name: "France",
    flag: "🇫🇷",
    vat_pct: 20,
    vat_label: "%20 TVA",
    currency: "EUR",
    strengths: ["Büyük ve büyüyen pazar", "Colissimo / Mondial Relay ağı", "Yüksek mobil dönüşüm"],
    challenges: [
      "Fransızca ürün açıklaması zorunlu",
      "AGEC çevre etiketleme",
      "Yerel müşteri desteği beklentisi",
    ],
  },
  {
    code: "CA",
    label: "Canada (CA)",
    name: "Canada",
    flag: "🇨🇦",
    vat_pct: 13,
    vat_label: "GST/HST %5–15",
    currency: "CAD",
    strengths: ["ABD'ye yakın tüketici davranışı", "Daha düşük reklam rekabeti"],
    challenges: ["Geniş coğrafya, pahalı kargo", "Fransızca etiket (Québec)", "Gümrük gecikmeleri"],
  },
  {
    code: "AU",
    label: "Australia (AU)",
    name: "Australia",
    flag: "🇦🇺",
    vat_pct: 10,
    vat_label: "%10 GST",
    currency: "AUD",
    strengths: ["Yüksek alım gücü", "Düşük rekabet", "İngilizce pazar"],
    challenges: [
      "Uzun teslimat süreleri (15–25 gün)",
      "Sıkı biyogüvenlik kuralları",
      "Yüksek kargo maliyeti",
    ],
  },
  {
    code: "TR",
    label: "Türkiye (TR)",
    name: "Türkiye",
    flag: "🇹🇷",
    vat_pct: 20,
    vat_label: "%20 KDV / ETGB",
    currency: "TRY",
    strengths: ["Düşük reklam maliyeti", "Hızlı yerel kargo (1–2 gün)", "Kapıda ödeme kültürü"],
    challenges: [
      "Kur oynaklığı",
      "İhracatta ETGB / mikro ihracat evrakı",
      "Yüksek iade & fiyat hassasiyeti",
    ],
  },
  {
    code: "NL",
    label: "Netherlands (NL)",
    name: "Netherlands",
    flag: "🇳🇱",
    vat_pct: 21,
    vat_label: "%21 BTW",
    currency: "EUR",
    strengths: ["Avrupa dağıtım merkezi", "Yüksek İngilizce seviyesi", "Hızlı PostNL teslimat"],
    challenges: ["Küçük nüfus", "iDEAL ödeme yöntemi beklenir", "Yüksek iade oranı"],
  },
  {
    code: "IT",
    label: "Italy (IT)",
    name: "Italy",
    flag: "🇮🇹",
    vat_pct: 22,
    vat_label: "%22 IVA",
    currency: "EUR",
    strengths: ["Büyüyen e-ticaret hacmi", "Moda/ev kategorilerinde güçlü talep"],
    challenges: [
      "Kapıda ödeme talebi yaygın",
      "Yavaş güney bölgesi lojistiği",
      "İtalyanca destek şart",
    ],
  },
  {
    code: "ES",
    label: "Spain (ES)",
    name: "Spain",
    flag: "🇪🇸",
    vat_pct: 21,
    vat_label: "%21 IVA",
    currency: "EUR",
    strengths: ["Düşük CPC", "Hızlı büyüyen mobil ticaret"],
    challenges: [
      "Daha düşük ortalama sepet",
      "Ada bölgeleri gümrüğü (Kanarya)",
      "İspanyolca içerik gerekli",
    ],
  },
  {
    code: "JP",
    label: "Japan (JP)",
    name: "Japan",
    flag: "🇯🇵",
    vat_pct: 10,
    vat_label: "%10 Consumption Tax",
    currency: "JPY",
    strengths: ["Çok yüksek alım gücü", "Düşük iade oranı", "Kaliteye ödeme isteği"],
    challenges: [
      "Japonca yerelleştirme zorunlu",
      "Aşırı yüksek kalite beklentisi",
      "Yerel temsilci/ithalatçı gereksinimi",
    ],
  },
  {
    code: "AE",
    label: "UAE (AE)",
    name: "United Arab Emirates",
    flag: "🇦🇪",
    vat_pct: 5,
    vat_label: "%5 VAT",
    currency: "AED",
    strengths: ["Düşük vergi", "Yüksek harcama gücü", "Lüks/gadget talebi güçlü"],
    challenges: [
      "Kapıda ödeme oranı yüksek",
      "Arapça içerik avantaj sağlar",
      "Gümrükte ürün sertifikası (ESMA)",
    ],
  },
  {
    code: "SA",
    label: "Saudi Arabia (SA)",
    name: "Saudi Arabia",
    flag: "🇸🇦",
    vat_pct: 15,
    vat_label: "%15 VAT",
    currency: "SAR",
    strengths: ["Hızla büyüyen genç pazar", "Yüksek mobil kullanım"],
    challenges: ["SABER/SASO uygunluk sertifikası", "COD kaynaklı iade riski", "Arapça zorunlu"],
  },
  {
    code: "PL",
    label: "Poland (PL)",
    name: "Poland",
    flag: "🇵🇱",
    vat_pct: 23,
    vat_label: "%23 VAT",
    currency: "PLN",
    strengths: ["Düşük reklam maliyeti", "Allegro üzerinden hızlı erişim", "Hızlı büyüyen pazar"],
    challenges: [
      "Fiyat hassasiyeti yüksek",
      "Paczkomaty teslimat beklentisi",
      "Lehçe içerik gerekli",
    ],
  },
  {
    code: "MX",
    label: "Mexico (MX)",
    name: "Mexico",
    flag: "🇲🇽",
    vat_pct: 16,
    vat_label: "%16 IVA",
    currency: "MXN",
    strengths: ["Latin Amerika'nın en hızlı büyüyen pazarı", "Mercado Libre erişimi"],
    challenges: ["Gümrük gecikmeleri", "Kart dışı ödeme (OXXO) ihtiyacı", "Kargo güvenliği"],
  },
  {
    code: "BR",
    label: "Brazil (BR)",
    name: "Brazil",
    flag: "🇧🇷",
    vat_pct: 17,
    vat_label: "ICMS ~%17 + ithalat vergisi",
    currency: "BRL",
    strengths: ["Devasa nüfus", "Sosyal ticaret çok güçlü"],
    challenges: [
      "Karmaşık ithalat vergileri",
      "Uzun gümrük süreleri",
      "Portekizce + taksitli ödeme beklentisi",
    ],
  },
  {
    code: "IN",
    label: "India (IN)",
    name: "India",
    flag: "🇮🇳",
    vat_pct: 18,
    vat_label: "%18 GST",
    currency: "INR",
    strengths: ["Çok büyük hacim", "Çok düşük CPC"],
    challenges: ["Düşük ortalama sepet", "COD iade oranı yüksek", "Yerel varlık/GST kaydı gerekir"],
  },
  {
    code: "KR",
    label: "South Korea (KR)",
    name: "South Korea",
    flag: "🇰🇷",
    vat_pct: 10,
    vat_label: "%10 VAT",
    currency: "KRW",
    strengths: [
      "Ultra hızlı teslimat kültürü",
      "Yüksek online harcama",
      "Trend ürünlerde hızlı benimseme",
    ],
    challenges: [
      "Korece zorunlu",
      "Yerel platform hâkimiyeti (Coupang/Naver)",
      "KC sertifikasyonu",
    ],
  },
  {
    code: "SE",
    label: "Sweden (SE)",
    name: "Sweden",
    flag: "🇸🇪",
    vat_pct: 25,
    vat_label: "%25 Moms",
    currency: "SEK",
    strengths: ["Yüksek alım gücü", "Kart/Klarna ödeme yaygın", "İngilizce kabul görür"],
    challenges: [
      "%25 ile Avrupa'nın en yüksek KDV'si",
      "Küçük pazar",
      "Sürdürülebilirlik beklentisi",
    ],
  },
  {
    code: "SG",
    label: "Singapore (SG)",
    name: "Singapore",
    flag: "🇸🇬",
    vat_pct: 9,
    vat_label: "%9 GST",
    currency: "SGD",
    strengths: ["Hızlı gümrük", "Yüksek gelir düzeyi", "İngilizce pazar"],
    challenges: [
      "Çok küçük nüfus",
      "Yoğun bölgesel rekabet (Shopee/Lazada)",
      "Yüksek müşteri beklentisi",
    ],
  },
];

export const DEFAULT_TARGET_COUNTRY = "GLOBAL";

export function countryByCode(code: string | undefined): TargetCountry {
  return TARGET_COUNTRIES.find((c) => c.code === (code ?? "").toUpperCase()) ?? TARGET_COUNTRIES[0];
}

export function countryFlag(code: string | undefined): string {
  return countryByCode(code).flag;
}

export function countryName(code: string | undefined): string {
  return countryByCode(code).name;
}

export function countryVat(code: string | undefined): number {
  return countryByCode(code).vat_pct;
}
