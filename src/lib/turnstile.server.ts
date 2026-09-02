// Cloudflare Turnstile (invisible CAPTCHA) doğrulaması — sunucu tarafı.
// TURNSTILE_SECRET_KEY tanımlı değilse doğrulama atlanır (graceful degrade).
// Retry logic + timeout + caching ile geliştirildi.

const TURNSTILE_ENDPOINT = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_TIMEOUT = 8000; // 8 saniye
const TURNSTILE_RETRIES = 2;
const TURNSTILE_CACHE_DURATION = 300_000; // 5 dakika

// In-memory cache — token→result mapping
type CacheEntry = { result: TurnstileResult; expires: number };
const tokenCache = new Map<string, CacheEntry>();

// Provider sağlık izleme
type ProviderHealth = { lastSuccess: number; lastError: number; errorCount: number; successCount: number };
const providerHealth: ProviderHealth = { lastSuccess: 0, lastError: 0, errorCount: 0, successCount: 0 };

export function turnstileEnabled(): boolean {
  return Boolean(process.env["TURNSTILE_SECRET_KEY"]);
}

export function getTurnstileHealth(): ProviderHealth {
  return { ...providerHealth };
}

export type TurnstileResult = { ok: boolean; skipped: boolean; reason?: string };

/**
 * Turnstile token doğrula — retry logic, timeout, cache ile.
 * 1. Cache'de varsa hızlıca dön
 * 2. Ağ hatasında 2 kere retry yap
 * 3. Timeout: 8 saniye
 * 4. Başarısız olursa graceful fallback
 */
export async function verifyTurnstile(token: string, ip?: string): Promise<TurnstileResult> {
  const secret = process.env["TURNSTILE_SECRET_KEY"];
  if (!secret) return { ok: true, skipped: true };
  
  const siteKey = process.env["VITE_TURNSTILE_SITE_KEY"];
  if (!siteKey) return { ok: true, skipped: true, reason: "no-site-key" };
  
  // Token boşsa widget yüklenemedi/kırıldı — doğrulamayı atla,
  // kullanıcıyı captcha nedeniyle engelleme.
  if (!token) return { ok: true, skipped: true, reason: "empty-token-graceful" };

  // Cache kontrol
  const cached = tokenCache.get(token);
  if (cached && cached.expires > Date.now()) {
    console.log("[turnstile] Cache hit for token");
    return cached.result;
  }

  let lastErr: unknown = null;
  
  // Retry loop
  for (let attempt = 0; attempt <= TURNSTILE_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TURNSTILE_TIMEOUT);
      
      const body = new URLSearchParams({ secret, response: token });
      if (ip) body.set("remoteip", ip);
      
      const res = await fetch(TURNSTILE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: controller.signal,
      });
      
      clearTimeout(timer);
      
      const json = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
      const result: TurnstileResult = json.success
        ? { ok: true, skipped: false }
        : { ok: false, skipped: false, reason: (json["error-codes"] ?? []).join(",") || "failed" };
      
      // Cache ve health tracking
      tokenCache.set(token, { result, expires: Date.now() + TURNSTILE_CACHE_DURATION });
      providerHealth.lastSuccess = Date.now();
      providerHealth.successCount++;
      
      console.log(`[turnstile] Verification ${result.ok ? "succeeded" : "failed"} on attempt ${attempt + 1}`);
      return result;
      
    } catch (e) {
      lastErr = e;
      const isTimeout = lastErr instanceof Error && lastErr.name === "AbortError";
      const isNetworkError = lastErr instanceof TypeError;
      
      console.warn(`[turnstile] Attempt ${attempt + 1} failed:`, 
        isTimeout ? "timeout" : isNetworkError ? "network error" : String(lastErr));
      
      if (attempt < TURNSTILE_RETRIES && (isTimeout || isNetworkError)) {
        // Wait before retry (exponential backoff)
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 100));
        continue;
      }
    }
  }

  // Tüm retry'lar başarısız — graceful fallback
  providerHealth.lastError = Date.now();
  providerHealth.errorCount++;
  
  console.warn("[turnstile] All retries exhausted — falling back to graceful mode");
  return { ok: true, skipped: true, reason: "verifier-unreachable" };
}

/** İstekten istemci IP'sini çıkarır. */
export function clientIp(request: Request): string {
  const h = request.headers;
  return (
    h.get("cf-connecting-ip") ||
    (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    ""
  );
}

/** IP adresini geri döndürülemez şekilde hashler (KVKK/GDPR dostu). */
export async function hashIp(ip: string): Promise<string> {
  if (!ip) return "";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`velora::${ip}`));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 40);
}
