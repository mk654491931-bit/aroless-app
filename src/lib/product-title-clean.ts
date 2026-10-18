// ============================================================================
// LİSTE BAŞLIĞI TEMİZLİĞİ — pazarlama gürültüsünü at, ÜRÜN KİMLİĞİNİ koru.
//
// NEDEN VAR (ölçülen tekilleştirme kaybı): pazaryeri kart başlıkları ürün adıyla
// birlikte kampanya metni taşıyor:
//   "Air Fryer 5.5L **Free Shipping Hot Sale**"
//   "Ninja AF101 Air Fryer 4 Qt **2024 New Arrival**"
//   "Robot Vacuum Q7 **Wholesale Dropshipping**"
// `productFingerprint` TAM normalize başlığı gömdüğü için bu iki yazım İKİ AYRI
// ürün sayılıyor ve aynı ürün nihai listeye iki kez girebiliyor (ya da tam tersi:
// puanları bölünüp ikisi de eleniyor). Gürültüyü ATMAK, eşik düşürmekten çok
// daha güvenlidir: ürünün ayırt edici kelimeleri (marka, model, ölçü) KORUNUR.
//
// GÜVENLİK KURALI — SADECE BİLİNEN KAMPANYA KALIPLARI:
//   • Sayı + birim (5.5L, 4 Qt, 1200W) ASLA silinmez: bunlar ürün kimliğidir.
//   • "for", "with", "set", "pack" gibi ANLAM taşıyan kelimeler silinmez.
//   • Yalnız satış/kampanya sıfatları ve kargo/ihracat kalıpları atılır.
//   • Temizlik sonrası başlık ÇOK KISALIRSA (ör. yalnız "Air" kalırsa) özgün
//     başlık korunur — aşırı temizlik yanlış birleştirme riskidir.
// ============================================================================

/**
 * Atılan kampanya/gürültü kalıpları.
 *
 * Hepsi tam kelime öbeği olarak eşleşir (`\b`), yani "free" tek başına
 * silinmez — yalnız "free shipping" gibi kalıplar.
 */
const NOISE_PATTERNS: readonly RegExp[] = [
  /\bfree\s+shipping\b/gi,
  /\bfast\s+(?:free\s+)?shipping\b/gi,
  /\bfree\s+returns?\b/gi,
  /\bhot\s+sale\b/gi,
  /\bhot\s+selling\b/gi,
  /\bbest\s+seller\b/gi,
  /\bbest\s+selling\b/gi,
  /\btop\s+seller\b/gi,
  /\bhigh\s+quality\b/gi,
  /\bhigh\s+end\b/gi,
  /\bwholesale\s+(?:lot|price|dropshipping)\b/gi,
  /\bdropshipping\b/gi,
  /\bdrop\s+shipping\b/gi,
  // Yıl + "new arrival" birlikte kampanya metnidir ("2024 New Arrival");
  // YALNIZ yıl ("Sony WH-1000XM4 (2024)") ürün kimliği olabilecekken
  // silinmez — bu yüzden kalıp ikisini BİRDEN ister.
  /\b(?:19|20)\d{2}\s+(?:new\s+)?arrival\b/gi,
  /\bnew\s+arrival\b/gi,
  /\bnew\s+in\b/gi,
  /\blimited\s+(?:time\s+)?offer\b/gi,
  /\bbig\s+discount\b/gi,
  /\bon\s+sale\b/gi,
  /\bsale\s+promotion\b/gi,
  /\bpromotion\b/gi,
  /\bfactory\s+direct\b/gi,
  /\b100%\s+(?:new|original|brand\s+new)\b/gi,
  /\bbrand\s+new\b/gi,
  /\bas\s+seen\s+on\s+tv\b/gi,
  /\bmust\s+have\b/gi,
  /\blowest\s+price\b/gi,
];

/**
 * Başlıktan kampanya gürültüsünü temizler — SAF, ağ YOK.
 *
 * Ürün kimliği (marka, model kodu, ölçü, sayı+ Birim) KORUNUR. Sonuç çok
 * kısaysa (`MIN_KEPT_CHARS`) özgün başlık döner: yanlış birleştirme riski,
 * gürültülü başlıklı kopyadan daha kötüdür.
 */
const MIN_KEPT_CHARS = 8;

export function cleanListingTitle(title: string): string {
  const original = String(title ?? "").trim();
  if (!original) return "";
  let cleaned = original;
  for (const re of NOISE_PATTERNS) cleaned = cleaned.replace(re, " ");
  cleaned = cleaned
    // Kalıp atmaktan arta kalan çift boşluk/ayraçları topla.
    .replace(/\s*[,;|·/]+\s*(?=[,;|·/]|$)/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-–—:,.]+|[\s\-–—:,.]+$/g, "")
    .trim();
  if (cleaned.length < MIN_KEPT_CHARS) return original;
  return cleaned.slice(0, 180);
}
