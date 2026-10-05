/**
 * PAZARYERİ JSON-LD AYRIŞTIRICI — saf fonksiyonlar (ağ YOK, anahtar YOK).
 *
 * NEDEN AYRI DOSYA: pazaryeri kazımasının riskli kısmı HTML'dir, ağ değil.
 * Ayrıştırıcı saf tutulunca gerçek markup örnekleriyle birim testine girer;
 * kazıma katmanı ince bir ağ çağrısı olarak kalır. Anahtar (ScraperAPI)
 * yalnız ağ katmanında aranır, testler anahtarsız çalışır.
 *
 * NEDEN JSON-LD: pazaryerleri ürün kartlarını kendi iç sınıflarıyla
 * (`product-card`, `prc_...`) sürekli değiştirir; bu testler bir gün
 * kendiliğinden kırılır. `schema.org/Product` ise bir STANDART: isim, fiyat,
 * puan ve yorum sayısı her markette aynı anahtarlarda gelir.
 *
 * DÜRÜSTLÜK KURALI: yalnız JSON-LD'de YAZILI olan sayılar kullanılır.
 * Olmayan alan `null` kalır — puan uydurulmaz, fiyat tahmin edilmez.
 */

/** Ham, kaynak sayfadan çıkmış satır (ağdan bağımsız). */
export type MarketplaceRow = {
  title: string;
  url: string;
  imageUrl: string;
  brand: string;
  /** Sayfanın verdiği fiyat, KENDİ para biriminde. */
  priceLocal: number | null;
  /** Fiyatın para birimi (ISO). Sayfa belirtmiyorsa boş. */
  currency: string;
  /** 0-5 ölçek. */
  rating: number | null;
  ratingCount: number | null;
  inStock: boolean | null;
  seller: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** `ItemList` → ürün dizisi; düz `Product` dizisi ve tek `Product` da kabul. */
function collectProducts(node: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 6) return [];
  if (Array.isArray(node)) return node.flatMap((item) => collectProducts(item, depth + 1));
  const record = asRecord(node);
  if (!record) return [];

  const type = String(record["@type"] ?? "");
  if (type === "Product" || type.includes("Product")) return [record];

  if (type.includes("ItemList")) {
    const list = asRecord(record["itemListElement"]);
    const elements = list?.["itemListElement"];
    if (Array.isArray(elements)) return elements.flatMap((el) => collectProducts(el, depth + 1));
    if (Array.isArray(record["itemListElement"])) {
      return (record["itemListElement"] as unknown[]).flatMap((el) =>
        collectProducts(el, depth + 1),
      );
    }
  }
  // `mainEntity`, `item`, `hasVariant` gibi sarıcıları da gez.
  for (const key of ["mainEntity", "item", "hasVariant", "itemListElement"]) {
    if (record[key] !== undefined) {
      const found = collectProducts(record[key], depth + 1);
      if (found.length) return found;
    }
  }
  return [];
}

/** Fiyatı sayıya çevirir. `1234.56` (kuruş değil, decimal) ya da `"1.234,56 TL"`. */
function parsePrice(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== "string") return null;
  // Türkçe biçim: binlik ayırıcı "." ondalık "," olabilir.
  const cleaned = value
    .replace(/[^\d.,]/g, "")
    .replace(/\.(?=\d{3}\b)/g, "")
    .replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * `offers` tekil ya da dizi olabilir; ilk fiyatlı olanı alır.
 *
 * DÖNÜŞÜM YAPMAZ: fiyat kendi para biriminde (`priceLocal` + `currency`)
 * döner. Kur çevrimi çağırana bırakılmıştır (`fx-rates.server.ts`), çünkü
 * ayrıştırıcı SAF olmalıdır — burada ağ çağrısı olmaz.
 */
function readOffer(record: Record<string, unknown>): {
  price: number | null;
  currency: string;
  inStock: boolean | null;
  seller: string;
} {
  const offersRaw = record["offers"];
  const offers = (Array.isArray(offersRaw) ? offersRaw : [offersRaw])
    .map(asRecord)
    .filter((o): o is Record<string, unknown> => o !== null);
  if (!offers.length) return { price: null, currency: "", inStock: null, seller: "" };

  for (const offer of offers) {
    const spec = asRecord(offer["priceSpecification"]);
    const price =
      parsePrice(offer["price"]) ?? parsePrice(offer["lowPrice"]) ?? parsePrice(spec?.["price"]);
    if (price === null) continue;
    const availability = String(offer["availability"] ?? "").toLowerCase();
    const inStock = availability
      ? availability.includes("instock") || availability.includes("limitedavailability")
        ? true
        : availability.includes("outofstock") || availability.includes("soldout")
          ? false
          : null
      : null;
    const seller = asRecord(offer["seller"])?.["name"];
    const currency =
      firstString(offer, ["priceCurrency", "currency"]) ||
      firstString(spec ?? {}, ["priceCurrency"]);
    return {
      price,
      currency: currency.toUpperCase(),
      inStock,
      seller: typeof seller === "string" ? seller : "",
    };
  }
  return { price: null, currency: "", inStock: null, seller: "" };
}

/**
 * `aggregateRating` → 5'lik puan.
 *
 * DİKKAT: pazaryerleri `ratingValue` alanını 5 ölçekte yazar, AMA bazıları
 * "10 üzerinden" yazar ve bunu `bestRating` ile bildirir. `bestRating`
 * okunur ve puan `5 / bestRating` ile normalize edilir — aksi halde 10'lu
 * sistemde 9,2 puan 5'lik ölçekte "9,2" görünür ve ürün yanlış sıralanır.
 */
function readRating(record: Record<string, unknown>): {
  rating: number | null;
  count: number | null;
} {
  const agg = asRecord(record["aggregateRating"]);
  if (!agg) return { rating: null, count: null };
  const value = Number(agg["ratingValue"]);
  if (!Number.isFinite(value) || value <= 0) return { rating: null, count: null };
  const best = Number(agg["bestRating"] ?? 5);
  const scale = Number.isFinite(best) && best > 0 ? best : 5;
  const rating = Math.round((value / scale) * 5 * 10) / 10;
  const countRaw = Number(agg["ratingCount"] ?? agg["reviewCount"] ?? 0);
  return {
    rating: Math.max(0, Math.min(5, rating)),
    count: Number.isFinite(countRaw) && countRaw > 0 ? Math.round(countRaw) : null,
  };
}

function firstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function firstImage(record: Record<string, unknown>): string {
  const image = record["image"];
  if (typeof image === "string") return image;
  if (Array.isArray(image)) {
    const first = image.find((i) => typeof i === "string" && i);
    return typeof first === "string" ? first : "";
  }
  const obj = asRecord(image);
  const url = obj?.["url"];
  return typeof url === "string" ? url : "";
}

/** `<script type="application/ld+json">` bloklarını ham içerikleriyle döner. */
export function extractJsonLdBlocks(html: string): string[] {
  const out: string[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    const body = (m[1] ?? "").trim();
    if (body) out.push(body);
  }
  return out;
}

/**
 * Bir arama sayfasının HTML'inden ürün satırları çıkarır.
 *
 * @param html kazınan sayfa metni
 * @param limit en fazla kaç satır döneceği
 */
export function parseMarketplaceHtml(html: string, limit = 12): MarketplaceRow[] {
  if (!html) return [];
  const rows: MarketplaceRow[] = [];
  const seen = new Set<string>();

  for (const block of extractJsonLdBlocks(html)) {
    let parsed: unknown;
    try {
      // Pazaryerleri JSON-LD'nin başına/sonuna BOM veya yorum karıştırabiliyor.
      parsed = JSON.parse(block.replace(/^\uFEFF/, ""));
    } catch {
      // Bozuk JSON-LD nadir değildir; sessizce geç, diğer bloklara bak.
      continue;
    }
    for (const product of collectProducts(parsed)) {
      const title = firstString(product, ["name", "title"]);
      if (!title || title.length < 3) continue;
      const key = title.toLowerCase();
      if (seen.has(key)) continue;

      const offer = readOffer(product);
      const { rating, count } = readRating(product);
      // Gürültü kapısı: ne fiyatı ne puanı olan kart kanıt değildir.
      if (offer.price === null && rating === null) continue;

      seen.add(key);
      rows.push({
        title: title.slice(0, 180),
        url: firstString(product, ["url", "@id"]),
        imageUrl: firstImage(product),
        brand:
          firstString(asRecord(product["brand"]) ?? {}, ["name"]) ||
          firstString(product, ["brand"]),
        priceLocal: offer.price,
        currency: offer.currency,
        rating,
        ratingCount: count,
        inStock: offer.inStock,
        seller: offer.seller,
      });
      if (rows.length >= limit) return rows;
    }
  }
  return rows;
}
