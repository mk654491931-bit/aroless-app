# Aroless — Sıfır Bütçeli Büyüme ve Gelir Playbook'u

Tarih: 14 Ekim 2026 · Kısıt: **0 TL reklam bütçesi** · Hedef: **ücretsiz kanallardan ödeyen müşteri + affiliate komisyonu**

> Bu doküman bir "kanal listesi" değil, uygulanabilir bir operasyon planıdır. Tüm ürün ve rakam bilgileri
> koddan okundu: `src/lib/plans.ts`, `src/lib/affiliate.ts`, `src/lib/affiliate-payout.ts`,
> `src/components/affiliate-program-page.tsx`, `README.md`. Kanal bilgileri ve program adları repo içindeki
> mevcut araştırmalardan (`AFFILIATE_OPPORTUNITIES.md`, `AFFILIATE_PROMOTER_ARASTIRMASI.md`,
> `GLOBAL_SCALE_REPORT.md`) alınmıştır. Uydurma trafik/dönüşüm rakamı **yoktur**; tahmin olan her yerde
> "varsayım" yazılıdır.

---

## 1) Ürün gerçekten ne satıyor?

Aroless bir "AI ürün bulucu" değil; **e-ticaret satıcısı için kanıta dayalı karar panelidir**. Tek çekirdek
vaat, "kazanan ürün" iddiasının ölçülmüş veriye dayanması: niş gerçek kaynaklardan taranır, sert filtrelerden
geçirilir ve 14 ajanlı AI Konseyi'nde oylanır; sonuç boşsa "bulunamadı" denir, sahte bir liste üretilmez
(`src/routes/discover.tsx` ve `src/lib/product-discovery-reader.server.ts` bunu sözleşme olarak taşır).
Bunun etrafında dokuz modül var: ürün bulucu, kazanan ürün radarı, ROI/unit economics, mağaza denetçisi,
fiyat & arbitraj araçları, listing SEO kiti, reklam kreatif stüdyosu, trend radarı ve eğitim simülatörü +
21 günlük akademi.

Ticari model tek satış kalemidir: **aylık abonelik** (`src/lib/plans.ts`). Starter **39 $/ay** (8 ürün bulucu
kredisi, 30 araç çalıştırma), Pro **59 $/ay** (15 kredi, 90 araç), Business **199 $/ay** (50 kredi, 300 araç).
Paketler arasındaki fark modül erişimi değil, **kullanım miktarıdır** — dokuz modül her pakette açıktır.
Ücretsiz hesap 2 ürün bulucu kredisi + 3 araç çalıştırma alır (`quotaFor(0)`). Bu, "ücretsizde boğ, ödemede
kıs" tipik SaaS hunisinden farklıdır ve pazarlamada **dürüstçe** anlatılmalıdır: ücretsiz katman gerçek bir
deneme, tanıtım oyuncağı değil.

İkinci gelir kanalı zaten kodda hazır: **%30 yinelenen affiliate**, müşteri başına en fazla 12 ay, 75 $
ödeme eşiği, iade beklemesi ve Wise/IBAN ile manuel ödeme (`src/lib/affiliate.ts`,
`src/components/affiliate-program-page.tsx`). Bu, "pazarlama bütçesi sıfır" probleminin en doğal çözümü:
**trafik üreten kişiye nakit önceden vermek yerine, gelirin bir kısmını paylaşmak.**

### Hedef kullanıcı profilleri

| Profil | Acı noktası | Aroless'in cevabı | Ödeme eğilimi |
|---|---|---|---|
| **Yeni dropshipper** (TikTok Shop / Shopify, 0-6 ay) | "Ne satsam?" sorusunda ürün araştırma araçlarına para veremiyor | Ücretsiz katmanla 2 gerçek tarama; sonuç boşsa dürüst "bulunamadı" | Starter 39 $ (ikinci ay) |
| **Mevcut satıcı** (Etsy/Amazon/Trendyol, kâr var, marj eriyor) | Reklam maliyeti yüzünden ürün seçimi kritik; marj ve komisyon hesabı elle yapılıyor | Marj/lojistik kırılımı, platform komisyon & teslimat aralıkları, ülke uyumu | Pro 59 $ |
| **Küçük ajanstek çalışan / freelancer** (birden fazla mağaza yönetiyor) | Müşteriye "neden bu ürün" raporu üretmek zaman alıyor | Konsey raporu + gerekçe + dışa aktarılabilir liste, ROI takibi | Business 199 $ veya Pro + ek kredi |
| **İçerik üreticisi / eğitmen** (satıcı kitlesine içerik üretiyor) | Kitlesi için araç öneriyor ama kazanmıyor | **Affiliate: %30 × 12 ay** (Pro müşteri başına ~212 $, Business ~716 $ üst sınır) | 0 $ öder, kazanır |
| **Türkiye/orta doğu satıcısı** | İngilizce araçlar yerel pazaryerini (Trendyol vb.) modellemiyor | Türkçe arayüz + yerel platform/komisyon verisi | Starter/Pro (TL gelirle 39-59 $ zor ama mümkün) |

---

## 2) Kanallar tablosu — ücretsiz, ölçülebilir

Ritim kolonundaki süreler **tek kişilik** operasyon varsayar. "İzlenecek metrik" kolonu, o kanalın işe
yarayıp yaramadığını 2-4 hafta içinde söyleyebilecek tek sayıdır.

| # | Kanal | Neden bu üründe işe yarar | Kurulum adımları | Ritim | Maliyet | İzlenecek metrik |
|---|---|---|---|---|---|---|
| 1 | **Uygulamanın kendi affiliate sistemi** (`/affiliate` + Ayarlar → Affiliate) | Komisyon zaten kodda: %30 × 12 ay, 75 $ eşik, Wise/IBAN. Ürünü kullanan satıcı **kendi kitlesine** satar; en yüksek dönüşümlü trafik bu | 1) `/affiliate` sayfası yayında olduğunu doğrula. 2) 20 kişilik hedef promoter listesi çıkar (niş YouTube/newsletter/danışman). 3) Kişiye özel davet yaz (şablon değil). 4) Başvuruları **elle, 48 saat içinde** onayla. 5) Her promoter'a ayrı kod; panelden kod bazlı abonelik say | Haftalık: 10 yeni davet, 1 onay, 1 ödeme kontrolü | 0 TL (ödeme sadece satıştan sonra) | **Aktif affiliate sayısı** ve **kod başına abonelik** |
| 2 | **Ücretsiz ürün dizinleri / launch platformları** | "AI e-ticaret ürün araştırma" aramasında kalıcı, ücretsiz referans trafiği üretir; İngilizce kitlesi var | 1) Ürün açıklamasını 3 varyantta yaz (satıcı dili, ajanstek dili, "AI council" tekniği dili). 2) Aynı gün 5-8 dizine gönder. 3) Her dizinde **aynı ekran görüntüsü setini** kullan (marka tutarlılığı). 4) Lansmanda ücretsiz katmanı öne çıkar | Bir kez kur, ardından ayda 1 güncelleme | 0 TL | **Dizin-1: ücretsiz kayıt sayısı** (UTM ile) |
| 3 | **Yüksek niyetli topluluklar** (satıcı subreddit'leri, Facebook grupları, Discord/Telegram) | Kitlenin tamamı zaten "ne satsam / marj nasıl" diye soruyor. Soru-cevap formatı doğal yerleşim sağlar | 1) **Önce 2 hafta hiç link verme** — sadece soruları yanıtla. 2) Her grubun self-promo kuralını oku; izin varsa "değer + tek link" gönder. 3) Yasaksa hiç gönderme, sadece bilgi ver. 4) Cevap şablonlarını gerçek vaka sayılarıyla (kendi taramandan) yaz | Günde 15 dk: 3 soru yanıtı | 0 TL | **Yorumdan profile tıklama → kayıt** oranı |
| 4 | **Kısa video** (TikTok / Reels / Shorts) | Ürün araştırması görsel bir iştir: "niş gir → 20 sn'de kanıtla sıralanmış liste" ekran kaydı yüksek tutma gücüne sahip | 1) 3 hook kalıbı seç: (a) "Bu ürünü 4 dakikada değil 40 saniyede buldum", (b) "Şu nişte şu ürün ölmüş, işte kanıtı", (c) "Ücretsiz planla yaptım, 0 TL". 2) 15-30 sn ekran kaydı + altyazı. 3) Günde 1 video, 2 hafta boyunca aynı saatte. 4) Biyoda tek link | Günde 1 video (kayıt 10 dk) | 0 TL | **İzlenme değil, biyodan kayıt** (UTM) |
| 5 | **Programatik / şablon SEO sayfaları** | "X nişi için kazanan ürün", "Trendyol komisyon oranları", "TikTok Shop marj hesabı" aramaları satın alma niyetinde. Ürün zaten bu veriyi üretiyor (`/tools/*`, `/trend-radar`, `/hot/:id`, blog/legal altyapısı var) | 1) 20 niş + 20 platform/ülke kombinasyonu seç. 2) Her sayfayı **tek şablondan** üret (başlık, kısa cevap, tablo, ücretsiz araç CTA'sı). 3) `sitemap.xml`'e eklendiğini doğrula. 4) Haftada 3 sayfa | Haftada 3 sayfa | 0 TL | **Organik giriş sayısı → ücretsiz kayıt** |
| 6 | **E-posta imzası + mevcut kişisel ağ** | Sıfır maliyet, sıfır risk, anında başlar. Zaten satıcı olan tanıdıklar ilk 10 gerçek kullanıcı olur | 1) İmzaya "e-ticaret ürün araştırması: <link>" ekle. 2) 30 kişilik gerçek ağa **tek tek** yaz: "dene, bozuksa söyle" (satış değil geri bildirim iste). 3) İlk 10 kullanıcının ne yaptığını not et | Tek seferlik + ayda 1 hatırlatma | 0 TL | **İlk 10 aktif kullanıcı** ve buldukları hata |
| 7 | **Karşılıklı tanıtım (cross-promo)** | Satıcıya hizmet veren küçük araçlar aynı kitleye konuşur (kargo, listing SEO, e-posta araçları, danışmanlar). Bütçe yerine **dikkat takas edilir** | 1) Birbirini tamamlayan 5 küçük ürün seç. 2) "Newsletter'ımda seni tanıtayım, sen de beni" teklifi gönder. 3) Ortak lansman günü belirle | Ayda 1 anlaşma | 0 TL | **Tanıtım başına kayıt** |
| 8 | **İçerik geri dönüşümü** (blog → video → thread → newsletter) | Tek üretim, 4 kanal. Hem SEO hem kısa video hem topluluk aynı içerikten beslenir → üretim maliyeti 1'e düşer | 1) Haftalık 1 "derin" içerik yaz (ör. "hangi ürün araştırma sinyalleri gerçekten öngörücü?"). 2) Aynı içeriği 3 kısa videoya böl. 3) X/LinkedIn thread'i çıkar. 4) Newsletter'da özetle | Haftada 1 derin içerik | 0 TL | **İçerik başına kayıt** (aynı UTM setiyle) |

> **Sıralama önerisi (zaman kısıtlıysa):** 1 → 6 → 3 → 4. Affiliate ve mevcut ağ önce gelir çünkü ikisi de
> ürünü **kullanan** gerçek kişilerden gelir; dizin/video/SEO ise 4-8 hafta gecikmeli döner.

---

## 3) Affiliate-first huni (program zaten kodda, iş **insanları bulmakta**)

**Huni:** hedefli davet → başvuru (Ayarlar → Affiliate) → admin onayı (`verified`) → özel kod → `/auth?promo=KOD`
linki → gelen kişi abone olur → **her yenileme ödemesinden %30**, müşteri başına en fazla 12 ay → 75 $ eşiğini
geçince Wise/IBAN ile ödeme (iade riskine karşı bekleme süresi uygulanır).

**Kimi hedefle:** "en iyi Amazon FBA araçları", "dropshipping ürün araştırması", "TikTok Shop kâr marjı" içeriği
üreten kanallar; e-ticaret danışmanları/ajanstekler; satıcı kursları; niş newsletter yazarları; Trendyol/Hepsiburada
satıcı topluluklarında **aktif ve bilgili** isimler. Promoter seçiminde cimri ol: ürünü gerçekten kullanacak
kişi %30'u hak eder, sadece takipçisi olan kişi etmez.

**DM/ilk temas scripti (kısa, kişiselleştirilmiş — madde madde değil, 3 cümle):**
> Merhaba <isim>, <kanalında şu içeriği> izledim — özellikle <spesifik detay> kısmı bizim ürünün çözmeye
> çalıştığı şey. Ben Aroless'i kuruyorum: niş taraması + marj/komisyon kanıtı + 14 ajanlık konsey oyu ile
> "kazanan ürün" listesi üreten bir panel; sonuç bulunamazsa boş liste döndürüyor (uydurmuyor).
> Ürünü %30 × 12 ay komisyonla tanıtmak ister misin? Kodun ve link hazır, ücretsiz hesabın benden.

**Teşvik yapısı (koddan gelen gerçek sayılar):** %30 sabit · müşteri başına 12 ay · 75 $ eşik · iade beklemesi ·
manuel Wise/IBAN ödeme · admin doğrulanmış hesap şartı · kendine atıf yasak. Bunların hepsi
`/affiliate` sayfasında zaten yazılı olduğu için pazarlıkta **çelişki doğmaz**; davet metninde de aynı
ifadeleri kullan.

**İki taraflı ödül (öneri):** affiliate kodunun **indirim vermediği** kodda sabit (`affiliate-program-page.tsx`
FAQ'ı bunu açıkça yazıyor — indirim Paddle panelinden yönetilir). Yani "kodunla gelen %10 indirim alır"
demek **yanlış olur**. İki taraflı değer istiyorsan indirimi Paddle'da ayrıca tanımla ve **ancak tanımladıktan
sonra** anlat. Aksi halo vaat, iade ve şikâyet üretir.

**Sahtekârlığı önleme:** kod başına abonelik izleme; aynı cihazdan açılan ikinci hesap ve kendi kendine atıf
tespit edilirse komisyon yazılmaz (sistem bunu zaten reddediyor); iadeler komisyondan mahsup edilir;
promoter'ın ülkesini ödeme öncesi kontrol et (Wise'ın gönderemediği ülkeler listesi var —
`AFFILIATE_PROMOTER_ARASTIRMASI.md` §5).

---

## 4) 30 / 60 / 90 gün takvimi

**Gün 1-30 — "gerçek kullanıcı + ilk affiliate"**
- Hafta 1: E-posta imzası + 30 kişilik gerçek ağa tek tek yazma (kanal 6). İlk 10 aktif kullanıcıyı topla,
  nerede takıldıklarını not et.
- Hafta 2: 20 kişilik promoter listesi; 10 kişiye kişiselleştirilmiş davet (kanal 1). Topluluklarda 2 haftalık
  "sadece cevap" dönemi başlar (kanal 3).
- Hafta 3: Üründe kullanıcıların takıldığı ilk 3 noktayı düzelt (büyüme, ürünü düzeltmeden yürümez).
  Dizin başvurularını topluca gönder (kanal 2).
- Hafta 4: İlk affiliate onayı + kod dağıtımı. İlk 4 kısa videoyu yayınla (kanal 4).
- **Ay sonu kontrol:** kaç aktif kullanıcı, kaç affiliate, kaç ücretsiz→ödeyen dönüşüm.

**Gün 31-60 — "tekrarlanabilir içerik + SEO"**
- Haftada 1 derin içerik + 3 kısa video + 1 thread (kanal 8+4).
- Programatik şablon sayfalarına başla: haftada 3 sayfa (kanal 5). Hangi şablonun trafik aldığını ölç.
- Topluluklarda artık **izin çerçevesinde** paylaşım; her yanıtta gerçek tarama çıktısı göster.
- 1 cross-promo anlaşması kapat (kanal 7).
- **Ay sonu kontrol:** hangi kanal **kayıt** getirdi (izlenme değil); kazanan kanala zamanı kaydır.

**Gün 61-90 — "ölçek: affiliate ağı + karar"**
- Affiliate sayısını 5+ aktif promoter'a çıkar; en iyi 2 promoter'a **daha fazla içerik materyali** ver
  (ekran kaydı, vaka, karşılaştırma tablosu) — komisyon oranını artırmadan.
- 10+ affiliate olduğunda çerez/tıklama takibi gereksinimini değerlendir (repo araştırması FirstPromoter /
  Partnero'yu Paddle Billing ile uyumlu olarak işaretliyor) — **ama önce** kendi sisteminin paneli yeterli mi
  diye ölç; ayda ~50 $ gider sıfır bütçe kısıtını bozar.
- Karar: organik kayıt maliyeti 0 TL kaldığı sürece içerik üretimini artır; hangi kanal 2 ayda kayıt
  getirmediyse **bırak**, yerine kazananı ölçekle.

---

## 5) Uyum (ihmal edilirse kanal kapanır, hesap askıya alınır)

- **Affiliate açıklaması:** komisyon aldığın her yerde ilişkiyi linkin yanında yaz (FTC/AB "material
  connection"; TR'de de tüketicinin yanıltılmaması ilkesi). "Komisyon alıyorum" cümlesi dönüşümü düşürmez,
  iade ve şikâyeti düşürür.
- **Spam yapma:** toplu DM, otomatik gönderim, istenmeyen e-posta yok. Her topluluğun self-promo kuralını
  **paylaşmadan önce** kendin oku (`AFFILIATE_PROMOTER_ARASTIRMASI.md` bu konuda "kurallar doğrulanamadı"
  diyorsa, o gruba link gönderme).
- **Platform kuralları:** TikTok/YouTube/Meta'nın yönlendirme ve para kazanma kuralları; dizinlerin
  listeleme şartları; Paddle'ın kabul edilebilir kullanım şartları (abonelik/indirim metinleri).
- **KVKK/GDPR:** kayıt formu ve affiliate panelinde toplanan veri için aydınlatma + açık rıza; veri
  minimizasyonu; affiliate'e komisyon için gereken en az veriyi taşı (vergi no opsiyonel — kodda öyle).
- **Vergi:** komisyon ödemeleri ve yurt dışı araç ödemeleri için muhasebecine sor; repo'da bulunan notlar
  (stopaj/KDV/tersine yükümlülük) **genel çerçevedir, olayına uygulanması muhasebecinin işidir**.
- **Reklamı yaptığın aracı kullan:** anlatmadığın aracı övme; vaat ettiğin sayıyı üründen göster.
  `marketing-landing` ve `landing/sections.tsx`'teki "ÖRNEK yorum" etiketi bu ilkenin kod halidir — topluluk
  paylaşımlarında da aynı dürüstlüğü koru.

---

## 6) YAPILMAMASI gerekenler

- **Takipçi/tıklama satın almak.** Ölü trafik, panelde "kayıt 0", affiliate'de "satış 0" olarak geri döner.
- **Toplu/otomatik DM ve istenmeyen e-posta.** Kalıcı olarak kanal ve alan adı itibarı kaybettirir.
- **Sahte inceleme, sahte "4.9/5 · 2.400+ satıcı" tipi istatistik.** Bu repo bunları **bilerek kaldırmış**
  (`landing/sections.tsx` yorumu); geri koymak ürünün tek ayırt edici özelliğini (kanıt) yok eder.
- **Ürünün veremediği vaat:** "kesin kazanan ürün", "garanti kâr", "heuristik skor = gerçek satış".
  Ücretsiz katmanın gerçek sınırı (2 kredi / 3 araç) saklanmaz, açıkça söylenir.
- **Affiliate'e indirim vaat etmek** — kod indirim vermiyor; önce Paddle'da indirim tanımla, sonra anlat.
- **Aynı içeriği 5 kanala kopyalamak.** Platformlar cezalandırır; geri dönüşüm (1 üretim → farklı format)
  yap, kopyala-yapıştır değil.
- **Ölçümsüz kanal eklemek.** Her kanalın UTM'i ve tek metriği olmalı; 4 haftada metrik gelmiyorsa kanal ölür.

---

## Ek: Ücretsiz kanallara **ek** olarak ikinci gelir katmanı (kendi trafiğini paraya çevirme)

Repo'da hazır bir araştırma var (`AFFILIATE_OPPORTUNITIES.md`): Aroless'in kitlesi = satıcı, ve satıcıların
zaten satın aldığı araçların çoğu **ücretsiz katılınabilen** affiliate programlarına sahip (ör. Helium 10,
Spocket, Moosend, GetResponse, Systeme.io, ClickBank/Impact altyapıları). Aroless'in kendi trafiği oluştuğunda
`/tools` veya `/partners` tipi bir sayfada bu araçları **kategorize edip kendi affiliate linkin ile** sunmak,
ek reklam bütçesi olmadan ikinci bir gelir kanalı açar. Bu, §2'deki kanalların **yerine değil, üstüne** gelir:
önce kendi ürünün satışı ve kendi affiliate ağı, sonra aracı katmanı.

**Doğrulanamayanlar (imzalamadan önce teyit et):** affiliate ağlarının Türkiye'de yerleşik advertiser kabul
şartları, Wise Business batch/API erişiminin kendi profilde açık olup olmadığı, her topluluğun güncel
self-promo kuralı. Bu üçü **yazılı** teyit edilmeden plana dahil edilmemelidir.
