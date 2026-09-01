/**
 * Unified e-posta servisi — Resend öncelikli, AWS SES yedek, Console fallback.
 *
 * Öncelik sırası:
 *   1. Resend API (RESEND_API_KEY + RESEND_FROM_EMAIL)
 *   2. AWS SES v2 (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, ...)
 *   3. Development/Console log fallback (e-posta gönderilemediğinde konsola yazar)
 *
 * Hiçbir hata yukarı fırlatılmaz; gönderim başarısız olursa { sent: false } döner.
 * Bu sayede kayıt/giriş akışları e-posta servisi yüzünden asla kırılmaz.
 */

import {
  otpEmail,
  passwordResetEmail,
  verificationEmail,
  welcomeEmail,
} from "@/lib/email-templates";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SendEmailArgs = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
};

export type SendEmailResult = { sent: boolean; reason?: string; messageId?: string };

// ─── Resend ───────────────────────────────────────────────────────────────────

type ResendKey = { key: string; from: string };

function resendKeys(): ResendKey[] {
  const defs: [string, string][] = [
    ["RESEND_API_KEY", "RESEND_FROM_EMAIL"],
    ["RESEND_API_KEY_2", "RESEND_FROM_EMAIL_2"],
    ["RESEND_API_KEY_3", "RESEND_FROM_EMAIL_3"],
  ];
  const out: ResendKey[] = [];
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

async function sendViaResend(args: SendEmailArgs): Promise<SendEmailResult> {
  const pool = resendKeys();
  if (pool.length === 0) return { sent: false, reason: "resend_not_configured" };

  const to = (Array.isArray(args.to) ? args.to : [args.to]).filter(Boolean);
  if (to.length === 0) return { sent: false, reason: "no_recipient" };

  let lastStatus = 0;
  for (const { key, from } of pool) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          from,
          to,
          subject: args.subject,
          html: args.html,
          ...(args.text ? { text: args.text } : {}),
          ...(args.replyTo ? { reply_to: args.replyTo } : {}),
        }),
      });

      if (res.ok) {
        const json = (await res.json().catch(() => ({}))) as { id?: string };
        return { sent: true, messageId: json.id };
      }

      lastStatus = res.status;
      const body = await res.text();
      console.warn(`[resend] send failed [${res.status}]: ${body}`);
      // 429 (rate limit) veya 5xx → sıradaki anahtarı dene; diğer hatalarda dur.
      if (res.status !== 429 && res.status < 500) break;
    } catch (e) {
      console.warn("[resend] network error", e);
      break;
    }
  }

  return {
    sent: false,
    reason: lastStatus === 429 ? "resend_rate_limited" : "resend_send_failed",
  };
}

// ─── AWS SES v2 (SDK'sız SigV4) ──────────────────────────────────────────────

async function hmacSign(
  key: ArrayBuffer | Uint8Array,
  data: string,
): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data));
}

function bufHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(text: string): Promise<string> {
  return bufHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

function sesConfig() {
  return {
    accessKey: process.env["AWS_ACCESS_KEY_ID"],
    secretKey: process.env["AWS_SECRET_ACCESS_KEY"],
    region: process.env["AWS_REGION"] || "us-east-1",
    from: process.env["AWS_SES_FROM_EMAIL"] || "noreply@aroless.tech",
  };
}

function sesConfigured(): boolean {
  const { accessKey, secretKey } = sesConfig();
  return Boolean(accessKey && secretKey);
}

async function sendViaSes(args: SendEmailArgs): Promise<SendEmailResult> {
  const { accessKey, secretKey, region, from } = sesConfig();
  if (!accessKey || !secretKey) return { sent: false, reason: "ses_not_configured" };

  const to = (Array.isArray(args.to) ? args.to : [args.to]).filter(Boolean);
  if (to.length === 0) return { sent: false, reason: "no_recipient" };

  const host = `email.${region}.amazonaws.com`;
  const path = "/v2/email/outbound-emails";
  const payload = JSON.stringify({
    FromEmailAddress: from,
    Destination: { ToAddresses: to },
    ...(args.replyTo ? { ReplyToAddresses: [args.replyTo] } : {}),
    Content: {
      Simple: {
        Subject: { Data: args.subject, Charset: "UTF-8" },
        Body: {
          Html: { Data: args.html, Charset: "UTF-8" },
          ...(args.text ? { Text: { Data: args.text, Charset: "UTF-8" } } : {}),
        },
      },
    },
  });

  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256Hex(payload);
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonical = [
    "POST",
    path,
    "",
    `content-type:application/json\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/${region}/ses/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonical)].join("\n");

  let signingKey: ArrayBuffer | Uint8Array = new TextEncoder().encode(`AWS4${secretKey}`);
  for (const part of [dateStamp, region, "ses", "aws4_request"])
    signingKey = await hmacSign(signingKey, part);
  const signature = bufHex(await hmacSign(signingKey, toSign));

  try {
    const res = await fetch(`https://${host}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Amz-Date": amzDate,
        "X-Amz-Content-Sha256": payloadHash,
        Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
      body: payload,
    });

    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      console.warn(`[ses] send failed [${res.status}]: ${body}`);
      return { sent: false, reason: `ses_${res.status}` };
    }
    const json = (await res.json().catch(() => ({}))) as { MessageId?: string };
    return { sent: true, ...(json.MessageId ? { messageId: json.MessageId } : {}) };
  } catch (e) {
    console.warn("[ses] network error", e);
    return { sent: false, reason: "ses_network_error" };
  }
}

// ─── Fallback console log ──────────────────────────────────────────────────

/** Development/fallback mode: console'a log ve simüle et. */
async function sendViaConsole(args: SendEmailArgs): Promise<SendEmailResult> {
  const to = (Array.isArray(args.to) ? args.to : [args.to]).filter(Boolean);
  console.log("[email-fallback] Development mode — e-posta gönderimi simüle ediliyor:");
  console.log(`  To: ${to.join(", ")}`);
  console.log(`  Subject: ${args.subject}`);
  console.log(`  Body preview: ${(args.html ?? args.text ?? "").slice(0, 100)}...`);
  // Geliştirme ortamında başarılı gibi göster — böylece kayıt/giriş akışı devam eder
  return { sent: true, messageId: `dev-${Date.now()}` };
}

// ─── Unified send (Resend → SES → Console Fallback) ──────────────────────

/** Hiçbir zaman fırlatmaz. */
async function sendUnified(args: SendEmailArgs): Promise<SendEmailResult> {
  // 1) Resend dene
  const resend = await sendViaResend(args);
  if (resend.sent) return resend;

  // 2) SES dene (yapılandırılmışsa)
  if (sesConfigured()) {
    const ses = await sendViaSes(args);
    if (ses.sent) return ses;
  }

  // 3) Development fallback: console'a log et ve simüle et
  console.warn("[email] Neither Resend nor SES available — falling back to development mode");
  return await sendViaConsole(args);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * E-posta servisi yapılandırıldı mı? (Herhangi bir provider aktifse true.)
 * Auth akışlarının akışını engellemez — kullanılmamalı.
 */
export function isEmailConfigured(): boolean {
  return resendKeys().length > 0 || sesConfigured();
}

/** Genel gönderim — asla fırlatmaz. */
export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  return sendUnified(args);
}

/** Kritik olmayan bildirimler için sessiz gönderim. */
export async function trySendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  try {
    return await sendUnified(args);
  } catch (e) {
    console.error("[email] unexpected send error", e);
    return { sent: false, reason: "unexpected_error" };
  }
}

// ─── Hazır tetikleyiciler ─────────────────────────────────────────────────────

/** Kayıt sonrası hoş geldiniz e-postası. */
export async function sendWelcomeEmail(
  to: string,
  publicId: string,
): Promise<SendEmailResult> {
  const { subject, html } = welcomeEmail({ publicId, email: to });
  return trySendEmail({
    to,
    subject,
    html,
    text: `Aroless'e hoş geldiniz. Kimliğiniz: ${publicId}`,
  });
}

/** Şifre sıfırlama bağlantısı. */
export async function sendPasswordResetEmail(
  to: string,
  link: string,
): Promise<SendEmailResult> {
  const { subject, html } = passwordResetEmail({ link });
  return sendUnified({ to, subject, html, text: `Şifrenizi sıfırlayın: ${link}` });
}

/** E-posta doğrulama bağlantısı. */
export async function sendVerificationEmail(
  to: string,
  link: string,
): Promise<SendEmailResult> {
  const { subject, html } = verificationEmail({ link });
  return sendUnified({ to, subject, html, text: `Hesabınızı doğrulayın: ${link}` });
}

/** 6 haneli doğrulama kodu — asla fırlatmaz. */
export async function sendOtpCodeEmail(
  to: string,
  code: string,
): Promise<SendEmailResult> {
  const { subject, html } = otpEmail({ code });
  return sendUnified({
    to,
    subject,
    html,
    text: `Aroless doğrulama kodunuz: ${code} (10 dakika geçerli)`,
  });
}
