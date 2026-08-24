// Cloudflare Turnstile (invisible CAPTCHA) doğrulaması — sunucu tarafı.
// TURNSTILE_SECRET_KEY tanımlı değilse doğrulama atlanır (graceful degrade).

export function turnstileEnabled(): boolean {
  return Boolean(process.env["TURNSTILE_SECRET_KEY"]);
}

export type TurnstileResult = { ok: boolean; skipped: boolean; reason?: string };

export async function verifyTurnstile(token: string, ip?: string): Promise<TurnstileResult> {
  const secret = process.env["TURNSTILE_SECRET_KEY"];
  if (!secret) return { ok: true, skipped: true };
  if (!token) return { ok: false, skipped: false, reason: "missing-token" };

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    return json.success
      ? { ok: true, skipped: false }
      : { ok: false, skipped: false, reason: (json["error-codes"] ?? []).join(",") || "failed" };
  } catch {
    // Doğrulama servisi ulaşılamazsa kullanıcıyı kilitleme.
    return { ok: true, skipped: true, reason: "verifier-unreachable" };
  }
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
