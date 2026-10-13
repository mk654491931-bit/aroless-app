/**
 * AFFILIATE KOMİSYON ZİNCİRİ — BAĞLANTI TESTİ (uçtan uca kablo).
 *
 * NEDEN VAR: %30'luk komisyon zinciri beş ayrı dosyada yaşar ve herhangi bir
 * halka sessizce kopabilir:
 *
 *   ?promo=KOD  →  localStorage  →  hesaba bağlama  →  promo_codes.affiliate_id
 *              →  Paddle ödeme (indirim kodu ekranı)  →  webhook  →  komisyon
 *
 * Ölçülen / riskli kopmalar:
 *   1. Kod YALNIZ kayıt formundan yakalanıyordu: Google ile giren veya önce
 *      landing'e uğrayan kullanıcıda atıf tamamen kayboluyordu.
 *   2. Panel toplamları en yeni 50 satırdan hesaplanıyordu → eksik "birikmiş"
 *      ve yanlış ödeme eşiği.
 *   3. Affiliate kodu tanımlanmadan davet linki "affiliate linkin" gibi
 *      gösteriliyordu; davet programı en fazla 2 arkadaşla sınırlıdır.
 *   4. Self-referral (kendi koduyla ikinci hesap) engellenmiyordu.
 *   5. Checkout'ta indirim kodu alanı açıkça istenmiyordu.
 *
 * Bu test kabloyu kilitler: davranış değişirse burada görünür.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const root = read("../routes/__root.tsx");
const index = read("../routes/index.tsx");
const auth = read("../routes/auth.tsx");
const promoFns = read("./promo.functions.ts");
const signupFns = read("./signup.functions.ts");
const signupServer = read("./signup.server.ts");
const affiliateFns = read("./affiliate.functions.ts");
const paddleCheckout = read("./paddle-checkout.ts");
const affiliatePanel = read("../components/affiliate-panel.tsx");

describe("?promo=KOD taşınması (atıf kaybına karşı)", () => {
  it("__root.tsx geçerli kodu localStorage'a yazar", () => {
    expect(root).toMatch(/aroless\.promo/);
    expect(root).toMatch(/isValidAffiliateCode\(promo\)/);
  });

  it("auth formu URL'de kod yoksa saklanan kodu ön-doldurur", () => {
    expect(auth).toMatch(/getBrandedItem\("aroless\.promo"\)/);
  });

  it("giriş sonrası hesaba bağlama çağrısı yapılır ve başarıda anahtar silinir", () => {
    expect(index).toMatch(/claimPromoCodeFn\(\{ data: \{ code \} \}\)/);
    expect(index).toMatch(
      /removeBrandedItem\("aroless\.promo"\)[\s\S]{0,200}?claimPromoCodeFn|claimPromoCodeFn[\s\S]{0,900}?removeBrandedItem\("aroless\.promo"\)/,
    );
  });

  it("davet ve promo akışı birbirini ezmez: önce davet, sonra kod bağlanır", () => {
    expect(index).toMatch(/await claimStoredReferral\(\)[\s\S]{0,200}?await claimStoredPromo\(\)/);
  });
});

describe("claimPromoCode sunucu kuralı", () => {
  it("saf karar fonksiyonunu kullanır (kural testte kilitli)", () => {
    expect(promoFns).toMatch(/promoClaimDecision\(/);
    expect(promoFns).toMatch(/export const claimPromoCode = createServerFn/);
  });

  it("referred_by yalnız BOŞKEN yazılır (mevcut davet sahibi korunur)", () => {
    expect(promoFns).toMatch(/!row\.referred_by \? \{ referred_by: affiliateId \}/);
  });

  it("kendi kodunu kullanmayı reddeder", () => {
    expect(promoFns).toMatch(/affiliateId === context\.userId[\s\S]{0,200}?code: "self"/);
  });
});

describe("self-referral koruması", () => {
  it("kayıt akışı cihaz parmak izini affiliate hesabıyla karşılaştırır", () => {
    expect(signupServer).toMatch(/isSelfReferralDevice\(/);
    expect(signupFns).toMatch(/isSelfReferralSignup\(supabaseAdmin, \{/);
  });

  it("self-referral'da atıf YAZILMAZ (komisyon doğmaz) ama admin uyarısı düşer", () => {
    expect(signupFns).toMatch(
      /if \(selfReferral && promo\.affiliate_id\)[\s\S]{0,400}?notifySelfReferralBlocked\(/,
    );
    expect(signupFns).toMatch(/else \{[\s\S]{0,600}?referred_by: promo\.affiliate_id/);
  });

  it("kontrol hatası kaydı ENGELLEMEZ (meşru kayıt düşmez)", () => {
    expect(signupServer).toMatch(
      /self-referral kontrolü yapılamadı[\s\S]{0,120}?return false/,
    );
  });
});

describe("ödeme ekranı ve indirim yolu", () => {
  it("Paddle overlay'de indirim kodu alanı açıkça istenir", () => {
    expect(paddleCheckout).toMatch(/showAddDiscounts: true/);
    expect(paddleCheckout).toMatch(/allowDiscountRemoval: true/);
  });

  it("checkout'a indirim DAYATILMAZ (tek kaynak: Paddle)", () => {
    // `discountCode`/`discountId` uygulama tarafından gönderilmemelidir.
    expect(paddleCheckout).not.toMatch(/discountCode\s*:/);
    expect(paddleCheckout).not.toMatch(/discountId\s*:/);
  });

  it("kayıt ekranı 'otomatik uygulanır' gibi ÖLÇÜLMEMİŞ bir vaat vermez", () => {
    expect(auth).not.toMatch(/applied automatically at checkout/i);
    expect(auth).toMatch(/Paddle ödeme ekran/);
  });
});

describe("affiliate paneli ve toplamlar", () => {
  it("toplamlar veritabanında/ sayfalı olarak hesaplanır (50 satır sınırı yok)", () => {
    expect(affiliateFns).toMatch(/readAffiliateTotals\(/);
    expect(affiliateFns).toMatch(/affiliate_payout_summary/);
    // Eski hatalı davranış: toplamlar yalnız `commissions` (limit 50) üzerinden.
    expect(affiliateFns).not.toMatch(/for \(const c of commissions\)/);
  });

  it("affiliate kodu yokken davet linki AYRI etiketlenir (2 kişi sınırı gizlenmez)", () => {
    expect(affiliatePanel).toMatch(/affiliate kodun henüz tanımlanmadı/);
    expect(affiliatePanel).toMatch(/en fazla 2 arkadaş/);
  });
});
