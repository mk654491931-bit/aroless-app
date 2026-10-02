/**
 * Herkese açık HTTP uçları için ortak koruma katmanı.
 *
 * - `requireUser`: Authorization: Bearer <supabase access token> doğrular.
 * - `rateLimit`: kullanıcı/IP başına kalıcı (veritabanı tabanlı) istek sınırı.
 * - `jsonError`: iç hata detaylarını sızdırmadan hata döndürür.
 */

export type GuardResult = { userId: string; token: string } | { response: Response };

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
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

// ---------------------------------------------------------------------------
// İstek sınırı arka uç durumu
//
// `bump_rate_limit` migration'ı uygulanmamışsa RPC bulunamaz. Bu durumda
// sınırı süreç içinde tutmaya devam ederiz ve teşhisi `/health` üzerinden
// görünür kılarız: kullanıcı "çok fazla istek" hatası yaşamaz, log bir kez
// uyarı basar, teşhis tek adreste görülür.
// ---------------------------------------------------------------------------

/** Sınırın şu an hangi arka uçta tutulduğu. */
export type RateLimitBackend = "database" | "memory" | "unknown";

let rateLimitBackend: RateLimitBackend = "unknown";
let rateLimitFallbackReason: string | null = null;
let rateLimitFallbackWarned = false;

/** Süreç içi sabit pencere sayaçları (bucket → pencere başlangıcı + sayım). */
const memoryBuckets = new Map<string, { windowStart: number; count: number }>();

/** Bellek sızıntısını önlemek için tutulan en fazla kova sayısı. */
const MEMORY_BUCKET_CAP = 5_000;

/** `/health` ve teşhis için: sınır arka ucunun anlık durumu (sır içermez). */
export function rateLimitBackendStatus(): {
  backend: RateLimitBackend;
  fallbackReason: string | null;
} {
  return { backend: rateLimitBackend, fallbackReason: rateLimitFallbackReason };
}

/**
 * RPC yoksa süreç içi sınırı devreye alır ve uyarıyı **bir kez** basar.
 * Aynı sebeple tekrar tekrar log yazmak, hatta hatanın kendisinden daha fazla
 * gürültü üretir.
 */
function noteDatabaseFallback(reason: string): void {
  const changed = rateLimitFallbackReason !== reason;
  rateLimitBackend = "memory";
  rateLimitFallbackReason = reason.slice(0, 200);
  if (!rateLimitFallbackWarned) {
    rateLimitFallbackWarned = true;
    console.warn(
      "[rate-limit] public.bump_rate_limit çağrılamadı; istek sınırı bu instance içinde tutuluyor." +
        ` Sebep: ${rateLimitFallbackReason}` +
        " Düzeltme: supabase/migrations/20260824013156_*.sql dosyasını canlı projeye uygula.",
    );
  } else if (changed) {
    console.warn(`[rate-limit] arka uç değişti: ${rateLimitFallbackReason}`);
  }
}

/**
 * Sabit pencereli süreç içi sayaç. SQL sürümüyle aynı hizayı kullanır
 * (`floor(now / window) * window`), böylece pencere sınırları tutarlıdır.
 */
function allowInMemory(key: string, limit: number, windowSeconds: number): boolean {
  const size = Math.max(1, Math.floor(windowSeconds));
  const now = Date.now();
  const windowStart = Math.floor(now / (size * 1000)) * size * 1000;
  const existing = memoryBuckets.get(key);
  const count = existing && existing.windowStart === windowStart ? existing.count + 1 : 1;
  memoryBuckets.set(key, { windowStart, count });
  if (memoryBuckets.size > MEMORY_BUCKET_CAP) {
    for (const [bucket, entry] of memoryBuckets) {
      if (entry.windowStart < windowStart) memoryBuckets.delete(bucket);
    }
  }
  return count <= limit;
}

/** Standart 429 gövdesi. */
function tooManyRequests(windowSeconds: number): Response {
  return new Response(
    JSON.stringify({ error: "Çok fazla istek gönderdiniz. Lütfen biraz sonra tekrar deneyin." }),
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
    // `token` da döner: jeton düşen uçlar (`chargeAiCredits`) kullanıcı-kapsamlı
    // RPC'yi çağırmak için ham erişim jetonuna ihtiyaç duyar.
    return { userId: user.id, token };
  } catch (e) {
    return { response: jsonError(401, "Oturum doğrulanamadı.", e) };
  }
}

/**
 * Kalıcı istek sınırı. Sınır aşıldıysa 429 yanıtı döner, aksi halde null.
 *
 * Dayanak birincil olarak veritabanı RPC'sidir (`public.bump_rate_limit`).
 * Bu RPC migration'ı canlıya uygulanmamışsa PostgREST şema önbelleğinde
 * bulunamaz ve her çağrı "Could not find the function …" hatası verir.
 *
 * O hâlde eskiden sınır **hiç uygulanmadan** istekler geçiyordu (fail-open) ve
 * her istek log'a hata yazıyordu: hem kullanıcı kotasız kalıyor hem de platform
 * logları bu satırla doluyordu. Artık:
 *   1. sınır **süreç içi** bir pencere sayacıyla devam eder (aynı limit, aynı
 *      pencere hizası — yalnızca instance kapsamlı), ve
 *   2. uyarı **bir kez** basılır, sebebiyle birlikte ("migration uygulanmamış").
 *
 * Böylece eksik migration ne ürün aramasını bozar ne de gürültüye döner.
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
      noteDatabaseFallback(error.message);
      if (!allowInMemory(key, limit, windowSeconds)) return tooManyRequests(windowSeconds);
      return null;
    }
    rateLimitBackend = "database";
    if (data === false) return tooManyRequests(windowSeconds);
    return null;
  } catch (e) {
    noteDatabaseFallback(e instanceof Error ? e.message : String(e));
    if (!allowInMemory(key, limit, windowSeconds)) return tooManyRequests(windowSeconds);
    return null;
  }
}

/** Oturum + istek sınırı birlikte. */
export async function guardAuthed(
  request: Request,
  bucket: string,
  limit = 30,
  windowSeconds = 60,
): Promise<GuardResult> {
  const auth = await requireUser(request);
  if ("response" in auth) return auth;
  const limited = await rateLimit(`${bucket}:u:${auth.userId}`, limit, windowSeconds);
  if (limited) return { response: limited };
  return { userId: auth.userId, token: auth.token };
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
