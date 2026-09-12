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

/**
 * OTP kodunu gönderir — unified email-service üzerinden.
 * Asla fırlatmaz; gönderim başarısız olursa hata loglanır.
 * @returns true = e-posta gönderildi, false = gönderilemedi (hata loglandı)
 */
export async function sendOtpEmail(to: string, code: string): Promise<boolean> {
  const { sendOtpCodeEmail } = await import("@/lib/email-service");
  const result = await sendOtpCodeEmail(to, code);
  if (!result.sent) {
    console.warn(`[otp] email not delivered to ${to}: ${result.reason ?? "unknown"}`);
  }
  return result.sent;
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
