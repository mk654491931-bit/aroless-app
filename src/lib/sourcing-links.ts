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

/** Ürün adı boşsa bağlantı üretilmez; uydurma arama metni yazılmaz. */
export function sourcingSearchLinks(productName: string): SourcingLink[] {
  const name = String(productName ?? "").trim();
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
  const name = String(productName ?? "").trim();
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
