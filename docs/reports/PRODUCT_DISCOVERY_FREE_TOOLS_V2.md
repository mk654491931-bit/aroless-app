# Ürün bulucu — katman katman ücretsiz araç araştırması (v2)

Tarih: **2026-10-17** · Kapsam: L0–L8 · Yöntem: kod okuması + resmî doküman + **bu ağda canlı ölçüm**

Bu rapor `PRODUCT_DISCOVERY_FREE_UPGRADES_2026.md`'nin devamıdır ama onu tekrar etmez:
**aynı uç noktaları bugün yeniden ölçtü**, sekiz iddiayı düzeltti ve dokuz yeni uç noktayı ölçtü.
Kural değişmedi: **ölçülmeyen alan `null` / "—" kalır.** "Ücretsiz" burada *sürekli* ücretsiz
katman demektir; tek seferlik deneme kredisi ücretsiz sayılmadı.

---

## 1. Yönetici özeti

1. **En büyük kalite kazancı daha çok ham satır değil, marka/kategori/yorum sayısı.**
   Bugünkü ölçüm (air fryer / US): marka 6-12/21, kategori 0-4/21, `ratingCount` **0/21**.
   Ücretsiz kaynaklarla bu üç yuva gerçekten dolabilir — ama doğru kaynakla.
2. **Yeni ve en güçlü anahtarsız kaynak: WooCommerce Store API.** Gerçek bir mağazada
   `GET /wp-json/wc/store/v1/products` **200 / 20,3 KB / 2 satır** döndü; alanlar
   `name · sku · prices · average_rating · review_count · categories · brands · images`.
   Yani **puan + yorum sayısı + kategori + fiyat** aynı yanıtta, anahtarsız.
3. **Shopify `products.json`** 25 üründe `vendor`/`product_type`/`sku`/görsel **%100**,
   **`barcode` %0**. Marka/kategori için mükemmel, GTIN için değil.
4. **Mevcut JSON-LD ayrıştırıcısı GTIN/MPN okumuyor** (`marketplace-jsonld.ts`):
   marka, fiyat, puan, yorum sayısı, satıcı var; `gtin/gtin13/mpn/sku` yok. Tekilleştirme
   için en ucuz kazanç burada.
5. **Jina Reader (anahtarsız, 20 RPM) JS ile çizilen ürün sayfasını 724 ms'de HTML olarak
   döndürdü** ve sayfada 1 JSON-LD bloğu vardı. Doğrudan `fetch` aynı sayfada **0** JSON-LD
   gördü (8,1 KB, kabuk HTML). Yani "pazaryeri sayfasını oku" katmanı artık mümkün.
6. **Open Food/Beauty/Products Facts metin araması ÇALIŞMIYOR**: `search_terms` ve `q`
   yok sayılıyor (üç farklı sorgu **aynı** 47.176 kaydı ve aynı ilk kodları döndürdü).
   Bu aile yalnız **barkod ve kategori** okuması için kullanılmalı. (Bu turun ilk
   ölçümünde OBF'de "marka %50" görünmüştü; o satırlar shampoo sonucu değil, katalogun
   rastgele ilk satırlarıydı — sorgu parametresi yok sayıldığı için.)
7. **Talep katmanında ücretsiz "satış adedi" yok.** Ücretsiz ve bugün çalışan sinyaller
   *hacim değil*: Amazon/eBay autocomplete (200, ~10 öneri), Google Trends RSS (200),
   Wikipedia pageviews (200), UN Comtrade (200, kategori ticareti). Arama **hacmi** için tek
   ciddi ücretsiz-resmî yol Google Ads API; erişim başvuruya bağlı.
8. **Ücretsiz araç sayısı değil, bütçe disiplini kazandırıyor.** UPCitemdb bir sorguda
   5 satır döndürüyor ama o 5 satırın **%100'ünde** marka+kategori+GTIN+fiyat+görsel var.
   Bu yüzden pahalı arama kotası rastgele nişlere değil, **aday havuzundaki marka
   çapalarına** harcanmalı.

---

## 2. Katman haritası — darboğaz nerede?

| # | Katman | Kod | Bugün ölçülen | Gerçek darboğaz | En iyi ücretsiz araç (bu rapor) |
| --- | --- | --- | --- | --- | --- |
| L0 | Aday havuzu | `PRODUCT_SOURCES` (`product-discovery-sources.server.ts`) | **24 kaynak**: TR okuyucu, AliExpress, Newegg, Otto, Flipkart, Rakuten, Best Buy, deal-feed, Steam, Bing, SerpAPI, TR marketplace, OpenLibrary + talep/bağlam (Trends, News, Wikipedia, pageviews, HN, Reddit arşivi, GitHub, OFF, Wikidata) | Kaynak **sayısı** değil, satır **kalitesi**: markasız/kategorisiz kartlar | WooCommerce Store API + Shopify allowlist; autocomplete ile sorgu genişletme |
| L1 | Normalize / tekilleştirme | `product-discovery-filter.server.ts`, `productFingerprint`, `productModelKey` | başlık+marka+satıcı parmak izi; model kodu | GTIN yok → aynı ürün iki kayıtta | JSON-LD'den `gtin/mpn/sku` + yerel GTIN check-digit |
| L2 | Marka / kategori / GTIN / görsel | `product-brand.ts`, `product-catalog.server.ts` | marka 6-12/21, kategori 0-4/21 | Kaynaklar alanı yayınlamıyor; katalog kotası 2 arama/koşu | UPCitemdb (marka çapası), mağaza API'leri, Jina+JSON-LD |
| L3 | Talep kanıtı | `demand` yuvası, `googleTrendsSource`, `wikipediaPageviewsSource` | satış 14/21; Trends 429 | Ücretsiz satış hacmi yok; arama hacmi gated | Google Ads API (başvuru), autocomplete (kelime haznesi), Comtrade (kategori) |
| L4 | Tedarik & ekonomi | `aliexpress`, `made-in-china`, `supplier-economics.ts`, `launch-readiness.ts` | MOQ %97-100, FOB %100 | Kargo/vergi yok; ikinci tedarikçi teyidi yok | CJ Dropshipping, Printify shipping profili, Frankfurter/VATcomply |
| L5 | Rekabet | `cohortCompetitors` | yalnız kendi havuzu | Havuz dışı aktif ilan sayısı yok | eBay Browse (onay), SerpAPI 250/ay |
| L6 | Mevzuat / IP | yasaklı kategori sözlüğü | başlık taraması | HS kodu yok; ücretsiz sınıflandırıcı yok | USITC HTS + WITS (kod **verildikten** sonra) |
| L7 | AI kısa liste + konsey | `agents.server.ts`, `council.server.ts` | Gemini/Groq/OpenRouter/HF/AI Gateway | 14 çağrı kotayı yakıyor; yedek oranı görünmüyor | Tek şema çağrısı + deterministik toplama; Cloudflare Workers AI yedek |
| L8 | Operasyon | `swr-cache.server.ts`, `scraper-quota.server.ts`, QStash | 3 saat okuyucu önbelleği, günlük kovalar | Yeni kaynak başına bütçe/tazelik yok | Aynı desen + kaynak başına günlük kova |

---

## 3. Katman katman öneriler

### L0 — Aday havuzu

#### 3.1 WooCommerce Store API — **ölçüldü, anahtarsız, en iyi yeni kaynak**

`GET https://<mağaza>/wp-json/wc/store/v1/products?search=<niş>&per_page=20`

Ölçüm (2026-10-17, gerçek mağaza): **200 / 20,3 KB / 2 satır**, alanlar:

```text
name · sku · prices{price, currency_code} · average_rating · review_count
categories[] · brands[] · images[] · permalink · stock_availability
```

- **Doldurduğu yuvalar:** marka (varsa `brands`), kategori, fiyat, görsel, stok,
  **puan**, **yorum sayısı** — yani bugün 0/21 olan `ratingCount` yuvası.
- **Doldurmadığı:** GTIN (standart alan değil; eklenti varsa `sku` altında), satış adedi.
- **Eşleşme yoksa davranış dürüst:** `search=shampoo` → **200 + `[]`** (hata değil).
- **Uygulama biçimi:** genel tarayıcı değil, **niş başına mağaza allowlist'i** + mağaza
  `robots.txt` kontrolü + 24 saat önbellek. Kaynak adı `woo-storefront`; `PRODUCT_SOURCES`'a
  eklenir, `runSources` fail-soft sözleşmesine uyar. Ülke filtresi mağazanın para biriminden
  okunur (`prices.currency_code`), ayrı bir ülke alanı uydurulmaz.
- **Ölçülen risk:** yanıt **3,9 s** sürdü; kaynak tavanı 4-8 sn olduğu için yavaş mağaza
  timeout'a düşebilir. Bu yüzden mağaza başına ayrı tavan (ör. 3 sn) ve `ok:false` raporu
  şart; yavaş mağaza hattı durdurmaz.

#### 3.2 Shopify `products.json` — **ölçüldü, marka/kategori %100, barkod %0**

`GET https://<mağaza>/products.json?limit=25`

| Alan | Doluluk (25 ürün) |
| --- | --- |
| `vendor` (marka) | **%100** |
| `product_type` (kategori) | **%100** |
| `variants[].sku` | **%100** |
| `images[]` | **%100** |
| `variants[].barcode` | **%0** |

- **Uyarı:** Shopify bunu resmî "katalog API'si" olarak taahhüt etmiyor; mağaza bazlı
  izin/robots kontrolü zorunlu. Toplu mağaza taraması yapılmamalı, allowlist kullanılmalı.
- **Doldurduğu:** marka, kategori, fiyat, görsel, stok, satıcı (mağaza adı).
- **Doldurmadığı:** GTIN, puan, yorum sayısı, satış.

#### 3.3 Sorgu genişletme — **ölçüldü, anahtarsız, sıfır maliyet**

Ürün bulucunun isabeti büyük ölçüde **nişi nasıl yazdığına** bağlı. Üç ücretsiz tamamlama
ucu bugün çalıştı:

| Uç | Ölçüm | Ne verir | Ne vermez |
| --- | --- | --- | --- |
| `completion.amazon.com/api/2017/suggestions?mid=ATVPDKIKX0DER&alias=aps&prefix=…` | **200 / 0,20 s / 2,8 KB** | "air fryer oven", "air fryer 8 qt" gibi alıcı dili | hacim, satış |
| `autosug.ebay.com/autosug?kwd=…&fmt=json` | **200 / 0,18 s / 405 B**, 10 öneri | pazaryeri uzun kuyruğu | hacim |
| `suggestqueries.google.com/complete/search` | 200 (önceki ölçüm, 59 ms) | genel uzun kuyruk | hacim |

**Kullanım kuralı:** bu üçü **`salesVolume`'a yazılmaz**. Ayrı ve etiketli bir sinyal olur:
`queryBreadth` = öneri listesindeki *ayırt edici* tamlamaların sayısı (ör. "8 qt", "dual basket",
"ninja"). Sorgu üretiminde kullanılır (`productQueryVariants` yanına), talep kanıtı sayılmaz.
Dokümante API değiller → varsayılan **kapalı**, açılırsa 1 istek/niş + 6 saat önbellek.

#### 3.4 eBay Browse + Best Buy — kod yok, **anahtar/onay** var

- eBay Browse: ücretsiz geliştirici hesabı + OAuth; geliştirici katmanı tipik olarak
  ~5.000 çağrı/gün, üretim kullanımı onaya bağlı. Anahtarsız çağrı bugün de **403**.
- Best Buy: `BESTBUY_API_KEY` tanımlıysa kaynak zaten `categoryPath`, `customerReviewCount`,
  `customerReviewAverage`, `manufacturer` alanlarını istiyor; anahtar yokken **0 ağ çağrısı**.
  Yani bu bir *kod* işi değil, **yapılandırma + ölçüm** işi. Ücretsiz anahtar alındığı gün
  ABD nişlerinde kategori ve `ratingCount` yuvaları ölçülmüş hâle gelir.

---

### L1 — Normalize / tekilleştirme

1. **GTIN check-digit + GS1 öneki yerelde** (API'siz): 8/12/13/14 hane, Mod-10 doğrulama,
   GS1 ülke öneki. "Matematiksel olarak geçerli" ≠ "GS1 tahsis etti" notu koda yazılmalı.
   Uydurma barkod burada elenir.
2. **`marketplace-jsonld.ts` eksik alanları:** bugün `MarketplaceRow` içinde
   `brand · price · rating · ratingCount · seller` var; **`gtin · mpn · sku` yok**.
   `schema.org/Product` bu alanları `gtin/gtin8/gtin12/gtin13/gtin14`, `mpn`, `sku` olarak
   yayınlar. Eklendiğinde aynı ürünün iki kaynaktaki kaydı **GTIN ile** birleşir; ayrıca
   `ProductGroup.hasVariant` altındaki varyantların SKU'su okunabilir (ölçülen sayfa tam
   olarak `@type: ProductGroup` + `hasVariant` döndürdü).
3. **Öncelik sırası:** GTIN var → GTIN; yok → mevcut `productModelKey`; yok → fingerprint.
   Bu sıra, "marka yoksa GTIN'den marka doğrula" zincirini de mümkün kılar.

---

### L2 — Marka / kategori / GTIN / görsel

| Araç | Ölçülen | Ücretsiz kota | Doldurduğu | Doldurmadığı |
| --- | --- | --- | --- | --- |
| **UPCitemdb** `/prod/trial/search` | **200 / 0,55 s / 5 satır**; marka, kategori, görsel, fiyat, GTIN **%100**, model %80 | 100 istek/gün, **≤40 arama**, 6 istek/dk (bu ağda 3. ardışık istek 429) | marka, kategori, GTIN, kayıtlı fiyat, görsel | puan, yorum sayısı, satış |
| **WooCommerce Store API** | 200 / 20,3 KB | mağaza başına, anahtarsız | marka, kategori, fiyat, **puan + yorum** | GTIN, satış |
| **Shopify `products.json`** | 200 / %100 vendor+type | mağaza başına, anahtarsız | marka, kategori, fiyat, görsel | GTIN, puan |
| **Jina Reader + JSON-LD** | 200 / **724 ms** / 668 KB / 1 blok | anahtarsız **20 RPM** (anahtarla 500 RPM) | marka, fiyat, puan, yorum, (varsa) GTIN | garanti yok: sayfa şeması değişebilir |
| **Open Beauty / Products Facts** | 200; `categories_tags` çalışıyor | anahtarsız | barkod/kategori zenginleştirme | **metin araması yok** (aşağıda) |
| **Open Prices** | 200 / 20 satır (Nutella barkodu) | anahtarsız | gözlemlenmiş fiyat kaydı | ülke filtresi yok sayıldı; satırların çoğunda isim/marka `null` |
| **Google Knowledge Graph** | anahtarsız 403 | 100.000 okuma/gün (anahtarla) | marka/varlık kimliği | katalog/fiyat değil |
| **logo.dev / Brandfetch** | anahtarsız 401 | 500k CDN/gün / ~1M | logo | **kanıt yuvası değil**, yalnız görsel |

**Kritik düzeltme — bu aile metin araması yapmıyor:**

| Sorgu (Open Products Facts) | `count` | İlk 6 kod |
| --- | --- | --- |
| `search_terms=air fryer` | 47.176 | 5000158100381, 0729927772417, … |
| `search_terms=electric kettle` | 47.176 | **aynı** |
| `search_terms=shampoo` | 47.176 | **aynı** |
| `q=air fryer` | 47.176 | **aynı** |
| `categories_tags=en:kitchen-appliances` | **67** | farklı |

Open Beauty Facts'ta da aynı: `shampoo` ve `lipstick` **aynı** 77.736 kaydı döndürdü;
`categories_tags=en:shampoos` ise 1.880. Yani bu API'ler **yalnız barkod ve kategori**
okuması için kullanılmalı; niş aramasında kullanılırsa havuza **alakasız ürün** sokar.

---

### L3 — Talep kanıtı (en zor katman)

**Değişmeyen gerçek:** ücretsiz ve genel bir **satış adedi** API'si yok. eBay Marketplace
Insights yeni kullanıcıya kapalı, Amazon PA-API emekli, Keepa ücretli. Bu yüzden
`salesVolume` ücretsiz kaynakla doldurulmamalı.

| Aday | Ölçüm / durum | Ne döndürür | Hüküm |
| --- | --- | --- | --- |
| **Google Ads API — Keyword Planning** | Erişim başvuruya bağlı. **Basic: 15.000 işlem/gün**, planlama çağrıları **1 istek/sn**. 2026-09-09'da developer token kaldırıldı; erişim Cloud projesine bağlı | aylık ortalama arama, 4 yıl geçmiş, rekabet indeksi | **Tek gerçek ücretsiz arama hacmi yolu.** Sıfır harcamalı hesapta kesinlik **doğrulanamadı** → hacim gelmezse `null` |
| **Amazon autocomplete** | **200 / 0,20 s** | 10 öneri | kelime haznesi; hacim değil |
| **eBay autosuggest** | **200 / 0,18 s** | 10 öneri | kelime haznesi; hacim değil |
| **Google Trends RSS** | **200 / 0,12 s / 21,6 KB** | günlük trend başlıkları + kaba trafik kovası (`100+`) | niş ölçmez; yalnız "bugün ne patlıyor" |
| **Google Trends explore** | **429** (önceki ölçüm, 75 ms) | — | üretim bağımlılığı yapılmamalı; kaynak fail-soft kalsın |
| **Wikipedia pageviews** | **200 / 0,22 s**; Air_fryer 2026-01: **3.291** | gerçek görüntülenme | dikkat sinyali; satış değil |
| **UN Comtrade** (public preview) | **200 / 1,24 s / 82,7 KB**, 92 satır | HS kodu bazında ithalat/ihracat değeri ve miktarı | **kategori pazar büyüklüğü**; ürün talebi değil |
| **GDELT DOC API** | **429** ("1 istek/5 sn"), 6 sn sonraki deneme **timeout** | haber hacmi | kararsız; eklenmemeli |
| **Reddit `search.json`** | **403** / 190 KB HTML | — | onaysız kullanılmaz |
| **Google Books** | **429** (günlük kota) | — | kullanılmaz |
| **YouTube Data API** | anahtarsız 403; ücretsiz 10.000 birim/gün + **100 `search.list`/gün** | video/kanal, `viewCount` | dikkat sinyali; satın alma niyeti değil |

**Tasarım kuralı (denetimdeki R6'nın tekrarını önler):** üç sinyal **üç ayrı alan** olarak taşınır:

```text
salesVolume      ← yalnız ölçülmüş satış (bugün: AliExpress/TR okuyucu)
searchVolume     ← yalnız Google Ads (yoksa null)
attentionIndex   ← Wikipedia pageviews / YouTube / Trends RSS (ayrı etiket)
```

Üçü tek `demand` alanına ezilirse kanıt yeniden şişer.

---

### L4 — Tedarik & ekonomi

| Araç | Ücretsiz durum | Doldurduğu | Not |
| --- | --- | --- | --- |
| **made-in-china** (mevcut) | anahtarsız, izinli yol | FOB aralığı, MOQ, tedarikçi adı | birincil FOB kaynağı olarak kalmalı |
| **CJ Dropshipping API** | ücretsiz hesap/token; `listV2` **30 istek/sn** | `sellPrice`, `nowPrice`, depo ülkesi, stok, `directMinOrderNum` | MOQ'nun **ikinci kaynaktan teyidi**; FOB yerine geçmez |
| **Printify API** | ücretsiz token; **600 istek/dk** (katalog 100/dk) | POD taban maliyeti, fulfillment ülkesi, **shipping profili** (`first_item`, `additional_items`, handling) | yalnız POD sınıfı; MOQ kavramı yok |
| **Open Supply Hub** | **API $225/ay** | tesis/kapasite araştırması | **reddedildi** (ücretsiz değil) |
| **Frankfurter** | anahtarsız, **200 / 0,11 s**, USD→TRY **49,527** | günlük kur | ödeme kuru değil |
| **VATcomply `/vat_rates`** | anahtarsız, **200 / 0,45 s / 237 KB** | AB ülke VAT oranları | `/vat` parametresiz 422 → doğru uç `/vat_rates` |
| **Shippo rate** | **$0,01 / rate** (30 etiket/ay ücretsiz) | kargo teklifi | **ücretsiz sayılmaz** |
| **ShipStation API** | $0/ay plan, API ücreti yok (kota yayınlanmamış) | taşıyıcı oranları | doğrulanması gereken tek aday |
| **USITC HTS `reststop/search`** | anahtarsız, **200 / 0,42 s / 34 KB** | tarife satırı + vergi kolonları | kod **verildikten** sonra |
| **WITS API** | anahtarsız, **200 / 0,88 s** (XML) | HS6 tarife/ticaret özeti | ortalama; kesin gümrük vergisi değil |
| **UN Comtrade** | public preview **200** | HS kodu ticaret hacmi | pazar büyüklüğü |

**Ölçülen sınır:** başlıktan **HS kodu** üreten ücretsiz ve güvenilir bir API yok.
`hts.usitc.gov/reststop/search?keyword=air fryer` **200** döndü ama ilk sonuç
"Young (broilers, **fryers**, roasters and capons)" — yani ürün değil, **tavuk**. Otomatik
sınıflandırma bugün yanlış vergi oranı üretir. `launch-readiness` bu yüzden **mevzuat
kapısını `unknown`** tutmaya devam etmeli.

---

### L5 — Rekabet yoğunluğu

- Bugün yalnız **kendi havuzundaki** benzer satır sayısı (`cohortCompetitors`).
- Eklenebilecek ücretsiz ölçüm: **eBay Browse** ile aynı GTIN/başlık için aktif ilan sayısı
  (onay sonrası) ve **SerpAPI Google Shopping** (`total_results`; ücretsiz plan **250 arama/ay,
  50/saat**). İkisi de "kaç sonuç var"ı bot duvarından saymaz; **ilan sayısı** der.
- Alan adı `activeListings` olmalı — "competitors" değil. Ölçülen şey ilan sayısıdır.
- **Yapılmaması gereken:** eBay/Walmart/Amazon arama HTML'inden sonuç sayısı saymak
  (robots, bot duvarı, tutarsız sayı).

---

### L6 — Mevzuat / IP

- **USITC HTS** (anahtarsız) ve **EU TARIC** (Excel) tabloları ücretsiz; **API yok**.
  Yerelde `hs → duty` tablosu tutulmalı, ülke menşeiyle birlikte.
- **VATcomply** yalnız oran/numara doğrulama; gümrük vergisi hesabı değil.
- Mevcut yasaklı kategori sözlüğü korunmalı. GTIN varsa marka-tescilli ürün kontrolü
  **sinyal** olabilir, **veto** olamaz.
- Ücretsiz "başlık → HS kodu" API'si **yok**; bu yuva `unknown` kalmalı (bkz. L4 ölçümü).

---

### L7 — AI kısa liste + konsey

**Mimari kazanç, sağlayıcı sayısından büyük:** 14 ayrı çağrı yerine **tek şema-kısıtlı
çağrı** (14 rol tek JSON'da) + deterministik toplama. Her rol için ayrı çağrı, ücretsiz
kotaları 14 ile çarpar.

| Sağlayıcı | 2026 durumu | Not |
| --- | --- | --- |
| **Gemini free tier** | var; model/kota proje bazında, canlı limit AI Studio'da | ücretsiz katmanda **girdi/çıktı ürün geliştirmede kullanılabilir**; **AB/İngiltere/İsviçre** uygulama kullanımı ücretli katman ister |
| **Groq** | ücretsiz katman var; yayınlanan tablo **Developer** planı | JSON schema bazı modellerde |
| **Cloudflare Workers AI** | **10.000 neuron/gün**, metin üretiminde **300 istek/dk** | yeni, iyi bir ücretsiz yedek |
| **OpenRouter free** | **50 istek/gün**, 20 RPM; **$10 kredi → 1.000/gün** | 50/gün = günde en fazla 3 tam konsey |
| **Cohere trial** | **1.000 çağrı/ay**, 20 RPM | JSON schema var |
| **Cerebras** | tek seferlik **$5 / 30 gün** | sürekli ücretsiz değil |
| **GitHub Models** | **30 Temmuz 2026'da kapatıldı** | planlanmamalı |
| **Together** | ücretsiz deneme yok, min **$15** | — |
| **Hugging Face** | ücretsiz hesapta aylık çıkarım kredisi **yok** | — |

**Kod tarafı:** `ai-router.server.ts` zaten çok sağlayıcılı. Yapılacak: (a) çağrı sayısını
düşürmek, (b) sonuç başlığında **kaç rolün gerçek AI, kaç rolün deterministik yedek**
olduğunu göstermek (denetim R3), (c) 429'da sağlayıcı değiştirirken **hangi modelin**
kullanıldığını kaydetmek.

---

### L8 — Operasyon

- **Kaynak başına günlük kova:** `scraper-quota.server.ts` deseni yeni kaynaklara da
  uygulanmalı (Woo/Shopify mağaza başına, Jina RPM, autocomplete 1/niş).
- **Tazelik damgası:** `priceStamp` kartta görünmeli; 24 saatten eski fiyat "bugünkü fiyat"
  gibi sunulmamalı.
- **Allowlist işi:** mağaza listesi koda gömülmemeli; QStash günlük işi listeyi tazeler,
  erişilemeyen mağaza 3 hatadan sonra düşer (`ok:false` raporlanır).
- **Önbellek:** Jina/JSON-LD sonucu ürün URL'si başına 24 saat; UPCitemdb yanıtı 24 saat
  (mevcut desen).

---

## 4. Bugün canlı ölçülen uç noktalar (2026-10-17, bu ağ)

| Uç nokta | Sonuç | Süre | Boyut | Hüküm |
| --- | --- | --- | --- | --- |
| `prices.openfoodfacts.org/api/v1/prices` | **200** | 0,65 s | 7,8 KB | çalışıyor; ülke filtresi yok sayıldı |
| `world.openfoodfacts.org/api/v2/product/…` | **200** | 1,09 s | 154 KB | barkod okuma çalışıyor |
| `world.openfoodfacts.org/api/v2/search` | **503** | 0,64 s | — | arama ucu güvenilmez |
| `world.openbeautyfacts.org/api/v2/search` | **200** | 0,95 s | 10 KB | metin araması **yok sayılıyor** |
| `world.openproductsfacts.org/api/v2/search` | **200** | 0,73 s | 17 KB | metin araması **yok sayılıyor** |
| `completion.amazon.com/api/2017/suggestions` | **200** | 0,20 s | 2,8 KB | çalışıyor (dokümante değil) |
| `autosug.ebay.com/autosug` | **200** | 0,18 s | 405 B | çalışıyor (dokümante değil) |
| `trends.google.com/trending/rss?geo=US` | **200** | 0,12 s | 21,6 KB | çalışıyor; niş ölçmez |
| `api.gdeltproject.org/api/v2/doc/doc` | **429**, tekrar **timeout** | 8,6 s | 444 B | kararsız |
| `wikimedia …/pageviews/per-article` | **200** | 0,22 s | 1,3 KB | çalışıyor |
| `reddit.com/search.json` | **403** | 0,11 s | 190 KB | onay gerekir |
| `googleapis.com/books/v1/volumes` | **429** | 0,05 s | 1,3 KB | kota dolu |
| `api.vatcomply.com/vat_rates` | **200** | 0,45 s | 237 KB | çalışıyor |
| `api.frankfurter.dev/v1/latest` | **200** | 0,11 s | 84 B | USD→TRY 49,527 |
| `hts.usitc.gov/reststop/search` | **200** | 0,42 s | 34 KB | çalışıyor; sonuç alakasız olabilir |
| `wits.worldbank.org/API/V1/SDMX/V21/…` | **200** | 0,88 s | 2,2 KB | XML çalışıyor |
| `comtradeapi.un.org/public/v1/preview` | **200** | 1,24 s | 82,7 KB | 92 satır |
| `…/wp-json/wc/store/v1/products` | **200** | 3,9 s | 20,3 KB | anahtarsız, alanlar zengin |
| `allbirds.com/products.json` | **200** | 0,24 s | 12,7 KB | barkod %0 |
| `r.jina.ai/<ürün>` (`x-return-format: html`) | **200** | 0,72 s | 668 KB | 1 JSON-LD bloğu |
| `api.upcitemdb.com/prod/trial/search` | **200** | 0,55 s | 33 KB | 5 satır, %100 dolu |
| `opensupplyhub.org/api/facilities` | **401** | 0,50 s | 58 B | API ücretli |

---

## 5. Düzeltmeler

1–3, 5 ve 7 numaralar önceki raporun (`PRODUCT_DISCOVERY_FREE_UPGRADES_2026.md`) iddialarını
düzeltir; 4, 6 ve 8 bu turdaki araştırma notlarının canlı ölçümle çürütülmesidir.

| # | Eski / dolaşımdaki iddia | Bugün ölçülen | Etki |
| --- | --- | --- | --- |
| 1 | "Open Beauty/Products Facts marka alanı çoğu kayıtta boş" | Metin araması **parametre yok sayıyor**; dönen satırlar sorguyla ilgisiz. `categories_tags` ile 1.880 shampoo kaydı geliyor | Bu aile **metin aramasında kullanılmamalı** |
| 2 | "UPCitemdb ücretsiz planı 2 arama/30 sn" (önceki **ölçülen** patlama sınırı) | Belgelenen sınır **6 istek/dk, ≤40 arama/gün**; bugün sorgu başına **5 satır** geldi. İkisi çelişmiyor: patlama sınırı bu ağda daha dar | Kota hesabı **40 arama/gün** üzerinden yapılmalı; 3. ardışık istek yine 429 beklenmeli |
| 3 | "VATcomply `/vat` 422" | Doğru uç **`/vat_rates`** → **200 / 237 KB** | Entegrasyon yanlış uçla yazılmamalı |
| 4 | "SerpAPI ücretsiz ~100 arama/ay" (eski yaygın varsayım) | Güncel plan **250 arama/ay, 50/saat** | Rekabet ölçümü bütçesi 2,5 kat |
| 5 | "OpenRouter ücretsiz ~50/gün" | Doğru; **$10 kredi ile 1.000/gün** (20 RPM sabit) | Konsey planı buna göre |
| 6 | "Amazon completion 404 / eBay autosuggest 400" (bu tur araştırma notu) | **İkisi de 200**; Amazon'da doğru yol `completion.amazon.com/api/2017/suggestions` | L0'da kullanılabilir |
| 7 | "Google Ads developer token yeterli" | **2026-09-09'da token kaldırıldı**, erişim Cloud projesine bağlı | Başvuru adımları güncellenmeli |
| 8 | "GitHub Models ücretsiz bir LLM kapısı" (eski varsayım) | **30 Temmuz 2026'da kapatıldı** | Plandan çıkarılmalı |

---

## 6. Öncelik sırası ve kabul kriterleri

| Öncelik | Değişiklik | Etki | Emek | Kabul kriteri (ölçüm) |
| --- | --- | --- | --- | --- |
| **P0** | JSON-LD ayrıştırıcısına `gtin/mpn/sku` + `ProductGroup.hasVariant` | mükerrer kayıt, GTIN çapası | 0,5 gün | yeni birim testleri; canlı sayfada GTIN doluysa kartta görünür, yoksa `null` |
| **P0** | GTIN check-digit + GS1 öneki (yerel) | sahte barkod elenir | 0,5 gün | geçersiz 100 kodun 100'ü reddedilir |
| **P0** | Autocomplete ile sorgu genişletme (niş başına 1 istek, 6 saat cache) | isabet/recall | 1 gün | aday havuzu **+%20**, eklenen satırların **≥%80**'i fiyat+marka taşır |
| **P1** | WooCommerce Store API allowlist kaynağı | **puan + yorum + kategori** | 2 gün | air fryer'da `ratingCount` **0/21 → ≥8/21** |
| **P1** | Shopify allowlist kaynağı | marka/kategori %100 | 1 gün | marka (ölçülmüş) **6-12/21 → ≥15/21** |
| **P1** | Jina Reader + JSON-LD, koşu başına **en fazla 5** aday | marka/kategori/puan/GTIN | 2 gün | 5 adayın **≥3**'ünde yeni alan; süre **<2 sn** |
| **P1** | UPCitemdb bütçesini marka çapalarına kaydır | aynı kota, daha çok eşleşme | 1 gün | eşleşen marka sayısı **artar**, arama sayısı **artmaz** |
| **P2** | `BESTBUY_API_KEY` tanımla + doluluk ölç | kategori/puan | 0,5 gün | ABD nişinde kategori **≥10/21** |
| **P2** | eBay Browse başvurusu (GTIN arama + aktif ilan) | L5 rekabet | 3 gün + onay | `activeListings` ölçülür |
| **P2** | CJ Dropshipping (MOQ teyidi) | L4 ikinci kaynak | 2 gün | ürünlerin **≥%50**'sinde ikinci kaynak teyidi |
| **P2** | Cloudflare Workers AI yedek motoru | kota dayanıklılığı | 1 gün | 429 sonrası yedek oranı raporda görünür |
| **P3** | UN Comtrade/WITS ile HS pazar büyüklüğü | L6 bağlam | 3 gün | HS kodu **elle** doğrulanmadan karar vermez |

---

## 7. Doğrulama protokolü

Canlı testler `*_LIVE=1` bayrağıyla, normal koşuda atlanır (mevcut desen).

```sh
# birim (ağsız)
npx vitest run src/lib/marketplace-jsonld.test.ts \
  src/lib/product-discovery-deal-feed.test.ts src/lib/launch-readiness.test.ts

# tip
npx tsc --noEmit

# canlı doluluk ölçümü (yeni)
WOO_LIVE=1 SHOPIFY_LIVE=1 JINA_LIVE=1 \
  PRODUCT_DISCOVERY_E2E_NICHES="air fryer,robot vacuum" \
  npx vitest run src/lib/product-discovery.e2e.live.test.ts
```

Dürüstlük kontrolleri (testle kilitlenmeli):

1. Yeni kaynak `null` döndüğünde `dataCompleteness` **artmaz**.
2. Autocomplete/YouTube/Wikipedia sayıları `salesVolume`'a **yazılmaz**.
3. OBF/OPF metin araması kullanılmaz; kullanılırsa test **kırmızı** olur.
4. GTIN yoksa `missingFields` içinde `gtin` **görünür** (0 yazılmaz).

---

## 8. Eklenmemesi gerekenler (2026-10 itibarıyla)

- **GDELT DOC API** — 429 ("1/5 sn"), tekrar denemede timeout; üretim için kararsız.
- **Reddit `search.json`** — bu ağdan **403**; ticari API onayı gerekir.
- **Google Books API** — günlük kota **429**.
- **Open Food/Beauty/Products Facts metin araması** — parametre yok sayılıyor; yalnız
  barkod/kategori.
- **Open Prices ülke filtresi** — yok sayıldı (aynı 7,8 KB yanıt).
- **Open Supply Hub API** — **$225/ay**.
- **GitHub Models** — **kapatıldı** (2026-07-30).
- **Cerebras / Together / Hugging Face** — sürekli ücretsiz katman yok (tek seferlik kredi
  veya ön ödeme).
- **Shippo rate** — **$0,01/rate**; ücretsiz kargo kaynağı değil.
- **Başlıktan otomatik HS kodu** — ücretsiz ve güvenilir API yok; ölçülen örnekte
  "air fryer" → "broilers, fryers" (tavuk) döndü.
- **Amazon PA-API / eBay Marketplace Insights / Keepa** — emekli, kapalı, ücretli.
- **Pazaryeri HTML'inden "sonuç sayısı" saymak** — bot duvarı, ToS, tutarsız sayı.

---

## 9. Kaynaklar (okunan resmî sayfalar)

- WooCommerce Store API — https://developer.woocommerce.com/docs/apis/store-api/resources-endpoints/products/
- Shopify Storefront API — https://shopify.dev/docs/api/storefront/latest/queries/products
- UPCitemdb — https://devs.upcitemdb.com/
- Open Food Facts API — https://openfoodfacts.github.io/openfoodfacts-server/api/
- Open Products Facts veri/API — https://world.openproductsfacts.org/data
- Open Prices API — https://prices.openfoodfacts.org/api/docs
- Jina Reader — https://jina.ai/reader/
- eBay Browse API — https://developer.ebay.com/api-docs/buy/static/api-browse.html
- Best Buy API — https://developer.bestbuy.com/apis · https://developer.bestbuy.com/legal
- Google Ads erişim seviyeleri — https://developers.google.com/google-ads/api/docs/api-policy/access-levels
- Google Ads developer token değişikliği — https://developers.google.com/google-ads/api/docs/api-policy/developer-token
- Google Ads anahtar kelime metrikleri — https://developers.google.com/google-ads/api/docs/keyword-planning/generate-historical-metrics
- YouTube kota — https://developers.google.com/youtube/data/determine_quota_cost
- Wikimedia Pageviews — https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/reference/page-views.html
- SerpAPI fiyatlandırma — https://serpapi.com/pricing
- CJ Dropshipping ürün API'si — https://developers.cjdropshipping.com/en/api/api2/api/product.html
- Printify API — https://developers.printify.com/
- Open Supply Hub API/fiyat — https://info.opensupplyhub.org/resources/api-documentation · https://info.opensupplyhub.org/pricing
- Frankfurter — https://frankfurter.dev/
- VATcomply — https://www.vatcomply.com/
- USITC HTS — https://hts.usitc.gov/
- EU TARIC — https://taxation-customs.ec.europa.eu/online-services/online-services-and-databases-customs/eu-customs-tariff-taric_en
- WITS API — https://wits.worldbank.org/witsapiintro.aspx?lang=en
- UN Comtrade — https://comtradeplus.un.org/
- Gemini kota — https://ai.google.dev/gemini-api/docs/rate-limits
- Gemini şartlar — https://ai.google.dev/gemini-api/terms
- Cloudflare Workers AI — https://developers.cloudflare.com/workers-ai/platform/pricing/
- OpenRouter limitler — https://openrouter.ai/docs/api_reference/limits
- Cohere limitler — https://docs.cohere.com/docs/rate-limits
- GitHub Models emeklilik — https://github.blog/changelog/2026-07-30-github-models-is-now-retired/
