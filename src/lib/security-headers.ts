/**
 * Güvenlik başlıkları (tek kaynak).
 *
 * Uygulama sunucusu her yanıta bu başlıkları ekler (bkz. src/server.ts).
 * Amaç: MIME sniffing, clickjacking, gereksiz tarayıcı izinleri ve <base>
 * kaçırma saldırılarını kapatmak. Script/style kaynaklarını kısıtlayan tam bir
 * CSP bilinçli olarak eklenmez — uygulama inline stil ve çok sayıda harici
 * görsel/CDN kullanıyor; agresif bir CSP canlıyı kırar.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "SAMEORIGIN",
  "permissions-policy": "geolocation=(), microphone=(), camera=(), payment=(self)",
  "cross-origin-opener-policy": "same-origin",
  "content-security-policy": "frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
};

/** HSTS yalnızca HTTPS yanıtlarında gönderilir (localhost'u kilitlememek için). */
export const HSTS_VALUE = "max-age=31536000; includeSubDomains";

/**
 * Yanıta güvenlik başlıklarını ekler. Zaten var olan başlıklar (ör. bir
 * proxy/edge tarafından eklenmişse) korunur.
 */
export function applySecurityHeaders(
  response: Response,
  options: { secure?: boolean } = {},
): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  if (options.secure && !headers.has("strict-transport-security")) {
    headers.set("strict-transport-security", HSTS_VALUE);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** İstek şemasından HSTS gerekip gerekmediğini çıkarır. */
export function isSecureRequest(request: Request): boolean {
  try {
    if (new URL(request.url).protocol === "https:") return true;
  } catch {
    /* göreli/bozuk URL — aşağıdaki başlıklara düşer */
  }
  return (request.headers.get("x-forwarded-proto") ?? "").split(",")[0].trim() === "https";
}
