import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isDisposableEmail } from "@/lib/disposable-email";
import { applyFingerprintPolicy, generateOtp, hashOtp, sendOtpEmail } from "@/lib/signup.server";
import { clientIp, hashIp, verifyTurnstile } from "@/lib/turnstile.server";
import { hashValue, rateLimit } from "@/lib/api-guard.server";
import { getRequest } from "@tanstack/react-start/server";

type StartInput = {
  email: string;
  password: string;
  confirmPassword: string;
  visitorId?: string;
  marketing?: boolean;
  legalAccepted?: boolean;
  turnstileToken?: string;
  promoCode?: string;
};

/** İstekten IP hash'i üretir (bot/mükerrer hesap denetimi için). */
async function requestIpHash(): Promise<string> {
  try {
    return await hashIp(clientIp(getRequest()));
  } catch {
    return "";
  }
}

export const startEmailSignup = createServerFn({ method: "POST" })
  .inputValidator((input: StartInput) => {
    const email = String(input?.email ?? "")
      .trim()
      .toLowerCase();
    const password = String(input?.password ?? "");
    const confirmPassword = String(input?.confirmPassword ?? "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 255) {
      throw new Error("Geçerli bir e-posta adresi girin.");
    }
    if (password.length < 6 || password.length > 72)
      throw new Error("Şifre en az 6 karakter olmalı.");
    if (password !== confirmPassword) throw new Error("Şifreler birbiriyle eşleşmiyor.");
    if (input?.legalAccepted !== true)
      throw new Error("Kayıt için zorunlu yasal onayları kabul etmelisiniz.");
    if (isDisposableEmail(email))
      throw new Error("Geçici (temp-mail) e-posta adresleriyle kayıt yapılamaz.");
    return {
      email,
      password,
      visitorId: String(input?.visitorId ?? "").slice(0, 128),
      marketing: !!input?.marketing,
      legalAccepted: true,
      turnstileToken: String(input?.turnstileToken ?? "").slice(0, 4096),
      promoCode: String(input?.promoCode ?? "")
        .trim()
        .toUpperCase()
        .slice(0, 32),
    };
  })
  .handler(async ({ data }) => {
    const signupLimit = await rateLimit(
      `signup:ip:${await hashValue(clientIp(getRequest()))}`,
      5,
      3600,
    );
    if (signupLimit) throw new Error("Çok fazla kayıt denemesi. Lütfen daha sonra tekrar deneyin.");
    const captcha = await verifyTurnstile(data.turnstileToken, clientIp(getRequest()));
    if (!captcha.ok)
      throw new Error("Bot doğrulaması başarısız. Sayfayı yenileyip tekrar deneyin.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Promosyon kodu verildiyse kayıt öncesi doğrula.
    let promo: { id: string; code: string; discount_pct: number } | null = null;
    if (data.promoCode) {
      const { data: row } = await supabaseAdmin
        .from("promo_codes")
        .select("id, code, discount_pct, active, expires_at, max_redemptions, times_redeemed")
        .eq("code", data.promoCode)
        .maybeSingle();
      if (!row) throw new Error("Promosyon kodu bulunamadı.");
      if (!row.active) throw new Error("Promosyon kodu pasif.");
      if (row.expires_at && new Date(row.expires_at) < new Date())
        throw new Error("Promosyon kodunun süresi dolmuş.");
      if (row.max_redemptions != null && row.times_redeemed >= row.max_redemptions) {
        throw new Error("Promosyon kodu kullanım limitine ulaştı.");
      }
      promo = { id: row.id, code: row.code, discount_pct: row.discount_pct };
    }

    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: false,
      user_metadata: {
        marketing_opt_in: data.marketing,
        legal_accepted_at: new Date().toISOString(),
        signup_visitor_id: data.visitorId || null,
        signup_promo_code: promo?.code ?? null,
        signup_promo_discount_pct: promo?.discount_pct ?? null,
      },
    });

    let userId = created?.user?.id;

    if (createError) {
      const msg = createError.message.toLowerCase();
      const exists =
        msg.includes("already") || msg.includes("registered") || msg.includes("exists");
      if (!exists) throw new Error(createError.message);

      // Eski akıştan kalan doğrulanmamış hesabı yeniden kullan ve yeni kod gönder.
      const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const existing = list?.users?.find(
        (u) => u.email?.toLowerCase() === data.email.toLowerCase(),
      );
      if (!existing) throw new Error("Bu e-posta zaten kayıtlı. Giriş yapmayı deneyin.");
      if (existing.email_confirmed_at) {
        throw new Error("Bu e-posta zaten kayıtlı. Giriş yapmayı deneyin.");
      }
      const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(existing.id, {
        password: data.password,
        email_confirm: false,
      });
      if (updErr) throw new Error(updErr.message);
      userId = existing.id;
    }

    if (!userId) throw new Error("Hesap oluşturulamadı. Lütfen tekrar deneyin.");

    const code = generateOtp();
    const { error: otpError } = await supabaseAdmin.from("email_otps").insert({
      email: data.email,
      code_hash: await hashOtp(data.email, code),
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    if (otpError) throw new Error("Doğrulama kodu oluşturulamadı. Lütfen tekrar deneyin.");
    try {
      await sendOtpEmail(data.email, code);
    } catch (error) {
      if (created?.user?.id) await supabaseAdmin.auth.admin.deleteUser(userId);
      throw error;
    }

    // Promosyon kodunu kalıcı olarak bağla ve kullanımı say.
    let promoDiscount = 0;
    if (promo) {
      try {
        promoDiscount = promo.discount_pct;
        await supabaseAdmin.from("profiles").update({ promo_code: promo.code }).eq("id", userId);
        await supabaseAdmin
          .from("promo_redemptions")
          .upsert(
            { promo_code_id: promo.id, code: promo.code, user_id: userId, email: data.email },
            { onConflict: "user_id" },
          );
        const { data: pc } = await supabaseAdmin
          .from("promo_codes")
          .select("times_redeemed")
          .eq("id", promo.id)
          .maybeSingle();
        await supabaseAdmin
          .from("promo_codes")
          .update({ times_redeemed: (pc?.times_redeemed ?? 0) + 1 })
          .eq("id", promo.id);
      } catch {
        /* promosyon kaydı kritik değil */
      }
    }

    // Hoş geldiniz e-postası — 8 haneli Aroless kimliği ile (kritik değil).
    try {
      const { data: prof } = await supabaseAdmin
        .from("profiles")
        .select("public_id")
        .eq("id", userId)
        .maybeSingle();
      const publicId = String((prof as { public_id?: string } | null)?.public_id ?? "");
      if (publicId) {
        const { sendWelcomeEmail } = await import("@/lib/email-service");
        await sendWelcomeEmail(data.email, publicId);
      }
    } catch (e) {
      console.error("[email] welcome send failed", e);
    }

    return { ok: true as const, email: data.email, creditsBlocked: false, promoDiscount };
  });

export const verifyEmailSignup = createServerFn({ method: "POST" })
  .inputValidator((input: { email: string; code: string; visitorId?: string }) => {
    const email = String(input?.email ?? "")
      .trim()
      .toLowerCase();
    const code = String(input?.code ?? "").trim();
    if (!email || !/^\d{6}$/.test(code)) throw new Error("6 haneli doğrulama kodunu girin.");
    return { email, code, visitorId: String(input?.visitorId ?? "").slice(0, 128) };
  })
  .handler(async ({ data }) => {
    const ipLimit = await rateLimit(
      `verify-otp:ip:${await hashValue(clientIp(getRequest()))}`,
      10,
      600,
    );
    const emailLimit = await rateLimit(`verify-otp:email:${await hashValue(data.email)}`, 10, 600);
    if (ipLimit || emailLimit)
      throw new Error("Çok fazla doğrulama denemesi. Lütfen biraz sonra tekrar deneyin.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: otp } = await supabaseAdmin
      .from("email_otps")
      .select("id, code_hash, attempts, expires_at")
      .eq("email", data.email)
      .is("consumed_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!otp || new Date(otp.expires_at) <= new Date())
      throw new Error("Kodun süresi dolmuş. Kayıt işlemini yeniden başlatın.");
    if (otp.attempts >= 5) throw new Error("Çok fazla hatalı deneme. Yeni kod isteyin.");

    const codeHash = await hashOtp(data.email, data.code);
    if (codeHash !== otp.code_hash) {
      await supabaseAdmin
        .from("email_otps")
        .update({ attempts: otp.attempts + 1 })
        .eq("id", otp.id);
      throw new Error("Doğrulama kodu hatalı.");
    }

    const { data: consumedOtp } = await supabaseAdmin
      .from("email_otps")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", otp.id)
      .eq("code_hash", codeHash)
      .is("consumed_at", null)
      .gt("expires_at", new Date().toISOString())
      .select("id")
      .maybeSingle();
    if (!consumedOtp) throw new Error("Bu doğrulama kodu artık geçerli değil.");

    const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const user = list?.users?.find((candidate) => candidate.email?.toLowerCase() === data.email);
    if (!user) throw new Error("Kayıt bulunamadı. Lütfen yeniden deneyin.");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
    const creditsBlocked = await applyFingerprintPolicy(supabaseAdmin, {
      visitorId: data.visitorId,
      userId: user.id,
      email: data.email,
      tier: "Free",
      ipHash: await requestIpHash(),
      source: "email_signup",
    });
    return { ok: true as const, creditsBlocked };
  });

/** Google ile giren kullanıcılar için cihaz parmak izini kaydeder. */
export const registerDeviceFingerprint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { visitorId: string }) => ({
    visitorId: String(input?.visitorId ?? "").slice(0, 128),
  }))
  .handler(async ({ data, context }) => {
    if (!data.visitorId) return { ok: true as const, freeTierBlocked: false };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing } = await supabaseAdmin
      .from("device_fingerprints")
      .select("id")
      .eq("user_id", context.userId)
      .limit(1);
    if (existing && existing.length > 0) return { ok: true as const, freeTierBlocked: false };

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, email, subscription_tier")
      .eq("id", context.userId)
      .maybeSingle();

    const reused = await applyFingerprintPolicy(supabaseAdmin, {
      visitorId: data.visitorId,
      userId: context.userId,
      email: profile?.email ?? null,
      tier: profile?.subscription_tier ?? "Free",
      ipHash: await requestIpHash(),
      source: "oauth_or_session",
    });
    return { ok: true as const, freeTierBlocked: reused };
  });
