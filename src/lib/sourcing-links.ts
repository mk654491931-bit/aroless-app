/**
 * TEDARİK / PAZARYERİ ARAMA BAĞLANTILARI — saf, ağsız yardımcı.
 *
 * NEDEN VAR: canlı toptan kaynakta birebir teklif eşleşmediğinde kart ve derin
 * analiz yalnız "eşleşmedi" deyip kullanıcıyı boş bırakıyordu. Buradaki
 * bağlantılar bir VERİ İDDİASI değildir; ürün adıyla yapılmış arama
 * sayfasıdır. Kullanıcı fiyat/MOQ/teslimatı kendi gözüyle doğrular, biz de
 * ölçülmemiş tedarik fiyatını 0 veya tahmin olarak göstermeyiz.
 */

export type SourcingLink = {
  label: string;
  url: string;
  /** Bu bağlantının ne için kullanılacağı (toptan/perakende). */
  note: string;
};

/**
 * Pazaryeri başlıklarındaki DOLGU sözcükleri.
 *
 * NEDEN: Hepsiburada/AliExpress başlıkları "Pratik ve Şık …", "Premium
 * Quality …" gibi pazarlama sıfatlarıyla dolu. Bu sözcükler arama sonucunu
 * daraltmaz, aksine alakasız sonuç getirir. Ürünün kimliğini değiştiren
 * sözcükler (portable, universal, set, model numarası) KORUNUR.
 */
const MARKETING_WORDS = new Set([
  "pratik",
  "sik",
  "kompakt",
  "kullanisli",
  "kaliteli",
  "premium",
  "quality",
  "luks",
  "luxury",
  "modern",
  "yeni",
  "new",
  "orijinal",
  "original",
  "harika",
  "mukemmel",
  "perfect",
  "amazing",
  "best",
]);

/** Aramada anlam taşımayan bağlaçlar. */
const STOP_WORDS = new Set(["ve", "ile", "icin", "and", "with", "for", "the", "of"]);

/** Karşılaştırma için Türkçe küçük harfe indirir ve aksanları sadeleştirir. */
const normToken = (token: string) =>
  token
    .toLocaleLowerCase("tr-TR")
    .replace(/[ıİ]/g, "i")
    .replace(/[şŞ]/g, "s")
    .replace(/[ğĞ]/g, "g")
    .replace(/[çÇ]/g, "c")
    .replace(/[öÖ]/g, "o")
    .replace(/[üÜ]/g, "u")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");

function slug(value: string): string {
  return String(value ?? "")
    .replace(/[ıİ]/g, "i")
    .replace(/[şŞ]/g, "s")
    .replace(/[ğĞ]/g, "g")
    .replace(/[çÇ]/g, "c")
    .replace(/[öÖ]/g, "o")
    .replace(/[üÜ]/g, "u")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

/**
 * Ürün başlığını ARANABİLİR bir sorguya indirger.
 *
 * Kural: ilk virgülle ayrılmış ifade = marka + ürün türü. Parantez içi
 * (ölçü/varyant) atılır, pazarlama sıfatları ve bağlaçlar çıkarılır; ilk
 * 8 anlamlı kelime korunur. Hiçbir zaman uydurma kelime EKLENMEZ.
 *
 * Örnek: "Empresso Pratik ve Şık Seyahat Makyaj Organizeri, Oval …"
 *      → "Empresso Seyahat Makyaj Organizeri"
 */
export function productSearchQuery(productName: string): string {
  const raw = String(productName ?? "").trim();
  if (!raw) return "";
  const firstPhrase = raw
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .split(/[,;|•]/)[0]
    .replace(/\s+/g, " ")
    .trim();
  if (!firstPhrase) return "";

  const tokens = firstPhrase.split(" ").filter(Boolean);
  const meaningful = tokens.filter((token) => {
    const n = normToken(token.replace(/[.,!?]+$/g, ""));
    return n && !MARKETING_WORDS.has(n) && !STOP_WORDS.has(n);
  });
  // Aşırı sadeleştirme ürünü kaybettirebilir: en az 2 kelime kalmazsa ilk
  // ifadeyi olduğu gibi kullan (yine de uydurma kelime yok).
  const base = meaningful.length >= 2 ? meaningful : tokens;
  const capped = base.slice(0, 8);
  let query = capped.join(" ").trim();
  // URL'lerde taşınabilir kalsın; kelimeyi ortadan kesmek yerine sondan at.
  while (query.length > 80 && capped.length > 1) {
    capped.pop();
    query = capped.join(" ").trim();
  }
  return query.slice(0, 90).trim();
}

/** Ürün adı boşsa bağlantı üretilmez; uydurma arama metni yazılmaz. */
export function sourcingSearchLinks(productName: string): SourcingLink[] {
  const name = productSearchQuery(productName);
  if (!name) return [];
  const s = slug(name);
  if (!s) return [];
  const query = encodeURIComponent(name);
  return [
    {
      label: "AliExpress",
      url: `https://www.aliexpress.com/w/wholesale-${encodeURIComponent(s)}.html`,
      note: "Perakende/toptan teklif",
    },
    {
      label: "Alibaba",
      url: `https://www.alibaba.com/trade/search?SearchText=${query}`,
      note: "Toptan üretici",
    },
    {
      label: "Made-in-China",
      url: `https://www.made-in-china.com/products-search/hot-china-products/${encodeURIComponent(
        s.replace(/-/g, "_"),
      )}.html`,
      note: "Üretici / fabrika",
    },
  ];
}

/**
 * Ölçülen tek ilanın yanında diğer pazaryerlerini karşılaştırma bağlantısı.
 * Yine fiyat ÜRETMEZ; yalnız kullanıcının aynı ürünü başka yerde aramasını
 * sağlar. Kart, ölçülmüş fiyatı ayrı satırda gösterir.
 */
export function marketplaceSearchLinks(productName: string): SourcingLink[] {
  const name = productSearchQuery(productName);
  if (!name) return [];
  const query = encodeURIComponent(name);
  return [
    {
      label: "Amazon",
      url: `https://www.amazon.com.tr/s?k=${query}`,
      note: "Perakende fiyat",
    },
    {
      label: "Trendyol",
      url: `https://www.trendyol.com/sr?q=${query}`,
      note: "Perakende fiyat",
    },
    {
      label: "Hepsiburada",
      url: `https://www.hepsiburada.com/ara?q=${query}`,
      note: "Perakende fiyat",
    },
  ];
}
