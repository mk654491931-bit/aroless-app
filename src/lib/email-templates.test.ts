// Affiliate komisyon bildirimi — e-postanın SÖZÜ, kodun uyguladığı kurallarla
// aynı olmalı: 12 aylık pencere, 30 günlük bekleme ve program şartlarının adresi.
//
// NEDEN: e-posta influencer'ın gördüğü ilk "sözleşme özeti"dir. Orada yazmayan
// bir sınırı (12 ay) sonradan uygulamak, hak iddiasına açık kapı bırakır; bu
// yüzden sayılar burada koddaki sabitlerle karşılaştırılır.
import { describe, expect, it } from "vitest";
import { COMMISSION_MAX_MONTHS } from "./affiliate";
import { PAYOUT_HOLD_DAYS } from "./affiliate-payout";
import {
  APP_URL,
  affiliateCommissionEmail,
  affiliatePayoutEmail,
  payoutMethodLabel,
} from "./email-templates";

const base = {
  commissionCents: 870,
  grossCents: 2900,
  tier: "Pro",
  promoCode: "AYSE20",
  heldCents: 870,
};

/** Ödenebilir bakiyesi eşiğin ALTINDA olan durum. */
const below = affiliateCommissionEmail({ ...base, payableCents: 5000 });
/** Ödenebilir bakiyesi eşiği GEÇEN durum. */
const above = affiliateCommissionEmail({ ...base, payableCents: 9000 });

describe("affiliate komisyon e-postası", () => {
  it("kazancı, kodu ve ödenebilir/beklemede bakiyeyi yazar", () => {
    expect(below.subject).toContain("$8.70");
    expect(below.html).toContain("$8.70");
    expect(below.html).toContain("AYSE20");
    expect(below.html).toContain("$50.00"); // ödenebilir
    expect(below.html).toContain(`ödemeden önce ${PAYOUT_HOLD_DAYS} gün`);
  });

  it("12 aylık pencereyi ve program şartlarının bağlantısını içerir", () => {
    expect(below.html).toContain(`en fazla ${COMMISSION_MAX_MONTHS} ay`);
    expect(below.html).toContain(`${APP_URL}/legal/affiliate-program-sartlari`);
  });

  it("eşiğin altındaysa kalan tutarı söyler", () => {
    // $75 eşiği − $50 ödenebilir = $25 kaldı.
    expect(below.html).toContain("$25.00");
  });

  it("eşik geçildiyse ödemenin Wise/IBAN ile yapıldığını söyler", () => {
    expect(above.html).toMatch(/Wise\/IBAN/);
  });

  it("ölçülmemiş bir ödeme TARİHİ vaat etmez", () => {
    for (const mail of [below, above]) {
      expect(mail.html).not.toMatch(/tarihinde ödene/i);
    }
  });
});

/**
 * ÖDEME BİLDİRİMİ — "para gerçekten gönderildi mi?" sorusunun cevabı.
 *
 * NEDEN TEST: bu e-posta, affiliate'in ödeme aldığını gördüğü TEK kanal olabilir
 * (panele girmeyebilir). Tutar veya REFERANS yanlış/eksik olursa kişi banka
 * ekstresinde transferi eşleştiremez ve ödeme yapılmamış sanır — yani bildirimin
 * kendisi sahte bir "sorun" yaratır. Bu yüzden tutar, kayıt sayısı, yöntem ve
 * referans burada kilitlenir.
 */
const payout = affiliatePayoutEmail({
  paidCents: 12345,
  paidCount: 4,
  method: "wise",
  reference: "PAY-20261013123045",
  heldCents: 900,
});
const payoutNothingHeld = affiliatePayoutEmail({
  paidCents: 7500,
  paidCount: 1,
  method: "iban",
  reference: "TR-DEKONT-77",
});

describe("affiliate ödeme bildirimi", () => {
  it("tutarı, kayıt sayısını, yöntemi ve referansı yazar", () => {
    expect(payout.subject).toContain("$123.45");
    expect(payout.html).toContain("$123.45");
    expect(payout.html).toContain("4 komisyon kaydı");
    expect(payout.html).toContain("Wise");
    expect(payout.html).toContain("PAY-20261013123045");
  });

  it("referansı olmadan eşleştirme yapılamayacağı için referans başlığı ayrı gösterilir", () => {
    expect(payout.html).toMatch(/Transfer referansı/);
    expect(payout.html).toContain("Transfer referansı");
  });

  it("IBAN yönteminde insan okunur etiketi kullanır", () => {
    expect(payoutMethodLabel("iban")).toBe("Banka havalesi (IBAN)");
    expect(payoutMethodLabel("wise")).toBe("Wise");
    expect(payoutMethodLabel(null)).toBe("Manuel transfer");
    expect(payoutNothingHeld.html).toContain("Banka havalesi (IBAN)");
  });

  it("bekleyen birikim varsa söyler, yoksa 'beklemede yok' der (sürpriz ödeme olmasın)", () => {
    expect(payout.html).toContain("$9.00");
    expect(payout.html).toMatch(new RegExp(`ödenmeden önce ${PAYOUT_HOLD_DAYS} gün`));
    expect(payoutNothingHeld.html).toMatch(new RegExp(`ödenmeden önce ${PAYOUT_HOLD_DAYS} gün`));
    expect(payoutNothingHeld.html).toContain("beklemede başka birikim yok");
  });

  it("program şartlarına ve vergi yükümlülüğüne atıf yapar", () => {
    expect(payout.html).toContain(`${APP_URL}/legal/affiliate-program-sartlari`);
    expect(payout.html).toMatch(/vergi/i);
  });

  it("IBAN gibi hassas ödeme bilgisini ve boş şablon değerlerini sızdırmaz", () => {
    for (const mail of [payout, payoutNothingHeld]) {
      expect(mail.html).not.toMatch(/[A-Z]{2}\d{2}[A-Z0-9]{10,}/);
      expect(mail.html).not.toContain("undefined");
      expect(mail.html).not.toContain("NaN");
    }
  });

  it("referanstaki HTML karakterleri kaçırılır (gövde bozulmasın)", () => {
    const injected = affiliatePayoutEmail({
      paidCents: 100,
      paidCount: 1,
      method: "other",
      reference: "PAY<script>alert(1)</script>",
    });
    expect(injected.html).not.toContain("<script>");
    expect(injected.html).toContain("&lt;script&gt;");
  });
});
