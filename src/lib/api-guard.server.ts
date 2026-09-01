/**
 * Herkese açık HTTP uçları için ortak koruma katmanı.
 *
 * - `requireUser`: Authorization: Bearer <supabase access token> doğrular.
 * - `rateLimit`: kullanıcı/IP başına kalıcı (veritabanı tabanlı) istek sınırı.
 * - `jsonError`: iç hata detaylarını sızdırmadan hata döndürür.
 */

export type GuardResult = { userId: string } | { response: Response };

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Kullanıcıya ham hata metni dönmeden hata yanıtı üretir. */
export function jsonError(status: number, message: string, internal?: unknown): Response {
  if (internal) console.error(`[api] ${message}`, internal);
  return json(status, { error: message });
}

/** İstemci IP'si (Cloudflare / proxy başlıkları). */
export function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    (request.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ||
    "unknown"
  );
}

/** Basit hash — IP'yi düz metin saklamamak için. */
export async function hashValue(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

/**
 * Oturum zorunlu uçlar için: geçerli bir Supabase erişim jetonu ister.
 * Başarılıysa kullanıcı kimliğini, değilse hazır 401 yanıtını döndürür.
 */
export async function requireUser(request: Request): Promise<GuardResult> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || token.split(".").length !== 3) {
    return { response: json(401, { error: "Bu işlem için giriş yapmalısınız." }) };
  }

  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) return { response: json(500, { error: "Sunucu yapılandırması eksik." }) };

  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok)
      return { response: json(401, { error: "Oturumunuz geçersiz, tekrar giriş yapın." }) };
    const user = (await res.json()) as { id?: string };
    if (!user?.id)
      return { response: json(401, { error: "Oturumunuz geçersiz, tekrar giriş yapın." }) };
    return { userId: user.id };
  } catch (e) {
    return { response: jsonError(401, "Oturum doğrulanamadı.", e) };
  }
}

/**
 * Kalıcı istek sınırı. Sınır aşıldıysa 429 yanıtı döner, aksi halde null.
 * Veritabanına ulaşılamazsa isteği engellemez (kullanılabilirlik önceliği).
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<Response | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("bump_rate_limit", {
      _bucket: key,
      _limit: limit,
      _window_seconds: windowSeconds,
    });
    if (error) {
      console.error("[rate-limit] rpc failed", error.message);
      return null;
    }
    if (data === false) {
      return new Response(
        JSON.stringify({
          error: "Çok fazla istek gönderdiniz. Lütfen biraz sonra tekrar deneyin.",
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(windowSeconds),
            "Cache-Control": "no-store",
          },
        },
      );
    }
    return null;
  } catch (e) {
    console.error("[rate-limit] failed", e);
    return null;
  }
}

/** Oturum + istek sınırı birlikte. */
export async function guardAuthed(
  request: Request,
  bucket: string,
  limit = 30,
  windowSeconds = 60,
): Promise<{ userId: string } | { response: Response }> {
  const auth = await requireUser(request);
  if ("response" in auth) return auth;
  const limited = await rateLimit(`${bucket}:u:${auth.userId}`, limit, windowSeconds);
  if (limited) return { response: limited };
  return { userId: auth.userId };
}

/** Yalnızca IP tabanlı istek sınırı (herkese açık kalması gereken uçlar). */
export async function guardPublic(
  request: Request,
  bucket: string,
  limit = 60,
  windowSeconds = 60,
): Promise<Response | null> {
  const ip = await hashValue(clientIp(request));
  return rateLimit(`${bucket}:ip:${ip}`, limit, windowSeconds);
}

/** İstek gövdesi boyut sınırı (varsayılan 64 KB). */
export async function readJsonBody<T>(request: Request, maxBytes = 64 * 1024): Promise<T | null> {
  const text = await request.text();
  if (text.length > maxBytes) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
