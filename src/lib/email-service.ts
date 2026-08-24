/**
 * AWS SES e-posta servisi — SDK'sız, Worker uyumlu SigV4 imzalı HTTP isteği.
 * Yalnızca sunucu tarafında (server function / server route handler) çağrılır.
 *
 * Gerekli ortam değişkenleri:
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, AWS_SES_FROM_EMAIL
 */

import {
  otpEmail,
  passwordResetEmail,
  verificationEmail,
  welcomeEmail,
} from "@/lib/email-templates";

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data));
}
function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

export type SendEmailArgs = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
};

export type SendEmailResult = { sent: boolean; reason?: string; messageId?: string };

function sesConfig() {
  const accessKey = process.env["AWS_ACCESS_KEY_ID"];
  const secretKey = process.env["AWS_SECRET_ACCESS_KEY"];
  const region = process.env["AWS_REGION"] || "us-east-1";
  const from = process.env["AWS_SES_FROM_EMAIL"] || "noreply@aroless.tech";
  return { accessKey, secretKey, region, from };
}

/** SES yapılandırıldı mı? */
export function isEmailConfigured(): boolean {
  const { accessKey, secretKey } = sesConfig();
  return Boolean(accessKey && secretKey);
}

/**
 * SES v2 `SendEmail` çağrısı. Anahtar yoksa gönderim sessizce atlanır
 * (kayıt/şifre akışları e-posta yüzünden kırılmamalı).
 */
export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
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
    signingKey = await hmac(signingKey, part);
  const signature = hex(await hmac(signingKey, toSign));

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
    console.error(`[ses] send failed [${res.status}]: ${body}`);
    throw new Error(`E-posta gönderilemedi (SES ${res.status}).`);
  }
  const json = (await res.json().catch(() => ({}))) as { MessageId?: string };
  return { sent: true, ...(json.MessageId ? { messageId: json.MessageId } : {}) };
}

/** Hata fırlatmadan gönderir; kritik olmayan bildirimler için. */
export async function trySendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  try {
    return await sendEmail(args);
  } catch (e) {
    console.error("[ses] non-critical send error", e);
    return { sent: false, reason: "send_failed" };
  }
}

// ------------------------------------------------------------ hazır tetikleyiciler

/** Kayıt sonrası hoş geldiniz e-postası (8 haneli Aroless kimliği ile). */
export async function sendWelcomeEmail(to: string, publicId: string): Promise<SendEmailResult> {
  const { subject, html } = welcomeEmail({ publicId, email: to });
  return trySendEmail({
    to,
    subject,
    html,
    text: `Aroless'e hoş geldiniz. Kimliğiniz: ${publicId}`,
  });
}

/** Şifre sıfırlama bağlantısı. */
export async function sendPasswordResetEmail(to: string, link: string): Promise<SendEmailResult> {
  const { subject, html } = passwordResetEmail({ link });
  return sendEmail({ to, subject, html, text: `Şifrenizi sıfırlayın: ${link}` });
}

/** E-posta doğrulama bağlantısı. */
export async function sendVerificationEmail(to: string, link: string): Promise<SendEmailResult> {
  const { subject, html } = verificationEmail({ link });
  return sendEmail({ to, subject, html, text: `Hesabınızı doğrulayın: ${link}` });
}

/** 6 haneli doğrulama kodu. */
export async function sendOtpCodeEmail(to: string, code: string): Promise<SendEmailResult> {
  const { subject, html } = otpEmail({ code });
  return sendEmail({
    to,
    subject,
    html,
    text: `Aroless doğrulama kodunuz: ${code} (10 dakika geçerli)`,
  });
}
