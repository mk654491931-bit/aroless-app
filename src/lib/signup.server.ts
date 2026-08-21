/** Sunucu tarafı: OTP üretimi/doğrulaması ve Resend ile e-posta gönderimi. */

export function generateOtp(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(100000 + ((bytes[0] ?? 0) % 900000));
}

export async function hashOtp(email: string, code: string): Promise<string> {
  const data = new TextEncoder().encode(`${email.trim().toLowerCase()}::${code}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function otpEmailHtml(code: string): string {
  return `<!doctype html><html><body style="margin:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:520px;margin:0 auto;padding:32px 28px;">
  <h1 style="margin:0 0 8px;font-size:22px;color:#0b0f1a;">Aroless doğrulama kodu</h1>
  <p style="margin:0 0 24px;font-size:14px;color:#4b5563;">Hesabınızı etkinleştirmek için aşağıdaki 6 haneli kodu girin. Kod 10 dakika geçerlidir.</p>
  <div style="font-size:34px;letter-spacing:10px;font-weight:700;color:#0b0f1a;background:#f3f4f6;border-radius:12px;padding:18px 12px;text-align:center;">${code}</div>
  <p style="margin:24px 0 0;font-size:12px;color:#6b7280;">Bu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz.</p>
</div></body></html>`;
}

/** Sırayla denenecek Resend anahtarları (kota/rate-limit'e karşı rotasyon). */
function resendKeys(): { key: string; from: string }[] {
  const defs: [string, string][] = [
    ["RESEND_API_KEY", "RESEND_FROM_EMAIL"],
    ["RESEND_API_KEY_2", "RESEND_FROM_EMAIL_2"],
    ["RESEND_API_KEY_3", "RESEND_FROM_EMAIL_3"],
  ];
  const out: { key: string; from: string }[] = [];
  for (const [keyName, fromName] of defs) {
    const key = process.env[keyName];
    if (!key) continue;
    out.push({
      key,
      from:
        process.env[fromName] ||
        process.env["RESEND_FROM_EMAIL"] ||
        "Aroless <onboarding@resend.dev>",
    });
  }
  return out;
}

export async function sendOtpEmail(to: string, code: string): Promise<void> {
  const pool = resendKeys();
  if (pool.length === 0) throw new Error("E-posta servisi yapılandırılmamış.");

  let lastStatus = 0;
  for (const { key, from } of pool) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `Aroless doğrulama kodunuz: ${code}`,
        html: otpEmailHtml(code),
        text: `Aroless doğrulama kodunuz: ${code} (10 dakika geçerli)`,
      }),
    });

    if (res.ok) return;

    lastStatus = res.status;
    const body = await res.text();
    console.error(`[resend] send failed [${res.status}]: ${body}`);
    // 429 (kota/rate limit) veya 5xx ise sıradaki anahtarı dene; diğer hatalarda dur.
    if (res.status !== 429 && res.status < 500) break;
  }

  throw new Error(
    lastStatus === 429
      ? "E-posta gönderim kotası doldu. Lütfen biraz sonra tekrar deneyin."
      : "Doğrulama e-postası gönderilemedi. Lütfen tekrar deneyin.",
  );
}


/** Aynı cihazdan ikinci kez ücretsiz hak alınmasını engeller. */
export async function applyFingerprintPolicy(
  admin: Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"],
  args: { visitorId: string; userId: string; email: string | null; tier?: string | null; ipHash?: string; source?: string },
): Promise<boolean> {
  if (!args.visitorId && !args.ipHash) return false;

  // Aynı cihaz parmak izi VEYA aynı IP üzerinden açılmış başka bir hesap var mı?
  const [byDevice, byIp] = await Promise.all([
    args.visitorId
      ? admin
          .from("device_fingerprints")
          .select("id")
          .eq("visitor_id", args.visitorId)
          .neq("user_id", args.userId)
          .limit(1)
      : Promise.resolve({ data: [] as { id: string }[] }),
    args.ipHash
      ? admin
          .from("device_fingerprints")
          .select("id")
          .eq("ip_hash", args.ipHash)
          .neq("user_id", args.userId)
          .limit(1)
      : Promise.resolve({ data: [] as { id: string }[] }),
  ]);

  const reused = (byDevice.data?.length ?? 0) > 0 || (byIp.data?.length ?? 0) > 0;
  const paid = !["free", ""].includes(String(args.tier ?? "Free").toLowerCase());

  await admin.from("device_fingerprints").insert({
    visitor_id: args.visitorId || `ip:${args.ipHash ?? "unknown"}`,
    user_id: args.userId,
    email: args.email,
    ip_hash: args.ipHash ?? null,
    free_tier_granted: !reused,
  });

  const blocked = reused && !paid;
  if (blocked) {
    await admin.from("profiles").update({ credits: 0, sim_credits: 0 }).eq("id", args.userId);
  }

  // Denetim logu: ücretsiz kredinin kime, hangi cihaz/IP ile verildiği (ya da
  // neden verilmediği) kalıcı olarak kaydedilir.
  let credits = 0;
  let simCredits = 0;
  if (!blocked) {
    const { data: prof } = await admin
      .from("profiles")
      .select("credits, sim_credits")
      .eq("id", args.userId)
      .maybeSingle();
    credits = prof?.credits ?? 0;
    simCredits = prof?.sim_credits ?? 0;
  }
  await admin.from("free_credit_audit").insert({
    user_id: args.userId,
    email: args.email,
    visitor_id: args.visitorId || null,
    ip_hash: args.ipHash || null,
    granted: !blocked,
    credits,
    sim_credits: simCredits,
    reason: blocked
      ? (byDevice.data?.length ?? 0) > 0
        ? "duplicate_device"
        : "duplicate_ip"
      : "first_signup",
    source: args.source ?? "unknown",
    meta: { tier: args.tier ?? "Free", paid },
  });

  return blocked;
}

