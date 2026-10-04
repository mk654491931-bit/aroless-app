// ============================================================================
// DOĞRULANMIŞ ÜRÜN GÖRSELİ — ağ katmanı (ince).
//
// Bu dosya YALNIZCA iki iş yapar:
//   1) Ürünün KENDİ sayfasını getirir (`fetchThroughScraperApi` üzerinden,
//      anahtar varsa proxy + anti-bot çözümü sağlanır).
//   2) Saf doğrulayıcıya (`product-image-verification.ts`) verir ve sonucu
//      döner.
//
// ASLA YAPILMAYAN ŞEY: ürün adına görsel ARAMASI yapmak. Ölçülen hata tam
// budur — "LED masa lambası" için Bing/DDG'ye gidilip dönen İLK fotoğraf
// ürünün fotoğrafı sanılıyordu; oysa logo, kategori karosu, banner veya
// BAŞKA bir ürünün fotoğrafı dönüyordu. Arama motoru bir ürünün varlığına
// kanıt DEĞİLDİR; yalnız ürünün kendi sayfası kanıttır.
//
// DOĞRULANAMAZSA `imageUrl = null` DÖNER. Yer tutucu, başka ürünün görseli
// veya "muhtemel fotoğraf" ASLA döndürülmez.
// ============================================================================

import { fetchThroughScraperApi, scraperApiConfigured } from "./product-image.server";
import {
  findSharedImageUrls,
  resolveVerifiedImageFromHtml,
  unverifiedImage,
  validateImageCandidate,
  type ImageValidationStatus,
  type VerifiedProductImage,
} from "./product-image-verification";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

/** Ürün sayfası ve görsel doğrulama için üst süre (ms). Vercel Hobby duvarına takılmamak için kısa. */
const PAGE_TIMEOUT_MS = 12_000;
const IMAGE_TIMEOUT_MS = 6_000;

/** İç ağ / özel adres — public ucun SSRF'e açılmasını engeller. */
function isPublicHttpUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (/^(10\.|127\.|192\.168\.|169\.254\.|0\.)/.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  if (host === "[::1]" || host.startsWith("[fd") || host.startsWith("[fe80")) return false;
  return true;
}

/** Ürün sayfasının HTML'ini getirir. Hata fırlatmaz. */
async function fetchProductPage(productUrl: string, countryCode?: string): Promise<string | null> {
  if (!isPublicHttpUrl(productUrl)) return null;
  try {
    const viaProxy = await fetchThroughScraperApi(productUrl, {
      countryCode: countryCode || "us",
      timeoutMs: PAGE_TIMEOUT_MS,
    });
    if (viaProxy) return viaProxy;
  } catch {
    /* proxy düştü → doğrudan kazımaya düş */
  }
  try {
    const res = await fetch(productUrl, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (type && !type.includes("text/html")) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Görselin HTTP 200 + `image/*` olduğunu DOĞRULAR.
 *
 * NEDEN: "adres geçerli" demek, dosyanın bir görsel olduğunu kanıtlamaz; bir
 * HTML hata sayfası ya da bozuk uç da 200 dönebilir. Bu kontrol YALNIZCA
 * doğrulama içindir — 200 dönmesi tek başına ürün görseli sayılmaz.
 */
async function confirmImageIsServed(imageUrl: string): Promise<{ ok: boolean; reason: string }> {
  if (!isPublicHttpUrl(imageUrl))
    return { ok: false, reason: "Görsel adresi genel erişime açık değil." };
  try {
    const res = await fetch(imageUrl, {
      method: "GET",
      headers: { "user-agent": UA, accept: "image/*" },
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, reason: `Görsel sunucusu HTTP ${res.status} döndürdü.` };
    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    if (type && !type.startsWith("image/")) {
      return { ok: false, reason: `Görsel adresi image/* değil (${type}).` };
    }
    return { ok: true, reason: "Sunucu bu adresi bir görsel olarak servis ediyor." };
  } catch {
    return { ok: false, reason: "Görsel adresine ulaşılamadı (zaman aşımı / ağ hatası)." };
  }
}

/** Skraper kaynağının verdiği ham görsel adresini doğrular. */
export async function verifyScrapedImageUrl(
  imageUrl: string,
  options: { sharedImageUrls?: ReadonlySet<string> } = {},
): Promise<VerifiedProductImage> {
  const structural = validateImageCandidate(imageUrl, {
    source: "scraped_source",
    sharedWithOtherProducts: options.sharedImageUrls?.has(imageUrl) ?? false,
  });
  if (!structural.imageUrl) return structural;
  const confirmed = await confirmImageIsServed(structural.imageUrl);
  if (!confirmed.ok) {
    return unverifiedImage("unverified_no_image_found" as ImageValidationStatus, confirmed.reason);
  }
  return structural;
}

/**
 * TEK bir ürünün görselini ÜRÜN SAYFASINDAN doğrular.
 *
 * @param productUrl ürünün gerçek kaynak adresi (arama sonucu DEĞİL)
 * @param productTitle aday ürün başlığı (sayfadaki `<img alt>` eşleşmesi için)
 */
export async function resolveVerifiedProductImage(
  productUrl: string,
  productTitle = "",
  options: { countryCode?: string; sharedImageUrls?: ReadonlySet<string> } = {},
): Promise<VerifiedProductImage> {
  if (!isPublicHttpUrl(productUrl)) {
    return unverifiedImage(
      "unverified_no_product_page",
      "Ürün adresi geçerli bir genel URL değil.",
    );
  }
  const html = await fetchProductPage(productUrl, options.countryCode);
  if (!html) {
    return unverifiedImage(
      "unverified_no_product_page",
      "Ürün sayfası okunamadı; görsel doğrulanamadı (uydurma görsel gösterilmez).",
    );
  }
  const resolved = resolveVerifiedImageFromHtml(html, {
    productUrl,
    productTitle,
    sharedImageUrls: options.sharedImageUrls,
  });
  if (!resolved.imageUrl) return resolved;
  const confirmed = await confirmImageIsServed(resolved.imageUrl);
  if (!confirmed.ok) {
    return unverifiedImage("unverified_no_image_found", confirmed.reason);
  }
  return resolved;
}

/**
 * BİR KOŞUNUN TÜM ADAYLARINI çapraz denetleyerek doğrulanmış görsel verir.
 *
 * NEDEN TEK TEK ÇÖZMEK YETMEZ: iki farklı ürünün sayfası aynı CDN yolunu
 * (ör. `site.com/static/img/p/1.jpg`) paylaşabilir veya bir kaynak satırın
 * görselini diğerine kopyalayabilir. Bu yüzden önce TÜM adaylar toplanır,
 * paylaşılan adresler bulunur, sonra tek tek doğrulanır. Paylaşılan adres
 * hiçbir ürüne atanmaz.
 */
export async function resolveVerifiedProductImages(
  candidates: readonly { productId: string; productUrl: string; title?: string }[],
  options: { countryCode?: string; limit?: number } = {},
): Promise<{ productId: string; image: VerifiedProductImage }[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 10, candidates.length));
  const slice = candidates.slice(0, limit);
  if (!slice.length) return [];

  const htmlByProduct = await Promise.all(
    slice.map(async (candidate) => ({
      productId: candidate.productId,
      title: candidate.title ?? "",
      html: await fetchProductPage(candidate.productUrl, options.countryCode),
    })),
  );

  // Önce saf çözüm — ağsız. Paylaşılan adres tespiti de burada yapılır.
  const provisional = htmlByProduct.map(({ productId, title, html }) =>
    html
      ? resolveVerifiedImageFromHtml(html, {
          productUrl: slice.find((c) => c.productId === productId)?.productUrl,
          productTitle: title,
        })
      : unverifiedImage("unverified_no_product_page", "Ürün sayfası okunamadı."),
  );

  const shared = findSharedImageUrls(
    new Map(provisional.map((image, i) => [slice[i].productId, image.imageUrl])),
  );

  // Sonra ağ doğrulaması — yalnız paylaşılmayan adaylar için.
  return Promise.all(
    htmlByProduct.map(async ({ productId, title, html }, i) => {
      const image = provisional[i];
      if (!image.imageUrl) return { productId, image };
      if (shared.has(image.imageUrl)) {
        return {
          productId,
          image: unverifiedImage(
            "rejected_duplicate_across_products",
            "Bu görsel aynı koşuda birden fazla üründe görüldü; hangi ürüne ait olduğu belirsiz.",
          ),
        };
      }
      const confirmed = await confirmImageIsServed(image.imageUrl!);
      if (!confirmed.ok) {
        return {
          productId,
          image: unverifiedImage("unverified_no_image_found", confirmed.reason),
        };
      }
      void html;
      void title;
      return { productId, image };
    }),
  );
}

/** Tanı yolunda proxy anahtarı var mı (panelde teşhis için). */
export const verifiedImageProxyConfigured = scraperApiConfigured;
