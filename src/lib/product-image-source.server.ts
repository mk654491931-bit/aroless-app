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

// ============================================================================
// SSRF SAVUNMASI
//
// BULGU: eski koruma yalnız yazılı adres biçimlerini (10.x, 127.x, 169.254.x)
// reddediyordu ve `redirect: "follow"` ile isteği atıyordu. Bu iki açık,
// herkese açık `?u=` ucunu metin tabanlı bir SSRF'e çeviriyordu:
//   • Saldırganın genel bir alan adı, DNS'te 169.254.169.254 / 127.0.0.1'e
//     çözümlenebilir (DNS rebinding) — metin kontrolü bunu görmez.
//   • Genel bir alan adı 302 ile `http://169.254.169.254/latest/meta-data/`
//     adresine yönlendirebilir — `redirect: "follow"` bu atlamayı izler.
//   • `http://2130706433/`, `http://0x7f000001/`, `http://[::ffff:127.0.0.1]/`
//     gibi kodlamalar regex'i atlar.
//   • `:6379`, `:11211` gibi standart dışı portlarla iç servisler denenebilir.
//
// ÇÖZÜM: (1) port 80/443 dışını reddet, (2) tüm IP kodlamalarını normalize et,
// (3) alan adını GERÇEKTEN çözümle ve özel/ayrılmış aralığa düşüyorsa reddet,
// (4) yönlendirmeleri ELLE, her adımı yeniden doğrulayarak izle.
// ============================================================================

/** Yalnız standart web portları: iç servis taramasını (redis, postgres…) keser. */
const ALLOWED_PORTS = new Set(["", "80", "443"]);

/** Yerel/metadata amaçlı alan adları — DNS'e hiç sorulmadan reddedilir. */
const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home.arpa",
  ".lan",
  ".intranet",
];

const BLOCKED_EXACT_HOSTS = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "instance-data",
  "kubernetes.default",
  "kubernetes.default.svc",
]);

/** IPv4 adresi özel/ayrılmış bir aralıkta mı? */
function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return true;
  const octets = parts.map((p) => Number(p));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = octets as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true; // bu ağ / özel / loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // link-local + bulut metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // özel
  if (a === 192 && b === 168) return true; // özel
  if (a === 192 && (b === 0 || b === 2)) return true; // IETF / TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark
  if (a === 198 && b === 51) return true; // TEST-NET-2
  if (a === 203 && b === 0) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast + ayrılmış + broadcast
  return false;
}

/** IPv6 adresi özel/ayrılmış bir aralıkta mı? (IPv4-mapped adresler dahil) */
function isPrivateIpv6(rawHost: string): boolean {
  const host = rawHost.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "::" || host === "::1") return true;
  // IPv4-mapped (::ffff:127.0.0.1) → IPv4 kuralına devret.
  const mapped = /^(?:0*:)*ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
  if (mapped?.[1]) return isPrivateIpv4(mapped[1]);
  if (host.startsWith("::ffff:")) return true; // çözümlenemeyen eşleme → reddet
  if (host.startsWith("fc") || host.startsWith("fd")) return true; // unique local
  if (
    host.startsWith("fe8") ||
    host.startsWith("fe9") ||
    host.startsWith("fea") ||
    host.startsWith("feb")
  )
    return true; // link-local
  if (host.startsWith("ff")) return true; // multicast
  if (host.startsWith("64:ff9b:")) return true; // NAT64 → iç ağa köprü olabilir
  return false;
}

/** Metin biçimindeki IP benzeri host'ları normalize eder. */
function looksLikeNumericHost(host: string): boolean {
  return /^(0x[0-9a-f]+|[0-9]+)$/i.test(host) || /^0[0-7]+(\.[0-7]+){0,3}$/.test(host);
}

/** DNS çözümlemesi özel bir adrese düşüyor mu? Ağ yoksa fail-closed. */
async function resolvesToPrivateAddress(host: string): Promise<boolean> {
  try {
    const { lookup } = await import("node:dns/promises");
    const results = await lookup(host, { all: true, verbatim: true });
    if (!Array.isArray(results) || results.length === 0) return true;
    return results.some((entry) =>
      entry.family === 6 ? isPrivateIpv6(entry.address) : isPrivateIpv4(entry.address),
    );
  } catch {
    // Çözümleme başarısızsa istek zaten yapılamaz; yine de fail-closed kalırız.
    return true;
  }
}

/**
 * Genel erişime açık, güvenli bir http(s) adresi mi?
 *
 * `deep` true ise DNS de çözümlenir (yönlendirme adımlarında her seferinde).
 */
async function isSafeRemoteUrl(
  raw: string,
  options: { resolveDns?: boolean } = {},
): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username || url.password) return false;
  if (!ALLOWED_PORTS.has(url.port)) return false;

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return false;
  if (BLOCKED_EXACT_HOSTS.has(host)) return false;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;
  if (looksLikeNumericHost(host)) return false;

  // IPv6 literal (köşeli parantezli) veya IPv4 literal.
  if (host.includes(":")) {
    if (isPrivateIpv6(host)) return false;
  } else if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    if (isPrivateIpv4(host)) return false;
  }

  if (options.resolveDns === false) return true;
  return !(await resolvesToPrivateAddress(host));
}

/** İzin verilen en fazla yönlendirme sayısı. */
const MAX_REDIRECTS = 3;

/**
 * Yönlendirmeleri ELLE izleyen fetch — her adım yeniden doğrulanır.
 *
 * `redirect: "follow"` kullanılsaydı, genel bir alan adı 302 ile iç adrese
 * (bulut metadata, 127.0.0.1) yönlendirerek tüm kontrolleri atlatırdı.
 */
async function fetchWithGuardedRedirects(
  rawUrl: string,
  init: { headers: Record<string, string>; timeoutMs: number; method?: string },
): Promise<Response | null> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await isSafeRemoteUrl(current))) return null;
    let res: Response;
    try {
      res = await fetch(current, {
        method: init.method ?? "GET",
        headers: init.headers,
        signal: AbortSignal.timeout(init.timeoutMs),
        redirect: "manual",
      });
    } catch {
      return null;
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return null;
      try {
        current = new URL(location, current).toString();
      } catch {
        return null;
      }
      continue;
    }
    return res;
  }
  // Yönlendirme zinciri çok uzun → döngü/kaçış şüphesi.
  return null;
}

/** Ürün sayfasının HTML'ini getirir. Hata fırlatmaz. */
async function fetchProductPage(productUrl: string, countryCode?: string): Promise<string | null> {
  if (!(await isSafeRemoteUrl(productUrl))) return null;
  try {
    const viaProxy = await fetchThroughScraperApi(productUrl, {
      countryCode: countryCode || "us",
      timeoutMs: PAGE_TIMEOUT_MS,
    });
    if (viaProxy) return viaProxy;
  } catch {
    /* proxy düştü → doğrudan kazımaya düş */
  }

  const res = await fetchWithGuardedRedirects(productUrl, {
    headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
    timeoutMs: PAGE_TIMEOUT_MS,
  });
  if (!res || !res.ok) return null;
  const type = res.headers.get("content-type") ?? "";
  if (type && !type.includes("text/html")) return null;
  // Bellek koruması: 2 MB üzeri gövde okunmaz (sıkıştırılmış bomba / dev sayfa).
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > 2_000_000) return null;
  try {
    const body = await res.text();
    return body.length > 2_500_000 ? null : body;
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
  if (!(await isSafeRemoteUrl(imageUrl)))
    return { ok: false, reason: "Görsel adresi genel erişime açık değil." };
  const res = await fetchWithGuardedRedirects(imageUrl, {
    headers: { "user-agent": UA, accept: "image/*" },
    timeoutMs: IMAGE_TIMEOUT_MS,
  });
  if (!res) return { ok: false, reason: "Görsel adresine ulaşılamadı (zaman aşımı / ağ hatası)." };
  if (!res.ok) return { ok: false, reason: `Görsel sunucusu HTTP ${res.status} döndürdü.` };
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  if (type && !type.startsWith("image/")) {
    return { ok: false, reason: `Görsel adresi image/* değil (${type}).` };
  }
  return { ok: true, reason: "Sunucu bu adresi bir görsel olarak servis ediyor." };
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
  if (!(await isSafeRemoteUrl(productUrl))) {
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
