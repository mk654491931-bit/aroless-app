// Cloudflare Turnstile (invisible CAPTCHA) doğrulaması — sunucu tarafı.
// TURNSTILE_SECRET_KEY tanımlı değilse doğrulama atlanır (graceful degrade).
// Retry logic + timeout + caching ile geliştirildi.

import { clientIpFromHeaders } from "@/lib/client-ip";

const TURNSTILE_ENDPOINT = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_TIMEOUT = 8000; // 8 saniye
const TURNSTILE_RETRIES = 2;
const TURNSTILE_CACHE_DURATION = 300_000; // 5 dakika

// Yalnız BAŞARISIZ doğrulamalar kısa süreliğine hatırlanır.
//
// GÜVENLİK (bulgu): başarılı sonuç da önbelleğe alınıyordu. Turnstile jetonları
// TEK KULLANIMLIKTIR; başarıyı 5 dakika cache'lemek aynı jetonla art arda
// sınırsız istek (replay) yapılabilmesi demekti — yani bir kez çözülen CAPTCHA
// birçok kez kullanılabiliyordu. Başarı artık önbelleğe YAZILMAZ.
type CacheEntry = { result: TurnstileResult; expires: number };
const tokenCache = new Map<string, CacheEntry>();
/** Bellek şişmesini önlemek için en fazla bu kadar başarısız jeton saklanır. */
const MAX_CACHED_FAILURES = 500;

function rememberFailure(token: string, result: TurnstileResult): void {
  if (tokenCache.size >= MAX_CACHED_FAILURES) {
    const oldest = tokenCache.keys().next().value;
    if (oldest !== undefined) tokenCache.delete(oldest);
  }
  tokenCache.set(token, { result, expires: Date.now() + TURNSTILE_CACHE_DURATION });
}

// Provider sağlık izleme
type ProviderHealth = {
  lastSuccess: number;
  lastError: number;
  errorCount: number;
  successCount: number;
};
const providerHealth: ProviderHealth = {
  lastSuccess: 0,
  lastError: 0,
  errorCount: 0,
  successCount: 0,
};

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

  if (!token) return { ok: false, skipped: false, reason: "token-required" };

  // Cache'te YALNIZ başarısız sonuçlar bulunur.
  const cached = tokenCache.get(token);
  if (cached) {
    if (cached.expires > Date.now()) return cached.result;
    tokenCache.delete(token);
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

      // Başarı ASLA cache'lenmez (tek kullanımlık jeton); hata hatırlanır.
      if (!result.ok) rememberFailure(token, result);
      providerHealth.lastSuccess = Date.now();
      providerHealth.successCount++;

      console.log(
        `[turnstile] Verification ${result.ok ? "succeeded" : "failed"} on attempt ${attempt + 1}`,
      );
      return result;
    } catch (e) {
      lastErr = e;
      const isTimeout = lastErr instanceof Error && lastErr.name === "AbortError";
      const isNetworkError = lastErr instanceof TypeError;

      console.warn(
        `[turnstile] Attempt ${attempt + 1} failed:`,
        isTimeout ? "timeout" : isNetworkError ? "network error" : String(lastErr),
      );

      if (attempt < TURNSTILE_RETRIES && (isTimeout || isNetworkError)) {
        // Wait before retry (exponential backoff)
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 100));
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

/**
 * İstekten istemci IP'si (sahtelenemez çıkarım).
 *
 * GÜVENLİK: ham başlık okuması, `x-forwarded-for`un ilk halkasını uydurarak
 * IP tabanlı sınırların atlatılmasına izin veriyordu; çıkarım tek kaynağa
 * taşındı (bkz. lib/client-ip.ts).
 */
export function clientIp(request: Request): string {
  return clientIpFromHeaders(request.headers);
}

/** IP adresini geri döndürülemez şekilde hashler (KVKK/GDPR dostu). */
export async function hashIp(ip: string): Promise<string> {
  if (!ip) return "";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`aroless::${ip}`));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 40);
}
