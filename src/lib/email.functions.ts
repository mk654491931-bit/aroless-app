import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

function originOf(fallback = "https://aroless.tech"): string {
  try {
    return new URL(getRequest().url).origin;
  } catch {
    return fallback;
  }
}

function normalizeEmail(input: unknown): { email: string } {
  const email = String((input as { email?: unknown } | null)?.email ?? "")
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 255) {
    throw new Error("Geçerli bir e-posta adresi girin.");
  }
  return { email };
}

/** Şifre sıfırlama bağlantısını AWS SES ile gönderir. */
export const requestPasswordReset = createServerFn({ method: "POST" })
  .inputValidator(normalizeEmail)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendPasswordResetEmail } = await import("@/lib/email-service");
    const redirectTo = `${originOf()}/auth?mode=reset`;

    const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: data.email,
      options: { redirectTo },
    });
    // Hesap yoksa da aynı yanıtı döndür (kullanıcı sayımı sızmasın).
    if (error || !link?.properties?.action_link) return { ok: true as const };

    try {
      await sendPasswordResetEmail(data.email, link.properties.action_link);
    } catch (e) {
      console.error("[email] password reset send failed", e);
    }
    return { ok: true as const };
  });

/** E-posta doğrulama bağlantısını yeniden gönderir. */
export const resendVerificationEmail = createServerFn({ method: "POST" })
  .inputValidator(normalizeEmail)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendVerificationEmail } = await import("@/lib/email-service");
    const redirectTo = `${originOf()}/auth/callback`;

    const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "signup",
      email: data.email,
      password: crypto.randomUUID(),
      options: { redirectTo },
    });
    if (error || !link?.properties?.action_link) return { ok: true as const };

    try {
      await sendVerificationEmail(data.email, link.properties.action_link);
    } catch (e) {
      console.error("[email] verification send failed", e);
    }
    return { ok: true as const };
  });
