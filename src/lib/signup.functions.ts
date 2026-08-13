import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isDisposableEmail } from "@/lib/disposable-email";
import { applyFingerprintPolicy } from "@/lib/signup.server";
import { clientIp, hashIp, verifyTurnstile } from "@/lib/turnstile.server";
import { getRequest } from "@tanstack/react-start/server";

type StartInput = {
  email: string; password: string; confirmPassword: string;
  visitorId?: string; marketing?: boolean; turnstileToken?: string;
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
    const email = String(input?.email ?? "").trim().toLowerCase();
    const password = String(input?.password ?? "");
    const confirmPassword = String(input?.confirmPassword ?? "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 255) {
      throw new Error("Geçerli bir e-posta adresi girin.");
    }
    if (password.length < 6 || password.length > 72) throw new Error("Şifre en az 6 karakter olmalı.");
    if (password !== confirmPassword) throw new Error("Şifreler birbiriyle eşleşmiyor.");
    if (isDisposableEmail(email)) throw new Error("Geçici (temp-mail) e-posta adresleriyle kayıt yapılamaz.");
    return {
      email,
      password,
      visitorId: String(input?.visitorId ?? "").slice(0, 128),
      marketing: !!input?.marketing,
      turnstileToken: String(input?.turnstileToken ?? "").slice(0, 4096),
      promoCode: String(input?.promoCode ?? "").trim().toUpperCase().slice(0, 32),
    };
  })
  .handler(async ({ data }) => {
    const captcha = await verifyTurnstile(data.turnstileToken, clientIp(getRequest()));
    if (!captcha.ok) throw new Error("Bot doğrulaması başarısız. Sayfayı yenileyip tekrar deneyin.");

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
      if (row.expires_at && new Date(row.expires_at) < new Date()) throw new Error("Promosyon kodunun süresi dolmuş.");
      if (row.max_redemptions != null && row.times_redeemed >= row.max_redemptions) {
        throw new Error("Promosyon kodu kullanım limitine ulaştı.");
      }
      promo = { id: row.id, code: row.code, discount_pct: row.discount_pct };
    }

    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
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
      const exists = msg.includes("already") || msg.includes("registered") || msg.includes("exists");
      if (!exists) throw new Error(createError.message);

      // Eski akıştan kalan, doğrulanmamış hesapları kurtar: onayla ve şifreyi tazele.
      const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const existing = list?.users?.find((u) => u.email?.toLowerCase() === data.email.toLowerCase());
      if (!existing) throw new Error("Bu e-posta zaten kayıtlı. Giriş yapmayı deneyin.");
      if (existing.email_confirmed_at) {
        throw new Error("Bu e-posta zaten kayıtlı. Giriş yapmayı deneyin.");
      }
      const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(existing.id, {
        password: data.password,
        email_confirm: true,
      });
      if (updErr) throw new Error(updErr.message);
      userId = existing.id;
    }

    if (!userId) throw new Error("Hesap oluşturulamadı. Lütfen tekrar deneyin.");


    const reused = await applyFingerprintPolicy(supabaseAdmin, {
      visitorId: data.visitorId,
      userId,
      email: data.email,
      tier: "Free",
      ipHash: await requestIpHash(),
    });

    // Promosyon kodunu kalıcı olarak bağla ve kullanımı say.
    let promoDiscount = 0;
    if (promo) {
      try {
        promoDiscount = promo.discount_pct;
        await supabaseAdmin.from("profiles").update({ promo_code: promo.code }).eq("id", userId);
        await supabaseAdmin.from("promo_redemptions").upsert(
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

    return { ok: true as const, email: data.email, creditsBlocked: reused, promoDiscount };
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
    });
    return { ok: true as const, freeTierBlocked: reused };
  });
