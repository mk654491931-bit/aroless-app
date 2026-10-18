# Ürün Bulucu — Katman Katman Ücretsiz Kaynak Araştırması

**Tarih:** 2026-10-17 · **Kapsam:** `src/lib/product-discovery-*`, `product-catalog.server.ts`,
`aliexpress-supplier.server.ts`, `launch-readiness.ts`, `ai-*.ts` · **Ülke odağı:** US + TR (+ DE/FR/IT/ES/UK)

Bu rapor yalnızca "şu API var" listesi değildir. Her öneri üç etiketten biriyle işaretlenir:

| Etiket | Anlamı |
| --- | --- |
| **ÖLÇÜLDÜ** | Bu oturumda canlı ağ isteğiyle doğrulandı (sayı + süre raporda) |
| **KAYNAK** | Resmî doküman/şartlar okundu, canlı test edilmedi |
| **DOĞRULANMADI** | Doküman okunamadı veya çelişkili — yatırım yapılmadan önce test edilmeli |

Bu rapor, aynı gün üretilen iki ölçüm raporunu da sentezler:
`docs/reports/PRODUCT_DISCOVERY_FREE_UPGRADES_2026.md` ve
`docs/reports/PRODUCT_DISCOVERY_FREE_TOOLS_V2.md`. Onların ölçümleri **tekrar edilmedi**;
raporda "önceki ölçüm" olarak etiketlendi. Çelişen noktalar (Open Facts metin araması,
Shopify rotası, UPCitemdb kotası) bu oturumda yeniden test edildi ve farkın **hangi uç
noktadan** kaynaklandığı yazıldı.

---

## 0. Yönetici özeti

> **En kısa cevap (günlük kotalarla):** Bugün eklenebilecek en yüksek getirili üç şey
> **(1)** `BESTBUY_API_KEY` (50.000 çağrı/gün — puan + yorum sayısı + kategori),
> **(2)** **Google Product Taxonomy** (dosya, kota yok — kategori boşluğu) ve
> **(3)** **WooCommerce Store API allowlist** (anahtarsız — puan + yorum + kategori + fiyat).
> Gerçek darboğaz kaynak sayısı değil, **UPCitemdb'nin 40 arama/gün** tavanı: zenginleştirme
> yalnız ilk 15 adaya ve 90 gün önbellekle uygulanmalı (§8.7). Tam kota kataloğu §8'de,
> uygulama sırası §9'da.
>
> **İkinci turun (§12) en önemli sonucu:** *ücretsiz, tam otomatik landed-cost API'si yok.*
> Ücretsiz parçalar var (USITC HTS JSON — anahtarsız ÖLÇÜLDÜ, TARIC tabloları, VATcomply VAT,
> CJ kargo tahmini) ama gümrük vergisini ürün tanımından hesaplayan ücretsiz servis
> doğrulanamadı. Ücretsiz kalan tek gerçekçi yol: **HTS/GTİP kodunu kendin eşle + tarife
> tablosundan oku**. İkinci tur ayrıca OpenRouter (50→1.000/gün), Printify (600/dk) ve
> Icecat (100 istek/IP/sn) sayılarını resmî sayfadan doğruladı; Etsy ve Printful hâlâ açık.

Mevcut hat, anahtarsız kaynaklarda **fiyat + görsel + link** konusunda zaten güçlü; asıl açıklar
şunlar: **(1) kategori**, **(2) puan/değerlendirme sayısı**, **(3) kargo/vergi sonrası gerçek maliyet**,
**(4) tedarikçi shipping'i**, **(5) AI kotası/veri politikası**.

Bugün uygulanabilir, en yüksek getirili sekiz iş:

1. **Google Product Taxonomy'yi yerel veri olarak al** (anahtarsız, ÖLÇÜLDÜ: 5.596 satır / 483 KB / 49 ms).
   Kategori boşluğunu (nişe göre 0–4 satır) anahtar gerektirmeden kapatır — ama **türev** olduğu
   `categoryMeasured: false` ile işaretlenmeli, kanıt yuvasını doldurmamalı.
2. **JSON-LD ayrıştırıcısına `gtin/mpn/sku` ekle + yerel GTIN kontrol hanesi.** Aynı ürünün iki
   kaynaktaki kaydı bugün başlık parmak iziyle ayrılıyor; GTIN varsa birleşmeli. Sıfır ağ maliyeti.
3. **WooCommerce Store API allowlist kaynağı** (anahtarsız; önceki ölçüm: 200 / 20,3 KB / 3,9 sn):
   `average_rating` + `review_count` + kategori + fiyat + görsel aynı yanıtta. Bugün 0/21 olan
   `ratingCount` yuvasını anahtarsız doldurabilen tek ölçülmüş kaynak.
4. **Landed-cost kapısı ekle** (kargo + komisyon + vergi). Bugün brüt marj "kargo/komisyon ÖNCESİ"
   ölçülüyor; bu, "atılabilir" kararının en büyük dürüstlük açığı. Ücretsiz girdiler: TARIC/HTS
   tarife tabloları, ABD/EU VAT tablosu (VATcomply `/vat_rates` ölçüldü), pazaryeri komisyon
   tarifeleri, CJ kargo tahmini.
5. **AI katmanını sağlamlaştır:** Cloudflare Workers AI (10.000 neuron/gün, sıfır veri saklama) +
   Groq (1.000 RPD). `ai-load-balancer.ts` içindeki sabit eski model adları (`gemini-2.5-flash`,
   `gemini-2.0-pro`, `Llama-2`) risklidir; alias kullan veya dosyayı emekliye ayır.
6. **eBay Browse API başvurusunu şimdi başlat.** Ücretsiz ama onay kapılı; onay gelene kadar
   entegrasyon yazma. Gerçek ilan fiyatı + satıcı + kargo getirir.
7. **CJ Dropshipping API** (ücretsiz hesap token'ı): MOQ, tedarikçi, teslim süresi ve **kargo
   tahmini**. Made-in-China'nın kapatamadığı "birim kargo" yuvasını kapatır.
8. **Reddit OAuth** (ücretsiz, 100 istek/dk): mevcut `reddit-archive` statik arşiv; anahtarsız
   JSON bugün **403** (ÖLÇÜLDÜ). Ürün satmaz — talep/şikâyet bağlamı üretir, aday havuzuna
   girmemeli (kapı zaten var).

**Yapılmaması gerekenler:** Shopify `/products.json` ile rakip kataloğu indekslemek (Shopify API
şartları ticari ürün indeksi kurmayı yasaklıyor), TikTok/Pinterest otomatik kazıma (destekli API yok,
şartlar yasaklıyor), Amazon PA-API (Creators API'ye geçti; son 30 günde 10 satış şartı), Alibaba/1688
kazıma (ücretsiz alıcı API'si doğrulanamadı, şartlar belirsiz).

---

## 1. Yöntem ve dürüstlük sınırları

- **Katmanlar koddan çıkarıldı**, tahminle değil: `PRODUCT_SOURCES`, `runScrapeFilterStep`,
  `product-catalog.server.ts`, `aliexpress-supplier.server.ts`, `launch-readiness.ts`,
  `product-discovery-council-*.ts`.
- **"Ücretsiz" dört ayrı şey olabilir:** (A) anahtarsız, (B) ücretsiz anahtar/kota,
  (C) tek seferlik trial, (D) ölü/emekli. Rapor her birini ayırır.
- **Kota/limit bilgileri değişir.** Bu rapordaki sayılar Ekim 2026 snapshot'ıdır; entegrasyondan
  önce ilgili dokümandan tekrar doğrulanmalıdır.
- **Bu rapor kod değiştirmedi.** Hiçbir öneri "ölçülmüş etki" olarak sunulmadı; etkiler
  bölüm 6'daki A/B planıyla ölçülmek üzere **beklenti** olarak yazıldı.

---

## 2. Mevcut hat: katman haritası

| # | Katman | Bugünkü kaynaklar | Ölçülen zayıflık |
| --- | --- | --- | --- |
| 1 | Talep / trend | `google-trends` (link), `wikipedia-demand`, `wikipedia-pageviews`, `google-news`, HN, Reddit arşivi, GitHub, Wikidata | Google Trends **yalnız alpha başvurusuyla** resmî API; mevcut kaynak link/429; Reddit arşivi statik |
| 2 | Aday ürün | `tr-reader` (HB + n11), `aliexpress-reader`, `newegg-reader`, `otto`, `flipkart`, `rakuten`, `bestbuy-api`, `deal-feed` (Slickdeals RSS), `openlibrary`, `marketplace-price` (Apple), `web-reviews`, `steam`, `tr-marketplace` (anahtarlı), `serpapi-shopping` (anahtarlı), `bing-shopping` | ABD ana akım perakende (Walmart/eBay/Amazon/Target) anahtarsız okunamıyor; Bing Shopping bu ağdan kart döndürmüyor |
| 3 | Puan / değerlendirme / satış | Best Buy (anahtarlı), TR okuyucu, Newegg, Steam, AliExpress "sold" | Anahtarsız global kaynaklarda puan çoğunlukla `null`; eBay "sold" erişimi sınırlı |
| 4 | Katalog / kimlik | UPCitemdb trial (marka · model · GTIN · kategori · fiyat), `product-brand.ts` | Günlük 20 (belgelenen tavan 40) arama, patlama 2/30 sn; sorgu başına 5 kayıt; yalnız gıda için OFF |
| 5 | Görsel | `product-image-verification.ts` + ürün sayfası doğrulaması | Doğru tasarım (uydurma görsel yok); sorun kaynakta görsel olmaması |
| 6 | Tedarik | `aliexpress-supplier`, `made-in-china` | MOQ/FOB/tedarikçi iyi; **birim kargo** ve **teslim süresi** yok |
| 7 | Ekonomi | `launch-readiness.ts` (7 kapı), `economics-evidence.ts`, Frankfurter FX | Marj kargo/komisyon öncesi; vergi/gümrük yok; kargo çoğu üründe `unknown` |
| 8 | AI kısa liste + 14 ajan | `ai-pool.server.ts`, `council-*.ts` (Gemini/Groq/Cerebras/SambaNova/Together/OpenRouter/HF/Evren) | Ücretsiz kotalar dar; bazı sağlayıcı varsayımları 2026'da geçersiz; ücretsiz Gemini verisi eğitimde kullanılıyor |
| 9 | Skor / kanıt | `evidenceCompleteness` (5 yuva), `discovery-quality.ts`, `product-discovery-filter.server.ts` | Kategori ve kargo yuvaları yok; talep ile satış ayrımı iyi korunuyor |

---

## 3. Katman bazında bulgular

### 3.1 Talep ve trend

| Kaynak | Erişim / limit | Ne katar | Karar |
| --- | --- | --- | --- |
| **Google Trends (resmî API)** | Alpha, başvuru ile; genel kullanıma açık self-servis değil ([developers.google.com/search/apis/trends](https://developers.google.com/search/apis/trends)) | Gerçek arama ilgisi (göreli), mevsimsellik | **ŞARTLI** — alpha kabulü olmadan entegre etme |
| **Google Trends RSS / explore** | RSS anahtarsız; **önceki ölçüm: RSS 200, explore 429** (datacenter IP) | Günlük trend başlıkları; **niş ölçmez** | **YARDIMCI** — mevcut link + Wikipedia ile yetin |
| **pytrends** | Anahtarsız, resmî değil; repo arşivlenmiş ([GitHub](https://github.com/GeneralMills/pytrends)) | Hızlı prototip | **RED** — üretimde kırılgan, Node hattına uygun değil |
| **Reddit Data API** | OAuth ile 100 istek/dk, OAuth'suz 10/dk (2023'ten beri); ticari kullanım ayrı anlaşma ([redditinc.com/news/apifacts](https://redditinc.com/news/apifacts)) | Gerçek kullanıcı dili, şikâyet, "değer mi?" sinyali | **EKLE (P0, ücretsiz anahtar)** |
| **Product Hunt GraphQL** | Token; 6.250 karma/15 dk; **varsayılan ticari kullanım yok** ([docs](https://api.producthunt.com/v2/docs)) | Yeni ürün lansmanları | **RED** — fiziksel ürün nişleri için zayıf + lisans riski |
| **TikTok Creative Center / Shop GMV** | Destekli genel API yok; şartlar otomatik çıkarmayı yasaklıyor ([terms](https://www.tiktok.com/legal/page/us/terms-of-service/en)) | Güçlü satış proxy'si (satıcı panelinde) | **RED (programatik)** — yalnız manuel referans |
| **Pinterest Trends API** | `trending_keywords` uç noktası dokümanda görünüyor; kota/erişim doğrulanamadı ([docs](https://developers.pinterest.com/docs/analytics-and-reports/trends/)) | Mevsimsel anahtar kelime | **DENE** — doküman okunamadı |
| **Indiegogo Public API** | Anahtarsız; **anahtar kelime araması yok**, sabit liste | Kitle fonu sinyali | Zaten ölçülüp reddedildi (README) — değişmedi |
| **Kickstarter** | Destekli genel API doğrulanamadı | Ön talep sinyali | **RED** — şartlar belirsiz |
| **Exploding Topics / Glimpse** | Ücretsiz web; API ücretli / 10 arama/ay | Trend doğrulama | **ŞARTLI** — yalnız manuel referans |
| **Autocomplete (Amazon / Google)** | Dokümante değil, anahtarsız; **ÖLÇÜLDÜ: Amazon 200 / 0,17 sn / 2,8 KB** | Alıcı dili, uzun kuyruk (`8 qt`, `dual basket`) — **hacim değil** | **EKLE (P1)** — `queryBreadth`, talep kanıtı sayılmaz |

**Neden Reddit P0:** Mevcut `reddit-archive` geçmiş veridir; yeni çıkan bir ürünün şikâyeti orada
yok. Reddit OAuth, "bu ürünün kronik sorunu ne?" sorusunu **gerçek zamana** yakın cevaplar ve
konseyin `reason` alanını güçlendirir. Ürün satmadığı için aday havuzuna girmemeli — mevcut
`isNonProductSource` kapısı bunu zaten yapıyor; yeni kaynak da aynı kapıya bağlanmalı.

> **Uyarı:** Reddit ticari kullanım için ayrı anlaşma istiyor. Ücretsiz katman "ticarileşmemiş"
> kullanım içindir; ücretli bir üründe kullanacaksan Reddit'e başvur veya bu sinyali yalnız
> iç araştırma/önceliklendirme için tut.

### 3.2 Aday ürün toplama

| Kaynak | Erişim / limit | Getirdiği alanlar | Karar |
| --- | --- | --- | --- |
| **WooCommerce Store API** | Anahtarsız; mağaza başına allowlist; **önceki ölçüm: 200 / 20,3 KB / 2 satır / 3,9 sn** (`/wp-json/wc/store/v1/products`) | ad, SKU, fiyat, **average_rating**, **review_count**, kategori, marka, görsel, stok | **EKLE (P0)** — anahtarsız puan+yorum |
| **eBay Browse API** | Ücretsiz geliştirici hesabı; **üretim erişimi onay kapılı** ([guide](https://developer.ebay.com/develop/get-started/get-started-on-a-buying-application)) | Fiyat, satıcı, kargo, konum, kategori; `watchCount`/sold genel kullanıma açık değil | **BAŞVUR (P0)**, entegrasyon onay sonrası |
| **eBay Marketplace Insights** | Limited release; satış geçmişi | Gerçek "sold" | **RED (şimdilik)** — erişim garantisi yok |
| **Etsy Open API v3** | Anahtar zorunlu; kota uygulamaya özel (örnek 150 QPS/100k QPD) ([rate limits](https://developer.etsy.com/documentation/essentials/rate-limits/)) | Handmade/POD ilanları, fiyat, mağaza | **EKLE (P1)** — niş kapsama |
| **Best Buy Products API** | Ücretsiz anahtar; **50.000 çağrı/gün, 5 çağrı/sn** ([şartlar](https://developer.bestbuy.com/legal)); puan + değerlendirme sayısı + kategori ([docs](https://bestbuyapis.github.io/api-documentation/)) | ABD/CA elektronik | **AKTİF ET** — kodda var, anahtar yoksa 0 çağrı |
| **Walmart I/O / Target / Kroger** | Güncel erişim ve kota doğrulanamadı; Target PerimeterX (435) zaten ölçüldü | — | **RED** — doğrulanmamış varsayımla kod yazma |
| **Amazon Creators API** | PA-API 5 emekli; Creators için Associates + son 30 günde **10 satış** ([eligibility](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/introduction)) | Amazon kataloğu | **RED (şimdilik)** — kapı çok yüksek |
| **Shopify `/products.json`** | Resmî doküman değil; **önceki ölçüm: marka/kategori/SKU/görsel %100, barkod %0**; API şartları ticari ürün indeksi kurmayı yasaklıyor ([terms](https://www.shopify.com/legal/api-terms)) | Rakip mağaza kataloğu | **ŞARTLI** — yalnız allowlist + `robots.txt` + 24 saat önbellek; toplu tarama **RED** |
| **MercadoLibre** | Anahtarsız 403 (README'de ölçüldü) | LATAM | **RED** |
| **Serper.dev Shopping** | 2.500 ücretsiz sorgu (yenilenip yenilenmediği doğrulanmadı); anahtar ([serper.dev](https://serper.dev/)) | Google Shopping kartları: fiyat, satıcı, puan | **DENE (P1)** — mevcut SerpApi 250/ay'a göre daha geniş başlangıç |
| **SearchApi Google Shopping** | 100 ücretsiz istek (tek seferlik) ([pricing](https://www.searchapi.io/pricing)) | Yapılandırılmış shopping | **DENE** — trial |
| **DataForSEO Shopping** | 1 $ tek seferlik deneme ([trial](https://dataforseo.com/help-center/how-does-your-free-unlimited-trial-work)) | Shopping SERP | **ŞARTLI** — deneme bütçesi |

**Kritik ayrım:** Yeni bir SERP sağlayıcısı "ürün kaynağı" değil, **kanıt hızlandırıcıdır**.
Serper/SearchApi sonuçları da aynı kaynak kapısından geçmeli; puan alanı SERP'te yoksa `null` kalmalı.

### 3.3 Puan, değerlendirme ve satış kanıtı

Bu katman ürün bulucunun en pahalı boşluğu. Ücretsiz seçenekler sınırlı ve **bu tablodaki
kaynakların hiçbiri satış adedi vermiyor**:

| Kaynak | Ne verir | Sınır |
| --- | --- | --- |
| **WooCommerce Store API** | `average_rating`, `review_count`, kategori, fiyat, görsel | Mağaza bazlı allowlist; 3,9 sn ölçüldü → 3 sn kaynak tavanı; genel tarayıcı değil |
| **Best Buy** | `customerReviewAverage`, `customerReviewCount`, kategori, fiyat, görsel | ABD/CA, çoğunlukla elektronik; şartlar 72 saat önbellek ve üçüncü taraf adına fiyat analizi yasağı getiriyor ([terms](https://developer.bestbuy.com/legal)) |
| **eBay Browse** | Satıcı geri bildirimi, ilan fiyatı, kargo | Onay kapılı; `watchCount` herkese açık değil |
| **Etsy v3** | Listeleme + mağaza; yorum uç noktası doğrulanamadı | Anahtar; kota uygulamaya özel |
| **Newegg / Steam / TR okuyucu** | Gerçek puan + değerlendirme sayısı | Zaten kullanımda; kapsama dar |
| **Amazon Reviews'23** | 571M yorum, ASIN bazlı puan | **Ağustos 2023'te dondu**; ticari yeniden dağıtım lisansı doğrulanamadı ([dataset](https://amazon-reviews-2023.github.io/)) |
| **Keepa API** | Fiyat/rating geçmişi | Ücretsiz katman yok; token bazlı ücretli ([plans](https://keepa.com/api-docs/plans-tokens.html)) |
| **CamelCamelCamel** | Fiyat geçmişi (web) | Genel API yok |
| **Fakespot** | — | 2024'te kapatıldı (Mozilla) — kullanma |

**Sonuç:** "Kaç adet satıldı?" sorusu ücretsiz kaynaklarla **güvenilir biçimde cevaplanamaz**.
Dürüst strateji: satış yerine **değerlendirme sayısı + yorum ivmesi + pazaryeri "sold" alanı
(AliExpress/TR) + deal-feed topluluk oyu** birleşimi; bunların hiçbiri tek başına "satış" sayılmaz.
Kodda bu ayrım `salesVolume` / `ratingCount` olarak zaten var — korunmalı.

### 3.4 Katalog ve kimlik zenginleştirme

| Kaynak | Erişim / limit | Alanlar | Karar |
| --- | --- | --- | --- |
| **UPCitemdb trial** | Anahtarsız; **belgelenen kota: 100 istek/gün toplam, bunun en fazla 40'ı arama**, patlama **6 istek/dk** (IP başına) ([rate limits](https://www.upcitemdb.com/wp/docs/main/development/api-rate-limits/)); bu ağda 3. istekte 429 ölçüldü | marka, model, GTIN, kategori, kayıtlı fiyat | Mevcut — kotayı marka çapalarına harca; **arama tavanı 40/gün** |
| **Google Product Taxonomy** | Anahtarsız dosya; **ÖLÇÜLDÜ: 200, 483 KB, 5.596 satır, 49 ms** ([indirme](https://support.google.com/merchants/answer/6324436)) | 5.595 kategori yolu + ID | **EKLE (P0)** — kategori boşluğu |
| **Open Beauty Facts** | Anahtarsız; **ÖLÇÜLDÜ (cgi/search.pl): "vitamin c serum" → 46, "shampoo" → 2.919 kayıt; ilk 20'de 17 marka, 15 görsel, 13 kategori; 1,6 sn.** **Uç nokta farkı:** `/api/v2/search` metin aramasını **yok sayıyor** (77741 sabit); `?categories_tags=shampoo` → 1.880 doğru kayıt | GTIN, marka, kategori, görsel; **fiyat yok** | **EKLE (P1)** — yalnız zenginleştirme; aday havuzuna giremez |
| **Open Products Facts** | Anahtarsız; **ÖLÇÜLDÜ (`cgi/search.pl`): "yoga mat" → 0, "backpack" → 4, "water bottle" → 18 kayıt; 0,6–1,1 sn** | Genel ürün | **RED** — kapsama çok ince (tek haneli sonuç) |
| **Open Food Facts** | Anahtarsız; 15 okuma + 10 arama/dk | Gıda | Mevcut — **metin: `cgi/search.pl`; barkod/kategori: `/api/v2/search`** |
| **Icecat Open** | Ücretsiz kayıt; 2M ürün, 600 marka; **günlük kota yayınlanmamış**, API kılavuzu **100 istek/IP/sn** (50–70 önerilir), "Specs Icecat" atfı zorunlu ([pricing](https://icecat.com/pricing-content-users/)) — *not: bu ağdan curl **403** (bot koruması), sayılar doküman okumasından, canlı ölçüm değil* | marka, MPN, spesifikasyon, görsel, kategori | **EKLE (P1)** — elektronik marka/model açığı |
| **Go-UPC** | Ücretsiz anahtar başvurusu; **150 istek/ay**, 2 req/s ([plans](https://go-upc.com/plans)) | GTIN, marka, kategori, görsel | **DENE** — düşük kota |
| **EAN-Search** | Trial 100 sorgu/ay, sonra €9/ay ([plans](https://www.ean-search.org/ean-database-api.html)) | EAN, isim, kategori | **RED** — ücretsiz değil |
| **Barcode Lookup** | Ücretsiz test hesabı var; kota/şema doğrulanamadı (sayfa 403) | görsel/fiyat/yorum iddiası | **RED (şimdilik)** |
| **GS1 Verified** | GEPIR emekli; API ücretli (GS1 US $6.500 eklenti) ([apis](https://www.gs1us.org/tools/gs1-us-data-hub/gs1-us-apis)) | GTIN doğrulama | **RED** — doğrulama için manuel |
| **Brocade.io** | Repo arşivlendi (21 Ara 2025), host çözülmüyor | — | **RED** |
| **DummyJSON** | Anahtarsız ama **sahte** veri | — | **RED** |

> **Open Facts operasyon notu:** arama ucu dakikada **10 istek** ile sınırlı. Bu oturumda üç
> ardışık `cgi/search.pl` isteğinden üçüncüsü geçerli JSON döndürmedi (muhtemel 429/rate-limit).
> Kaynak bunu "0 sonuç" gibi göstermemeli: `ok:false` + `error:"429"` raporlamalı, aksi hâlde
> "bu nişte kozmetik ürün yok" yanılgısı doğar.

**Tasarım kuralı:** Taxonomy ve OBF'den gelen kategori **türev** olabilir. `product-brand.ts`'teki
`brandMeasured` deseninin aynısı uygulanmalı: `categorySource: "taxonomy-derived" | "catalog"`,
türevse kanıt yuvası doldurulmamalı. Aksi hâlde "kategori var" diye 5/5 kanıt gösteren ama
hiçbir kaynağın kategori vermediği bir kart üretilir — bu, markada kapatılan hatanın kategoride
tekrarı olur.

### 3.5 Görsel

Mevcut yaklaşım (yalnız ürünün kendi sayfasından doğrulama, paylaşılan görsel reddi, `null`
dönebilme) doğru ve korunmalı. Ücretsiz araçlar burada **kaliteyi artırmaz**, yalnızca arka plan
temizliği/optimizasyon sağlar:

| Araç | Limit | Ne için | Karar |
| --- | --- | --- | --- |
| **remove.bg** | 50 çağrı/ay | Reklam kreatifi için arka plan silme | **ŞARTLI** — 1 Ara 2026'dan itibaren Leonardo.Ai'ye geçiyor ([API](https://www.remove.bg/api)) |
| **Cloudinary** | 25 kredi/ay (1 kredi = 1.000 dönüşüm veya 1 GB) | Görsel optimizasyon/CDN | **ŞARTLI** — ürün bulucu hattı için gerekli değil |
| **imgix** | 30 gün trial | — | **RED** — kalıcı ücretsiz katman yok |

Görsel katmanında asıl iyileştirme API değil **kaynak seçimi**: puan/görsel taşıyan kaynaklara
(Best Buy, Newegg, TR okuyucu, Etsy) ağırlık vermek. Bunun için yeni bir araç gerekmiyor.

### 3.6 Tedarik / toptan

| Kaynak | Erişim | Getirdiği | Karar |
| --- | --- | --- | --- |
| **Made-in-China** | Anahtarsız, robots-uyumlu yol | FOB, MOQ, tedarikçi | Mevcut — güçlü |
| **AliExpress** | Anahtarsız okuyucu + aylık kota | Fiyat, satış adedi, mağaza | Mevcut |
| **CJ Dropshipping** | Ücretsiz hesap token'ı; **puan modeli: 50.000 puan/gün**, `/product/listV2` 50 puan, `/logistic/freightCalculate` 10 puan ([points](https://developers.cjdropshipping.com/en/api/api2/standard/points.html)) | MOQ, tedarikçi, stok, depo ülkesi, teslim süresi, **kargo tahmini** | **EKLE (P1)** — birim kargo |
| **Printful / Printify** | Ücretsiz geliştirici token'ı; Printify genel API'si token + `catalog.read` ile açık (**600/dk, katalog 100/dk**), yalnız "custom API" Enterprise'a bağlı ([docs](https://developers.printify.com/)) | POD üretim + kargo maliyeti | **ŞARTLI** — yalnız POD nişleri |
| **Alibaba / 1688 / DHgate** | Ücretsiz alıcı API'si doğrulanamadı; kazıma şartları belirsiz | — | **RED** — yetkili erişim olmadan |
| **Faire** | API anahtarı hesap/partner gerektiriyor; doküman 403 | Toptan | **DOĞRULANMADI** |
| **Spocket / AutoDS** | Ücretsiz API yok; abonelik | — | **RED** |
| **TurkishExporter / ToptanTR** | Genel API yok; RFQ/elle | TR tedarikçi keşfi | **MANUEL** — otomasyon önerme |

**Neden CJ:** Made-in-China FOB ve MOQ veriyor ama "bu ürünü ABD'ye 1 adet göndermek kaç dolar?"
sorusunu cevaplamıyor. Launch-readiness'teki en büyük `unknown` bu. CJ'nin lojistik ucu ürün +
varış ülkesi için tahmin döndürüyor; ölçüm dışı varsayım yapmadan kapıyı besler.

### 3.7 Ekonomi: kargo, vergi, kur, komisyon

| Girdi | Ücretsiz kaynak | Not |
| --- | --- | --- |
| **Kur** | Frankfurter (anahtarsız, ticari kullanım serbest) — **ÖLÇÜLDÜ: USD→TRY 200, 0,44 sn** | Kod zaten `/api/public/fx` üzerinden kullanıyor; değişiklik gerekmez |
| **Kargo** | Shippo 30 etiket/ay ama **rate isteği 0,01 $**; EasyPost ~3.000 etiket (doğrulanmadı); ShipEngine ücretsizde API ücreti yok ([pricing](https://www.shipengine.com/pricing)) | Ücretsiz "sınırsız rate" yok; CJ tahmini en pratik |
| **ABD satış vergisi** | Avalara `TaxRatesByPostalCode` ücretsiz (kimlik doğrulanamadı), TaxJar 30 gün trial | Üretim için ücretli |
| **AB KDV** | Statik ülke KDV tablosu (mevzuat) | API gerekmez |
| **Gümrük/HS** | TARIC Excel indirme; USITC HTS `reststop/exportList` **anahtarsız JSON — ÖLÇÜLDÜ 200 / ~10 KB** ([HTS](https://hts.usitc.gov/export)) | Anahtar kelime araması boş döndü; bölüm aralığıyla çek, aylık içe al |
| **Pazaryeri komisyonu** | eBay/Etsy/Amazon ücret tarifeleri (statik tablo) | API'ler fee hesaplamıyor (Amazon SP-API hariç, satıcı yetkisi ister) |
| **Reklam CPA** | Triple Whale medyan **$38,99** (40.000+ marka, Ağu 2025–Tem 2026) ([rapor](https://www.triplewhale.com/blog/facebook-ads-benchmarks)) | Kodda zaten $35 tabanı bu sayıya dayanıyor |
| **TikTok benchmark API** | `Get ad benchmarks` uç noktası var; şema/erişim doğrulanamadı | **RED** — doğrulanmadan plana girmez |

**Tek somut öneri:** `launch-readiness`'e **"Landing" (indirilmiş maliyet)** kapısı ekle:
`birim kargo + komisyon + vergi/gümrük` ölçülmüşse hesapla, değilse `unknown`. Mevcut %60 marj
kapısı **değiştirilmemeli** (politika); yeni kapı onun yanına eklenmeli. Böylece "atılabilir"
kararı daha katı ama daha dürüst olur.

### 3.8 AI kısa liste ve 14 ajanlı konsey

| Sağlayıcı | Ücretsiz gerçek | Ticari / veri | Karar |
| --- | --- | --- | --- |
| **Groq** | 30 RPM / **1.000 RPD**, 8k TPM (model bazlı; hesapta değişebilir) ([limits](https://console.groq.com/docs/rate-limits)) | Ticari kullanım açık; varsayılan **veri saklamıyor** ([your data](https://console.groq.com/docs/your-data)) | **VARSAYILAN** |
| **Gemini** | Ücretsiz modeller var; kesin RPM/RPD hesaba özel ([pricing](https://ai.google.dev/gemini-api/docs/pricing)) | **Ücretsiz kota verisi ürün geliştirmede kullanılır**; EEA/UK/CH'de son kullanıcıya sunulan API için ücretsiz kota yasak ([terms](https://ai.google.dev/gemini-api/terms)) | **KORU + UYAR** |
| **Cloudflare Workers AI** | **10.000 neuron/gün** ([pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)) | **Sıfır saklama, eğitimde kullanılmıyor** ([data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/)) | **EKLE (P0)** |
| **Cerebras** | Yalnız **$5 trial / 30 gün**, kart doğrulaması ([limits](https://inference-docs.cerebras.ai/support/rate-limits)) | Ticari izin doğrulanamadı | **ŞARTLI** — kalıcı katman sayma |
| **OpenRouter** | `:free` modeller; varsayılan **50 istek/gün**, $10 sonrası 1.000 ([FAQ](https://openrouter.ai/docs/faq)) | Model bazlı değişir | **YEDEK** |
| **SambaNova** | **20 RPD** (ücretsiz) ([limits](https://docs.sambanova.ai/docs/en/models/rate-limits.md)) | Açık ticari izin yok | **YEDEK (düşük)** |
| **Mistral Free** | Limitler hesaba özel; free mode prototip | **Veri eğitimde kullanılabilir** (opt-out var) | **ŞARTLI** |
| **Cohere trial** | 1.000 çağrı/ay | **Ticari/üretim yasak** | **RED** |
| **GitHub Models** | **30 Tem 2026'da tamamen kapatıldı** ([docs](https://docs.github.com/en/github-models)) | — | **RED** — kodda referans varsa temizle |
| **Hugging Face Inference** | Ücretsiz kullanıcıya aylık kredi **yok**; PRO $2/ay ([pricing](https://huggingface.co/docs/inference-providers/pricing)) | Sağlayıcıya göre değişir | **RED** — `HF_TOKEN` sessiz 402 üretebilir |
| **Together AI** | Ücretsiz trial yok; minimum **$5** kredi ([duyuru](https://support.together.ai/articles/1862638756-changes-to-free-tier-and-billing-july-2025)) | — | **YEDEK değil** — anahtar varsa da çalışmaz |
| **NVIDIA NIM trial** | Oran sınırlı trial; ticari izin doğrulanamadı | Gizli veri gönderme | **RED** |

**Koddaki somut risk (okundu, çalıştırılmadı):**
`src/lib/ai-load-balancer.ts` sabit model adları taşıyor: `gemini-2.5-flash`, `gemini-2.0-pro`,
`meta-llama/Llama-2-70b-chat-hf`, `NousResearch/Nous-Hermes-2-Mixtral-8x7B-DPO`. Ekim 2026
kaynaklarına göre 2.5 Flash erişimi yalnız onu daha önce kullananlara açık; Llama-2/Hermes-2
gibi kimliklerin güncel katalogda durduğu **doğrulanmadı** — bu yüzden risk "çalışmıyor" değil,
"doğrulanmadan üretime çıkmamalı". `ai-pool.server.ts` ise doğru yaklaşımı kullanıyor
(`gemini-flash-latest`, `llama-3.3-70b-versatile`). İki yol çeliştiğinde konsey sessizce yedek
modele düşer; bu "kalite düşüşü" olarak görünür, "hata" olarak görünmez. **Öneri:**
`ai-load-balancer` emekliye ayrılsın veya tüm model kimlikleri tek bir alias tablosundan gelsin;
`/health` sağlayıcı bazında son hata kodunu göstersin.

**Kota matematiği:** 14 ajan × rol başına 1 çağrı = koşu başına ~14 istek. Groq'un 1.000 RPD'si
teorik ~71 koşu/gün; Cloudflare 10.000 neuron/gün model ve token uzunluğuna göre değişir. Bu sayı
**ölçülmeden** kapasite planına yazılmamalı — `COUNCIL_CONCURRENCY` ve önbellek (12 saat) korunmalı.

### 3.9 Rekabet yoğunluğu ve mevzuat

| İhtiyaç | Ücretsiz kaynak | Sınır | Karar |
| --- | --- | --- | --- |
| Aynı nişteki **aktif ilan sayısı** | eBay Browse (`total` alanı) | Onay kapılı; `sold` değil, aktif arz | **P1** — onay sonrası `cohortCompetitors`'a ikinci ölçüm |
| Pazaryeri arzı (SERP) | SerpApi Shopping **250 arama/ay, 50/saat** | Havuz dışı ilanları sayar; tekrar önbelleklenmeli | **P1** |
| HS kodu / gümrük | USITC HTS, EU TARIC | API yok; kod **verildikten sonra** doğrulama | **P2** — elle onay |
| Kategori ticaret hacmi | UN Comtrade / WITS (önceki ölçüm: 200) | Ürün değil **kategori** büyüklüğü; talep kanıtı sayılmaz | **P2** — yalnız bağlam |
| Marka/IP taraması | USPTO/EUIPO web araması | Genel ücretsiz API doğrulanmadı | **MANUEL** — mevcut kelime sözlüğü korunmalı |

**Kural:** Rekabet sayısı da `sold` gibi davranmamalı. Aktif ilan sayısı **arz**tır; kaç adet
satıldığını göstermez. Mevcut `cohortCompetitors` yalnız kendi havuzunu saydığı için "rekabet az"
yanılsaması üretebilir; eBay/Browse toplamı bunu **ölçülmüş** hâle getirir — tahminle değil.

---

## 4. Bu oturumda canlı ölçülenler

Tümü bu makineden, bugün (2026-10-17), kimlik doğrulamasız:

| Test | Sonuç | Süre | Yorum |
| --- | --- | --- | --- |
| Google Product Taxonomy indirme | **HTTP 200 · 483 KB · 5.596 satır** (5.595 kategori + başlık) | 49 ms | Kategori katmanı için yeterli; statik veri olarak gömülebilir |
| OBF `cgi/search.pl` — serum / shampoo | **46 / 2.919 kayıt** (farklı kodlar) | 1,6 sn | **Metin araması burada çalışıyor** |
| OBF `/api/v2/search?search_terms=serum` | **77.741 sabit kayıt** (sorgu yok sayılıyor) | 0,6 sn | **Bu uçta metin araması yok**; `categories_tags` ile filtrele |
| OBF `/api/v2/search?categories_tags=shampoo` | **1.880 kayıt** | 0,9 sn | Tek doğru kullanım: barkod veya kategori |
| Open Products Facts `yoga mat` / `backpack` / `water bottle` | **0 / 4 / 18 kayıt** | 0,6–1,1 sn | Genel ürün için kapsama çok ince; besin dışı nişlerde işe yaramaz |
| Reddit anahtarsız `search.json` | **HTTP 403** | — | OAuth zorunlu; mevcut arşiv kaynağı taze değil |
| Amazon autocomplete (`completion.amazon.com`) | **HTTP 200 · 2,8 KB** | 0,17 sn | Sorgu genişletme; hacim değil |
| eBay autosuggest | **HTTP 400** (`Missing 'sId'`) | 0,24 sn | Parametre şart; dokümante değil |
| VATcomply `/vat_rates` | **HTTP 200 · 237 KB**, AB ülkeleri | 0,45 sn | AB KDV tablosu; **TR yok** → TR için statik %20 |
| Frankfurter USD→TRY | **HTTP 200**, TRY kuru döndü | 0,44 sn | Kod zaten kullanıyor; ek iş yok |
| WooCommerce Store API (önceki ölçüm) | **200 · 20,3 KB · 2 satır** | 3,9 sn | Puan + yorum + kategori + fiyat aynı yanıtta |

Önceki ölçümler (README ve `docs/reports/…V2.md`'den, tekrar edilmedi): UPCitemdb 3. istekte 429 ·
Best Buy anahtarsız 0 çağrı · deal-feed aday havuzunu %55–63 büyütüyor · Made-in-China 30/30 MOQ +
tedarikçi · WooCommerce Store API 200/3,9 sn · Shopify `products.json` marka/kategori %100, barkod %0 ·
Indiegogo/Stack Exchange/Open Products Facts reddedildi.

**Çelişki çözümü (bugün yeniden test edildi):**

1. **Open Facts:** önceki rapor "metin araması çalışmıyor" derken `/api/v2/search` kullanmıştı;
   bu uç gerçekten `search_terms`'ü yok sayıyor (77.741 sabit). **`cgi/search.pl` ise sayıyor**
   (serum 46, shampoo 2.919). İkisi de doğru — yanlış olan, uçları ayırmadan genellemek.
2. **Shopify:** teknik ölçüm (marka/kategori %100) doğru; hukuki hüküm ayrı: Shopify API şartları
   ticari ürün indeksi kurmayı yasaklıyor. Bu yüzden karar "çalışıyor" değil, **allowlist + izin**.
3. **UPCitemdb:** resmî belge **100 istek/gün toplam, en fazla 40 arama, 6 istek/dk** diyor;
   README'nin 20 arama varsayımı muhafazakârdı. Bu ağda 3. istekte 429 ölçüldü — yani sınır
   günlük değil **patlama** kaynaklı. Kota planı 40 arama üzerinden yapılmalı, istekler
   **10 sn arayla** atılmalı (2/30 sn gereksiz yavaş).

---

## 5. Önceliklendirilmiş yol haritası

### P0 — bu hafta, anahtar gerekmez veya ücretsiz anahtar

| İş | Etki | Efor | Risk | Dokunulacak yer |
| --- | --- | --- | --- | --- |
| **1. Taxonomy → kategori** | Kategori kapsamasında belirgin artış (türev işaretli); filtre doğruluğu | 1–2 gün | Türev kategori kanıt sayılmamalı | `src/data/` + `product-categories.ts` + `filter` |
| **2. JSON-LD `gtin/mpn/sku` + GTIN check-digit** | Mükerrer kayıt azalır; kimlik çapası | 0,5–1 gün | "Geçerli kod ≠ GS1 tahsisi" notu koda yazılmalı | `marketplace-jsonld.ts`, `product-identity.ts` |
| **3. WooCommerce allowlist kaynağı** | `ratingCount` 0/21 → ölçülmüş artış; kategori/fiyat | 2 gün | 3,9 sn yanıt → 3 sn tavan + fail-soft rapor | `product-discovery-sources.server.ts` |
| **4. Landed-cost kapısı** | "Atılabilir" yanlış pozitiflerini azaltır (kargo/komisyon/vergi) | 2–3 gün | Eşik politikası; geriye dönük kayıtlar bozulmamalı | `launch-readiness.ts`, `economics-evidence.ts` |
| **5. Cloudflare Workers AI + model alias** | AI darboğazı ve sağlayıcı ölümüne dayanıklılık; sıfır veri saklama | 1 gün | Neuron bütçesi ölçülmeli | `ai-pool.server.ts`, `ai-load-balancer.ts`, `/health` |
| **6. Reddit OAuth** | Talep/şikâyet tazeliği; konsey gerekçesi | 1 gün | Ticari kullanım şartı | yeni `reddit-live` kaynağı + non-product kapısı |
| **7. eBay Browse başvurusu** | Gerçek ilan fiyatı/satıcı/kargo | Başvuru 0, kod 2 gün (onay sonrası) | Onay gelmeyebilir | `product-discovery-sources.server.ts` |
| **8. Best Buy anahtarını aç** | ABD/CA puan + kategori + değerlendirme sayısı | 0 (env) | Şartlar: 72 saat önbellek, üçüncü taraf fiyat analizi yasağı | `BESTBUY_API_KEY` |

### P1 — 2–4 hafta, ücretsiz anahtar/kayıt

| İş | Etki | Not |
| --- | --- | --- |
| **CJ Dropshipping API** | Birim kargo + teslim süresi + MOQ; landed-cost kapısını besler | `listV2` kullan; eski `/product/list` deprecated |
| **Icecat Open** | Elektronikte marka/MPN/spesifikasyon/görsel | 100 istek/IP/sn; atıf zorunlu; AI eğitimi yasak |
| **Etsy v3** | Handmade/POD nişlerinde gerçek ilan + mağaza | Kota uygulamaya özel; yorum alanı doğrulanmalı |
| **Serper / Tavily / Brave** | Fiyat+yorum snippet'i, SERP yedeği | Serper 2.500 başlangıç (yenilenmesi doğrulanmadı); Tavily 1.000/ay; Brave ~1.000/ay |
| **Open Beauty Facts** | Güzellik nişi zenginleştirme | ODbL: atıf + share-alike; fiyat yok; **`cgi/search.pl` kullan** |
| **Awin / Impact ürün feed'i** | Marka + EAN/UPC/GTIN + kategori + fiyat + stok | İstek anında değil, QStash ile periyodik içe alma; büyük iş |
| **Go-UPC** | GTIN → marka/kategori/görsel | 150/ay; yeniden dağıtım şartları belirsiz |

### P2 — dene, ölç, sonra karar ver

- SearchApi / DataForSEO Shopping trial'ları (100 istek / 1 $) — yalnız ölçüm için.
- Printful/Printify — yalnız POD nişleri; üretim maliyeti + kargo.
- Pinterest Trends API — doküman okunamadı; önce erişim başvurusu.
- TikTok benchmark uç noktası — şema doğrulanmadan kod yazma.

---

## 6. Ölçüm planı (implementasyondan sonra)

Mevcut `PRODUCT_DISCOVERY_AB=1` koşucusu ile, aynı gün, aynı nişlerde:

| Metrik | Nasıl | Başarı eşiği (öneri, politika) |
| --- | --- | --- |
| Aday sayısı | Kaynak VAR/YOK | +%20 (deal-feed'in +%55'ine göre mütevazı) |
| Fiyat kapsaması | `priceUsd != null` oranı | ≥ %95 (mevcut seviye korunmalı) |
| Kategori kapsaması | ölçülmüş vs türev ayrı sayılır | Ölçülmüş ≥ %50; türev kanıt sayılmaz |
| Puan/değerlendirme | `rating` + `ratingCount` | Anahtarlı kaynakta ≥ %60; anahtarsızda artış hedefi yok |
| Kanıt bütünlüğü | ≥4/5 yuva | Mevcut tabanın altına düşmemeli |
| Landed kapı | "atılabilir" sayısı | Yeni kapı sonrası **azalma beklenir**; azalmıyorsa kapı yanlış |
| Süre | adım başına ms | 280 sn sözü içinde; p95 < 120 sn |
| AI | 429 oranı, tamamlanma | 429 < %5; konsey tamamlanma ≥ %95 |

Niş seti: `air fryer`, `robot vacuum`, `yoga mat`, `vitamin c serum` (yeni), `led desk lamp`.
Ülkeler: US + TR. Her koşuda kaynak sağlık raporu (`reports`) saklanmalı.

---

## 7. Reddedilenler ve tuzaklar (özet)

| Kaynak | Neden |
| --- | --- |
| GitHub Models | 30 Tem 2026'da kapatıldı |
| Hugging Face Inference ücretsiz | Aylık ücretsiz kredi yok; `HF_TOKEN` sessizce 402 |
| Together AI | Minimum $5 kredi; ücretsiz trial yok |
| Cohere trial | Ticari/üretim yasak |
| Bing Web Search API | 11 Ağu 2025'te emekli |
| Amazon PA-API | Creators API'ye geçti; 10 satış/30 gün şartı |
| Shopify toplu tarama | Resmî API değil; ticari ürün indeksi kurmak API şartlarına aykırı → yalnız allowlist |
| Open Facts metin araması (`/api/v2/search`) | Sorguyu yok sayıyor; barkod/kategori kullan |
| Alibaba / 1688 / DHgate | Ücretsiz alıcı API'si doğrulanamadı; kazıma izni yok |
| TikTok otomatik çıkarma | Destekli genel API yok; şartlar yazılı izin istiyor |
| Target / Walmart / Kroger | Erişim ve kota doğrulanamadı; Target PerimeterX |
| Keepa / EAN-Search / TaxJar | Ücretsiz kalıcı katman yok |
| Brocade.io / GEPIR | Arşivlendi / Verified by GS1'e taşındı |
| DummyJSON | Sentetik veri |
| Open Products Facts | Ölçüldü: 0–18 kayıt (nişe göre) — kapsama yetersiz |
| Kickstarter / Indiegogo keyword | Genel arama API'si yok |

**Lisans/şart uyarıları (önemli):**

- **Best Buy:** 72 saat önbellek; içerik üçüncü taraf adına Best Buy fiyat analizinde kullanılamaz.
- **UPCitemdb:** Amazon/eBay satış bilgisi API üzerinden yeniden dağıtılamaz; ticari yeniden
  dağıtım şartları belirsiz.
- **Open Food/Beauty/Products Facts:** ODbL (atıf + share-alike), görseller CC BY-SA.
- **Icecat:** Open Icecat lisansı; fair-use üstü ücretli; kazıma ve AI eğitimi yasak.
- **Reddit:** ücretsiz katman ticarileşmemiş kullanım; ticari ürün için anlaşma gerekir.
- **Gemini ücretsiz kota:** veri ürün geliştirmede kullanılır; EEA/UK/CH'de ücretsiz kota ile
  son kullanıcı API'si sunulamaz.

---

## 8. Günlük ücretsiz kotalar — tam katalog (Ekim 2026)

Bu bölüm "günde kaç çağrı" sorusunu kaynak kaynak yanıtlar. Üç sütun kritik:
**anahtar gerekiyor mu**, **günlük/aylık ücretsiz kota**, ve **ne veriyor**. "Kota yayınlanmadı"
*limitsiz* demek değildir; hesap/uygulama bazlı olduğu anlamına gelir.

### 8.1 Ürün, pazaryeri ve tedarik

| Kaynak | Anahtar | Ücretsiz kota | Ne veriyor | Karar |
| --- | --- | --- | --- | --- |
| **eBay Browse** | OAuth + üretim onayı | Keyset varsayılanı **5.000 çağrı/gün** ([KB](https://developer.ebay.com/support/knowledge-base/1359)) | Fiyat, satıcı, kargo, GTIN arama, aktif ilan `total` | **P0: başvuru**, kod onay sonrası |
| eBay Marketplace Insights | Onay (limited release) | Yayınlanmadı | Satış geçmişi | **RED** — erişim yok |
| **Best Buy Products** | Ücretsiz anahtar | **50.000 çağrı/gün, 5 çağrı/sn** ([şartlar](https://developer.bestbuy.com/legal)) | Fiyat, puan, yorum sayısı, kategori yolu, görsel | **P0: sadece env** (`BESTBUY_API_KEY`) |
| Amazon Creators | Associates + **30 günde 10 satış** | İlk 30 gün **8.640/gün, 1/sn**; gelirle artar ([rates](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/concepts/api-rates)) | Fiyat, varyant, kategori | **ŞARTLI** — satış yoksa erişim yok |
| **Etsy v3** | Anahtar (OAuth opsiyonel) | Uygulamaya özel; **kayan 24 saat**; `150/sn, 100.000/gün` yalnız **örnek başlık değeri** ([rate limits](https://developer.etsy.com/documentation/essentials/rate-limits)) | İlan, mağaza, fiyat | **P1** — handmade/POD nişi |
| **Kroger Public Products** | Geliştirici anahtarı | **10.000 çağrı/gün** | Market ürünü, fiyat, görsel | **P2** — yalnız US grocery |
| Walmart Affiliate | Başvuru | Yayınlanmadı | Fiyat, mağaza | **DOĞRULANMADI** |
| Target / Temu / Zalando / Bol / Otto / Rakuten | Partner | Yayınlanmadı | — | **RED/P2** — alıcı API'si yok |
| Newegg | Mevcut okuyucu | — | Elektronik fiyat | Mevcut yeterli |
| AliExpress | Anahtarsız okuyucu | Kod içi aylık kota | Fiyat, satış adedi, mağaza | Mevcut |
| Made-in-China | Anahtarsız (robots uyumlu) | Kod içi aylık kota | FOB, MOQ, tedarikçi | Mevcut — güçlü |
| **CJ Dropshipping** | Hesap token'ı | **50.000 puan/gün** (00:00 UTC); `/product/listV2` 50 puan → **1.000 çağrı**, `/product/query` 10 puan → **5.000**, `/logistic/freightCalculate` 10 puan → **5.000 kargo tahmini** ([points](https://developers.cjdropshipping.com/en/api/api2/standard/points.html)). **Risk:** 30 gün işlem yoksa API erişimi iptal edilir | MOQ, depo ülkesi, teslim süresi, **kargo tahmini** | **P1** — landed-cost'un eksik parçası |
| **Printful** | Katalog anahtarsız (**ÖLÇÜLDÜ: 200, 1,7 MB**) | Doküman ~**120/dk** (doğrulanmadı) | POD taban maliyeti, varyant, kargo sınıfı | **P1 (yalnız POD)** |
| Printify | Token + uygulama onayı | **600/dk** genel, katalog **100/dk**, yayın **200/30 dk** ([docs](https://developers.printify.com/)) | POD taban maliyeti | **ŞARTLI** |
| **Impact katalogları** | Partner hesabı | **1.000/saat**, `/Catalogs` **3.600/saat** | Marka + EAN/UPC + fiyat + stok | **P2** — feed içe alma |
| Awin feed | Partner hesabı | **5 eşzamanlı indirme**, 1 saatte 5 tekrar | Marka + GTIN + kategori + fiyat | **P2** |
| Shopify `products.json` | Anahtarsız ama **resmî API değil** | Kota yok; mağaza bazlı robots/izin | Marka, kategori, fiyat, görsel, stok; **barkod `null`** | Yalnız **allowlist**, toplu tarama yok |

### 8.2 Barkod, kimlik ve katalog zenginleştirme

| Kaynak | Anahtar | Ücretsiz kota | Ne veriyor | Karar |
| --- | --- | --- | --- | --- |
| **UPCitemdb Explorer** | Hayır | **100 istek/gün toplam, en fazla 40 arama**, patlama **6/dk** ([resmî](https://www.upcitemdb.com/wp/docs/main/development/api-rate-limits/)) | Barkod → marka, model, kategori, kayıtlı fiyat | Mevcut — **kota defteri şart** |
| **Google Product Taxonomy** | Hayır (dosya) | Kota yok — **ÖLÇÜLDÜ: 483 KB, 5.596 satır** | 5.595 kategori yolu + ID | **P0** |
| **Open Food Facts** | Hayır | **15 okuma/dk, 10 arama/dk** (IP) | Gıda: marka, kategori, görsel | Mevcut — metin için `cgi/search.pl` |
| **Open Beauty Facts** | Hayır | Aynı aile; ölçülen: serum 46, shampoo 2.919 | Kozmetik: marka, kategori, görsel, **fiyat yok** | **P1** — yalnız zenginleştirme |
| Open Products Facts | Hayır | Ölçülen: yoga mat 0, backpack 4, water bottle 18 | Genel ürün | **RED** — kapsama ince |
| Icecat Open | Ücretsiz kayıt | **Günlük kota yok**; 100 istek/IP/sn (50–70 önerilir) | Elektronik spec, MPN, görsel | **P2** — sayfa bot korumalı (403) |
| Go-UPC | Ücretsiz anahtar | **150 istek/ay** | Barkod → marka/kategori/görsel | **DENE** — düşük kota |
| EAN-Search | Ücretli | Ücretsiz katman doğrulanmadı | EAN → isim | **RED** |
| GS1 US | Web 30 arama/gün; API **$6.500** | — | GTIN doğrulama | **MANUEL** |
| **Open Library** | Hayır | **1/sn** (UA + e-posta ile 3/sn), **ÖLÇÜLDÜ: 200** | Kitap | Mevcut |

### 8.3 Talep, trend ve topluluk sinyalleri

| Kaynak | Anahtar | Ücretsiz kota | Ne veriyor | Karar |
| --- | --- | --- | --- | --- |
| **Google Trends resmî API** | Alpha başvurusu | Kota yayınlanmadı; **1.800 günlük (~5 yıl)** pencere ([duyuru](https://developers.google.com/search/blog/2025/07/trends-api)) | Trend serisi, bölge | **BAŞVUR** — bağımlı olma |
| Google Trends (resmî olmayan uçlar) | Hayır | **ÖLÇÜLDÜ: 429** | — | **DENEYSEL** etiketi korunmalı |
| **Wikimedia API** | Hayır | **200/dk** (tanımlı UA), 10/dk kimliksiz ([2026 limitleri](https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits)) | Bağlam, sayfa görüntüleme | Mevcut |
| **Hacker News (Algolia)** | Hayır | **10.000 istek/saat** ([API](https://hn.algolia.com/api)); **ÖLÇÜLDÜ: 200** | Bağlam | Mevcut |
| **Reddit** | OAuth | **100 sorgu/dk** (client ID başına) | Tazelik, şikâyet, talep | **P0** — mevcut arşiv statik |
| Product Hunt | Token | **6.250 karmaşıklık/15 dk**; **ticari kullanım varsayılan yasak** | Lansman | **RED (ticari)** |
| **YouTube Data v3** | Anahtar | **10.000 birim/gün**; `search.list` **100 çağrı/gün** ([kota](https://developers.google.com/youtube/data/guides/quota_and_compliance_audits)) | Video ilgisi, niş doğrulama | **P1** — 100 arama/gün sınırı |
| Steam Web API | Kısmen anahtar | **100.000 çağrı/gün** | Oyun nişi | Mevcut |
| Pinterest (trial) | Token | **1.000 istek/gün** | Trend | **P2** |
| Kickstarter / Indiegogo | — | Genel arama API'si yok/doğrulanmadı | — | **RED** |
| TikTok Creative Center | — | Destekli trend API'si yok | — | **RED** — kazıma yasak |
| Glimpse | — | 10 trend sorgusu/ay (ürün UI'ı, API değil) | — | **RED** |
| GitHub REST | Opsiyonel token | **60/saat** anahtarsız, **5.000/saat** token'lı | Açık kaynak ilgisi | Mevcut — token ekle |

### 8.4 SERP, kazıma ve sayfa okuma

| Kaynak | Anahtar | Ücretsiz kota | Ne veriyor | Karar |
| --- | --- | --- | --- | --- |
| Google Custom Search JSON | Anahtar | **100 sorgu/gün** — **yeni müşteriye kapalı**, **1 Oca 2027'de kapanıyor** ([overview](https://developers.google.com/custom-search/v1/overview)) | SERP | **RED** — üzerine inşa etme |
| Serper.dev | Anahtar | **2.500 sorgu** (tek seferlik, yenilendiği doğrulanmadı) | Google SERP | **DENE** |
| **Tavily** | Anahtar | **1.000 kredi/ay** (ayın 1'inde yenilenir) | Arama + sayfa çıkarma | **P1** — yorum/fiyat metni |
| Brave Search | Anahtar | **$5 kredi/ay ≈ 1.000 arama** | SERP | Yedek |
| Exa | Anahtar | **$10 kredi/ay** (+ilk ay $10 bonus) ≈ 2.500 arama | Anlamsal arama | **P2** |
| **Jina Reader** | Opsiyonel | **20/dk anahtarsız** (**ÖLÇÜLDÜ: 200**), **500/dk** anahtarla + 10M token | Sayfayı markdown'a çevirme | **P1** — ucuz okuma |
| Firecrawl | Anahtar | **1.000 kredi/ay** | Kazıma | Alternatif |
| ZenRows | Anahtar | **5.000 kredi/ay** | Sert siteler | **P2** — Target gibi bloklu siteler |
| Bright Data | Hesap | **5.000 kredi/ay** | SERP + unlocker | **P2** |
| Apify | Token | **$5 kullanım/ay** | Actor'lar | **P2** |
| ScrapingBee / ScraperAPI | Anahtar | 1.000 kredi + 7 gün 5.000 | Kazıma | **P2** |
| SerpApi | Anahtar | **250 arama/ay**, 50/saat | Shopping SERP | Mevcut |
| SearchApi / DataForSEO | Anahtar | 100 istek / $1 deneme (tek seferlik) | SERP | **RED** — kalıcı değil |
| Bing Web Search | — | **11 Ağu 2025'te kapandı** | — | **RED** |
| DuckDuckGo HTML / SearXNG | — | Resmî değil / kendi sunucu | — | **RED / P2** |

### 8.5 AI (kısa liste + 14 ajanlı konsey)

| Sağlayıcı | Ücretsiz kota (günlük vurgusu) | Ticari / veri | Karar |
| --- | --- | --- | --- |
| **Gemini free** | Modele göre; AI Studio'da görünür, RPD gece yarısı (PT) sıfırlanır | Ücretsiz kota verisi **ürün geliştirmede kullanılabilir**; EEA/UK/CH'de son kullanıcı API'si kısıtlı | Mevcut — uyarı korunmalı |
| **Groq** | `gpt-oss-120b` / `gpt-oss-20b` / `qwen3.8-27b`: **30 RPM, 1.000 RPD, 8K TPM, 200K TPD**; prompt-guard: **14.400 RPD** ([limits](https://console.groq.com/docs/rate-limits)) | Varsayılan saklama yok | **VARSAYILAN** |
| **Cloudflare Workers AI** | **10.000 neuron/gün** (00:00 UTC) | Sıfır saklama | **P0** — yedek motor |
| OpenRouter `:free` | **50 istek/gün, 20/dk**; $10 kredi alımı sonrası **1.000/gün** ([limitler](https://openrouter.ai/docs/api_reference/limits)) | Model bazlı | **YEDEK** |
| SambaNova | **20 RPD** (DeepSeek-V3.1, Llama-3.3-70B, gpt-oss-120b) | Preview üretimde yasak | Yedek (çok düşük) |
| Mistral Free | Hesaba özel | Veri eğitimde kullanılabilir | **ŞARTLI** |
| Cohere trial | **1.000 çağrı/ay**, 20/dk | **Ticari kullanım yasak** | **RED** |
| Cerebras | **$5 / 30 gün** trial | — | **ŞARTLI** |
| Hugging Face | Ücretsiz kredi **yok**; PRO **$2/ay** | — | **RED** |
| Together AI | Ücretsiz yok; ilk alım **$15** | — | **RED** |
| **GitHub Models** | **30 Tem 2026'da kapandı** | — | **RED** — koddan temizle |
| Voyage embeddings | Hesap başına **200M token** (bazı modellerde 50M) | — | **P2** — benzerlik |
| Jina embeddings | Ücretsiz anahtar: **500 RPM / 2M TPM** | — | **P2** |

### 8.6 Ekonomi ve görsel

| Kaynak | Anahtar | Ücretsiz kota | Ne veriyor | Karar |
| --- | --- | --- | --- | --- |
| **Frankfurter** | Hayır | Kota yok (**ÖLÇÜLDÜ: 200**) | 223 para birimi, tarihli kur | Mevcut |
| open.er-api | Hayır | Aylık tavan doğrulanmadı (~1.500/ay iddiası) | Kur yedeği | Yedek |
| **VATcomply** | Hayır | **2 istek/sn** | AB KDV oranları (**ÖLÇÜLDÜ: 200**) | **P1** — statik tabloyu besler |
| Shippo | Anahtar | **30 etiket/ay**; rate isteği **$0,01** | Etiket + rate | **RED (rate)** |
| EasyPost | Anahtar | "3.000 etiket" iddiası (doğrulanmadı) | Etiket | **DOĞRULANMADI** |
| ShipEngine | Anahtar | Ücretsiz plan var, kota yok | Etiket | **DOĞRULANMADI** |
| TARIC / USITC HTS | Hayır (dosya) | Kota yok | Gümrük tarifesi | **P1** — yerel tablo |
| **Logo.dev** | Anahtar | **500.000 CDN/ay** + **$5 kredi/ay** (≈100 marka çağrısı), atıf şartı | Marka logosu | **P1** |
| Brandfetch | Anahtar | 100 tek seferlik fetch + 1M render/ay | Logo, marka | **P2** |
| remove.bg | Anahtar | **50 çağrı/ay**; 1 Ara 2026'da Leonardo.Ai'ye geçiyor | Arka plan silme | **ŞARTLI** |
| Cloudinary | Anahtar | **25 kredi/ay** | Optimizasyon | **ŞARTLI** |
| Unsplash / Pexels | Anahtar | 50/saat (demo) / 200/saat | Stok görsel — **ürün görseli değil** | **RED** |

### 8.7 Kota matematiği: gerçek darboğaz nerede?

Koşu başına çağrı sayıları **tahmin** (kaynak başına 1 arama + zenginleştirme), ama sıralama
kota belgesinden kesin:

| Kaynak | Günlük ücretsiz kota | Koşu başına ~çağrı | Günlük koşu kapasitesi |
| --- | --- | --- | --- |
| Best Buy | 50.000 | 2–3 | ~16.000 |
| eBay Browse | 5.000 | 2 | ~2.500 |
| Kroger | 10.000 | 2 | ~5.000 |
| Cloudflare AI | 10.000 neuron | 14 çağrı | modele bağlı |
| Groq | 1.000 RPD | 14 | ~71 |
| Tavily | 1.000/ay | 5 | ~6 |
| **UPCitemdb** | **40 arama/gün** | 5 | **~8** ← tek gerçek darboğaz |
| OBF | 10 arama/dk | 1 | teorik 14.400, pratikte 1/sn |

**Sonuç:** yeni kaynak eklemek kotayı değil, **zenginleştirme sırasını** değiştirmeli. UPCitemdb
yalnızca ilk 15 adaya uygulanmalı, sonuç GTIN anahtarıyla **90 gün** saklanmalı; aksi hâlde
günün 8. koşusundan sonra katalog katmanı sessizce ölür.

**Sıfırlanma saatleri (kotayı planlarken kritik):**

| Kaynak | Sıfırlanma |
| --- | --- |
| CJ Dropshipping puanları | **00:00 UTC** (günlük) |
| Cloudflare Workers AI neuronları | **00:00 UTC** (günlük) |
| Gemini ücretsiz RPD | gece yarısı **Pasifik** |
| YouTube Data birimleri | gece yarısı **Pasifik** |
| UPCitemdb | günlük + **6/dk** patlama penceresi |
| Open Facts / Wikimedia / Tavily | dakika bazlı (günlük tavan yok) |

UTC 00:00 ile Pasifik gece yarısı arasında **7–8 saat** fark var; "gün" kavramı kaynak başına
tanımlanmadan tek bir kota defteri yazılırsa gece yarısı çift harcama veya erken 429 görülür.

---

## 9. Ne ekleyelim — uygulama planı

Sıra "en çok yuvayı en az işle kapat" kuralına göre. Her satırda **env anahtarı** ve
**dokunulacak dosya** var; hiçbiri ölçülmeden "etki" olarak sunulmadı.

### 9.1 P0 — bu hafta (anahtarsız veya tek env satırı)

| # | Ekleme | Neden (kanıt) | Env | Dosya | Efor |
| --- | --- | --- | --- | --- | --- |
| 1 | **`BESTBUY_API_KEY` aç + doluluk ölç** | Kaynak kodda zaten eşli; 50.000/gün; `ratingCount` bugün 0/21 | `BESTBUY_API_KEY` | env + `product-discovery-sources.server.ts` | 0,5 gün |
| 2 | **Google Taxonomy → yerel kategori** | Ölçüldü: 5.596 satır/483 KB; kategori 0–4/21 | — | `src/data/` + `product-categories.ts` + filtre | 1–2 gün |
| 3 | **GTIN check-digit + JSON-LD `gtin/mpn/sku`** | Mükerrer kayıt; API maliyeti sıfır | — | `marketplace-jsonld.ts`, `product-identity.ts` | 0,5–1 gün |
| 4 | **WooCommerce Store API allowlist** | Anahtarsız; puan + yorum + kategori + fiyat aynı yanıtta | — | `product-discovery-sources.server.ts` | 2 gün |
| 5 | **Kaynak kota defteri** | UPCitemdb 40 arama/gün, OBF 10/dk, CJ puan/gün: bugünkü `SUPPLIER_MONTHLY_LIMIT` tek kaynak için var, günlük yok | — | `scraper-quota.server.ts` genişletme | 1 gün |
| 6 | **Reddit OAuth (100/dk)** | Anahtarsız `search.json` **403**; arşiv statik | `REDDIT_CLIENT_ID/SECRET` | yeni `reddit-live` kaynağı (non-product kapısı) | 1 gün |
| 7 | **Cloudflare Workers AI yedeği** | 10.000 neuron/gün, sıfır saklama | `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_AI_TOKEN` | `ai-pool.server.ts` | 1 gün |

### 9.2 P1 — 2–4 hafta (ücretsiz kayıt/anahtar)

| # | Ekleme | Neden | Env | Efor |
| --- | --- | --- | --- | --- |
| 8 | **eBay Browse** (onay sonrası) | Aktif ilan `total` + GTIN arama + satıcı/kargo; 5.000/gün | `EBAY_CLIENT_ID/SECRET` | Başvuru + 2 gün |
| 9 | **CJ Dropshipping** | 50.000 puan/gün; `freightCalculate` 10 puan → **5.000 kargo tahmini/gün** = tek `unknown` kapanır. **30 gün işlem yoksa erişim iptal** — hesabı canlı tutma planı yazılmalı | `CJ_API_KEY` | 2 gün |
| 10 | **Open Beauty Facts (`cgi/search.pl`)** | 46/2.919 sonuç; kozmetikte marka+kategori | — | 1 gün |
| 11 | **Tavily (1.000/ay) + Jina Reader (20/dk)** | Yorum/fiyat metnini sayfadan çıkarır; 429'da yedek | `TAVILY_API_KEY` | 2 gün |
| 12 | **YouTube Data (10.000 birim/gün, 100 arama)** | Nişin video ilgisi; talep kanıtı sayılmaz | `YOUTUBE_API_KEY` | 1 gün |
| 13 | **Logo.dev** (500K CDN/ay) | Kart görsel kalitesi; **atıf şartı** | `LOGO_DEV_TOKEN` | 0,5 gün |
| 14 | **VATcomply + TARIC/HTS tablosu** | Landed-cost kapısı; KDV/gümrük ölçülmüş olur | — | 1 gün |
| 15 | **Printful katalog** (ölçüldü 200, anahtarsız) | POD nişinde taban maliyet | `PRINTFUL_TOKEN` (opsiyonel) | 1 gün |
| 16 | **Etsy v3** | Handmade/POD'da gerçek ilan + mağaza | `ETSY_API_KEY` | 2 gün |

### 9.3 P2 — dene, ölç, sonra karar ver

- **Impact/Awin feed içe alma** (1.000/saat; 3.600/saat katalog) — marka+GTIN boşluğunun tek gerçek çözümü, ama QStash işi + normalize tablo gerekir.
- **Kroger** (10.000/gün) — yalnız US grocery nişi açılırsa.
- **Icecat** — elektronikte spec/MPN; kota doğrulanmadı.
- **Go-UPC** (150/ay) — UPCitemdb kotası dolduğunda ikinci kaynak.
- **ZenRows/Bright Data** (5.000 kredi/ay) — yalnız Target gibi bloklu siteler için; ToS riski kullanıcıya yazılmalı.
- **Voyage/Jina embeddings** — başlık benzerliği yerine anlamsal eşleştirme, ancak GTIN'den sonra.
- **Google Trends alpha başvurusu** — kabul gelirse gerçek trend serisi; gelmezse plan değişmez.

### 9.4 Eklemeyelim (gerekçeli)

| Kaynak | Neden eklenmiyor |
| --- | --- |
| Google Custom Search | Yeni müşteriye kapalı, **1 Oca 2027'de kapanıyor** |
| GitHub Models | 30 Tem 2026'da kapandı |
| Bing Web Search | 11 Ağu 2025'te kapandı |
| Together / Hugging Face | Kalıcı ücretsiz katman yok |
| Cohere trial / Product Hunt | Ticari kullanım yasak |
| Cerebras / SearchApi / DataForSEO | Tek seferlik deneme; kalıcı plan değil |
| SambaNova | 20 RPD — konsey için kullanılamaz |
| Alibaba / 1688 / DHgate / Temu | Ücretsiz alıcı API'si doğrulanamadı; kazıma izni yok |
| TikTok / Pinterest otomatik kazıma | Destekli API yok, şartlar yasaklıyor |
| Shopify toplu indeksleme | API şartları ticari ürün indeksi kurmayı yasaklıyor |
| Shippo rate / Keepa / EAN-Search | Ücretsiz değil |

### 9.5 10 günlük sıra (öneri)

1. **Gün 1–2:** `BESTBUY_API_KEY` + kota defteri; `ratingCount`/kategori doluluğunu önce/sonra ölç.
2. **Gün 3–4:** Taxonomy → kategori (türev işaretli) + GTIN check-digit.
3. **Gün 5–6:** WooCommerce allowlist kaynağı; `ratingCount` ikinci kaynakla doğrula.
4. **Gün 7:** Reddit OAuth + Cloudflare AI yedeği.
5. **Gün 8–9:** eBay başvurusu, Tavily + Jina Reader, Logo.dev.
6. **Gün 10:** `PRODUCT_DISCOVERY_AB=1` ile aynı nişlerde önce/sonra tablosu; kazananları tut, kaybedenleri kapat.

---

## 10. Bu turda canlı ölçülen yeni uçlar (2026-10-17)

| Test | Sonuç | Boyut | Yorum |
| --- | --- | --- | --- |
| Best Buy `/v1/products` (anahtarsız) | **403** | 98 B | Anahtar şart — beklenen |
| Kroger `/v1/products` | **401** | 77 B | Geliştirici anahtarı şart |
| eBay Browse (token yok) | **403** | 567 B | OAuth şart |
| HN Algolia | **200** | 2 KB | 10.000/saat; anahtarsız |
| Open Library search | **200** | 853 B | 1/sn; UA ile 3/sn |
| Jina Reader (`r.jina.ai`) | **200** | 1,5 KB | 20/dk anahtarsız doğrulandı |
| **Printful `/products`** | **200** | **1,7 MB** | Katalog anahtarsız okunuyor |
| Printify catalog | **401** | 90 B | Token şart |
| Logo.dev search | **401** | 84 B | Token şart |
| UPCitemdb kota belgesi | **200** | — | 100/gün, 40 arama, 6/dk |

---

## 11. Düzeltmeler ve doğrulanamayanlar

**Önceki rapora göre düzeltilenler:**

1. **UPCitemdb** "20 arama/gün" değil: **100 istek/gün toplam, 40 arama, 6/dk** (resmî belge).
2. **Best Buy** kotası artık yazılı: **50.000/gün, 5/sn** — "kota bilinmiyor" notu kalktı.
3. **Google Trends'in resmî alpha API'si var** (Temmuz 2025 duyurusu, 1.800 günlük pencere); "resmî API yok" ifadesi yalnız *genel erişim* için doğru.
4. **Google Custom Search** yeni müşteriye kapalı ve 1 Oca 2027'de kapanıyor — hiçbir plana girmemeli.
5. **GitHub Models** 30 Tem 2026'da kapandı; `HF_TOKEN` gibi "sessiz 402" üretir.
6. **Printful** kataloğu anahtarsız okunuyor (ölçüldü); Printify kataloğu token istiyor (401).
7. **Cohere trial** ticari kullanıma kapalı; **SambaNova** 20 RPD ile yedek bile olamaz.

**Doğrulanamayanlar (plana girmeden önce teyit gerekir):**

- Icecat **günlük** kotası: yayınlanmış bir sayı yok; yalnız **100 istek/IP/sn** var (§12.5).
- EasyPost ~3.000 etiket/ay (dinamik sayfa, tam doğrulanamadı); ShipEngine/ShipStation ücretsiz
  planında sayısal kota yok; Walmart Affiliate kotası hâlâ açık.
- Etsy'nin uygulamaya atanmış QPS/QPD değeri (portalda görünür); `150/100.000` yalnız örnek.
- Printful 120/dk ve anahtarsız 30/60 sn — doküman sayfası çekilemedi, doğrulanmadı.
- Kroger/AliExpress doküman gövdeleri okunamadı; sayılar arama sonucu.
- Google Trends alpha kabul koşulları ve kotası; Glimpse ücretsiz API kotası.
- Pinterest trial 1.000/gün — doküman sayfası çekilemedi.
- DeepL API Free karakter kotası (500K/ay ile 1M toplam çelişiyor) ve Google Cloud Translation
  500K/ay — resmî fiyat sayfaları çekilemedi.
- Ticari kullanıma açık, ürün tanımından **HS kodu atayan** ücretsiz API: bulunamadı (§12.1).

---

## 12. İkinci tur: kargo/vergi, görsel, çeviri, yorum ve kota doğrulamaları

Bu bölüm ikinci araştırma turunun çıktısıdır. Kural aynı: **resmî sayfadan okunamayan sayı
"doğrulanmadı" olarak işaretlenir**, tahmin tabloya yazılmaz.

### 12.1 Kargo, takip, vergi ve gümrük

| Servis | Anahtar | Ücretsiz kota (günlük / aylık) | Ne döndürür | Ticari not |
| --- | --- | --- | --- | --- |
| **Shippo** Starter | Evet | **30 etiket/ay**; fazlası $0.07 | Oran, etiket; **takip ayrı ücretli** (2¢/track, 1¢/rate, 3¢/teslim tarihi) | Yayınlanmış limitler: takip POST 750/dk, çoğu POST 500/dk, tek GET 4.000/dk |
| **EasyPost** | Evet | **~3.000 etiket/ay** (fiyat sayfası dinamik, tam doğrulanamadı) | Oran, etiket, takip, adres doğrulama | Günlük API çağrı kotası yayınlanmamış |
| **ShipEngine / ShipStation** | Evet | $0 plan, **sayısal kota yok** | Oran, etiket, takip, webhook | **Vergi/gümrük Advanced planda** — ücretsiz planda yok |
| **17TRACK** | Evet | 7 Oca 2026'dan sonra açılan hesaplar: **tek seferlik 200 takip no** (eski 100/ay kalktı) | Çok taşıyıcılı takip + webhook | **3 istek/sn** |
| **AfterShip** | Premium+ | Ücretsiz planda **API yok**; Premium $59/ay | Takip | 10 istek/sn |
| **DHL MyDHL** | DHL müşteri hesabı | **Test: 500 çağrı/gün** (üretim kotası yayınlanmamış) | Oran, etiket, takip, **vergiler dahil landed cost** | Landed cost **HS kodunu girdi olarak ister**, kendisi atamaz |
| **Zonos** | Evet | Ücretsiz katman yok | Landed cost, vergi, ithalat ücreti | **$2 + vergilerin %10'u / sipariş**; 300.000 puan kova, 3.000 puan/sn, hesap başına ~60 puan |
| **Avalara AvaTax** | Evet | **90 gün deneme: 1.000 işlem/gün**, 5 sipariş + 5 fatura/dk | Satış/KDV hesabı (gümrük değil) | Deneme sonrası ücretli |
| **TaxJar** | Evet | 30 gün deneme; ücretsiz API kotası doğrulanamadı | ABD satış vergisi | Ücretli planda 10.000 API çağrısı/dk |
| **Stripe Tax** | Evet | Ücretsiz kota yok | KDV/satış vergisi | **İşlem başına $0,50** |
| **TARIC** | Hayır | Kota yok — **Excel ham veri**, REST API doğrulanamadı | AB tarife nomenklatürü, vergi oranları, kotalar | Ürün tanımından kod **sınıflandırmaz** |
| **USITC HTS** | Hayır | **ÖLÇÜLDÜ: `reststop/exportList` JSON 200, ~10 KB** | ABD tarife satırları + oranlar | `search?keyword=` **boş dizi döndü** — anahtar kelime araması güvenilir değil, bölüm aralığıyla çek |
| **Airlift Tariff API** | Hayır | Kota yayınlanmamış (sayfa ÖLÇÜLDÜ 200) | HTS girdisinden vergi + MPF/HMF + landed cost | Ticari lisans/limit belirsiz; **kod sınıflandırmaz** |

**Sonuç:** ücretsiz, üretime hazır, ürün tanımından **HS kodu atayan** bir API bulunamadı.
Ücretsiz olan her şey ya tarife tablosu ya da kodu girdi olarak isteyen hesaplayıcı.
Bu yüzden landed-cost kapısı **kendi tarife tablomuzla** kurulmalı: `HTS/GTİP → oran` eşlemesi
+ VATcomply VAT + CJ kargo + pazaryeri komisyonu. Sipariş başına ücretli servis (Zonos,
Stripe Tax) ancak gerçek ödeme alındığında mantıklı.

### 12.2 Görsel ve marka

| Servis | Ücretsiz kota | Ne verir | Not |
| --- | --- | --- | --- |
| **Google Cloud Vision** | **1.000 birim/özellik/ay** | Etiket, nesne, logo, baskın renk, kırpma önerisi | Özellik başına ayrı sayaç |
| **AWS Rekognition** | İlk 12 ay **1.000 görsel/ay** (grup 1 ve 2 ayrı) | Etiket, metin, yüz, moderasyon | Image Properties ücretsiz değil |
| **Cloudflare Images** | **5.000 benzersiz dönüşüm/ay** | Yeniden boyutlandırma/CDN | Aynı dönüşüm tekrarı bir kez sayılır |
| **remove.bg** | **50 düşük çözünürlüklü API çağrısı/ay** | Arka plan silme | Tam çözünürlük ücretli |
| **Cloudinary** | **25 kredi/ay** | Dönüşüm (1 kredi ≈ 1.000) + depolama/bandwidth | Krediler paylaşılır |
| **imgix** | 30 gün deneme, 100 kredi | Dönüşüm + CDN | Kalıcı ücretsiz katman yok |
| **Logo.dev** | **500.000 logo CDN/ay**, 100 API isteği/dk, $5 API kredisi | Marka logosu | Ticari kullanımda **atıf** şartı |
| **Brandfetch** | **100 marka fetch (tek seferlik)**, 1M logo render/ay, 500K arama/ay | Marka varlıkları | Veriyi kendi API'n gibi yayınlamak yasak |
| fal.ai / Replicate / HF | **Düzenli ücretsiz kredi doğrulanamadı** (HF PRO $2/ay) | Model çıkarımı | Model bazlı deneme olabilir; plana girmez |

**Karar:** arka plan silme zaten `remove.bg` ile sınırlı; asıl kazanç **Logo.dev/Brandfetch**
(marka kimliği) ve **Cloudflare Images** (5.000 dönüşüm) — ikisi de mevcut görsel hattına
ek dosya gerektirir, yeni bağımlılık değil.

### 12.3 Çeviri (rapor/başlık normalizasyonu için)

| Servis | Ücretsiz kota | Not |
| --- | --- | --- |
| **MyMemory** | **5.000 karakter/gün** anonim, **50.000/gün** e-posta ile | ÖLÇÜLDÜ: 200 / 1,3 KB |
| **LibreTranslate (self-host)** | Sınırsız (kendi sunucun) | Kalite düşük; toplu normalizasyonda yeterli |
| **DeepL API Free** | **Doğrulanamadı** — 500.000 karakter/ay (eski) ile 1M karakter toplam (yeni Developer) çelişiyor, sayfa 403 | Hesap açılışında teyit et |
| **Google Cloud Translation** | 500.000 karakter/ay (resmî sayfa çekilemedi) | Doğrulanmadı |

### 12.4 Yorum / UGC

| Servis | Ücretsiz kota | Not |
| --- | --- | --- |
| **Judge.me** | Ücretsiz planda **sınırsız yorum**; API sayfa başına 100 | Yalnız mağazanın kendi verisi |
| **Yotpo** | **50 sipariş/ay**, 500 e-posta/ay | Ücretsiz planda API hakkı belirsiz |
| **Trustpilot** | 50 davet/ay (ücretsiz işletme) | **API ayrı modül**: 200K/1M/sınırsız çağrı-yıl |
| **Bazaarvoice** | Ücretsiz katman yok | Lisans şartı; 100 QPS |

**Karar:** üçüncü taraf yorum verisi ücretsiz ve meşru yoldan toplanamıyor. Doğru yol:
mevcut **WooCommerce** kaynağının `review_count` + `average_rating` alanları, Best Buy
`customerReviewAverage`, eBay `feedbackPercentage` — yani **satıcının kendi beyanı**.

### 12.5 Kotası doğrulanan / düzeltilen servisler

| Servis | Önceki durum | **Doğrulanan (resmî sayfa)** |
| --- | --- | --- |
| **OpenRouter** `:free` | "50/1.000 doğrulanamadı" | **50 istek/gün**, **$10 kredi alımı sonrası 1.000/gün**, **20/dk**; başarısız denemeler de sayılır |
| **Etsy Open API v3** | "uygulama kotası portalda" | Günlük kota **kayan 24 saat**; `150 QPS / 100.000 QPD` **örnek değer**, varsayılan değil |
| **Printify** | "token şart" | **600 istek/dk**, katalog uçları **100/dk**, ürün yayınlama **200/30 dk** |
| **Printful** | "anahtarsız katalog" | Katalog ÖLÇÜLDÜ (200 / 1,7 MB); limit **120/dk** (doğrulanmadı, doküman çıkarımı) |
| **Icecat** | "kota bulunamadı" | **Günlük kota yayınlanmamış**; API kılavuzu **100 istek/IP/sn** (50–70 önerilir); "Specs Icecat" atfı zorunlu, **AI eğitiminde kullanılamaz** |
| **Amazon Creators** | 8.640/gün | İlk 30 gün **1 TPS / 8.640 TPD**; sonrası **$0,05 başına 1 TPD**, 10 TPS tavanı; 30 gün satış yoksa erişim düşer |
| **CJ Dropshipping** | 50.000 puan/gün | Doğrulandı: **50.000 puan/gün** (00:00 UTC), Free seviye **1 istek/sn**, 30 gün işlem yoksa API askıya alınır |
| **UPCitemdb** | 100/40/6 | Doğrulandı: **100 birleşik istek/gün**, kayıt gerekmez; DEV 20.000 lookup + 2.000 arama/gün |
| **upc.dev** | yok | Ana sayfa: **100 lookup/gün, kalıcı ücretsiz** (sayfa ÖLÇÜLDÜ 200) |
| **Go-UPC** | yok | **150 istek/ay** deneme (manuel onay), 2 istek/sn |
| **EAN-Search** | yok | **Ücretsiz değil**: 100 sorgu/ay, ilk ay €1, sonra €9/ay |
| **GS1 Verified** | yok | **24 saatte 30 tek GTIN sorgusu** |
| **Open Food Facts** | 10 arama/dk | Doğrulandı: **15 ürün okuma/dk + 10 arama/dk**, IP başına; ODbL lisansı |

### 12.6 Bu turda canlı ölçülenler (2026-10-17, bu sandbox)

| Uç | Sonuç | Boyut | Yorum |
| --- | --- | --- | --- |
| OFF `/api/v2/product/3017620422003.json` | **200** | 426 B | Marka + kategori + ad tek yanıtta |
| MyMemory `get` | **200** | 1,3 KB | 5.000 karakter/gün |
| USITC HTS `reststop/exportList` | **200** | ~10 KB | **Anahtarsız tarife JSON'u** |
| USITC HTS `reststop/search?keyword=` | **200** | `[]` | Anahtar kelime araması boş — kullanma |
| Wikidata SPARQL | **200** | 200 B | Anahtarsız, UA ile |
| upc.dev ana sayfa | **200** | 124 KB | 100/gün iddiası doğrulandı |
| Airlift Tariff sayfası | **200** | 181 KB | Kota yayınlanmamış |
| Frankfurter `/v1/latest` | **200** | 84 B | Kur, anahtarsız |
| Printify katalog | **401** | 90 B | Token şart (beklenen) |

### 12.7 İkinci turun "ne ekleyelim" deltası

Mevcut §9 listesine **eklenen** maddeler (öncelik sırasıyla):

1. **USITC HTS JSON tablosunu indir** (anahtarsız, ÖLÇÜLDÜ) → `hsCode → dutyRate` yerel eşlemesi.
   Landed-cost kapısının eksik olan yarısı; CJ kargo + VATcomply VAT ile birleşince ücretsiz çalışır.
   *Dosya: yeni `src/data/hts-tariff.json` (üretilen), okuyucu `src/lib/landed-cost.ts`.*
2. **Marka logosu:** `logo.dev` (500K CDN/ay) veya `brandfetch` (1M render/ay) — görsel yuvası
   boş kalan adaylar için. *Env: `LOGO_DEV_TOKEN` (opsiyonel).*
3. **i18n/başlık normalizasyonu:** MyMemory (5.000 karakter/gün, anahtarsız) veya self-host
   LibreTranslate; DeepL'e para vermeden önce yeterli mi diye ölç.
4. **Takip katmanı ekleme:** 17TRACK ücretsiz 200 takip no ile başla; kalıcı ihtiyaç doğarsa
   Shippo 30 etiket/ay. **AfterShip ve Zonos'u ücretsiz sanıp plana koyma.**
5. **GS1 Verified (30 sorgu/24 saat) ve Go-UPC (150/ay) yalnız doğrulama için** — toplu
   zenginleştirme için değil. Toplu iş UPCitemdb 40 arama/gün + yerel GTIN cache ile yapılmalı.

**Eklemeyelim (bu turda kesinleşti):** TikTok Creative Center, Pinterest Trends, Amazon Movers
& Shakers ve Etsy bestseller sayfaları — hepsinin şartları otomatik toplamayı yasaklıyor ve
hiçbirinin yayınlanmış ücretsiz API kotası yok. Glimpse ve Exploding Topics **ücretsiz API
değil** (Exploding Topics 1.000 istek/ay için ~$1.000).

---

## 13. Kaynaklar

**Ürün/pazaryeri:** [eBay Browse](https://developer.ebay.com/api-docs/buy/static/api-browse.html) ·
[eBay buying access](https://developer.ebay.com/develop/get-started/get-started-on-a-buying-application) ·
[Etsy rate limits](https://developer.etsy.com/documentation/essentials/rate-limits/) ·
[Best Buy docs](https://bestbuyapis.github.io/api-documentation/) · [Best Buy terms](https://developer.bestbuy.com/legal) ·
[Amazon Creators](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/introduction) ·
[Shopify API terms](https://www.shopify.com/legal/api-terms)

**Talep/trend:** [Google Trends API](https://developers.google.com/search/apis/trends) ·
[pytrends](https://github.com/GeneralMills/pytrends) · [Reddit API facts](https://redditinc.com/news/apifacts) ·
[Reddit data terms](https://redditinc.com/policies/data-api-terms) · [Product Hunt](https://api.producthunt.com/v2/docs) ·
[TikTok terms](https://www.tiktok.com/legal/page/us/terms-of-service/en) ·
[Pinterest Trends](https://developers.pinterest.com/docs/analytics-and-reports/trends/) ·
[Indiegogo API](https://help.indiegogo.com/article/616-indiegogo-public-api)

**SERP:** [Serper](https://serper.dev/) · [SerpApi pricing](https://serpapi.com/pricing) · [Brave pricing](https://api-dashboard.search.brave.com/documentation/pricing) ·
[Tavily credits](https://docs.tavily.com/documentation/api-credits) · [Exa pricing](https://exa.ai/docs/admin/pricing) ·
[SearchApi](https://www.searchapi.io/pricing) · [DataForSEO trial](https://dataforseo.com/help-center/how-does-your-free-unlimited-trial-work) ·
[Bing retirement](https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement)

**Katalog:** [UPCitemdb](https://devs.upcitemdb.com/) · [UPCitemdb limits](https://www.upcitemdb.com/wp/docs/main/development/api-rate-limits/) ·
[WooCommerce Store API](https://developer.woocommerce.com/docs/store-api/) ·
[Shopify Ajax/products.json notu](https://shopify.dev/docs/api/ajax) ·
[Go-UPC](https://go-upc.com/docs) · [EAN-Search](https://www.ean-search.org/ean-database-api.html) ·
[Open Food Facts API](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/) ·
[Open Beauty Facts](https://world.openbeautyfacts.org/data) ·
[Icecat](https://icecat.com/structured-data-content-users/) · [Icecat fair use](https://iceclog.com/open-icecat-fair-use-policy/) ·
[Google taxonomy](https://support.google.com/merchants/answer/6324436) ·
[GS1 APIs](https://www.gs1us.org/tools/gs1-us-data-hub/gs1-us-apis) ·
[Keepa](https://keepa.com/api-docs/plans-tokens.html) ·
[Amazon Reviews'23](https://amazon-reviews-2023.github.io/)

**Tedarik:** [CJ product API](https://developers.cjdropshipping.com/en/api/api2/api/product.html) ·
[Awin feed şeması](https://help.awin.com/developers/docs/product-feed-publisher-guide-intro) ·
[Impact katalog alanları](https://help.impact.com/partner/what-would-you-like-to-learn-about/platform-features/marketing-content/product-marketplace-and-catalogs/download-product-catalogs-as-a-partner) ·
[CJ fees](https://www.cjdropshipping.com/service-fee) · [Printful API](https://www.printful.com/api) ·
[Printify](https://developers.printify.com/) · [Made-in-China terms](https://www.made-in-china.com/help/terms/) ·
[Alibaba API](https://developer.alibaba.com/docs/doc.htm?articleId=118416&docType=1&source=search&treeId=684)

**Ekonomi:** [Frankfurter](https://frankfurter.dev/) · [ECB Data API](https://data.ecb.europa.eu/help/api/data) ·
[VATcomply](https://api.vatcomply.com/vat_rates) · [Jina Reader](https://jina.ai/reader/) ·
[Shippo](https://goshippo.com/pricing/api) · [EasyPost](https://www.easypost.com/pricing/) ·
[ShipEngine](https://www.shipengine.com/pricing) · [TARIC](https://taxation-customs.ec.europa.eu/online-services/online-services-and-databases-customs/eu-customs-tariff-taric_en) ·
[USITC HTS](https://hts.usitc.gov/export) ·
[Triple Whale benchmarks](https://www.triplewhale.com/blog/facebook-ads-benchmarks)

**AI:** [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) · [Gemini terms](https://ai.google.dev/gemini-api/terms) ·
[Groq limits](https://console.groq.com/docs/rate-limits) · [Groq data](https://console.groq.com/docs/your-data) ·
[Cerebras](https://inference-docs.cerebras.ai/support/rate-limits) · [Cohere limits](https://docs.cohere.com/docs/rate-limits) ·
[GitHub Models retirement](https://docs.github.com/en/github-models) ·
[Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/) ·
[Cloudflare data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/) ·
[OpenRouter FAQ](https://openrouter.ai/docs/faq) · [SambaNova limits](https://docs.sambanova.ai/docs/en/models/rate-limits.md) ·
[HF pricing](https://huggingface.co/docs/inference-providers/pricing) ·
[Together billing change](https://support.together.ai/articles/1862638756-changes-to-free-tier-and-billing-july-2025) ·
[remove.bg API](https://www.remove.bg/api)

**Kota belgeleri (bu tur eklendi):** [UPCitemdb rate limits](https://www.upcitemdb.com/wp/docs/main/development/api-rate-limits/) ·
[Best Buy şartlar](https://developer.bestbuy.com/legal) · [eBay keyset limitleri](https://developer.ebay.com/support/knowledge-base/1359) ·
[Amazon Creators rates](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/concepts/api-rates) ·
[Etsy rate limits](https://developer.etsy.com/documentation/essentials/rate-limits) ·
[CJ puan kuralları](https://developers.cjdropshipping.com/en/api/api2/standard/points.html) ·
[Printify](https://developers.printify.com/) · [Impact rate limits](https://integrations.impact.com/brand-api-reference/readme/rate-limits) ·
[Wikimedia 2026 limitleri](https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits) ·
[HN Algolia API](https://hn.algolia.com/api) · [YouTube kota](https://developers.google.com/youtube/data/guides/quota_and_compliance_audits) ·
[Open Library limitleri](https://openlibrary.org/developers/api) · [Steam API şartları](https://steamcommunity.com/dev/apiterms) ·
[Tavily pricing](https://www.tavily.com/pricing) · [Serper](https://serper.dev/) · [Exa pricing](https://exa.ai/docs/admin/pricing) ·
[ZenRows pricing](https://docs.zenrows.com/first-steps/pricing) · [Bright Data free tier](https://docs.brightdata.com/general/account/billing-and-pricing/free-tier) ·
[Apify pricing](https://apify.com/pricing) · [Logo.dev pricing](https://www.logo.dev/pricing) ·
[Google CSE overview](https://developers.google.com/custom-search/v1/overview) ·
[Google Trends alpha duyurusu](https://developers.google.com/search/blog/2025/07/trends-api) ·
**İkinci tur kaynakları (kargo/vergi/görsel/çeviri/yorum):**
[Shippo API fiyat](https://goshippo.com/pricing/api) · [Shippo limitler](https://docs.goshippo.com/api-concepts/rate-limits) ·
[EasyPost fiyat](https://www.easypost.com/pricing/) · [ShipStation API fiyat](https://www.shipstation.com/shipping-api/pricing/) ·
[17TRACK API](https://api.17track.net/en/doc) · [AfterShip takip fiyat](https://www.aftership.com/pricing/tracking) ·
[DHL MyDHL API](https://developer.dhl.com/api-reference/dhl-express-mydhl-api) ·
[Zonos landed cost fiyat](https://zonos.com/docs/global-ecommerce/landed-cost/pricing) · [Zonos limitler](https://zonos.com/docs/supply-chain/rate-limiting) ·
[Avalara 90 gün deneme](https://developer.avalara.com/freeTrial) · [TaxJar fiyat](https://www.taxjar.com/pricing) ·
[Stripe Tax fiyat](https://stripe.com/tax/pricing) · [TARIC](https://taxation-customs.ec.europa.eu/online-services/online-services-and-databases-customs/eu-customs-tariff-taric_en) ·
[USITC HTS](https://hts.usitc.gov/) · [Airlift Tariff API](https://airliftusa.com/tools/tariff-api)

[Google Vision fiyat](https://cloud.google.com/vision/pricing) · [AWS Rekognition fiyat](https://aws.amazon.com/rekognition/pricing/) ·
[Cloudflare Images fiyat](https://developers.cloudflare.com/images/pricing/) · [remove.bg API](https://www.remove.bg/i/api) ·
[Cloudinary fiyat](https://cloudinary.com/pricing) · [Logo.dev fiyat](https://www.logo.dev/pricing) ·
[Brandfetch geliştirici fiyat](https://brandfetch.com/developers/pricing) · [Brandfetch şartlar](https://brandfetch.com/terms) ·
[Hugging Face çıkarım fiyat](https://huggingface.co/docs/inference-providers/en/pricing)

[MyMemory limitler](https://mymemory.translated.net/doc/usagelimits.php) · [LibreTranslate API](https://docs.libretranslate.com/guides/api_usage/) ·
[DeepL API planları (403)](https://support.deepl.com/hc/en-us/articles/360021200939-DeepL-API-plans) ·
[DeepL kullanım limitleri](https://developers.deepl.com/docs/resources/usage-limits) · [Google Translate fiyat](https://cloud.google.com/products/translate/pricing)

[Judge.me fiyat](https://judge.me/pricing) · [Judge.me API](https://judge.me/help/en/articles/8409180-using-judge-me-api) ·
[Yotpo ücretsiz plan](https://support.yotpo.com/docs/free-growth-plans-faq) · [Trustpilot fiyat](https://business.trustpilot.com/pricing) ·
[Trustpilot API modülü](https://developers.trustpilot.com/api-module-overview/) · [Bazaarvoice geliştirici](https://developers.bazaarvoice.com/)

[OpenRouter fiyat/limit](https://openrouter.ai/pricing) · [OpenRouter API limitleri](https://openrouter.ai/docs/api_reference/limits) ·
[Etsy rate limits](https://developer.etsy.com/documentation/essentials/rate-limits/) · [Printify API](https://developers.printify.com/) ·
[Printful doküman](https://developers.printful.com/docs/) · [Icecat API kılavuzu](https://iceclog.com/manual-how-to-import-product-content-into-your-webshop-via-icecat/) ·
[upc.dev](https://upc.dev/) · [Go-UPC deneme](https://go-upc.com/plans/api/trial) · [EAN-Search API](https://www.ean-search.org/ean-database-api.html) ·
[GS1 Verified sorgu limiti](https://support.gs1.org/support/solutions/articles/43000734075-how-many-queries-can-a-user-perform-using-the-verified-by-gs1-service-on-gs1-org-) ·
[Open Food Facts API](https://openfoodfacts.github.io/openfoodfacts-server/api/) · [Wikidata SPARQL limitleri](https://www.wikidata.org/wiki/Wikidata:SPARQL_query_service/query_limits) ·
[Exploding Topics API](https://explodingtopics.com/feature/et-api) · [Glimpse API](https://meetglimpse.com/google-trends-api/) ·
[TikTok şartlar](https://www.tiktok.com/legal/page/us/terms-of-service/en) · [Pinterest şartlar](https://policy.pinterest.com/en/terms-of-service) ·
[Amazon kullanım koşulları](https://www.amazon.com/gp/help/customer/display.html?nodeId=GX7NJQ4ZB8MHFRNJ)
