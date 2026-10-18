// ============================================================================
// eBay BROWSE — UYGULAMA JETONU (client-credentials OAuth).
//
// ÖLÇÜLEN HATA (resmî doküman, 2026-10-18): Browse API **uygulama erişim
// jetonu** ister ve o jeton `client_credentials` akışıyla üretilir
// (`POST https://api.ebay.com/identity/v1/oauth2/token`, Basic auth = Client
// ID + Client Secret). Daha önce kaynak yalnız ELLE alınmış bir Bearer jetonu
// kabul ediyordu; kullanıcı panelde Client ID/Secret girdiğinde ise kaynak
// sessizce hiç çalışmıyordu ("anahtar var ama veri yok").
//
// Ayrıca eBay jetonu ~2 SAAT geçerlidir: elle kopyalanan jeton kısa sürede
// ölür. Bu modül jetonu kendisi alır ve süresi dolmadan yeniler.
//
// DÜRÜSTLÜK:
//   • Kimlik bilgisi yoksa AĞ ÇAĞRISI YAPILMAZ (`""` döner).
//   • Hata `""` olur; kaynak 0 satır döner, hat düşmez.
//   • Hata mesajına jeton/secret YAZILMAZ (yalnız durum kodu).
// ============================================================================

/** eBay Client ID (`EBAY_CLIENT_ID` / `EBAY_APP_ID`). */
export function ebayClientId(env: Record<string, string | undefined> = process.env): string {
  for (const name of ["EBAY_CLIENT_ID", "EBAY_APP_ID"]) {
    const v = (env[name] ?? "").trim();
    if (v) return v;
  }
  return "";
}

/** eBay Client Secret (`EBAY_CLIENT_SECRET` / `EBAY_CERT_ID`). */
export function ebayClientSecret(env: Record<string, string | undefined> = process.env): string {
  for (const name of ["EBAY_CLIENT_SECRET", "EBAY_CERT_ID"]) {
    const v = (env[name] ?? "").trim();
    if (v) return v;
  }
  return "";
}

/** Kullanıcının ELLE verdiği jeton (varsa akış hiç çalışmaz). */
export function ebayStaticToken(env: Record<string, string | undefined> = process.env): string {
  for (const name of ["EBAY_OAUTH_TOKEN", "EBAY_BEARER_TOKEN", "EBAY_ACCESS_TOKEN"]) {
    const v = (env[name] ?? "").trim();
    if (v) return v;
  }
  return "";
}

/** Kimlik bilgisi VAR MI — ön kontrol paneli bunu raporlar. */
export function ebayCredentialsConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (
    Boolean(ebayStaticToken(env)) ||
    (Boolean(ebayClientId(env)) && Boolean(ebayClientSecret(env)))
  );
}

/** Jeton ucu — Sandbox için `EBAY_API_BASE` ile ezilebilir. */
export function ebayTokenUrl(env: Record<string, string | undefined> = process.env): string {
  const base = (env["EBAY_API_BASE"] ?? "").trim().replace(/\/+$/, "");
  return `${base || "https://api.ebay.com"}/identity/v1/oauth2/token`;
}

/** Önbellek: jeton + son kullanma (epoch ms). Modül düzeyinde, süreç başına. */
let cached: { token: string; expiresAt: number } | null = null;

/** Test yardımcısı — önbelleği temizler. */
export function resetEbayTokenCache(): void {
  cached = null;
}

/** Jetonun süresi dolmuş sayıldığı güvenlik payı (60 sn). */
const EXPIRY_SKEW_MS = 60_000;

/**
 * `client_credentials` akışıyla uygulama jetonu alır (önbellekli).
 *
 * @returns Erişim jetonu; kimlik yoksa ya da istek başarısızsa `""`.
 */
export async function ebayAppToken(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<string> {
  const staticToken = ebayStaticToken(env);
  if (staticToken) return staticToken;

  const clientId = ebayClientId(env);
  const clientSecret = ebayClientSecret(env);
  if (!clientId || !clientSecret) return "";

  if (cached && cached.expiresAt > now + EXPIRY_SKEW_MS) return cached.token;

  try {
    const basic = btoa(`${clientId}:${clientSecret}`);
    const res = await fetchImpl(ebayTokenUrl(env), {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${basic}`,
      },
      body: `grant_type=client_credentials&scope=${encodeURIComponent(
        "https://api.ebay.com/oauth/api_scope",
      )}`,
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) {
      // Gövde okunmaz: hata metni kimlik bilgisi içerebilir.
      console.log(`[ebay] jeton alınamadı (HTTP ${res.status})`);
      return "";
    }
    const json = (await res.json().catch(() => null)) as {
      access_token?: unknown;
      expires_in?: unknown;
    } | null;
    const token = String(json?.access_token ?? "").trim();
    if (!token) return "";
    const expiresIn = Number(json?.expires_in);
    const ttlMs = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 7_200_000;
    cached = { token, expiresAt: now + ttlMs };
    return token;
  } catch (e) {
    console.log(`[ebay] jeton isteği başarısız: ${(e as Error).message.slice(0, 80)}`);
    return "";
  }
}
