/**
 * Ürün kategorileri — TEK kaynak.
 *
 * NEDEN VAR: Onboarding sihirbazı Türkçe etiketlerle çalışıyordu
 * ("Ev & Yaşam") ama Ürün Bulucu'nun kategori filtresi İngilizce anahtarlar
 * bekliyor ("Home"). Onboarding sonucu bu yüzden arama filtresine hiç
 * oturmuyor, seçim sessizce "Any" oluyordu.
 *
 * KURAL: Buraya yalnızca Ürün Bulucu filtresinin kabul ettiği anahtarlar
 * girer. Görünen etiketler ayrı tutulur (bkz. onboarding-wizard.tsx), böylece
 * saklanan değer her zaman kanonik kalır.
 */
export const PRODUCT_CATEGORIES = [
  "Beauty",
  "Fitness",
  "Home",
  "Tech",
  "Pets",
  "Fashion",
  "Kids",
  "Outdoor",
  "Kitchen",
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export function isProductCategory(value: unknown): value is ProductCategory {
  return typeof value === "string" && (PRODUCT_CATEGORIES as readonly string[]).includes(value);
}

/**
 * DETERMİNİSTİK KATEGORİ TAKSONOMİ EŞLEYİCİ (Google Product Taxonomy tabanlı, $0).
 *
 * NEDEN VAR (denetim + v2 rapor P0):
 *   Adayların büyük kısmında (`tr-reader`, `aliexpress-reader`, `bing-shopping`)
 *   pazaryeri liste sayfası kategori yayınlamadığı için `category` alanı `""`
 *   kalıyordu (ölçüm: 0–4/21).
 *
 * DÜRÜSTLÜK KURALI:
 *   • Kaynağın ya da UPCitemdb kataloğunun verdiği kategori ASLA ezilmez.
 *   • Bu fonksiyon yalnız boş kalan `category` alanını başlık/niş içindeki
 *     somut ürün cinsi kelimelerinden (`air fryer` → `Kitchen > Small Appliances`,
 *     `vitamin c serum` → `Beauty > Skincare`) doldurur.
 *   • Eşleşen hiçbir somut kelime yoksa `""` döner — kategori UYDURULMAZ.
 *   • `category` zaten `EVIDENCE_SLOTS` içinde değildir; yani bu türev alan
 *     `dataCompleteness` puanını ŞİŞİRMEZ, yalnız filtreleme, LLM kısa listesi
 *     ve kart gösterimi için yapısal taksonomi sağlar.
 */
const TAXONOMY_RULES: readonly {
  category: string;
  canonical: ProductCategory;
  keywords: readonly string[];
}[] = [
  {
    category: "Kitchen > Small Appliances",
    canonical: "Kitchen",
    keywords: [
      "air fryer",
      "airfryer",
      "fritöz",
      "fritoz",
      "espresso",
      "coffee maker",
      "kahve makinesi",
      "blender",
      "toaster",
      "tost makinesi",
      "kettle",
      "su ısıtıcı",
      "juicer",
      "miks",
      "stand mixer",
      "waffle",
      "rice cooker",
      "slow cooker",
      "food processor",
      "ice maker",
    ],
  },
  {
    category: "Kitchen > Drinkware & Cookware",
    canonical: "Kitchen",
    keywords: [
      "thermos",
      "termos",
      "tumbler",
      "water bottle",
      "matara",
      "mug",
      "kupa",
      "bardak",
      "frying pan",
      "skillet",
      "tava",
      "tencere",
      "cookware",
      "knife set",
      "bıçak",
      "cutting board",
    ],
  },
  {
    category: "Home > Cleaning & Floor Care",
    canonical: "Home",
    keywords: [
      "robot vacuum",
      "robot süpürge",
      "robot supurge",
      "cordless vacuum",
      "dikey süpürge",
      "steam mop",
      "buharlı temizleyici",
      "carpet cleaner",
      "air purifier",
      "hava temizleyici",
      "humidifier",
      "nemlendirici",
      "dehumidifier",
    ],
  },
  {
    category: "Home > Lighting & Decor",
    canonical: "Home",
    keywords: [
      "desk lamp",
      "masa lambası",
      "masa lambasi",
      "floor lamp",
      "lambader",
      "led strip",
      "şerit led",
      "night light",
      "gece lambası",
      "chandelier",
      "avize",
      "wall sconce",
      "sunset lamp",
      "standing desk",
      "ergonomic chair",
    ],
  },
  {
    category: "Beauty > Skincare & Haircare",
    canonical: "Beauty",
    keywords: [
      "serum",
      "moisturizer",
      "nemlendirici krem",
      "cleanser",
      "sunscreen",
      "güneş kremi",
      "retinol",
      "hyaluronic",
      "niacinamide",
      "face mask",
      "yüz maskesi",
      "eye cream",
      "shampoo",
      "şampuan",
      "sampuan",
      "hair dryer",
      "saç kurutma",
      "hair straightener",
      "curling iron",
      "gua sha",
      "ice roller",
      "epilator",
    ],
  },
  {
    category: "Pets > Cat & Dog Supplies",
    canonical: "Pets",
    keywords: [
      "cat tree",
      "kedi ağacı",
      "scratching",
      "tırmalama",
      "tirmalama",
      "litter box",
      "kedi tuvaleti",
      "dog harness",
      "köpek tasması",
      "kopek tasmasi",
      "pet feeder",
      "mama kabı",
      "water fountain",
      "su pınarı",
      "dog bed",
      "cat bed",
      "aquarium",
      "akvaryum",
    ],
  },
  {
    category: "Fitness > Exercise & Recovery",
    canonical: "Fitness",
    keywords: [
      "yoga mat",
      "yoga matı",
      "pilates",
      "dumbbell",
      "dambıl",
      "kettlebell",
      "resistance band",
      "direnç bandı",
      "massage gun",
      "masaj tabancası",
      "foam roller",
      "treadmill",
      "koşu bandı",
      "walking pad",
      "pull up bar",
      "jump rope",
    ],
  },
  {
    category: "Tech > Consumer Electronics",
    canonical: "Tech",
    keywords: [
      "earbuds",
      "headphones",
      "kulaklık",
      "kulaklik",
      "smartwatch",
      "akıllı saat",
      "akilli saat",
      "power bank",
      "powerbank",
      "wireless charger",
      "kablosuz şarj",
      "bluetooth speaker",
      "hoparlör",
      "mechanical keyboard",
      "gaming mouse",
      "webcam",
      "projector",
      "projeksiyon",
      "dash cam",
      "araç kamerası",
      "mini pc",
      "ssd",
    ],
  },
  {
    category: "Outdoor > Camping & Garden",
    canonical: "Outdoor",
    keywords: [
      "camping tent",
      "kamp çadırı",
      "sleeping bag",
      "uyku tulumu",
      "camping chair",
      "kamp sandalyesi",
      "headlamp",
      "kafa lambası",
      "solar lantern",
      "portable grill",
      "hammock",
      "hamak",
      "hiking backpack",
      "garden hose",
    ],
  },
  {
    category: "Kids > Toys & Baby Gear",
    canonical: "Kids",
    keywords: [
      "baby monitor",
      "bebek telsizi",
      "stroller",
      "bebek arabası",
      "building blocks",
      "educational toy",
      "eğitici oyuncak",
      "plush toy",
      "peluş",
    ],
  },
  {
    category: "Fashion > Apparel & Accessories",
    canonical: "Fashion",
    keywords: [
      "crossbody bag",
      "omuz çantası",
      "backpack",
      "sırt çantası",
      "sunglasses",
      "güneş gözlüğü",
      "sneakers",
      "spor ayakkabı",
      "wallet",
      "cüzdan",
    ],
  },
];

/**
 * Ürün başlığından (ve isteğe bağlı niş metninden) Google Product Taxonomy
 * uyumlu kategori yolu çıkarır. Eşleşme yoksa `""` döner.
 */
export function inferProductCategory(title: string, niche = ""): string {
  const haystack = `${String(title ?? "")} ${String(niche ?? "")}`.toLocaleLowerCase("tr-TR");
  if (!haystack.trim()) return "";
  for (const rule of TAXONOMY_RULES) {
    for (const kw of rule.keywords) {
      if (haystack.includes(kw)) return rule.category;
    }
  }
  return "";
}

