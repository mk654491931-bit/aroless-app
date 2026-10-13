/**
 * Aroless e-posta şablonları — koyu, modern SaaS görünümü.
 * Saf HTML (inline stil) döner; e-posta istemcileri CSS dosyası desteklemez.
 */

import { COMMISSION_MAX_MONTHS } from "./affiliate";
import { PAYOUT_HOLD_DAYS } from "./affiliate-payout";

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

const usd = (cents: number) =>
  `$${(Math.max(0, Math.round(cents)) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/**
 * AFFILIATE KOMİSYON BİLDİRİMİ — "komisyon kazandın".
 *
 * NEDEN VAR: komisyon yazıldığında influencer yalnız paneli açarsa görüyordu;
 * sürekli panele bakmayan kişi programı ölü sanır ve paylaşmayı bırakır. E-posta
 * kazanç, plan, birikim ve ödeme eşiği durumunu özetler; ödeme tarihi vaat
 * ETMEZ (ödemeler manuel ve bekleme süresine bağlıdır — ölçülmemiş söz vermiyoruz).
 */
export function affiliateCommissionEmail(args: {
  commissionCents: number;
  grossCents: number;
  tier: string | null;
  promoCode: string | null;
  /** Ödenebilir birikim (bekleme süresi dolmuş). */
  payableCents?: number;
  /** Beklemedeki (30 gün dolmamış) birikim. */
  heldCents?: number;
  minPayoutCents?: number;
}) {
  const code = args.promoCode ? args.promoCode : null;
  const payable = args.payableCents ?? 0;
  const held = args.heldCents ?? 0;
  const min = args.minPayoutCents ?? 7500;
  const remaining = Math.max(0, min - payable);

  const progress =
    payable >= min
      ? `<p style="margin:0;color:${TEXT};"><b>Ödeme eşiğini geçtin.</b> Ödeme, yönetici tarafından Wise/IBAN ile yapılır ve transfer referansı paneline işlenir.</p>`
      : `<p style="margin:0;color:${MUTED};">Ödeme eşiği <b style="color:${TEXT};">${usd(min)}</b>. Ödenebilir bakiyene <b style="color:${TEXT};">${usd(remaining)}</b> daha eklendiğinde ödeme yapılır.</p>`;

  return {
    subject: `Affiliate komisyonun: ${usd(args.commissionCents)}`,
    html: shell({
      title: "Affiliate komisyonu",
      preview: `${args.tier ?? "Abonelik"} ödemesinden ${usd(args.commissionCents)} komisyon`,
      body: `<h1 style="margin:0 0 10px;font-size:22px;font-weight:600;color:#fff;">Komisyon kazandın</h1>
        <p style="margin:0;color:${MUTED};">${code ? `“${code}” kodunla` : "Affiliate kodunla"} gelen bir abonelik ödemesi işlendi.</p>
        <div style="margin:22px 0;padding:18px;border-radius:14px;background:rgba(122,162,255,0.10);border:1px solid rgba(122,162,255,0.28);text-align:center;">
          <div style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:${MUTED};">Komisyon</div>
          <div style="margin-top:8px;font-size:30px;font-weight:700;color:${BRAND};">${usd(args.commissionCents)}</div>
          <div style="margin-top:6px;font-size:12px;color:${MUTED};">${args.tier ?? "Abonelik"} · ödenen tutar ${usd(args.grossCents)}</div>
        </div>
        <p style="margin:0 0 6px;color:${MUTED};">Bakiye durumu:</p>
        <ul style="margin:0 0 16px;padding-left:18px;color:${TEXT};">
          <li>Ödenebilir (bekleme süresi dolmuş): <b>${usd(payable)}</b></li>
          <li>Beklemede (ödemeden önce ${PAYOUT_HOLD_DAYS} gün geçmeli): <b>${usd(held)}</b></li>
        </ul>
        ${progress}
        <p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:${MUTED};">
          Komisyon her müşteri için <b style="color:${TEXT};">en fazla ${COMMISSION_MAX_MONTHS} ay</b> yazılır (müşteri kaç ay ücretli kaldıysa o kadar).
          <a href="${APP_URL}/legal/affiliate-program-sartlari" style="color:${BRAND};">Program şartları</a>
        </p>
        ${button(`${APP_URL}/settings`, "Affiliate panelini aç")}`,
    }),
  };
}

/**
 * HTML kaçışı — şablona admin/kullanıcı kaynaklı metin girdiğinde (ödeme
 * referansı, promo kodu) tek bir `<` karakterinin e-postanın geri kalanını
 * bozmasını engeller. Kaçışsız bırakılan bir dekont no, mailin gövdesini
 * kırıp "ödeme yapıldı" bilgisini görünmez kılabilir.
 */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Ödeme yönteminin insan okunur adı (e-posta ve panel aynı metni kullanır). */
export function payoutMethodLabel(method: string | null | undefined): string {
  switch (method) {
    case "wise":
      return "Wise";
    case "iban":
      return "Banka havalesi (IBAN)";
    default:
      return "Manuel transfer";
  }
}

/**
 * AFFILIATE ÖDEME BİLDİRİMİ — "ödemen yapıldı".
 *
 * NEDEN VAR: ödeme yapıldığında affiliate bunu yalnız panele girip bakarsa
 * görüyordu. Ödemenin sessizce yapılması, programın en kritik güven anını
 * ("para gerçekten geldi mi?") belirsiz bırakır; influencer panele bakmadığı
 * için ödeme yapılmamış sanır ve paylaşmayı bırakır.
 *
 * REFERANS ZORUNLU İÇERİK: transfer tek başına hesapta görünür ama hangi
 * ödemeye ait olduğu anlaşılmaz. Dekont/referans numarası, affiliate'in banka
 * ekstresiyle eşleştirme yapabilmesi için gönderilir.
 *
 * TARİH VAADİ YOK: transfer bankaya göre gecikir; bu yüzden "şu tarihte
 * hesabında" gibi ölçülmemiş bir söz verilmez, yalnız "gönderildi" denir.
 */
export function affiliatePayoutEmail(args: {
  /** Ödenmiş komisyon toplamı (minor units). */
  paidCents: number;
  /** Kaç komisyon satırı ödendi. */
  paidCount: number;
  /** wise | iban | other (kayıt neyse). */
  method: string | null | undefined;
  /** Transfer dekont/referans numarası — eşleştirme için. */
  reference: string;
  /** Ödeme sonrası hâlâ beklemede olan (30 günü dolmamış) birikim. */
  heldCents?: number;
}) {
  const method = payoutMethodLabel(args.method);
  const reference = esc(args.reference);
  const held = args.heldCents ?? 0;

  const heldBlock =
    held > 0
      ? `<p style="margin:16px 0 0;color:${MUTED};">Ödeme dışında kalan bekleyen tutar: <b style="color:${TEXT};">${usd(held)}</b>.<br />Beklemedeki komisyonlar ödenmeden önce ${PAYOUT_HOLD_DAYS} gün bekler; süre dolduğunda bir sonraki ödemeye eklenir.</p>`
      : `<p style="margin:16px 0 0;color:${MUTED};">Şu an beklemede başka birikim yok. Yeni komisyonlar panelde birikmeye devam eder ve ödenmeden önce ${PAYOUT_HOLD_DAYS} gün bekler.</p>`;

  return {
    subject: `Affiliate ödemen yapıldı: ${usd(args.paidCents)}`,
    html: shell({
      title: "Affiliate ödemen yapıldı",
      preview: `${usd(args.paidCents)} transfer edildi · referans ${reference}`,
      body: `<h1 style="margin:0 0 10px;font-size:22px;font-weight:600;color:#fff;">Ödemen yapıldı</h1>
        <p style="margin:0;color:${MUTED};">Birikmiş affiliate komisyonun ödendi olarak işlendi ve transfer gönderildi.</p>
        <div style="margin:22px 0 8px;padding:18px;border-radius:14px;background:rgba(122,162,255,0.10);border:1px solid rgba(122,162,255,0.28);text-align:center;">
          <div style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:${MUTED};">Ödenen tutar</div>
          <div style="margin-top:8px;font-size:30px;font-weight:700;color:${BRAND};">${usd(args.paidCents)}</div>
          <div style="margin-top:6px;font-size:12px;color:${MUTED};">${method} · ${args.paidCount} komisyon kaydı</div>
        </div>
        <div style="margin:12px 0 0;padding:14px;border-radius:12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);text-align:center;">
          <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${MUTED};">Transfer referansı</div>
          <div style="margin-top:6px;font-size:16px;font-weight:700;letter-spacing:1px;color:${TEXT};word-break:break-all;">${reference}</div>
        </div>
        <p style="margin:14px 0 0;color:${MUTED};">Bankanda/ekstrelerinde bu referansı arayarak transferi eşleştirebilirsin. Tutarın hesabına geçmesi bankaya göre birkaç iş günü sürebilir.</p>
        ${heldBlock}
        <p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:${MUTED};">
          Komisyon geliri kendi gelirindir; vergi, mükellefiyet ve beyan yükümlülüğü sana aittir.
          <a href="${APP_URL}/legal/affiliate-program-sartlari" style="color:${BRAND};">Program şartları</a>
        </p>
        ${button(`${APP_URL}/settings`, "Kazanç geçmişini aç")}`,
    }),
  };
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
