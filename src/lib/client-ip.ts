/**
 * İSTEMCİ IP'Sİ — sahtelenemez çıkarım (tek kaynak).
 *
 * BULGU: eski kod sırayla `cf-connecting-ip` → `x-forwarded-for` (İLK halka) →
 * `x-real-ip` okuyordu. Bu başlıkların hepsi istemci tarafından gönderilebilir:
 *
 *     POST /api/public/tool
 *     X-Forwarded-For: 1.2.3.4
 *
 * Platform (Vercel/Cloudflare) gerçek IP'yi zincirin SONUNA eklediği için
 * saldırgan "ilk halka"yı uydurarak her istekte farklı bir IP gösterebiliyor,
 * yani IP tabanlı tüm hız sınırlarını (kayıt, OTP, AI uçları) atlatabiliyordu.
 * `cf-connecting-ip` ise Cloudflare arkasında olmadığımızda tamamen istemci
 * kontrolündedir.
 *
 * KURAL: yalnız proxy'nin YAZDIĞI değerlere güven ve zincirin en yakın halkasını
 * (son eleman) kullan. Cloudflare başlığına yalnız `cf-ray` de varsa güven —
 * `cf-ray`'i Cloudflare ekler, istemci taklit edemez.
 */

/** Görünen başlık değerini tek satırlık, sınırlı bir anahtara indirger. */
function normalize(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  // IPv6 köşeli parantezini ve yalnız IPv4 için `ip:port` biçimini sadeleştir.
  const withoutBrackets = trimmed.replace(/^\[|\]$/g, "");
  const withPort = /^(.*):(\d{1,5})$/.exec(withoutBrackets);
  const host = withPort?.[1]?.includes(".") ? withPort[1] : withoutBrackets;
  return host.slice(0, 64);
}

/**
 * İsteğin istemci IP'si. Hiçbir güvenilir bilgi yoksa `""` döner; çağıranlar
 * bunu "bilinmiyor" olarak ele almalıdır (tek bir ortak kovaya düşer).
 */
export function clientIpFromHeaders(headers: Headers): string {
  // 1) Vercel'in kendi başlığı: edge tarafından yazılır, istemci ezemez.
  const vercel = headers.get("x-vercel-forwarded-for");
  if (vercel) {
    const first = vercel.split(",")[0] ?? "";
    const value = normalize(first);
    if (value) return value;
  }

  // 2) Cloudflare: yalnız `cf-ray` eşlik ediyorsa güvenilir.
  if (headers.get("cf-ray")) {
    const cf = normalize(headers.get("cf-connecting-ip") ?? "");
    if (cf) return cf;
  }

  // 3) Proxy'nin yazdığı tek adres başlığı.
  const real = normalize(headers.get("x-real-ip") ?? "");
  if (real) return real;

  // 4) X-Forwarded-For: SON halka en yakın proxy'nin gördüğü adrestir.
  //    Saldırgan başa istediğini ekleyebilir, sona ekleyemez.
  const xff = headers.get("x-forwarded-for") ?? "";
  const parts = xff
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length > 0) {
    const value = normalize(parts[parts.length - 1] as string);
    if (value) return value;
  }

  return "";
}
