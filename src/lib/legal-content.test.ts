// Yasal belgeler — "kabul edilen metin" ile kodun gerçekte uyguladığı kuralların
// ayrışmasını engelleyen testler.
//
// NEDEN: onay kutuları birer sözleşme kanıtıdır. Metin, kodun uyguladığı
// oran/süre/eşik/onay akışıyla aynı olmazsa anlaşmazlıkta "şartlarda
// yazmıyordu" itirazı haklı çıkar. Bu yüzden hem affiliate sayıları hem de
// mesafeli satış / cayma / uyuşmazlık hükümleri burada kilitlenir.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMMISSION_MAX_MONTHS, DEFAULT_COMMISSION_RATE_PCT, MIN_PAYOUT_CENTS } from "./affiliate";
import { PAYOUT_HOLD_DAYS } from "./affiliate-payout";
import {
  AFFILIATE_TERMS,
  getLegalDoc,
  KVKK,
  LAST_UPDATED,
  LEGAL_DOCS,
  LEGAL_VERSION,
  MESAFELI_SATIS,
  ON_BILGILENDIRME,
  SELLER,
  TOS,
} from "./legal-content";

const docText = (doc: { sections: Array<{ heading: string; body: string[] }> }) =>
  doc.sections.flatMap((s) => [s.heading, ...s.body]).join("\n");

const affiliateText = docText(AFFILIATE_TERMS);
const tosText = docText(TOS);
const kvkkText = docText(KVKK);
const preInfoText = docText(ON_BILGILENDIRME);
const distanceText = docText(MESAFELI_SATIS);

const read = (path: string) => readFileSync(path, "utf8");

describe("legal content — sürüm ve yayın", () => {
  it("sürüm ve son güncelleme tutarlıdır", () => {
    expect(LEGAL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(LAST_UPDATED).toContain("2026");
    expect(SELLER.email).toContain("@");
  });

  it("mesafeli satış ve ön bilgilendirme belgeleri yasal merkezde yayınlanır", () => {
    expect(LEGAL_DOCS).toContain(MESAFELI_SATIS);
    expect(LEGAL_DOCS).toContain(ON_BILGILENDIRME);
    expect(getLegalDoc("mesafeli-satis-sozlesmesi")).toBe(MESAFELI_SATIS);
    expect(getLegalDoc("on-bilgilendirme-formu")).toBe(ON_BILGILENDIRME);
    expect(MESAFELI_SATIS.title).toContain("Mesafeli Satış");
    expect(ON_BILGILENDIRME.title).toContain("Ön Bilgilendirme");
    expect(MESAFELI_SATIS.sections.length).toBeGreaterThan(7);
    expect(ON_BILGILENDIRME.sections.length).toBeGreaterThan(6);
  });
});

describe("ön bilgilendirme formu — 6502 m.48 / MSY m.5", () => {
  it("satıcı, ödeme sağlayıcısı ve toplam fiyat bilgisini taşır", () => {
    expect(preInfoText).toContain("6502");
    expect(preInfoText).toContain("Mesafeli Sözleşmeler Yönetmeliği");
    expect(preInfoText).toContain("Paddle");
    expect(preInfoText).toContain("tüm vergiler dahil");
    expect(preInfoText).toMatch(/MERSİS|vergi kimlik/i);
    expect(preInfoText).toContain(SELLER.email);
  });

  it("cayma hakkı, istisnası ve iade süresini açıkça yazar", () => {
    expect(preInfoText).toContain("14 gün");
    expect(preInfoText).toContain("cayma");
    expect(preInfoText).toContain("m.15/1");
    expect(preInfoText).toContain("iade");
    expect(preInfoText).toMatch(/örnek cayma formu/i);
  });

  it("tüketici uyuşmazlık mercilerini ve arabuluculuğu gösterir", () => {
    expect(preInfoText).toContain("Tüketici Hakem Heyeti");
    expect(preInfoText).toContain("Tüketici Mahkemesi");
    expect(preInfoText).toContain("arabuluculuk");
    expect(preInfoText).toContain("m.73/A");
  });
});

describe("mesafeli satış sözleşmesi", () => {
  it("taraflar, bedel, ifa ve yenileme hükümlerini taşır", () => {
    expect(distanceText).toContain("Satıcı/Hizmet Sağlayıcı");
    expect(distanceText).toContain("Paddle");
    expect(distanceText).toContain("otomatik yenilenir");
    expect(distanceText).toContain("tüm vergiler dahil");
  });

  it("cayma, ayıplı hizmet ve tüketici haklarını düzenler", () => {
    expect(distanceText).toContain("14 gün");
    expect(distanceText).toContain("cayma");
    expect(distanceText).toContain("m.15");
    expect(distanceText).toContain("ayıplı hizmet");
    expect(distanceText).toContain("6502");
    expect(distanceText).toContain("m.68");
    expect(distanceText).toContain("m.73");
  });
});

describe("mevcut belgelerdeki hukuki risk düzeltmeleri", () => {
  it("Kullanım Koşulları tüketici satışını dışlamaz; emredici hakları korur", () => {
    expect(tosText).not.toContain("tüketiciye yönelik bir satış platformu değildir");
    expect(tosText).toContain("6502");
    expect(tosText).toContain("tüketici");
    expect(tosText).toContain("Tüketici Hakem Heyeti");
    expect(tosText).toContain("ağır ihmal");
    expect(tosText).toContain("Mesafeli Satış Sözleşmesi");
  });

  it("Kullanım Koşulları abonelik yenilemesini ve iptal sınırını açıkça söyler", () => {
    expect(tosText).toContain("otomatik yenilenir");
    expect(tosText).toContain("dönemin sonunda");
    expect(tosText).toContain("tüketicinin yasal cayma ve iade haklarını ortadan kaldırmaz");
  });

  it("KVKK saklama süresini veri minimizasyonuyla uyumlu yazar", () => {
    expect(kvkkText).not.toContain(
      "Üyelik verileri, üyelik süresince ve sona ermesinden itibaren 10 yıl",
    );
    expect(kvkkText).toContain("amaç sona erdiğinde");
    expect(kvkkText).toContain("Türk Ticaret Kanunu");
    expect(kvkkText).toContain("veri minimizasyonu");
    expect(kvkkText).toContain("İYS");
  });
});

describe("affiliate program şartları belgesi", () => {
  it("yasal merkezde yayınlanır ve slug ile bulunur", () => {
    expect(LEGAL_DOCS).toContain(AFFILIATE_TERMS);
    expect(getLegalDoc("affiliate-program-sartlari")).toBe(AFFILIATE_TERMS);
    expect(AFFILIATE_TERMS.title).toContain("Affiliate");
    expect(AFFILIATE_TERMS.sections.length).toBeGreaterThan(4);
  });

  it("kodun uyguladığı sayıları yazar (panel ↔ belge ayrışmasın)", () => {
    const lower = affiliateText.toLowerCase();
    expect(lower).toContain(`${COMMISSION_MAX_MONTHS} ay`); // 12 aylık pencere
    expect(lower).toContain(`${PAYOUT_HOLD_DAYS} gün`); // 30 günlük bekleme
    expect(affiliateText).toContain(`$${MIN_PAYOUT_CENTS / 100}`); // $75 eşiği
    expect(affiliateText).toContain(`%${DEFAULT_COMMISSION_RATE_PCT}`); // %30 oran
  });

  it("komisyon penceresini 'müşteri kaç ay ücretli kaldıysa o kadar' diye açıklar", () => {
    expect(affiliateText).toMatch(/ücretli kaldığı ay/i);
  });

  it("iade mahsubunu, kendine atıf yasağını ve vergi sorumluluğunu açıkça söyler", () => {
    expect(affiliateText).toMatch(/mahsup/i);
    expect(affiliateText).toMatch(/kendine atıf/i);
    expect(affiliateText).toMatch(/katılımcıya aittir/);
    // Vergi no ödeme ŞARTI değildir (kodda opsiyonel alan).
    // NOT: `i` bayrağı Türkçe "İ" (U+0130) ile eşleşmediği için büyük harf
    // biçimi doğrudan aranır.
    expect(affiliateText).toMatch(/ödeme şartı değildir/);
    expect(affiliateText).toMatch(/OPSİYONELDİR/);
    expect(affiliateText).toMatch(/stopaj/i);
  });
});

describe("ödeme öncesi onay akışı koda bağlıdır", () => {
  it("footer ve yasal merkez yeni belgelere bağlantı verir", () => {
    const footer = read("src/components/site-footer.tsx");
    const legalIndex = read("src/routes/legal/index.tsx");
    expect(footer).toContain('"mesafeli-satis-sozlesmesi"');
    expect(footer).toContain('"on-bilgilendirme-formu"');
    expect(legalIndex).toContain("LEGAL_DOCS");
  });

  it("pricing modal iki ayrı onayı zorunlu tutar ve belgeleri gösterir", () => {
    const modal = read("src/components/pricing-modal.tsx");
    expect(modal).toContain("legalAccepted");
    expect(modal).toContain("immediateAccepted");
    expect(modal).toContain("/legal/on-bilgilendirme-formu");
    expect(modal).toContain("/legal/mesafeli-satis-sozlesmesi");
    expect(modal).toContain("!legalReady");
  });

  it("sunucu onayları doğrular ve customData'ya onay izi yazar", () => {
    const fn = read("src/lib/paddle.functions.ts");
    const server = read("src/lib/paddle.server.ts");
    expect(fn).toContain("immediatePerformanceAccepted");
    expect(server).toContain("immediatePerformanceAccepted");
    expect(server).toContain("legalAcceptedAt");
    expect(server).toContain("withdrawalWaived");
  });
});
