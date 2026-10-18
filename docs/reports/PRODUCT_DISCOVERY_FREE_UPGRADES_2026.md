# Ürün Bulucu — katman katman ücretsiz kaynak araştırması (2026-10)

Hedef: hattın **her katmanında** daha iyi ve daha kaliteli sonuç — ücretsiz, API'li ya da
API'siz fark etmeden. Rapor üç kaynaktan besleniyor ve üçünü **karıştırmıyor**:

1. **Kod okuması** — mevcut katmanlar, dosya/sembol adları.
2. **Resmî doküman araştırması** (2026-10-17, üç paralel araştırma) — kotalar, auth,
   şema, kullanım şartları.
3. **Canlı ölçüm** (2026-10-17, bu sandbox) — bugün gerçekten yanıt veren uç noktalar.

Kural aynı kalıyor: **ölçülmeyen alan `null` / "—" olur.** Bu rapor "şu kaynağı ekle,
her şey dolar" demiyor; her öneri için *hangi yuvayı* doldurduğunu ve *neyi
doldurmadığını* yazıyor.

---

## 1. Kısa hüküm (yönetici özeti)

- **Ücretsiz ve genel bir "satış adedi" API'si YOK.** eBay Marketplace Insights yeni
  kullanıcıya kapalı, Amazon PA-API emekli (yerine gelen Creators API 30 günde 10 satış
  şartı koyuyor), Keepa ücretli. Bu yüzden `salesVolume` alanı ücretsiz kaynakla
  doldurulmamalı; **görüntülenme ≠ satış** ayrımı korunmalı.
- **En büyük gerçek kazanç marka + GTIN + kategori zenginleştirmede.** Bugünkü en zayıf
  yuvalar bunlar (marka 6-12/21, kategori 0-4/21 — `docs/reports/PRODUCT_DISCOVERY_FREE_SOURCES.md`).
  Ücretsiz çözüm: **Shopify vitrin JSON'u (anahtarsız, ölçüldü) + eBay Browse (onay
  gerekir) + Awin/Impact ürün feed'leri (zamanlanmış içe alma)**; Best Buy'da alan
  eşlemesi zaten yapılmış, eksik olan ücretsiz anahtarın tanımlanması.
- **Tedarik tarafında en somut ücretsiz API: CJ Dropshipping.** MOQ (`directMinOrderNum`),
  depo ülkesi ve fiyat alanları resmî dokümanda var; 1 istek/sn. FOB yerine geçmez;
  made-in-china FOB'unu **doğrular**, tek başına onun yerini almaz.
- **Google Trends hattı bugün sunucudan 429.** Ölçüldü (74 ms, `Error 429`). Resmî Trends
  API alpha ve başvuruyla; üretim bağımlılığı yapılmamalı. Talep katmanı için en sağlam
  ücretsiz-resmî aday **Google Ads API anahtar kelime metrikleri** (Basic erişim, 15.000
  işlem/gün), ikinci aday **YouTube Data API** (10.000 birim/gün + 100 arama/gün).
- **Maliyet/vergi tarafı ücretsiz ve ölçüldü:** Frankfurter (kur) ve VATcomply (AB VAT
  oranı) anahtarsız çalışıyor. Klasifikasyon (HS/HTS) için ücretsiz API yok; tablo
  yerelde tutulmalı.
- **AI konsey:** 14 ayrı çağrı yerine **tek şemalı çağrı + deterministik toplama**;
  ücretsiz katmanlarda veri eğitim maddeleri ve bölge kısıtları var (Gemini ücretsiz
  katmanı AB/İngiltere/İsviçre kullanıcısına hizmet için kullanılamıyor).

---

## 2. Katman haritası — bugün ne var, boşluk nerede

| # | Katman | Kod | Bugün ölçülen | Boşluk |
| --- | --- | --- | --- | --- |
| L0 | Aday havuzu | `PRODUCT_SOURCES` (`product-discovery-sources.server.ts`) | TR reader, AliExpress, Newegg, Otto, Flipkart, Rakuten, Best Buy, deal-feed, Steam, Bing Shopping, SerpAPI, Wikipedia, HN, GitHub, OFF, Wikidata | ABD/AB **D2C marka** katalogları yok; affiliate feed yok |
| L1 | Süzme/tekilleştirme | `product-discovery-filter.server.ts` (`EVIDENCE_SLOTS`, `BONUS_SLOTS`), `stableProductId` | fiyat/görsel kapıları, fingerprint tekilleştirme | GTIN/MPN çapraz eşleştirme yok → aynı ürün iki kayıt |
| L2 | Marka/kategori/GTIN/görsel | `product-brand.ts`, `product-catalog.server.ts` (UPCitemdb) | marka 6-12/21, kategori 0-4/21 | ücretsiz katalog planı 5 kayıt/sorgu; kategori çoğu kaynakta yok |
| L3 | Talep kanıtı | `demand` yuvası (sayısal alanlar), `googleTrendsSource`, `wikipediaPageviewsSource` | satış 14/21, pageviews gerçek | Trends 429; arama hacmi yok; Reddit 403 |
| L4 | Tedarik & ekonomi | `aliexpress`, `made-in-china`, `supplier-economics.ts`, `launch-readiness.ts` | MOQ %97-100, FOB %100, marj/katkı | kargo, vergi, depo ülkesi, ikinci tedarikçi doğrulaması |
| L5 | Rekabet | `cohortCompetitors` (pipeline) | havuz içi yoğunluk | havuz dışı pazar yoğunluğu (aktif ilan sayısı) yok |
| L6 | Mevzuat/IP | yasaklı kategori sözlüğü | başlık taraması | HS/HTS kodu, ülke menşe, VAT |
| L7 | AI kısa liste + konsey | `agents.server.ts`, `council.server.ts`, `product-discovery-council-ai.server.ts` | Gemini/Groq/OpenRouter/HF/AI Gateway | ücretsiz kota yönetimi, tek çağrı şeması, yedek oranı görünürlüğü |
| L8 | Operasyon | `swr-cache.server.ts`, `scraper-quota.server.ts`, QStash | 3 saat okuyucu önbelleği, günlük kotalar | feed içe alma işi, kaynak başına bütçe, tazelik damgası |

---

## 3. Katman katman öneriler

### L0 — Aday havuzu

#### 3.1 Shopify vitrin JSON'u (anahtarsız) — **ölçüldü, en hızlı kazanç**

`https://<mağaza>/products.json?limit=…` bugün **200 / 175 ms / 12,7 KB (2 ürün)** döndü.
Dönen alanlar: `title`, **`vendor`** (marka), **`product_type`** (kategori), `variants[].price`,
`variants[].available`, `images[].src`, `variants[].sku`.

- **Doldurduğu yuvalar:** marka, kategori, fiyat, görsel, stok, satıcı (mağaza adı).
- **Doldurmadığı:** `barcode` ölçülen 3 üründe de **`null`** — GTIN garantisi yok. Puan/yorum
  yok, satış yok.
- **Uygulama biçimi:** genel bir "Shopify kazıyıcı" değil, **niş başına seçilmiş mağaza
  allowlist'i** (ör. ev/yaşam nişlerinde 10-20 D2C marka) + mağaza `robots.txt` kontrolü +
  24 saat önbellek. Kaynak adı `d2c-storefront`, `oks` raporu `n` mağaza taranmış gibi
  metrik taşır.
- **Risk:** Shopify Ajax dokümanı bu rotayı üçüncü taraf katalog API'si olarak taahhüt
  etmiyor ([shopify.dev/docs/api/ajax](https://shopify.dev/docs/api/ajax)); mağaza bazlı
  izin/robots kontrolü zorunlu. Toplu tarama yapılmamalı.

#### 3.2 eBay Browse API — **onay gerekir**, ama doğru yuvalar

- Resmî, OAuth; geliştirici katmanında **5.000 çağrı/gün** duyuruluyor; üretim kullanımı
  onay sürecine bağlı ([Browse API](https://developer.ebay.com/api-docs/buy/static/api-browse.html)).
- **Doldurduğu:** GTIN ile arama, satıcı, fiyat, görsel, stok durumu, kategori, bazı
  ilanlarda ürün incelemesi.
- **Doldurmadığı:** satış geçmişi. Marketplace Insights **yeni kullanıcıya kapalı**.
- **Ölçüm:** anahtarsız çağrı bugün **403** (beklenen). Anahtar alınana kadar 0 ağ çağrısı
  yapılmalı (Best Buy deseniyle aynı).

#### 3.3 Awin / Impact ürün feed'leri — **marka+GTIN boşluğunun gerçek çözümü**

- Awin feed şeması: `brand_name`, `ean`, `upc`, `product_GTIN`, kategori, fiyat, görsel,
  stok, `average_rating` ([Awin publisher feed guide](https://help.awin.com/developers/docs/product-feed-publisher-guide-intro)).
- Impact standart katalog: **EAN, UPC, manufacturer, kategori, fiyat, stok, görsel**
  ([Impact katalog alanları](https://help.impact.com/partner/what-would-you-like-to-learn-about/platform-features/marketing-content/product-marketplace-and-catalogs/download-product-catalogs-as-a-partner)).
- **Kritik tasarım kararı:** bunlar **istek anında çağrılmaz**. Zamanlanmış iş (QStash)
  feed'i indirir → normalize tabloya yazar → hat kendi tablosunu sorgular. Vercel
  fonksiyonunda 100 MB feed çekmek yanlış mimari.
- **Doldurduğu:** marka, GTIN, kategori, fiyat, stok, satıcı.
- **Doldurmadığı:** yorum sayısı (Awin'deki `reviews` alanının sayı olduğu garanti değil —
  mağaza bazında doğrulanmalı), satış adedi.

#### 3.4 Best Buy: eşleme zaten yapılmış — eksik olan **anahtar ve ölçüm**

Kod okuması: `bestBuySource` (`product-discovery-sources.server.ts` ~2201-2253)
`customerReviewAverage`, `customerReviewCount`, `categoryPath.name`, `manufacturer` ve
`image` alanlarını **zaten** istiyor ve kategori yolunun en özel düğümünü kullanıyor.
Yani yeni bir entegrasyon değil; yapılacak iki şey var:

1. `BESTBUY_API_KEY` tanımlı değilse kaynak **hiç çağrılmıyor** (fail-soft). Ücretsiz
   anahtar alınıp tanımlandığında kategori/puan yuvaları ABD nişlerinde ölçülmüş hâle
   gelir — bu, kod değişikliği değil **yapılandırma** işidir.
2. Anahtar tanımlıyken canlı testte `category` ve `ratingCount` doluluk oranını ölç;
   "kategori 0-4/21" satırının bu kaynakla gerçekten kapandığını **sayıyla** doğrula.

Bu yüzden aşağıdaki öncelik tablosunda Best Buy bir *kod* işi olarak değil, bir
*ölçüm/yapılandırma* işi olarak duruyor.

### L1 — Normalize / tekilleştirme

1. **GTIN kontrol hanesi + GS1 öneki yerelde** (API'siz, sıfır maliyet): 8/12/13/14 haneli
   kodun check-digit doğrulaması ve GS1 ülke öneki. Uydurma barkod burada elenir;
   "matematiksel olarak geçerli" ≠ "GS1 tahsis etti" notu koda yazılmalı.
2. **`gtin` / `mpn` ile çapraz tekilleştirme:** bugün `fingerprint` başlık tabanlı; aynı
   ürünün iki kaynaktaki iki kaydı farklı `productId` alabiliyor
   (`docs/reports/PRODUCT_DISCOVERY_AUDIT.md` §4.6). GTIN varsa öncelikli anahtar o olmalı.
3. **Open Food Facts:** arama ucu bugün **503**; tek ürün okuma **200 / 806 ms** ve
   `brands` + `categories` döndü. Yani OFf'yi **barkod bilinen ürünlerde okuma** için
   kullan, arama için kullanma (limit: 15 ürün okuma/dk, 10 arama/dk).

### L2 — Marka / kategori / GTIN / görsel

| Araç | Ne doldurur | Ücretsiz kota (resmî) | Not |
| --- | --- | --- | --- |
| **UPCitemdb** (mevcut) | marka, kategori, GTIN, kayıtlı fiyat | **100 istek/gün** (arama+lookup toplam) | Anahtarsız; 24 saat önbellek şart |
| **Shopify `vendor` / `product_type`** | marka, kategori | Anahtarsız | Ölçüldü; barkod yok |
| **Awin / Impact feed** | marka, GTIN, kategori, stok | Hesap/onay | Zamanlanmış içe alma |
| **Google Knowledge Graph** | marka/varlık kimliği, tip | **100.000 okuma/gün** | Anahtar gerekir; katalog değil |
| **logo.dev** | marka logosu | 500.000 CDN/gün | Ticari kullanımda **atıf** şart |
| **Brandfetch Logo API** | logo | ~1M/gün (fair use) | **Yalnız embed**; sunucudan çekmek yasak |
| **Wikidata / Wikipedia** (mevcut) | marka, kategori, ürün tipi | Anahtarsız | Lisans/atıf kontrolü |

Kural: **logo alanı kanıt yuvası değildir** — görselleştirme; `dataCompleteness`'a
girmemeli (bugün `image` bonus; logo ayrı tutulmalı).

### L3 — Talep kanıtı (en zor katman)

| Aday | Sayısal sinyal | Erişim | Hüküm |
| --- | --- | --- | --- |
| **Google Ads API — Keyword Planning** | aylık ortalama arama, 4 yıl geçmiş, rekabet indeksi | Resmî; Basic erişim **15.000 işlem/gün**, 1 istek/sn | **En iyi ücretsiz-resmî talep proxy'si.** Ads hesabı + developer token gerekir; harcamasız hesapta metrik kalitesi test edilmeli |
| **YouTube Data API v3** | `viewCount`, `likeCount`, `commentCount` | Resmî; **10.000 birim/gün** + ayrı **100 `search.list`/gün** | Dikkat/creator aktivitesi; satın alma niyeti değil |
| **Google Trends** | arama ilgisi endeksi | Resmî API **alpha, başvuru**; gayriresmî uçlar | **Ölçüldü: 429** (datacenter IP). Mevcut kaynak fail-soft; üretim bağımlılığı yapılmamalı |
| **Google Suggest** | tamamlama listesi | Anahtarsız | Ölçüldü: **200 / 59 ms**, 10 öneri. Hacim değil; yalnız "kullanım/problem" keşfi. Dokümante API değil → varsayılan kapalı |
| **Amazon Creators API** | `salesRank` | Associates + **30 günde 10 satış** | Şart sağlanmıyorsa yok say |
| **eBay Marketplace Insights** | satış geçmişi | **Kapalı** (limited release) | Planlanmamalı |
| **Reddit Data API** | gönderi/yorum hacmi | OAuth; ticari kullanım onayı | `search.json` bu ağdan **403** (önceki ölçüm); onaysız kullanılmaz |
| **Wikipedia Pageviews** (mevcut) | günlük görüntülenme | Anahtarsız; **200 / 250 ms** | E-ticarete özgü değil ama dürüst ve stabil |

**Öneri:** talep kanıtını üç kademeli ve **etiketli** tut:
1. Ölçülmüş satış/yorum sayısı (varsa) → `salesVolume` / `ratingCount`.
2. Arama hacmi (Google Ads) → ayrı alan `searchVolume`, **satış değil**.
3. Dikkat sinyali (YouTube görüntülenme, Wikipedia) → ayrı alan `attentionIndex`.

Üçü tek `demand` alanına ezilirse kanıt yeniden şişer — bu, denetimdeki R6 bulgusunun
tekrarı olur.

### L4 — Tedarik & ekonomi

| Araç | Ne doldurur | Ücretsiz durum | Hüküm |
| --- | --- | --- | --- |
| **CJ Dropshipping API** | ürün maliyeti, **MOQ** (`directMinOrderNum`), depo ülkesi, stok | Hesap/token; **1 istek/sn** | En yakın ücretsiz yapısal tedarik kaynağı; FOB yerine geçmez |
| **Printify API** | POD taban maliyeti, fulfillment ülkesi, kargo profili | Token; 600 istek/dk | Ayrı "POD" sınıfı; MOQ kavramı yok |
| **made-in-china** (mevcut) | FOB aralığı, MOQ, tedarikçi adı | Anahtarsız | Birincil FOB kaynağı olarak kalmalı |
| **AliExpress** (mevcut) | perakende fiyat, satış adedi | Anahtarsız | Satış adedi gerçek; MOQ/FOB yok |
| **Frankfurter** | USD→TRY/EUR kuru, tarihli seri | Anahtarsız | **Ölçüldü: 200 / 102 ms**; aralık sorgusu da 200 |
| **open.er-api.com** | yedek kur | Anahtarsız, atıf şart | Ölçüldü: 200 / 105 ms |
| **VATcomply** | AB VAT oranı, VIES doğrulama | Anahtarsız, **2 istek/sn** | `GET /rates` **200**; `/vat` yanlış parametreyle 422 (doğru: `vat_number`) |
| **US HTS / EU TARIC** | gümrük vergisi | Tablo ücretsiz, **API yok** | Yerel veri seti + HS kodu zorunlu; ücretsiz sınıflandırma API'si yok |
| **EasyPost / Shippo / ShipEngine** | kargo teklifi | Yalnız sandbox / Shippo **$0.01/rate** | Ücretsiz üretim kargo kaynağı sayılmaz |
| **Freightos** | deniz/hava freight | Partner/rezervasyon şartı | Ücretsiz değil |

**Karar:** `launch-readiness.ts` içindeki "ilk sipariş = MOQ × FOB" hesabına **kargo ve
vergi** eklenmeli ama **ölçülmüşse**. Kargo ölçülmediyse kapı `unknown` kalmalı — bugünkü
dürüstlük sözleşmesiyle aynı.

### L5 — Rekabet yoğunluğu

- Bugün yalnız **kendi havuzundaki** benzer satır sayısı (`cohortCompetitors`).
- Eklenebilecek ücretsiz ölçüm: **eBay Browse API aktif ilan sayısı** (onay sonrası) ve
  **Awin/Impact feed'indeki aynı GTIN'e bağlı satıcı sayısı** (feed içe alındıysa bedava).
- **Yapılmaması gereken:** "kaç sonuç var"ı arama motoru HTML'inden saymak (bot duvarı,
  ToS, tutarsız sayı). Ölçülen tek şey ilan sayısıysa alan adı `activeListings` olmalı;
  "competitors" değil.

### L6 — Mevzuat / IP

- **AB TARIC** ve **US HTS** tabloları ücretsiz; API yok. Yerelde `hts/taric → duty`
  eşlemesi tutulmalı, ülke menşei ile birlikte.
- **VATcomply** oran için yeterli; **gümrük vergisi hesabı için değil**.
- Mevcut yasaklı kategori sözlüğü korunmalı; GTIN varsa marka-tescilli ürün kontrolü
  (Knowledge Graph varlık tipi) sinyal olarak eklenebilir, **veto değil**.

### L7 — AI konsey ve kısa liste

- **Mimari:** ürün başına **tek** şema-kısıtlı çağrı (14 rol tek JSON'da) + deterministik
  toplama. 14 paralel çağrı ücretsiz kotaları anında tüketir.
- **Ücretsiz kapasiteler (resmî):**
  - Gemini free tier: model/kota proje bazında değişiyor; **ücretsiz katmanda girdi/çıktı
    ürün geliştirmede kullanılabilir** ve **AB/İngiltere/İsviçre kullanıcısına hizmet
    için ücretli katman şart**.
  - Groq: ücretsiz ama RPD modele/organizasyona göre.
  - OpenRouter: ücretsiz modeller ~**50 istek/gün, 20/dk** (resmî sayfada doğrulanmalı).
  - **Cloudflare Workers AI: 10.000 neuron/gün** — istek sayısı değil; küçük modellerde
    verimli.
  - Hugging Face: ücretsiz kullanıcıya aylık çıkarım kredisi **yok**; Together **$15**
    ön ödeme; Cerebras yalnız 30 günlük deneme.
- **Kod tarafı:** `agents.server.ts` zaten çok sağlayıcılı; yapılacak olan **çağrı sayısını
  düşürmek** ve yedek (deterministik) rol oranını sonuç başlığında göstermek
  (denetimdeki R3).

### L8 — Operasyon

- **Feed içe alma işi:** Awin/Impact için günlük QStash işi; başarısızsa son iyi feed
  kullanılır, `ok:false` raporlanır.
- **Kaynak bütçeleri:** `scraper-quota.server.ts` deseni genişletilmeli (günlük kova +
  kaynak başına eşzamanlılık).
- **Tazelik damgası:** `priceStamp` kartta görünür olmalı (denetimde doğrulama borcu).

---

## 4. Bugün canlı ölçülen uç noktalar (2026-10-17, bu sandbox)

| Uç nokta | Sonuç | Süre | Not |
| --- | --- | --- | --- |
| `trends.google.com/trends/api/explore` | **429** | 75 ms | Datacenter IP; mevcut `getGoogleTrends` yedeğe düşüyor |
| `trends.google.com/trends/api/dailytrends` | **404** | 263 ms | Uç artık yok |
| `suggestqueries.google.com/complete/search` | **200**, 10 öneri | 59 ms | Dokümante değil; hacim değil |
| `allbirds.com/products.json?limit=3` | **200**, 20,3 KB | 167 ms | `vendor`, `product_type`, fiyat, görsel, stok var; **`barcode` null** |
| `api.frankfurter.dev/v1/latest` | **200** (USD→TRY 49,527) | 102 ms | Tarihli; aralık sorgusu da 200 |
| `open.er-api.com/v6/latest/USD` | **200** | 105 ms | Anahtarsız yedek |
| `api.vatcomply.com/rates?base=EUR` | **200**, 433 B | 332 ms | ECB oranları |
| `api.vatcomply.com/vat` (paramsız) | **422** | 387 ms | Doğru kullanım: `vat_number` |
| `world.openfoodfacts.org/api/v2/search` | **503** | 771 ms | Arama ucu güvenilmez |
| `world.openfoodfacts.org/api/v2/product/…` | **200**, marka+kategori | 806 ms | Barkod okuma çalışıyor |
| `wikimedia pageviews` | **200** | 250 ms | Mevcut kaynak |
| `api.ebay.com/buy/browse/...` (token yok) | **403** | — | OAuth şart |
| `googleapis.com/youtube/v3/search` (anahtar yok) | **403** | — | Anahtar şart |
| `img.logo.dev` (token yok) | **401** | — | Anahtar şart |

Bu tablo raporun omurgası: **yeşil olanlar bugün entegre edilebilir**, kırmızı olanlar
planlanmamalı.

---

## 5. Öncelik sırası (etki / emek)

| Öncelik | Değişiklik | Etki | Emek | Neden şimdi |
| --- | --- | --- | --- | --- |
| **P0** | Google Trends'e üretim bağımlılığını kaldır, etiketi "deneysel" yap | Yanlış güveni kaldırır | 0,5 gün | Bugün 429 ölçüldü |
| **P0** | GTIN check-digit + GS1 öneki (yerel) ve `gtin` ile tekilleştirme | Sahte barkod + mükerrer kayıt | 1 gün | API'siz, kalıcı kazanç |
| **P0** | Ücretsiz `BESTBUY_API_KEY` tanımla ve kategori/puan doluluğunu canlı ölç | Kategori 0-4/21 → ölçülmüş artış | 0,5 gün | Eşleme kodda var; sadece anahtar + ölçüm eksik |
| **P1** | Shopify D2C kaynağı (allowlist + robots + 24 saat cache) | Marka/kategori/fiyat/görsel | 2 gün | Ölçüldü; anahtarsız |
| **P1** | CJ Dropshipping API (MOQ + depo ülkesi doğrulaması) | MOQ'nun ikinci kaynaktan teyidi | 2 gün | Ücretsiz, yapısal |
| **P1** | Google Ads keyword metrics (arama hacmi) | Gerçek talep proxy'si | 3 gün | Ücretsiz-resmî, 15k işlem/gün |
| **P1** | Frankfurter + VATcomply bağla (kur, VAT) | Marj/vergi doğruluğu | 0,5 gün | Ölçüldü, anahtarsız |
| **P2** | eBay Browse (onay başvurusu, GTIN arama + aktif ilan sayısı) | GTIN/satıcı/rekabet | 3 gün + onay | Onay gecikmeli |
| **P2** | Awin/Impact feed içe alma (QStash + normalize tablo) | Marka+GTIN kapsamı | 1-2 hafta | Gerçek çözüm ama büyük iş |
| **P2** | YouTube Data API dikkat sinyali | Talep çeşitliliği | 1 gün | 100 arama/gün sınırı |
| **P2** | logo.dev / Brandfetch (embed) | Görsel kalite | 0,5 gün | Atıf/embed şartları |
| **P3** | Printify POD sınıfı, HTS/TARIC yerel tablo | Yeni segment / vergi | 3+ gün | Kapsam genişletme |

---

## 6. Eklenmemesi gerekenler (2026 itibarıyla ölü / kapalı / riskli)

- **Amazon PA-API v5** — emekli; çağrılar 403. Yerine **Creators API**, ama 30 günde 10
  satış şartı.
- **eBay Marketplace Insights** — limited release, yeni kullanıcıya kapalı.
- **eBay satılan-ürün sayfası kazıma** — `robots.txt` `/sch/` ve `LH_` parametreli
  aramaları kapatıyor.
- **Keepa** — abonelik; ücretsiz üretim katmanı yok.
- **Reddit `search.json`** — bu ağdan 403; ticari API onayı gerekir.
- **Product Hunt API** — ticari kullanım yasak (izin alınmadan).
- **Alibaba Open Platform** — ücretli GGS şartı.
- **1688 / AliExpress / DHgate / Temu / Target / Walmart / Newegg** — self-servis ücretsiz
  ürün arama API'si doğrulanamadı; hepsi partner/onay.
- **Google Merchant Center API** — satıcının kendi envanteri; rakip katalog taraması değil.
- **Datakick** — 2020'de kapandı.
- **exchangerate.host** — 100 istek/ay; **currencyapi** — 300/ay ve ticari için üst plan.
- **Hugging Face** ücretsiz çıkarım kredisi yok; **Together** $15 ön ödeme;
  **Cerebras** 30 günlük deneme.
- **Shippo rate** — $0.01/rate; **Freightos** — rezervasyon şartı.
- **Brandfetch'i sunucudan çekmek** — lisans gereği yalnız embed.
- **Google Suggest'i üretim API'si saymak** — hacim döndürmüyor, dokümante değil.

---

## 6b. UYGULANAN DEĞİŞİKLİKLER (2026-10-18) — ne kodlandı, ne ölçüldü

Aşağıdaki maddeler **eklendi ve test edildi**. Her satır hangi yuvayı doldurduğunu yazıyor;
anahtar yoksa kaynak 0 ms'de boş döner (ağ çağrısı yapılmaz) — yani "anahtar yok" hattı bozmaz.

| Katman | Eklenen | Tür | Ne kazandırır | Kanıt |
| --- | --- | --- | --- | --- |
| L1 Tekilleştirme | `product-identity.ts`: GS1 Mod-10 `isValidGtin`, `normalizeGtin` (UPC-12 → EAN-13), `gs1PrefixCountry` | anahtarsız, $0 | Sahte/bozuk barkod tekilleştirme çapası olamaz; aynı ürün ABD (UPC) ve AB (EAN) kaynağında tek anahtarda birleşir | `isValidGtin('0622356559772') === false`, `normalizeGtin('622356559775') === '0622356559775'` |
| L1 Tekilleştirme | `dedupKeys` artık GTIN + marka/MPN + model kodu anahtarlarını birlikte üretir | anahtarsız | Aynı ürünün iki yazımı nihai 5'liğe iki kez giremez | `product-discovery.test.ts` |
| L2 Marka/kategori | `product-categories.ts`: `TAXONOMY_RULES` + `inferProductCategory` (Google Product Taxonomy yolu, TR+EN kelimeler) | anahtarsız, $0 | Kategori 0-4/21 → başlıktan deterministik yol; kaynağın verdiği kategori ASLA ezilmez | 10 kural, 90+ anahtar kelime; eşleşme yoksa `""` |
| L2 Marka/GTIN | JSON-LD ayrıştırıcı `gtin/mpn/sku/category` alanlarını okur | anahtarsız | Pazaryeri markup'ı zaten taşıyordu, okuyucu düşürüyordu | `marketplace-jsonld.test.ts` (+2 test) |
| L0 Aday havuzu | `openbeautyfacts` (CGI `search.pl`, kozmetik nişi kapılı) | anahtarsız | Kozmetik nişlerinde pazar genişliği + öne çıkan markalar | `isBeautyNiche` kapısı, alakasız nişte 0 ağ çağrısı |
| L0 Aday havuzu | `woo-storefront` (WooCommerce Store API, `WOOCOMMERCE_STORES` allowlist) | anahtarsız | D2C mağaza katalogları: puan + yorum sayısı + kategori + fiyat tek yanıtta | allowlist boşsa 0 ms boş |
| L0 Aday havuzu | `ebay-browse` (Browse API) | anahtar: `EBAY_CLIENT_ID` + `EBAY_CLIENT_SECRET` (jeton otomatik) veya elle `EBAY_OAUTH_TOKEN` | Küresel ikinci el/yeni pazar: fiyat + görsel + kategori + aktif ilan sayısı (rekabet kanıtı) | `parseEbayBrowseItems` + `ebay-auth.test.ts` (client_credentials, önbellek, 401) |
| L0/L3 | `tavily-search` | anahtar: `TAVILY_API_KEY` | Web'de yayınlanmış gerçek fiyat/puan satırları (1.000 kredi/ay) | `parseTavilyResults` saf test |
| L0/L3 | `searchapi-shopping` + `serper-shopping` | anahtar: `SEARCHAPI_KEY` / `SERPER_API_KEY` | SerpAPI ile AYNI Google Shopping verisi (fiyat + puan + görsel) iki ek ücretsiz kotalı yoldan; biri tükenirse arama ölmez | `parseSerperShopping` / `parseSearchApiShopping` saf test; her servis kendi aylık kovasında |
| L3 Talep | `youtube-attention` (Data API v3) | anahtar: `YOUTUBE_API_KEY` | Niş dikkat/ilgi sinyali — `NON_PRODUCT_SOURCES` içinde, ürün kartı üretmez | 0 ms boş (anahtarsız) |
| L3 Talep | `google-trends-keyed` (SearchAPI/SerpAPI `engine=google_trends`) | anahtar: `SEARCHAPI_KEY` / `SERPAPI_KEY` | Anahtarsız Trends ucu 429 verdiğinde **gerçek** aylık seri buradan okunur; niş momentumu Wikipedia'ya bağımlı kalmaz | `momentumFromPoints` (iki yarı, ±100 bandı, <4 nokta → `null`), `parseKeyedTrends` |
| L3 Ekosistem | `github` kaynağı güçlendirildi: jeton desteği + ölçülen alanlar | anahtar: `GITHUB_API_TOKEN` (isteğe bağlı) | Kota 60 → 5.000 istek/saat (403 ile satır kaybı biter); `notes` artık yıldız + fork + açık konu + **son push N gün önce** + dil/etiket taşır; `archived` repo elenir | `githubApiHeaders`, `parseGithubRepos`, `daysSincePush` saf test |
| L4 Tedarik | `cj-supplier.server.ts`: `parseCjOffers`, `fetchCjOffers`, `resolveCjAccessToken`, `cjConfigured` | anahtar: `CJ_API_KEY` (jeton otomatik) | MOQ (`directMinOrderNum`), depo ülkesi, fiyat bandı — AliExpress/MIC'in ölçemediği yuvalar | `parseCjOffers` saf test + `ebay-auth.test.ts` (API Key ≠ access token, önbellek); pipeline 3. tedarik kaynağı |
| L4 Kur | `fx-rates.server.ts` çoklu sağlayıcı + önbellek | anahtarsız | Kur gelmezse fiyat `null` kalır (tahmin yok); artık 2 sağlayıcı denenir | `product-discovery-money.test.ts` |
| L7 AI havuzu | GitHub Models (`models.github.ai/inference`) `pool_d` yedeği | anahtar: `GITHUB_MODELS_TOKEN` | Ücretsiz günlük kota ile ek model kapasitesi; `PROVIDER_D` boşsa devreye girer | `ai-pool.test.ts`, `ai-keys.test.ts` |
| L8 Operasyon | Ön kontrol (`envChecks`) yeni anahtar adlarını tanır: SearchAPI/Serper, Tavily/Exa/Spider, eBay (Client ID+Secret ÇİFTİ), CJ | — | Panel "hangi anahtar eksik" sorusunu doğru yanıtlar; hepsi `optional` (hat düşmez). Yarım kimlik (yalnız Client ID) YEŞİL gösterilmez | `product-discovery-preflight.test.ts` (+2 test) |
| L0 Sorgu dili | `englishThenOriginal` + `ebay-browse`/`github` bu sırayı kullanır | $0 | Türkçe niş (`"LED masa lambası"`) EBAY_US ve GitHub'da 0 sonuç veriyordu; artık önce İngilizce karşılık denenir, ikinci istek YALNIZ ilki 0 satır dönerse atılır | `product-discovery-query.test.ts`; İngilizce nişte tek sorgu |
| L0 Sorgu sözlüğü | `PRODUCT_WORD_EN` düzeltmeleri + niteleyici/renk/malzeme kelimeleri + `PRODUCT_PHRASE_EN` (su geçirmez, el yapımı…) | $0 | Ölçülen yanlış çeviriler gitti: `kolye → necklace` (eskiden `earbuds`), `kayak → ski` (eskiden `paddle`), `tel → wire`, `kapı → door` (Türkçe karakterli anahtar hiç eşleşmiyordu). Niteleyiciler çevrilmediği için `"kablosuz kulaklık"` → `"kablosuz headphones"` gibi YARIM İngilizce sorgu çıkıyordu | `product-discovery-query.test.ts` (sözlük doğruluğu + niteleyici + kalıp testleri) |

**Eklenmeyenler ve nedeni:** satış adedi (ücretsiz genel API yok — eBay Insights kapalı, Amazon PA-API
emekli, Keepa ücretli), HS/HTS sınıflandırma (ücretsiz API yok), Reddit (403), Product Hunt (ticari
yasak), Alibaba/1688/Temu/Walmart (partner onayı). "Görüntülenme ≠ satış" ayrımı korunuyor.

---

## 6c. ENV — hangi anahtar ne açar

**Zorunlu değil, hepsi isteğe bağlı** (yoklukları hattı düşürmez, ilgili kaynak atlanır):

| Env | Servis | Ücretsiz katman | Ne açar |
| --- | --- | --- | --- |
| `JINA_API_KEY_1..8` | jina.ai Reader | 10M token/anahtar | Ürün sayfası okuma (en yüksek etki) |
| `SERPAPI_KEY` / `SEARCHAPI_KEY` / `SERPER_API_KEY` | SerpAPI / SearchAPI / Serper | 100/ay · 100/ay · 2.500 tek seferlik | Google Shopping gerçek fiyat + puan |
| `SCRAPERAPI_KEY` | ScraperAPI | 1.000 kredi/ay | TR/yerel pazaryeri kazıması |
| **`EBAY_CLIENT_ID` + `EBAY_CLIENT_SECRET`** (önerilen) | eBay Browse | 5.000 çağrı/gün | Küresel pazar + aktif ilan sayısı. Jeton `client_credentials` ile otomatik alınır ve ~2 saatte yenilenir (`ebay-auth.server.ts`). Alternatif: elle `EBAY_OAUTH_TOKEN` (2 saatte ölür) |
| `TAVILY_API_KEY` | Tavily | 1.000 kredi/ay | Web fiyat/puan satırları |
| `CJ_API_KEY` | CJ Dropshipping | 50.000 puan/gün | MOQ + depo ülkesi + fiyat bandı. Panel API Key'i **doğrudan jeton değildir**: `getAccessToken` ile değiştirilir (süreç başına önbellekli). Alternatif: hazır `CJ_ACCESS_TOKEN` |
| `BESTBUY_API_KEY` | Best Buy | ücretsiz anahtar | ABD katalog: fiyat + puan + GTIN |
| `YOUTUBE_API_KEY` | YouTube Data v3 | 10.000 birim/gün | Dikkat sinyali (ürün değil) |
| `GITHUB_API_TOKEN` (`GH_API_TOKEN`/`GITHUB_PAT` eşanlamlı) | GitHub REST | jetonlu 5.000 istek/saat (jetonsuz 60) | Niş ekosistem kanıtı: yıldız/fork/açık konu/son push — **git için kullanılan `GITHUB_TOKEN`'dan ayrı**, o otomatik tüketilmez |
| `FIRECRAWL_API_KEY` / `SCRAPINGBEE_API_KEY` / `SPIDER_API_KEY` / `EXA_API_KEY` | Firecrawl / ScrapingBee / Spider / Exa | 1.000/ay · 1.000 · deneme · 1.000/ay | Jina düşerse yedek okuma |
| `GITHUB_MODELS_TOKEN` (+ `GITHUB_MODELS_MODEL`) | GitHub Models | ücretsiz günlük kota | Ek LLM kapasitesi (`pool_d`) |
| `WOOCOMMERCE_STORES` | kendi/izinli mağaza listesi | $0 | D2C katalog satırları |
| `PROVIDER_A..E_1..8` (+ `_BASE_URL`, `_MODEL`) | DeepSeek / Z.ai / MiMo / Qwen / EVREN | sağlayıcıya göre | Konsey kapasitesi |

Anahtarsız çalışanlar (hiçbir şey istemez): Wikipedia + Pageviews, Google News, Hacker News,
Arctic Shift (Reddit arşivi), GitHub, Steam, Open Food/Beauty Facts, Wikidata, AliExpress,
Made-in-China, Newegg, Otto/Flipkart/Rakuten okuyucuları, deal-feed, Bing Shopping,
Frankfurter/VATcomply (kur), `inferProductCategory` (kategori), GTIN doğrulama.

---

## 7. Doğrulama planı (kod değişikliği yapıldığında)

Mevcut desen korunmalı: canlı ağ testleri `*_LIVE=1` bayrağıyla, normal koşuda atlanır.

1. **Birim testleri (ağsız):** GTIN check-digit, GS1 öneki, Shopify JSON ayrıştırıcı,
   `vatcomply` yanıt eşlemesi, CJ `directMinOrderNum` ayrıştırıcı.
2. **Wiring testleri:** yeni kaynağın `PRODUCT_SOURCES`'a eklendiği, `isNonProductSource`
   listesinde **olmadığı**, `runSources` fail-soft sözleşmesine uyduğu.
3. **Canlı testler (ölçüm raporlu):** `SHOPIFY_LIVE=1` (allowlist 2 mağaza, kategori/marka
   doluluk oranı), `CJ_LIVE=1` (MOQ/depo ülkesi doluluk), `GOOGLE_ADS_LIVE=1` (anahtar
   kelime hacmi var mı), `FX_LIVE=1` (Frankfurter + VATcomply).
4. **Regresyon:** `bunx vitest run` (tam paket) + değişen dosyalar için daraltılmış
   `tsc`; tam `tsc` bu sandbox'ta 180 sn'yi aşıyor.
5. **Dürüstlük kontrolü:** yeni kaynak `null` döndürdüğünde `dataCompleteness` artmamalı;
   "görüntülenme" alanı `salesVolume`'a yazılmamalı (test bunu kilitlemeli).

---

## 8. Kaynaklar (okunan resmî sayfalar)

- eBay Browse API — https://developer.ebay.com/api-docs/buy/static/api-browse.html
- eBay robots — https://www.ebay.com/robots.txt
- Best Buy API — https://developer.bestbuy.com/apis · https://bestbuyapis.github.io/api-documentation/ · https://developer.bestbuy.com/legal
- Awin publisher feed — https://help.awin.com/developers/docs/product-feed-publisher-guide-intro
- Impact katalog alanları — https://help.impact.com/partner/what-would-you-like-to-learn-about/platform-features/marketing-content/product-marketplace-and-catalogs/download-product-catalogs-as-a-partner
- UPCitemdb — https://devs.upcitemdb.com/
- Open Food Facts API — https://openfoodfacts.github.io/openfoodfacts-server/api/
- Shopify Ajax API — https://shopify.dev/docs/api/ajax
- CJ Dropshipping ürün API'si — https://developers.cjdropshipping.com/en/api/api2/api/product.html
- CJ hız limitleri — https://developers.cjdropshipping.com/en/api/start/limit.html
- Printify API — https://developers.printify.com/
- Google Ads keyword metrics — https://developers.google.com/google-ads/api/docs/keyword-planning/generate-historical-metrics
- Google Ads erişim seviyeleri — https://developers.google.com/google-ads/api/docs/api-policy/access-levels
- YouTube quota — https://developers.google.com/youtube/data/determine_quota_cost
- Amazon Creators API — https://affiliate-program.amazon.com/creatorsapi/docs/en-us/introduction
- Amazon PA-API emeklilik — https://affiliate-program.amazon.com/creatorsapi/docs/en-us/paapiv5-deprecation
- Google Trends resmî API duyurusu — https://developers.google.com/search/blog/2025/07/trends-api
- Reddit Data API şartları — https://redditinc.com/policies/data-api-terms
- Product Hunt API — https://api.producthunt.com/v2/docs
- Frankfurter — https://frankfurter.dev/
- ExchangeRate-API open — https://www.exchangerate-api.com/docs/free
- VATcomply — https://www.vatcomply.com/
- EU TARIC — https://taxation-customs.ec.europa.eu/online-services/online-services-and-databases-customs/eu-customs-tariff-taric_en
- US HTS — https://hts.usitc.gov/
- EasyPost rates — https://docs.easypost.com/docs/shipments/rates
- Shippo fiyatlandırma — https://goshippo.com/pricing/api
- logo.dev — https://www.logo.dev/pricing
- Brandfetch logo API — https://docs.brandfetch.com/logo-api/overview
- Google Knowledge Graph limitleri — https://developers.google.com/knowledge-graph/reference/rest/v1/usage-limits
- Gemini kota — https://ai.google.dev/gemini-api/docs/rate-limits
- Gemini şartlar — https://ai.google.dev/gemini-api/terms
- Cloudflare Workers AI fiyatlandırma — https://developers.cloudflare.com/workers-ai/platform/pricing/
- OpenRouter FAQ — https://openrouter.ai/docs/faq
- Cerebras limitler — https://inference-docs.cerebras.ai/support/rate-limits
- Hugging Face çıkarım fiyatlandırma — https://huggingface.co/docs/inference-providers/pricing
