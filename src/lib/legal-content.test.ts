// Affiliate program şartları belgesi — "kabul edilen metin" ile kodun uyguladığı
// kuralların ayrışmasını engelleyen test.
//
// NEDEN: başvuru ekranındaki onay kutusu bir sözleşme kanıtıdır
// (`affiliates.terms_accepted_at`). Kabul edilen metin kodun gerçekte
// uyguladığı oran/süre/eşikle aynı olmazsa, komisyon anlaşmazlığında
// "şartlarda yazmıyordu" itirazı haklı çıkar — bu yüzden sayılar burada
// koddaki sabitlerle karşılaştırılır.
import { describe, expect, it } from "vitest";
import { COMMISSION_MAX_MONTHS, DEFAULT_COMMISSION_RATE_PCT, MIN_PAYOUT_CENTS } from "./affiliate";
import { PAYOUT_HOLD_DAYS } from "./affiliate-payout";
import { AFFILIATE_TERMS, getLegalDoc, LEGAL_DOCS } from "./legal-content";

const text = AFFILIATE_TERMS.sections.flatMap((s) => [s.heading, ...s.body]).join("\n");

describe("affiliate program şartları belgesi", () => {
  it("yasal merkezde yayınlanır ve slug ile bulunur", () => {
    expect(LEGAL_DOCS).toContain(AFFILIATE_TERMS);
    expect(getLegalDoc("affiliate-program-sartlari")).toBe(AFFILIATE_TERMS);
    expect(AFFILIATE_TERMS.title).toContain("Affiliate");
    expect(AFFILIATE_TERMS.sections.length).toBeGreaterThan(4);
  });

  it("kodun uyguladığı sayıları yazar (panel ↔ belge ayrışmasın)", () => {
    const lower = text.toLowerCase();
    expect(lower).toContain(`${COMMISSION_MAX_MONTHS} ay`); // 12 aylık pencere
    expect(lower).toContain(`${PAYOUT_HOLD_DAYS} gün`); // 30 günlük bekleme
    expect(text).toContain(`$${MIN_PAYOUT_CENTS / 100}`); // $75 eşiği
    expect(text).toContain(`%${DEFAULT_COMMISSION_RATE_PCT}`); // %30 oran
  });

  it("komisyon penceresini 'müşteri kaç ay ücretli kaldıysa o kadar' diye açıklar", () => {
    expect(text).toMatch(/ücretli kaldığı ay/i);
  });

  it("iade mahsubunu, kendine atıf yasağını ve vergi sorumluluğunu açıkça söyler", () => {
    expect(text).toMatch(/mahsup/i);
    expect(text).toMatch(/kendine atıf/i);
    expect(text).toMatch(/katılımcıya aittir/);
    // Vergi no ödeme ŞARTI değildir (kodda opsiyonel alan).
    // NOT: `i` bayrağı Türkçe "İ" (U+0130) ile eşleşmediği için büyük harf
    // biçimi doğrudan aranır.
    expect(text).toMatch(/ödeme şartı değildir/);
    expect(text).toMatch(/OPSİYONELDİR/);
  });
});
