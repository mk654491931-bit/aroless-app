// Server-only prompt builders for the 19 Aroless tools.
import type { Provider } from "./tools-ai.server";

export type ToolId =
  | "supplier-negotiator"
  | "offer-analyzer"
  | "legitimacy-detector"
  | "review-spec-sheet"
  | "reverse-cost"
  | "landed-cost"
  | "capital-planner"
  | "desi-optimizer"
  | "milestone-shield"
  | "consensus"
  | "bundle-booster"
  | "lead-time"
  | "arbitrage-matrix"
  | "ad-hook-extractor"
  | "listing-seo"
  | "listing-visual"
  | "review-sentiment"
  | "price-strategy"
  | "news";

type Ctx = Record<string, string>;
const f = (c: Ctx, k: string, fb = "-") => (c[k]?.trim() ? c[k].trim().slice(0, 4000) : fb);

const BASE = `You are Aroless, a senior cross-border e-commerce operator with 10+ years of Amazon/TikTok Shop/Alibaba sourcing experience.
Method (do this internally, never print it):
1) Restate the case in unit-economics terms and write down every cost line.
2) Use real 2025/2026 benchmarks (Amazon referral %, FBA tiers, CN→US/EU freight rates, duty rates, CNY/USD/EUR volatility, typical MOQ and tooling costs).
3) Run a base case AND a pessimistic case; report the conservative number.
4) Sanity-check every calculation before answering; if an input is missing, state the assumption you used instead of inventing precision.
Style: blunt, numeric, case-specific. No generic advice, no filler, no hedging. Every claim carries a number, a range or a date. Write all prose in Turkish.`;

export const TOOL_PROVIDER: Record<ToolId, Provider> = {
  "supplier-negotiator": "gemini",
  "offer-analyzer": "groq",
  "legitimacy-detector": "gemini",
  "review-spec-sheet": "openrouter",
  "reverse-cost": "groq",
  "landed-cost": "groq",
  "capital-planner": "openrouter",
  "desi-optimizer": "groq",
  "milestone-shield": "gemini",
  consensus: "gemini",
  "bundle-booster": "openrouter",
  "lead-time": "groq",
  "arbitrage-matrix": "gemini",
  "ad-hook-extractor": "openrouter",
  "listing-seo": "gemini",
  "listing-visual": "openrouter",
  "review-sentiment": "groq",
  "price-strategy": "gemini",
  news: "gemini",
};

const LANG_NAMES: Record<string, string> = {
  tr: "Turkish",
  en: "English",
  es: "Spanish",
  de: "German",
  fr: "French",
  ar: "Arabic",
};

/** Appends the "answer in the user's language" directive to any built prompt. */
export function withOutputLanguage(prompt: string, lang?: string): string {
  const name = LANG_NAMES[(lang ?? "en").slice(0, 2)] ?? "English";
  return `${prompt}

- OUTPUT LANGUAGE: write EVERY human-readable string (headline, metrics labels, bullets, table cells, document, risks, actions, assumptions, verdict) in ${name}. Keep URLs, numbers, currency codes and brand/product names as they are.`;
}

export function buildPrompt(tool: ToolId, c: Ctx): string {
  return withOutputLanguage(buildToolPrompt(tool, c), c["uiLang"]);
}

function buildToolPrompt(tool: ToolId, c: Ctx): string {
  switch (tool) {
    case "supplier-negotiator":
      return `${BASE}
Ürün: ${f(c, "product")} | Hedef birim fiyat: ${f(c, "targetPrice")} USD | Hedef MOQ: ${f(c, "moq")}
Tedarikçi notları: ${f(c, "notes")}
Bu tedarikçiye gönderilecek profesyonel bir pazarlık mesajı yaz. "document" alanına ÖNCE İngilizce, sonra "---" ile ayrılmış Basitleştirilmiş Çince (简体中文) tam metin koy. Metin; hedef fiyatı gerekçelendirmeli, MOQ/örnek/ödeme vadesi taleplerini içermeli ve karşı tarafa kaçış alanı bırakmamalı. metrics: hedef fiyat, gerçekçi kabul olasılığı, önerilen ilk teklif, tavsiye edilen ödeme şartı. bullets: pazarlık taktikleri.`;

    case "offer-analyzer":
      return `${BASE}
Tedarikçiden gelen teklif/e-posta metni:
"""${f(c, "offer")}"""
Bu teklifi denetle. Gizli navlun/ek maliyetleri, Incoterm risklerini (EXW/FOB/CIF/DDP), ödeme şartı tuzaklarını, MOQ ve kalıp (mold/tooling) ücretlerini, teslim süresi belirsizliklerini bul. metrics: gerçek toplam maliyet tahmini, gizli maliyet toplamı (tone warning), Incoterm risk seviyesi. table: sütunlar ["Kalem","Teklifte","Gerçek/Gizli","Risk"]. bullets: tedarikçiye sorulacak net sorular.`;

    case "legitimacy-detector":
      return `${BASE}
Alibaba/1688 tedarikçi profil URL'i veya adı: ${f(c, "url")}
Ek gözlem: ${f(c, "notes")}
Bu tedarikçinin gerçek üretici mi yoksa ticaret firması (trading company) mı olduğunu değerlendir; profil sinyallerini (kuruluş yılı, ürün çeşitliliği genişliği, sertifikalar, fabrika alanı, çalışan sayısı, transaction level) yorumla. metrics: Meşruiyet skoru /100, Tip (Fabrika/Ticaret firması), Risk seviyesi. bullets: doğrulama için istenecek kanıtlar (üretim video turu, business license numarası, BSCI/ISO belgesi vb.).`;

    case "review-spec-sheet":
      return `${BASE}
Rakip ürünün 1 yıldızlı yorumları:
"""${f(c, "reviews")}"""
Ürün: ${f(c, "product")}
Bu şikayetleri üretime verilebilir bir teknik şartname (Production Spec Sheet) haline getir. "document" alanına başlıklı, maddeli, fabrikaya gönderilebilir tam şartname yaz (Malzeme, Tolerans, Dayanım testi, Ambalaj, QC kontrol noktaları, AQL seviyesi). metrics: tespit edilen kusur sayısı, en kritik kusur, tahmini iade azalması %. table: ["Şikayet","Kök neden","Spec düzeltmesi"].`;

    case "reverse-cost":
      return `${BASE}
Hedef perakende fiyat: $${f(c, "retail")} | Hedeflenen net marj: %${f(c, "margin")} | Kanal: ${f(c, "channel", "Amazon US")} | Ürün: ${f(c, "product")}
Kanal komisyonu, FBA/fulfillment, iade payı, reklam (TACOS) ve ödeme kesintilerini gerçek oranlarla düş; geriye kalan MAKSİMUM tedarikçi maliyetini hesapla. metrics: Maksimum tedarikçi maliyeti (tone profit), Toplam kanal kesintisi (tone warning), Kırılma noktası fiyatı, Önerilen hedef COGS. table: ["Kalem","Oran/Tutar","Kalan"]. bullets: bu maliyeti tutturmak için somut aksiyonlar.`;

    case "landed-cost":
      return `${BASE}
EXW/FOB birim fiyat: $${f(c, "unit")} | Adet: ${f(c, "qty")} | Navlun toplam: $${f(c, "freight")} | Gümrük vergisi: %${f(c, "duty")} | Ek ücretler: $${f(c, "extra", "0")} | Rota: ${f(c, "route", "CN → US")}
Gerçek kapıdan kapıya (door-to-door) birim maliyeti hesapla; liman/terminal, gümrük müşavirliği, iç nakliye ve depoya giriş kalemlerini gerçekçi tahminlerle ekle. metrics: Birim landed cost (tone profit), Toplam yatırım, Gizli lojistik payı (tone warning), Vergi tutarı. table: ["Kalem","Toplam $","Birim $"]. bullets: maliyeti düşürecek somut hamleler.`;

    case "capital-planner":
      return `${BASE}
İlk stok adedi: ${f(c, "units")} | Birim maliyet: $${f(c, "unit")} | Navlun: $${f(c, "freight")} | Günlük reklam bütçesi: $${f(c, "ads")} | Tahmini günlük satış: ${f(c, "velocity")} | Tedarik süresi: ${f(c, "leadTime")} gün
Stokta kalmamak (stockout) ve nakit açığına düşmemek için gereken minimum başlangıç sermayesini hesapla; ikinci siparişin ne zaman ve ne kadar nakitle verilmesi gerektiğini belirt. metrics: Minimum sermaye (tone action), Nakit dip noktası (tone warning), 2. sipariş günü, Stok tükenme günü. bullets: nakit akışı kuralları.`;

    case "desi-optimizer":
      return `${BASE}
Kutu ölçüleri: ${f(c, "l")} x ${f(c, "w")} x ${f(c, "h")} cm | Ağırlık: ${f(c, "weight")} kg | Kanal: ${f(c, "channel", "Amazon FBA US")}
Hacimsel ağırlık/desi hesapla, ürünün hangi FBA/kargo boyut kademesinde olduğunu söyle ve bir alt kademeye düşürmek için (vakumlama, kutu yeniden tasarımı, dolgu değişimi, flat-pack) somut öneriler ver. metrics: Desi/hacimsel ağırlık, Mevcut kademe (tone warning), Hedef kademe (tone profit), Birim tasarruf $. table: ["Senaryo","Ölçü","Kademe","Birim maliyet"].`;

    case "milestone-shield":
      return `${BASE}
Sipariş tutarı: $${f(c, "amount")} | Para birimi riski: ${f(c, "currency", "USD/CNY")} | Tedarik süresi: ${f(c, "leadTime")} gün | Tedarikçi güven seviyesi: ${f(c, "trust", "yeni")}
30/70 ödeme planını koru: her milestone için tetikleyici koşulu (kalıp onayı, üretim fotoğrafı, QC raporu, B/L kopyası) tanımla. metrics: Depozito tutarı, Bakiye tutarı, Kur riski (tone warning), Önerilen ödeme aracı. table: ["Milestone","Gün","Ödeme %","Tetikleyici koşul"]. bullets: dolandırıcılığa ve kur oynaklığına karşı korunma adımları.`;

    case "bundle-booster":
      return `${BASE}
Ana ürün: ${f(c, "product")} | Satış fiyatı: $${f(c, "price")} | Kanal: ${f(c, "channel", "Amazon US")}
Sepet ortalamasını (AOV) yükseltecek düşük maliyetli tamamlayıcı ürünler öner. table: ["Tamamlayıcı ürün","Tedarik maliyeti $","Bundle fiyatı $","AOV artışı %"] en az 4 satır. metrics: Yeni AOV (tone profit), Marj etkisi, En iyi bundle. bullets: bundle listeleme ve görsel stratejisi.`;

    case "lead-time":
      return `${BASE}
Bugün: ${f(c, "today")} | Fabrika üretim süresi: ${f(c, "production")} gün | Transit süresi: ${f(c, "transit")} gün | Depoya giriş: ${f(c, "checkin", "5")} gün | Eldeki stok: ${f(c, "stock")} adet | Günlük satış: ${f(c, "velocity")} adet
Tam olarak hangi tarihte yeniden sipariş verilmesi gerektiğini hesapla ve emniyet stoğu öner. metrics: Yeniden sipariş tarihi (tone action), Stok tükenme tarihi (tone warning), Toplam tedarik süresi, Emniyet stoğu. table: ["Aşama","Süre (gün)","Tarih"]. bullets: gecikme senaryoları ve B planı.`;

    case "arbitrage-matrix":
      return `${BASE}
Ürün: ${f(c, "product")} | Landed cost: $${f(c, "cost")} | Referans fiyat: $${f(c, "price")}
Amazon US, Amazon EU (DE), TikTok Shop US ve Etsy için gerçek komisyon, KDV/VAT, fulfillment ve reklam maliyetlerini kullanarak marj karşılaştırması yap. table: ["Pazar","Satış fiyatı","Komisyon+Fee","Vergi/VAT","Net marj $","Net marj %"]. metrics: En kârlı pazar (tone profit), En riskli pazar (tone warning), Marj farkı. bullets: pazar giriş sırası önerisi.`;

    case "ad-hook-extractor":
      return `${BASE}
Rakip reklam metni:
"""${f(c, "adCopy")}"""
Kullanılan psikolojik kancaları (kıtlık, sosyal kanıt, kayıp korkusu, kimlik, öncesi/sonrası) çöz; hangi açıların doygun (saturated) olduğunu ve hangi kullanılmamış açıların denenmesi gerektiğini söyle. table: ["Kanca","Kullanım","Doygunluk"]. metrics: Tespit edilen kanca sayısı, Doygunluk skoru (tone warning), En güçlü kanca. bullets: 4 adet kullanılmamış yeni reklam açısı — her biri hazır bir hook cümlesiyle.`;

    case "listing-seo":
      return `${BASE}
Ürün: ${f(c, "product")} | Hedef anahtar kelimeler: ${f(c, "keywords")} | Kanal: ${f(c, "channel", "Amazon US")}
Bu kanalın algoritmasına ve karakter limitlerine uygun tam bir listing üret. "document" alanına: SEO başlık (kanal limitine uygun), 5 bullet (fayda + teknik kanıt), ürün açıklaması ve backend/arama terimleri (250 karakter) yaz. metrics: Tahmini CTR etkisi (tone profit), Kapsanan ana anahtar kelime sayısı, Rekabet seviyesi (tone warning). table: ["Anahtar kelime","Arama hacmi tahmini","Rekabet","Nerede kullanıldı"]. bullets: yayına almadan önceki kontrol listesi.`;

    case "listing-visual":
      return `${BASE}
Ürün: ${f(c, "product")} | Hedef kitle: ${f(c, "audience")} | USP: ${f(c, "usp")}
Dönüşüm odaklı 7 görsellik ana galeri seti + A+ / EBC modül planı hazırla. "document" alanına her görsel için: amaç, kompozisyon, üstteki metin (overlay), çekim/prop talimatı ve ölçülebilir iddia yaz. metrics: Öncelikli görsel, Tahmini dönüşüm etkisi (tone profit), Üretim maliyeti tahmini. table: ["Görsel #","Tip","Mesaj","Overlay metni"]. bullets: mobil okunabilirlik kuralları.`;

    case "review-sentiment":
      return `${BASE}
Ürün: ${f(c, "product")}
Yorumlar:
"""${f(c, "reviews")}"""
Yorumları temaya göre grupla; satın almayı engelleyen itirazları, memnuniyet tetikleyicilerini ve listingde kullanılacak sosyal kanıt cümlelerini çıkar. metrics: Genel sentiment skoru /100, En kritik itiraz (tone warning), En güçlü satın alma nedeni (tone profit), Tahmini iade tetikleyicisi. table: ["Tema","Frekans","Sentiment","Listing aksiyonu"]. bullets: bullet/A+ içinde doğrudan kullanılabilecek 4 cümle.`;

    case "price-strategy":
      return `${BASE}
Ürün: ${f(c, "product")} | Landed cost: $${f(c, "cost")} | Kanal: ${f(c, "channel", "Amazon US")} | Rakip fiyatları: ${f(c, "competitors")}
Kâr koruyan bir fiyat bandı belirle: giriş fiyatı, hedef fiyat, taban fiyat (kupon/indirim sınırı). Kanal komisyonu, fulfillment, iade ve reklam payını hesaba kat. metrics: Önerilen fiyat (tone action), Net marj % (tone profit), Taban fiyat (tone warning), Başabaş dönüşüm oranı. table: ["Senaryo","Fiyat $","Net marj $","Net marj %","Not"]. bullets: lansman fiyatlama takvimi, kupon ve bundle hamleleri.`;

    case "consensus":
      return `${BASE}
Ürün: ${f(c, "product")} | Pazar: ${f(c, "country", "US")} | Fiyat: $${f(c, "price")} | Maliyet: $${f(c, "cost")}
Bu ürünü bu pazarda 0-100 arası puanla: talep, rekabet, marj, lojistik ve mevzuat riskini birlikte değerlendir.`;

    case "news":
      if (f(c, "mode") === "live")
        return `${BASE}
Bugünün tarihi: ${f(c, "today")}, şu anki saat (UTC): ${f(c, "hour")}. Son 24 saat içinde çıkmış, e-ticareti ŞU AN etkileyebilecek 8 SICAK gelişmeyi getir (pazar yeri politika değişiklikleri, tarife/gümrük, navlun-lojistik aksaklıkları, ödeme/reklam platformu güncellemeleri, döviz ve talep şokları). Sadece gerçek, doğrulanabilir haberler; en yeniden eskiye sırala.
Return ONLY minified JSON:
{"items":[{"title": string (kısa, max 90 karakter), "source": string, "date": string (YYYY-MM-DD), "time_ago": string ("2 saat önce" gibi), "category": string, "summary": string (1 cümle, Türkçe), "impact": "high"|"medium"|"low", "action": string (satıcı için tek cümlelik aksiyon)}]}`;
      return `${BASE}
Bugünün tarihi: ${f(c, "today")}. Amazon, TikTok Shop, Shopify, Etsy, gümrük/tarife, navlun, ödeme sistemleri ve reklam platformları tarafındaki EN GÜNCEL 6 gelişmeyi getir. Sadece gerçek, doğrulanabilir haberler.
Return ONLY minified JSON:
{"items":[{"title": string, "source": string, "date": string (YYYY-MM-DD), "category": string, "summary": string (2 cümle, Türkçe), "impact": "high"|"medium"|"low", "explainer": {"means": string (bu makro olay senin için ne demek, 1-2 cümle), "actions": string[3] (bu hafta atılacak somut satıcı adımları), "risk": string (1 cümle)}}]}`;
  }
}
