// ============================================================================
// ÜRÜN GÖRSELİ DOĞRULAMA — saf fonksiyonlar (ağ YOK, anahtar YOK, AI YOK).
//
// NEDEN AYRI DOSYA: görsel hatlının riskli kısmı ağ değil, KARAR kısmıdır.
// "Bu görsel bu ürünün fotoğrafı mı?" sorusu ağdan bağımsızdır; saf tutulunca
// gerçek HTML örnekleriyle birim teste girer. Ağ katmanı ince bir `fetch`
// olarak kalır (`product-image-source.server.ts`).
//
// ANA İLKE (değiştirilemez):
//   HTTP 200 dönen bir görsel ÜRÜN GÖRSELİ sayılmaz. Yalnız ürünün KENDİ
//   sayfasından türeyen ve ürünle ilişkilendirilmiş bir adres kabul edilir.
//   Doğrulanamayan görsel `null` döner — asla başka ürünün, logonun, banner'ın
//   veya arama motorunun döndürdüğü ilk fotoğrafın fotoğrafı gösterilmez.
// ============================================================================

import { extractJsonLdBlocks } from "./marketplace-jsonld";

/* ------------------------------------------------------------- Durumlar */

/**
 * Bir görsel adresinin ürün görseli olarak NEDEN kabul edildiği / reddedildiği.
 *
 * `verified_*` = ürün sayfasından türedi ve kapıları geçti (kullanılabilir).
 * `rejected_*`  = bilinçli olarak elendi (kullanılamaz, sebebi kayıtlı).
 * `unverified_*` = elimizde sayfa/kanıt yok (ağ erişilemedi, URL boş).
 */
export const IMAGE_VALIDATION_STATUSES = [
  "verified_jsonld_product",
  "verified_product_img",
  "verified_og_image",
  "verified_scraped_source",
  "rejected_malformed_url",
  "rejected_non_http",
  "rejected_placeholder_host",
  "rejected_logo_or_asset",
  "rejected_too_small",
  "rejected_tracking_pixel",
  "rejected_duplicate_across_products",
  "rejected_page_asset_mismatch",
  "unverified_no_product_page",
  "unverified_no_image_found",
] as const;
export type ImageValidationStatus = (typeof IMAGE_VALIDATION_STATUSES)[number];

/** Durum bir ürün görseli olarak KULLANILABİLİR mi? */
export function isVerifiedImage(status: ImageValidationStatus): boolean {
  return status.startsWith("verified_");
}

/** Görselin kaynağı (provenance) — "bu adres nereden geldi?" sorusunun cevabı. */
export const IMAGE_SOURCES = [
  "jsonld_product",
  "product_img",
  "og_image",
  "scraped_source",
] as const;
export type ImageSource = (typeof IMAGE_SOURCES)[number];

/** Doğrulanmış görsel kaydı — UI ve veritabanı bu şekli taşır. */
export interface VerifiedProductImage {
  /** Doğrulanmış adres. Doğrulama başarısızsa `null` — asla tahmin edilmez. */
  imageUrl: string | null;
  /** Adres hangi kanıttan türedi. */
  imageSource: ImageSource | null;
  /** Kararın gerekçesi (panelde ve logda görünür). */
  imageValidationStatus: ImageValidationStatus;
  /** Kısa insan-okur gerekçe. */
  reason: string;
}

/** Başarısız sonucun tek üreticisi — `imageUrl` ASLA `null` dışında değer alır. */
export function unverifiedImage(
  status: ImageValidationStatus,
  reason: string,
): VerifiedProductImage {
  return { imageUrl: null, imageSource: null, imageValidationStatus: status, reason };
}

/* ------------------------------------------------------------ Ayarlar */

/**
 * Ürün fotoğrafı için asgari kenar uzunluğu (px).
 *
 * NEDEN 120: bir logonun, ikonun veya sprite parçasının tipik boyutu bunun
 * altındadır. Sayfa `width`/`height` bildirmiyorsa boyut BİLİNMEZ demektir —
 * bilinmeyen boyut reddedilmez, çünkü CDN'ler `srcset` kullanır ve attribute
 * çoğu zaman yoktur; yalnız BİLİNEN ve küçük boyut elenir.
 */
export const MIN_PRODUCT_IMAGE_EDGE = 120;

/* --------------------------------------------- 1. URL yapısal kontrolü */

/** Stok/yer tutucu görsel servisleri — ürün fotoğrafı ASLA olamaz. */
const PLACEHOLDER_HOSTS =
  /(^|\.)(placehold\.co|via\.placeholder\.com|dummyimage\.com|placeholder\.com|placekitten\.com|loremflickr\.com|picsum\.photos|placeimg\.com|fakeimg\.cc|svgplaceholder\.com|placehold\.it|dummyjson\.com)$/i;

/**
 * Logo / ikon / sprite / banner / avatar / tracking deseni.
 *
 * NEDEN YOL DESENİ: pazaryerleri ürün fotoğrafını CDN üzerinde `.../product/
 * main.jpg` gibi tutar, logoyu ise `/assets/logo.svg`, `/static/img/icons/...`
 * gibi TUTAR. Bu yüzden dosya adı + yol birlikte bakılır.
 */
const ASSET_PATH_PATTERN =
  /(^|[/_.:-])(logo|logos|icon|icons|sprite|sprites|favicon|avatar|avatars|banner|banners|hero|header|footer|badge|badges|placeholder|spacer|pixel|tracking|spinner|loader|emoji|brand|watermark|overlay|swatch)([/_.:-]|$)/i;

/** 1×1 izleme pikseli veya şüpheli küçük boyutlu varyant. */
const TRACKING_PIXEL_PATTERN =
  /(^|[/_.:-])(pixel|beacon|track|tracking|collect|analytics)([/_.:-]|\.)/i;

/** Bir adres gerçekten ürün fotoğrafı olabilir mi? (ağ doğrulaması YAPMADAN) */
export function classifyImageUrl(url: unknown): ImageValidationStatus | null {
  const raw = typeof url === "string" ? url.trim() : "";
  if (!raw) return "rejected_malformed_url";
  // `data:` görselleri satır içi dekoratif ikonlardır; ürün fotoğrafı değildir.
  if (/^data:/i.test(raw)) return "rejected_logo_or_asset";
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return "rejected_malformed_url";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "rejected_non_http";
  }
  if (PLACEHOLDER_HOSTS.test(parsed.hostname)) return "rejected_placeholder_host";
  const path = decodeURIComponent(parsed.pathname || "/");
  if (TRACKING_PIXEL_PATTERN.test(path)) return "rejected_tracking_pixel";
  if (ASSET_PATH_PATTERN.test(path)) return "rejected_logo_or_asset";
  return null;
}

/** Görsel adresi taşıma/küçültme parametrelerinden arındırılır. */
export function canonicalImageUrl(url: string, baseUrl?: string): string | null {
  const raw = String(url ?? "").trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = baseUrl ? new URL(raw, baseUrl) : new URL(raw);
  } catch {
    return null;
  }
  parsed.hash = "";
  // CDN'lerin boyut/format parametreleri karşılaştırmayı bozar; aynı görsel
  // `?w=400` ve `?w=1200` ile iki farklı adres gibi görünür ve "kopya" sanılır.
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^(w|width|h|height|size|resize|fit|crop|dpr|quality|q|format|fm)$/i.test(key)) {
      parsed.searchParams.delete(key);
    }
  }
  parsed.search = parsed.searchParams.toString() ? `?${parsed.searchParams.toString()}` : "";
  return parsed.toString();
}

/** İki adres aynı görseli gösteriyor mu (parametre/büyüklük farkı yok sayılır). */
export function isSameImage(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = a ? canonicalImageUrl(a) : null;
  const y = b ? canonicalImageUrl(b) : null;
  return x !== null && y !== null && x === y;
}

/* ------------------------------------- 2. Sayfadaki ürün görselini bulma */

/** `<meta property="og:image" content="…">` ve eşdeğerleri. */
function readOgImage(html: string): string {
  const re =
    /<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const content = /content=["']([^"']+)["']/i.exec(match[0]);
    if (content?.[1]) return content[1].trim();
  }
  return "";
}

/**
 * JSON-LD `Product.image` — EN GÜÇLÜ kanıt.
 *
 * Neden ilk sırada: `schema.org/Product` görseli sayfanın KENDİSİ "bu ürünün
 * fotoğrafı budur" beyanıdır. Arama motoru, kategori veya banner değildir.
 */
function readJsonLdProductImages(html: string): string[] {
  const out: string[] = [];
  for (const block of extractJsonLdBlocks(html)) {
    let parsed: unknown;
    try {
      // Pazaryerleri JSON-LD'nin başına BOM karıştırabiliyor; BOM olmadan JSON.parse
      // patlar ve görsel kaynağı sessizce kaybolur.
      parsed = JSON.parse(block.replace(/^\uFEFF/, ""));
    } catch {
      continue;
    }
    for (const node of collectJsonLdProducts(parsed)) {
      const image = node["image"];
      if (typeof image === "string") out.push(image);
      else if (Array.isArray(image)) {
        for (const entry of image) {
          if (typeof entry === "string") out.push(entry);
          else if (entry && typeof entry === "object") {
            const url = (entry as Record<string, unknown>)["url"];
            if (typeof url === "string") out.push(url);
          }
        }
      } else if (image && typeof image === "object") {
        const url = (image as Record<string, unknown>)["url"];
        if (typeof url === "string") out.push(url);
      }
    }
  }
  return out;
}

function collectJsonLdProducts(node: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 6) return [];
  if (Array.isArray(node)) return node.flatMap((item) => collectJsonLdProducts(item, depth + 1));
  if (!node || typeof node !== "object") return [];
  const record = node as Record<string, unknown>;
  const type = String(record["@type"] ?? "");
  if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) return [record];
  if (type.includes("ItemList")) {
    const elements = record["itemListElement"];
    if (Array.isArray(elements))
      return elements.flatMap((el) => collectJsonLdProducts(el, depth + 1));
  }
  for (const key of ["mainEntity", "item", "hasVariant", "itemListElement", "@graph"]) {
    if (record[key] !== undefined) {
      const found = collectJsonLdProducts(record[key], depth + 1);
      if (found.length) return found;
    }
  }
  return [];
}

/**
 * Sayfadaki GERÇEK `<img>` etiketleri — `class`/`id`/`alt` ipuçlarıyla.
 *
 * NEDEN SINIRLI: bir arama sonuç sayfasında yüzlerce `<img>` vardır ve hepsi
 * ürün değildir. Bu yüzden yalnız (a) ürün konteyneri sınıfları içinde olanlar
 * ve (b) `alt` metni ürün başlığıyla örtüşenler aday sayılır. Kalan hiçbir
 * zaman ürün görseli sayılmaz.
 */
const PRODUCT_CONTAINER_HINT =
  /(product[-_ ]?(image|photo|gallery|media|thumb|picture)|[-_](pdp|detail|main)[-_]?(image|photo|media)|imagegallery|productgallery|carousel[-_]?item|zoom[-_]?image)/i;

function readProductPageImages(html: string, productTitle: string): string[] {
  const out: string[] = [];
  const titleTokens = new Set(
    productTitle
      .toLocaleLowerCase("tr-TR")
      .replace(/[^a-z0-9\s]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 4),
  );
  const imgRe = /<img\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRe.exec(html)) !== null) {
    const tag = match[0];
    // `data-src` / `data-lazy-src`: pazaryerleri görseli JS ile yerleştirir.
    const src =
      /\bsrc=["']([^"']+)["']/i.exec(tag)?.[1] ??
      /\bdata-(?:src|lazy-src|original|zoom-image)=["']([^"']+)["']/i.exec(tag)?.[1] ??
      "";
    if (!src) continue;
    const cls = `${/\bclass=["']([^"']*)["']/i.exec(tag)?.[1] ?? ""} ${
      /\bid=["']([^"']*)["']/i.exec(tag)?.[1] ?? ""
    }`;
    const alt = (/\balt=["']([^"']*)["']/i.exec(tag)?.[1] ?? "").toLocaleLowerCase("tr-TR");
    const containerHit = PRODUCT_CONTAINER_HINT.test(cls);
    // `alt` eşleşmesi: başlığın EN AZ iki belirgin kelimesi alt metninde geçmeli.
    // Tek kelime eşleşmesi çok gevşektir ("USB" her yerde geçer) ve yanlış
    // ürünün fotoğrafını kabul ettirir.
    const altHits = [...titleTokens].filter((token) => alt.includes(token)).length;
    if (containerHit || altHits >= 2) out.push(src);
  }
  return out;
}

/* ------------------------------------------ 3. Kaynak öncelikli çözümleme */

/** Bir ürün sayfasından görsel adaylarını ÖNCELİK sırasıyla üretir. */
export function extractProductImageCandidates(
  html: string,
  options: { productUrl?: string; productTitle?: string } = {},
): Array<{ url: string; source: ImageSource }> {
  const { productUrl, productTitle = "" } = options;
  const seen = new Set<string>();
  const candidates: Array<{ url: string; source: ImageSource }> = [];

  const add = (raw: string, source: ImageSource) => {
    const absolute = canonicalImageUrl(raw, productUrl);
    if (!absolute) return;
    const key = `${source}:${absolute}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ url: absolute, source });
  };

  // 1) JSON-LD Product image — en güçlü kanıt.
  for (const url of readJsonLdProductImages(html)) add(url, "jsonld_product");
  // 2) Ürün sayfasındaki gerçek ürün `<img>` etiketleri.
  for (const url of readProductPageImages(html, productTitle)) add(url, "product_img");
  // 3) og:image — sayfanın kendi paylaşım görseli (genelde ürün fotoğrafıdır).
  const og = readOgImage(html);
  if (og) add(og, "og_image");

  return candidates;
}

const STATUS_BY_SOURCE: Record<ImageSource, ImageValidationStatus> = {
  jsonld_product: "verified_jsonld_product",
  product_img: "verified_product_img",
  og_image: "verified_og_image",
  scraped_source: "verified_scraped_source",
};

/**
 * `<img width height>` ya da CDN adresindeki boyut ipucundan kenar uzunluğu.
 * `null` = boyut BİLİNMIYOR (reddedilmez, yalnız raporlanır).
 */
export function declaredImageEdge(width: unknown, height: unknown): number | null {
  const w = typeof width === "number" ? width : Number(width);
  const h = typeof height === "number" ? height : Number(height);
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return Math.min(w, h);
  return null;
}

/** Bir `<img>` etiketinden görsel + boyut ipucu çıkarır. */
export function readImgTag(html: string, url: string): { width: unknown; height: unknown } | null {
  const target = canonicalImageUrl(url);
  if (!target) return null;
  const imgRe = /<img\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRe.exec(html)) !== null) {
    const tag = match[0];
    const src =
      /\bsrc=["']([^"']+)["']/i.exec(tag)?.[1] ??
      /\bdata-(?:src|lazy-src|original|zoom-image)=["']([^"']+)["']/i.exec(tag)?.[1] ??
      "";
    if (canonicalImageUrl(src) === target) {
      return {
        width: /\bwidth=["']?([\d]+)/i.exec(tag)?.[1],
        height: /\bheight=["']?([\d]+)/i.exec(tag)?.[1],
      };
    }
  }
  return null;
}

/**
 * HAM bir görsel adresini doğrular (ağ YOK).
 *
 * `context.imageUsages`: aynı koşuda bu adresin BAŞKA ürünlerde de
 * görüldüğü kanıtı. Doluysa görsel reddedilir — çünkü "aynı görsel farklı
 * ürünlere ait görünüyor" demektir ve en az biri yanlıştır.
 */
export function validateImageCandidate(
  url: string,
  context: {
    /** Bu adres hangi kanıttan geldi (provenance). */
    source?: ImageSource;
    /** Sayfadaki `<img>` boyut ipucu — küçükse logo/ikon olabilir. */
    declaredEdge?: number | null;
    /** Aynı adresin başka ürünlerde de görülüp görülmediği. */
    sharedWithOtherProducts?: boolean;
  } = {},
): VerifiedProductImage {
  const {
    source = "scraped_source",
    declaredEdge = null,
    sharedWithOtherProducts = false,
  } = context;

  const structural = classifyImageUrl(url);
  if (structural) return unverifiedImage(structural, describeRejection(structural));

  const canonical = canonicalImageUrl(url);
  if (!canonical) return unverifiedImage("rejected_malformed_url", "Adres çözümlenemedi.");

  // Aynı görsel iki farklı ürüne atanmışsa KESİNLİKLE biri yanlıştır; tek bir
  // ürün lehine tahmin etmek uydurmak olurdu, ikisinden de vazgeçeriz.
  if (sharedWithOtherProducts) {
    return unverifiedImage(
      "rejected_duplicate_across_products",
      "Bu görsel aynı koşuda birden fazla üründe görüldü; hangi ürüne ait olduğu belirsiz.",
    );
  }

  if (declaredEdge !== null && declaredEdge < MIN_PRODUCT_IMAGE_EDGE) {
    return unverifiedImage(
      "rejected_too_small",
      `Görsel ${declaredEdge}px — ürün fotoğrafı için çok küçük (logo/ikon olabilir).`,
    );
  }

  return {
    imageUrl: canonical,
    imageSource: source,
    imageValidationStatus: STATUS_BY_SOURCE[source],
    reason: describeSource(source),
  };
}

function describeSource(source: ImageSource): string {
  switch (source) {
    case "jsonld_product":
      return "Ürün sayfasının JSON-LD Product.image beyanı (en güçlü kanıt).";
    case "product_img":
      return "Ürün sayfasındaki ürün konteynerindeki gerçek fotoğraf.";
    case "og_image":
      return "Ürün sayfasının og:image paylaşım görseli.";
    case "scraped_source":
      return "Kaynak scraper'ının ürettiği ve burada doğrulanan görsel.";
  }
}

function describeRejection(status: ImageValidationStatus): string {
  switch (status) {
    case "rejected_malformed_url":
      return "Geçerli bir adres değil.";
    case "rejected_non_http":
      return "Yalnız http/https adresleri kabul edilir.";
    case "rejected_placeholder_host":
      return "Stok/yer tutucu görsel servisi — ürün fotoğrafı olamaz.";
    case "rejected_logo_or_asset":
      return "Logo, ikon, sprite, banner veya dekoratif varlık — ürün fotoğrafı değil.";
    case "rejected_too_small":
      return "Görsel ürün fotoğrafı için çok küçük.";
    case "rejected_tracking_pixel":
      return "İzleme pikseli / analytics görseli.";
    case "rejected_duplicate_across_products":
      return "Aynı görsel birden fazla üründe görüldü.";
    case "rejected_page_asset_mismatch":
      return "Sayfa varlığı ürün görseliyle eşleşmiyor.";
    case "unverified_no_product_page":
      return "Ürün sayfası okunamadı — görsel doğrulanamadı.";
    case "unverified_no_image_found":
      return "Ürün sayfasında doğrulanabilir görsel bulunamadı.";
    default:
      return "Doğrulanamadı.";
  }
}

/**
 * Ürün SAYFASINDAN doğrulanmış görsel çözer — saf (ağ YOK).
 *
 * Sıra: JSON-LD → sayfa `<img>` → og:image. İlk kapıları geçen adres kazanır;
 * hiçbiri geçmezse `imageUrl` `null` döner (uydurma yok).
 */
export function resolveVerifiedImageFromHtml(
  html: string,
  options: {
    productUrl?: string;
    productTitle?: string;
    /** Aynı koşuda bu adreslerin başka ürünlerde de görüldüğü küme. */
    sharedImageUrls?: ReadonlySet<string>;
  } = {},
): VerifiedProductImage {
  const { productUrl, productTitle = "", sharedImageUrls } = options;
  if (!html || !html.trim()) {
    return unverifiedImage("unverified_no_product_page", "Ürün sayfasının HTML'i boş.");
  }
  const candidates = extractProductImageCandidates(html, { productUrl, productTitle });
  if (!candidates.length) {
    return unverifiedImage(
      "unverified_no_image_found",
      "Ürün sayfasında JSON-LD, ürün görseli etiketi veya og:image bulunamadı.",
    );
  }
  let lastReason = "Doğrulanabilir görsel yok.";
  let lastStatus: ImageValidationStatus = "unverified_no_image_found";
  for (const candidate of candidates) {
    const tag = readImgTag(html, candidate.url);
    const edge = declaredImageEdge(tag?.width, tag?.height);
    const result = validateImageCandidate(candidate.url, {
      source: candidate.source,
      declaredEdge: edge,
      sharedWithOtherProducts:
        sharedImageUrls?.has(canonicalImageUrl(candidate.url) ?? "") ?? false,
    });
    if (result.imageUrl) return result;
    // Son reddedilen adresin GEREKÇESİ korunur: "görsel bulunamadı" ile
    // "görsel bulundu ama logo çıktı" aynı şey DEĞİLDİR ve panelde
    // ayrımı görünür olmalıdır.
    lastReason = result.reason;
    lastStatus = result.imageValidationStatus;
  }
  return unverifiedImage(lastStatus, lastReason);
}

/**
 * BİR KOŞUNUN görsellerini çapraz denetler.
 *
 * "Aynı görsel farklı ürünlere ait görünüyorsa bunu tespit et" kuralının
 * uygulaması: girdi haritasında bir adres birden fazla FARKLI üründe geçiyorsa
 * o adres paylaşılan sayılır ve tüm ürünlerde REDDEDİLİR (tahmin edilmez).
 *
 * @returns adres → paylaşılıyor mu
 */
export function findSharedImageUrls(
  byProduct: ReadonlyMap<string, string | null | undefined>,
): Set<string> {
  const owners = new Map<string, Set<string>>();
  for (const [productId, url] of byProduct) {
    const canonical = canonicalImageUrl(url ?? "");
    if (!canonical) continue;
    const set = owners.get(canonical) ?? new Set<string>();
    set.add(productId);
    owners.set(canonical, set);
  }
  const shared = new Set<string>();
  for (const [url, ids] of owners) if (ids.size > 1) shared.add(url);
  return shared;
}
