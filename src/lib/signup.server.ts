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
  // Önce AWS SES; yapılandırılmamışsa Resend havuzuna düş.
  const { isEmailConfigured, sendOtpCodeEmail } = await import("@/lib/email-service");
  if (isEmailConfigured()) {
    await sendOtpCodeEmail(to, code);
    return;
  }

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
  args: {
    visitorId: string;
    userId: string;
    email: string | null;
    tier?: string | null;
    ipHash?: string;
    source?: string;
  },
): Promise<boolean> {
  if (!args.visitorId && !args.ipHash) return false;

  const lockKeys = [
    args.visitorId ? `visitor:${args.visitorId}` : null,
    args.ipHash ? `ip:${args.ipHash}` : null,
  ]
    .filter((key): key is string => !!key)
    .sort();
  for (const key of lockKeys) {
    const { error: lockError } = await admin.rpc("lock_signup_fingerprint", { lock_key: key });
    if (lockError) throw new Error("Kayıt güvenlik kontrolü tamamlanamadı.");
  }

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

  // Kötüye kullanım kuralları: aynı cihaz/IP'den çoklu hesap veya kısa sürede
  // tekrarlanan kayıt tespit edilirse adminlere otomatik uyarı gönderilir.
  try {
    await raiseAbuseAlert(admin, {
      userId: args.userId,
      email: args.email,
      visitorId: args.visitorId || null,
      ipHash: args.ipHash || null,
      blocked,
    });
  } catch (e) {
    console.error("[abuse-alert] failed", e);
  }

  return blocked;
}

/** Kötüye kullanım eşikleri. */
const ABUSE_RULES = {
  accountsPerDevice: 2, // aynı cihazdan bu sayı ve üzeri hesap
  accountsPerIp: 3, // aynı IP'den bu sayı ve üzeri hesap
  rapidWindowMinutes: 60, // kısa süre penceresi
  rapidCount: 2, // pencere içinde aynı cihaz/IP'den bu kadar kayıt
} as const;

type AbuseArgs = {
  userId: string;
  email: string | null;
  visitorId: string | null;
  ipHash: string | null;
  blocked: boolean;
};

/**
 * Ücretsiz kredi kötüye kullanımını değerlendirir; şüpheli ise tüm adminlere
 * bildirim (notifications) kaydı düşer.
 */
export async function raiseAbuseAlert(
  admin: Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"],
  args: AbuseArgs,
): Promise<{ flagged: boolean; reasons: string[]; severity: "low" | "high" }> {
  const since = new Date(Date.now() - ABUSE_RULES.rapidWindowMinutes * 60_000).toISOString();
  const reasons: string[] = [];

  const uniqueUsers = (rows: { user_id: string | null }[] | null) =>
    new Set((rows ?? []).map((r) => r.user_id).filter(Boolean) as string[]).size;

  if (args.visitorId) {
    const [{ data: all }, { data: recent }] = await Promise.all([
      admin.from("free_credit_audit").select("user_id").eq("visitor_id", args.visitorId).limit(200),
      admin
        .from("free_credit_audit")
        .select("user_id")
        .eq("visitor_id", args.visitorId)
        .gte("created_at", since)
        .limit(200),
    ]);
    const accounts = uniqueUsers(all);
    if (accounts >= ABUSE_RULES.accountsPerDevice) {
      reasons.push(`Aynı cihazdan ${accounts} farklı hesap`);
    }
    if ((recent?.length ?? 0) >= ABUSE_RULES.rapidCount) {
      reasons.push(
        `Son ${ABUSE_RULES.rapidWindowMinutes} dakikada ${recent?.length} kayıt (aynı cihaz)`,
      );
    }
  }

  if (args.ipHash) {
    const [{ data: all }, { data: recent }] = await Promise.all([
      admin.from("free_credit_audit").select("user_id").eq("ip_hash", args.ipHash).limit(200),
      admin
        .from("free_credit_audit")
        .select("user_id")
        .eq("ip_hash", args.ipHash)
        .gte("created_at", since)
        .limit(200),
    ]);
    const accounts = uniqueUsers(all);
    if (accounts >= ABUSE_RULES.accountsPerIp) {
      reasons.push(`Aynı IP'den ${accounts} farklı hesap`);
    }
    if ((recent?.length ?? 0) >= ABUSE_RULES.rapidCount) {
      reasons.push(
        `Son ${ABUSE_RULES.rapidWindowMinutes} dakikada ${recent?.length} kayıt (aynı IP)`,
      );
    }
  }

  if (reasons.length === 0) return { flagged: false, reasons, severity: "low" };

  const severity: "low" | "high" = reasons.length >= 2 || !args.blocked ? "high" : "low";

  const { data: admins } = await admin.from("user_roles").select("user_id").eq("role", "admin");
  const adminIds = [...new Set((admins ?? []).map((a) => a.user_id))];
  if (adminIds.length === 0) return { flagged: true, reasons, severity };

  const title =
    severity === "high"
      ? "Kritik: ücretsiz kredi kötüye kullanımı"
      : "Şüpheli ücretsiz kredi kaydı";
  const body = `${args.email ?? args.userId} — ${reasons.join(" · ")}${args.blocked ? " (kredi engellendi)" : " (kredi verildi)"}`;

  await admin.from("notifications").insert(
    adminIds.map((id) => ({
      user_id: id,
      type: "free_credit_abuse",
      title,
      body,
      data: {
        severity,
        reasons,
        suspect_user_id: args.userId,
        suspect_email: args.email,
        visitor_id: args.visitorId,
        ip_hash: args.ipHash,
        blocked: args.blocked,
      },
    })),
  );

  return { flagged: true, reasons, severity };
}
