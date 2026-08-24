/**
 * Aroless e-posta şablonları — koyu, modern SaaS görünümü.
 * Saf HTML (inline stil) döner; e-posta istemcileri CSS dosyası desteklemez.
 */

const BRAND = "#7aa2ff";
const BG = "#0b0f1a";
const CARD = "#111827";
const TEXT = "#e5e7eb";
const MUTED = "#9ca3af";

export const APP_URL = "https://aroless.tech";

function shell(opts: { title: string; preview: string; body: string }): string {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" /><title>${opts.title}</title></head>
<body style="margin:0;padding:0;background:${BG};font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${opts.preview}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:32px 16px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${CARD};border:1px solid rgba(122,162,255,0.18);border-radius:18px;overflow:hidden;">
    <tr><td style="padding:28px 28px 8px;">
      <img src="${APP_URL}/logo-mark.png" width="44" height="44" alt="Aroless" style="display:block;margin:0 0 12px;border:0;outline:none;" />
      <div style="font-size:19px;font-weight:300;letter-spacing:0.3em;text-transform:uppercase;color:${TEXT};">Aroless</div>
      <div style="margin-top:6px;font-size:9px;font-weight:600;letter-spacing:0.34em;text-transform:uppercase;color:${BRAND};">AI Commerce OS</div>
    </td></tr>
    <tr><td style="padding:12px 28px 32px;color:${TEXT};font-size:15px;line-height:1.65;">${opts.body}</td></tr>
    <tr><td style="padding:18px 28px 26px;border-top:1px solid rgba(255,255,255,0.06);color:${MUTED};font-size:11px;line-height:1.6;">
      Bu e-posta Aroless hesabınızla ilgili otomatik bir bildirimdir.<br />
      <a href="${APP_URL}" style="color:${BRAND};text-decoration:none;">aroless.tech</a>
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

function button(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;margin-top:20px;padding:13px 26px;border-radius:12px;background:${BRAND};color:#0b0f1a;font-weight:700;font-size:14px;text-decoration:none;">${label}</a>`;
}

function idBadge(publicId: string): string {
  return `<div style="margin:22px 0;padding:18px;border-radius:14px;background:rgba(122,162,255,0.10);border:1px solid rgba(122,162,255,0.28);text-align:center;">
    <div style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:${MUTED};">Aroless Kimliğiniz</div>
    <div style="margin-top:8px;font-size:30px;font-weight:700;letter-spacing:8px;color:${BRAND};">${publicId}</div>
  </div>`;
}

/** Kayıt sonrası hoş geldiniz + 8 haneli kimlik. */
export function welcomeEmail(args: { publicId: string; email: string }) {
  return {
    subject: `Aroless'e hoş geldiniz — Kimliğiniz ${args.publicId}`,
    html: shell({
      title: "Aroless'e hoş geldiniz",
      preview: `Aroless kimliğiniz: ${args.publicId}`,
      body: `<h1 style="margin:0 0 10px;font-size:22px;font-weight:600;color:#fff;">Aroless'e hoş geldiniz</h1>
        <p style="margin:0;color:${MUTED};">Hesabınız hazır. Aşağıdaki 8 haneli kimlik size özeldir; destek taleplerinde bu kimliği paylaşın.</p>
        ${idBadge(args.publicId)}
        <p style="margin:0;color:${MUTED};">Hızlı başlangıç:</p>
        <ul style="margin:8px 0 0;padding-left:18px;color:${TEXT};">
          <li>Ürün Bulucu ile 14 ajanlı konsey analizini çalıştırın</li>
          <li>Kazanan Ürün Radarı ile yükselen trendleri izleyin</li>
          <li>Kâr / ROI panelinde birim ekonomilerinizi hesaplayın</li>
        </ul>
        ${button(`${APP_URL}/dashboard`, "Panele git")}`,
    }),
  };
}

/** Şifre sıfırlama bağlantısı. */
export function passwordResetEmail(args: { link: string }) {
  return {
    subject: "Aroless şifre sıfırlama",
    html: shell({
      title: "Şifre sıfırlama",
      preview: "Şifrenizi sıfırlamak için bağlantıya tıklayın",
      body: `<h1 style="margin:0 0 10px;font-size:22px;font-weight:600;color:#fff;">Şifrenizi sıfırlayın</h1>
        <p style="margin:0;color:${MUTED};">Aşağıdaki bağlantı 60 dakika geçerlidir. Bu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz.</p>
        ${button(args.link, "Şifreyi sıfırla")}`,
    }),
  };
}

/** E-posta doğrulama bağlantısı. */
export function verificationEmail(args: { link: string }) {
  return {
    subject: "Aroless e-posta doğrulama",
    html: shell({
      title: "E-posta doğrulama",
      preview: "Hesabınızı doğrulamak için bağlantıya tıklayın",
      body: `<h1 style="margin:0 0 10px;font-size:22px;font-weight:600;color:#fff;">E-postanızı doğrulayın</h1>
        <p style="margin:0;color:${MUTED};">Hesabınızı etkinleştirmek için aşağıdaki bağlantıya tıklayın.</p>
        ${button(args.link, "Hesabımı doğrula")}`,
    }),
  };
}

/** 6 haneli doğrulama kodu. */
export function otpEmail(args: { code: string }) {
  return {
    subject: `Aroless doğrulama kodunuz: ${args.code}`,
    html: shell({
      title: "Doğrulama kodu",
      preview: `Kodunuz: ${args.code}`,
      body: `<h1 style="margin:0 0 10px;font-size:22px;font-weight:600;color:#fff;">Doğrulama kodunuz</h1>
        <p style="margin:0;color:${MUTED};">Kod 10 dakika geçerlidir.</p>
        <div style="margin-top:20px;padding:18px;border-radius:14px;background:rgba(122,162,255,0.10);border:1px solid rgba(122,162,255,0.28);text-align:center;font-size:32px;font-weight:700;letter-spacing:10px;color:${BRAND};">${args.code}</div>`,
    }),
  };
}
