# Ürün bulucu — ücretsiz kaynaklarla kalite raporu

Ölçüm tarihi: 2026-10-15 · ortam: bu sandbox, canlı ağ · hedef: **null / "—"
gösteren alanları gerçek ölçümle doldurmak, uydurmadan**.

## 1. Ölçülen başlangıç durumu (canlı `runScrapeFilterStep`)

| Ölçüm | Değer |
| --- | --- |
| Ham satır → aday (air fryer / US) | 120 → 75 |
| Marka dolu aday | **0 / 75** |
| Kategori dolu aday | **0 / 75** |
| Ürün OLMAYAN kaynak satırı | **31 / 120** (hackernews 8, github 8, web-reviews 11, wikipedia 2, wikidata 1, google-news 1) |
| Ölçülmemiş alan için gösterilen işaret | `null` / `—` |

İki kök neden:

1. **Pazaryeri LİSTE sayfaları marka/kategori alanı yayınlamıyor.** AliExpress
   kart şeması ölçüldü (60 kart): `brand` alanı YOK. Hepsiburada/n11 satırlarında
   da yok → marka hep boş, `productModelKey` anahtarı hiç üretilmiyor.
2. **Ürün olmayan kaynaklar aday havuzuna giriyordu.** Ticari kanıt kapısı
   bunları yalnız "havuzda ≥5 ticari satır varsa" eliyordu; fiyat taşıyan bir
   Wikipedia/haber satırı kapıyı atlayıp ürün kartı olabiliyordu.

## 2. Eklenen/değişen katmanlar

| Dosya | Değişiklik |
| --- | --- |
| `src/lib/product-brand.ts` (yeni) | Başlıktan **yapısal** marka çıkarımı (`Brand: X` · model kodu öncesi öbek · `by X` · ilk öbek) + `plausibleBrand` + kelime sınırlı `titleMentionsBrand`. Uydurma yok: anlaşılmazsa `""` |
| `src/lib/product-catalog.server.ts` (yeni) | Anahtarsız ücretsiz ürün kataloğu (UPCitemdb `/prod/trial/search`): marka · model · GTIN · kategori · görsel · kayıtlı fiyat. Kimlik çapası zorunlu eşleştirme, marka doğrulama, 24 saat önbellek |
| `src/lib/product-discovery-filter.server.ts` | Kaynak kapısı (ürün olmayan kaynaklar aday olamaz) · marka yuvası yalnız **ölçülmüş** markayla dolar (`brandMeasured`) · `demand` yuvası artık yalnız SAYISAL talep alanları (satış adedi / görüntülenme / değerlendirme sayısı) · `image` bonus yuvası |
| `src/lib/product-discovery-pipeline.server.ts` | Marka çıkarımı + katalog zenginleştirmesi adımı, marka ağırlıklı katalog sorguları, ölçüm notları |
| `src/lib/scraper-quota.server.ts` | `allowCatalogCredit()` — katalog araması için **günlük** kova (varsayılan 16, tavan 20) |
| `src/lib/product-discovery-query.ts` | `isNonProductSource()` + eksik `wikipedia-pageviews` kaynağı listeye eklendi |
| `src/lib/product-discovery.types.ts` | `brandMeasured` alanı (türev ≠ ölçüm) |
| `src/features/finder/components/discovery-winner-card.tsx` | Talep hücresi: puan → satış adedi → görüntülenme (etiket değişir), hepsi yoksa `—` |

### Kapanan iki sessiz uydurma

1. `notes` içindeki HERHANGİ bir rakam (katalog fiyatı, tarih) "ölçülmüş talep"
   sayılıyordu. Artık yalnız sayısal talep alanları sayılır — aynı kavram
   `discovery-quality.ts` ile de aynı şekilde tanımlı.
2. Katalog eşleşmesi markayı adayın başlığıyla çapraz doğrulamıyordu. Ölçüldü:
   kayıt markası `"Air"` geldiğinde 17 adaya marka yazıldı (alt dizi eşleşmesi).
   Artık çapa KAYDIN markasıdır, kelime sınırıyla aranır ve marka `plausibleBrand`
   süzgecinden geçmeden kullanılmaz.

## 3. Ölçülen sonuç (canlı, aynı gün)

| Niş | Ham → aday | Marka | Kategori | Görsel | Fiyat | Satış |
| --- | --- | --- | --- | --- | --- | --- |
| air fryer / US | 53 → 21 | 6-12 (ölçülmüş 0-5) | 0-4 | 21/21 | 21/21 | 14/21 |
| robot vacuum / US | 44 → 10 | 7 (ölçülmüş 0-1) | 0 | 10/10 | 10/10 | 7/10 |

Uçtan uca (kazıma → 75 → 25 → 14 ajan → 5) süre: **~6,4 sn**; ortalama veri
bütünlüğü 72-76/100.

## 4. Kalan boşluklar ve SEBEPLERİ (uydurulmadı)

| Alan | Durum | Ölçülen sebep |
| --- | --- | --- |
| Marka | 6-12/21 | İlanların bir kısmı markayı hiç yayınlamıyor; katalog ücretsiz planı sorgu başına 5 kayıt döndürüyor |
| Kategori | 0-4/21 | Kategori yalnız kategori alanını yayınlayan kaynaklardan gelir; uydurma kategori yazılmaz |
| Değerlendirme sayısı | 0/21 | Bing Shopping bu ağdan kart döndürmüyor (`no shopping cards`); AliExpress kartı yalnız puan verir |
| Puan | 3/21 | Kaynakların çoğu puani sayı olarak yayınlamıyor (yıldızlar görsel) |
| Talep (yorum/satış) | anahtarsız kaynak YOK | Ek kaynak araştırması yapıldı: UPCitemdb şemasında puan/değerlendirme/satış alanı **yok** (yalnız kimlik + fiyat); Reddit `search.json` anahtarsız **403**; Google Trends anahtarsız uç noktası yok (API limited alpha); Keepa kategori/BSR verisini ücretli anahtarla verir; Amazon ürün sayfası "bought in past month" metnini HTML'de taşısa da bu bir sayfa kazımasıdır (kalıcı alan garantisi yok, `/product-reviews/` robots.txt'te kapalı) — bu yüzden **eklenmedi**. Best Buy ücretsiz anahtarı gerçek `customerReviewCount/customerReviewAverage` verir; anahtar girilmediği sürece bu yuva boş kalır |

Bu alanlar için **hile yapılmadı**: 0 yazmak "ölçtük ve sıfır bulduk" demek
olurdu. Kartlar `—` gösterir ve gerekçe `missingFields` ile taşınır.

## 5. Ücretsiz kaynak sınırları (ölçüldü)

| Kaynak | Limit | Ölçüm notu |
| --- | --- | --- |
| UPCitemdb `/prod/trial` | günde 100 istek / 20 arama; **2 arama / 30 sn patlama** | 3. ardışık istek `429` döndü → koşu başına en fazla 2 sorgu, yanıt 24 saat önbellekte |
| MercadoLibre herkese açık arama | — | Her pazar için `403` (eklenmedi) |
| Google Books | — | `429` (eklenmedi) |
| Open Food Facts | ücretsiz | Bu koşuda `503`; kaynak fail-soft, hat düşmez |
| Wikipedia görüntülenme | anahtarsız | 300-560 ms, gerçek sayı; talep bağlamı için kullanılır |
| **Slickdeals arama RSS'i** (`deal-feed`) | yayınlanmış sayı yok → günde 60 okuma (nezakat bütçesi) | HTTP 200, ~69 KB, 25 öğe, ~600 ms; anahtar/bot duvarı YOK |
| **Best Buy API** (ücretsiz anahtar) | günde ~50.000 çağrı | Anahtar yokken 0 ağ çağrısı; ABD/CA'da kategori + GERÇEK puan + değerlendirme sayısı |
| Stack Exchange | anahtarsız 300 istek/gün | API 200 ama tüketici nişleri başlıkta yok → ürün katkısı ölçülemedi, eklenmedi |
| Indiegogo proje API'si | anahtarsız | 200 ama `query` parametresi yok sayılıyor (224 sabit proje) → eklenmedi |
| Target RedSky | — | `435` PerimeterX bot duvarı (eklenmedi) |
| dealnews RSS / bensbargains RSS | — | `404` / `403` (eklenmedi) |
| Open Products/Beauty Facts | anahtarsız | 200 ama `brands` çoğu kayıtta boş → marka boşluğunu kapatmıyor (eklenmedi) |

## 5b. `deal-feed` kaynağının ÖLÇÜLEN katkısı (2026-10-16)

Aynı ağ koşusunda kaynak VAR / YOK çalıştırıldı (`PRODUCT_DISCOVERY_AB=1`,
ülke US, 9 sn dilim). Ölçüm canlı test olarak repoda durur:
`src/lib/product-discovery-dealfeed-ab.live.test.ts`.

| Niş | Ham satır | Aday | Fiyatlı | Markalı | ≥4/5 kanıt |
| --- | --- | --- | --- | --- | --- |
| air fryer | 51 → 64 | 22 → **34** | 22 → 34 | 5 → 8 | 21 → 33 |
| robot vacuum | 44 → 68 | 19 → **31** | 19 → 31 | 11 → 15 | 16 → 26 |

Yorum: aday havuzu %55-63 büyüdü ve **her yeni satır gerçek fiyat taşıyor**
(fiyatlı satır sayısı aday sayısına eşit). Kaynak ~1,0-1,4 sn'de dönüyor;
kaynak hata verirse `ok:false` raporlanır ve hat düşmez (fail-soft sözleşmesi).

## 5c. İkinci tedarik kaynağı: `made-in-china` (anahtarsız) — 2026-10-16

### Ölçülen boşluk (eski durum)

Tek tedarik kaynağı AliExpress'ti ve üç yuvayı **hiç** ölçemiyordu:

| Yuva | Neden ölçülemiyordu | Neden önemli |
| --- | --- | --- |
| **MOQ** (minimum sipariş) | Perakende kartı MOQ taşımaz | “Bu ürünü bugün atabilir miyim?” sorusunun cevabı |
| **Tedarikçi kimliği** | Kart mağaza adını yalnız SPONSORLU kartlarda veriyor (ölçüldü: 60 kartın 10'u) | Kimden alınacağı bilinmiyor |
| **FOB fiyat bandı** | Perakende kartta tek fiyat var | Toptan ilanda fiyat miktar kademesine göre ARALIK yazılır |

### Çalışan yol ve ölçüm

`https://www.made-in-china.com/products-search/hot-china-products/<terim>.html`
→ HTTP 200, ~1,1-1,35 MB, **0,57-0,87 sn**. Aynı gün ölçülüp ÇALIŞMAYAN yol:
`m.made-in-china.com` (mobil arama kart şeması farklı).

**YOL DEĞİŞİKLİĞİNİN SEBEBİ ÖLÇÜLDÜ — VE YASAKLI YOL DEĞİŞTİRİLMEDEN ÖNCE
KULLANILIYORDU.** `made-in-china.com/robots.txt` şu satırları yayınlıyor:

```text
User-agent: *
User-agent: AdsBot-Google
User-agent: AdsBot-Google-Mobile
Disallow: /*.do$
Disallow: /*.do?
…
User-agent: *
Disallow: /*html?*
```

(İki ayrı `User-agent: *` grubu vardır; ikisi de bizi bağlar.) Bir üçüncü grup
`/products-search/hot-china-products/*` yolunu **yalnız Baiduspider** için
kapatır — bot adımız Baiduspider olmadığı için o kural bizi bağlamaz; ayrıca
AI botları grubu `/products-search/` yolunu açıkça `Allow` ediyor. Kullanılan
adreste **sorgu dizesi yoktur** ve bu bilinçlidir: `/*html?*` kuralı
`.html?…` biçimini yasaklıyor, `…<Slug>.html`i değil.

Eski adres `productdirectory.do?word=…` idi, yani **robots.txt'in açıkça
kapatmadığı bir yol kullanılıyordu**. İki yol aynı gün yan yana ölçüldü:

| Ölçüm (air fryer, aynı gün) | `productdirectory.do?` (yasaklı) | `products-search/hot-china-products` (izinli) |
| --- | --- | --- |
| Kart | 37 | **41** |
| FOB fiyatlı | 37 | **41 (%100)** |
| MOQ ölçülen | 23 | **31** |
| Tedarikçi adı | 22 | **31** |

İzinli yol YASAKLI yoldan daha zengin çıktı, yani uyumlu davranmak burada bir
kayıp değil kazanç. Ayrıca **dürüst bot User-Agent**
(`<ürün> (+https://<domain>; bot@<domain>)`) aynı içeriği döndürdü: kimliği
gizlemek gerekmiyor.

| Niş | Teklif | FOB fiyatlı | FOB aralığı | MOQ | Tedarikçi adı | medyan FOB | medyan MOQ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| air fryer | 30 | 30 (%100) | 23 | 30 | 30 | $20,37 | 500 |
| led desk lamp | 30 | 30 (%100) | 22 | 30 | 30 | $7,34 | 100 |
| pet water fountain | 30 | 30 (%100) | 14 | 30 | 30 | $15,23 | 100 |
| yoga mat | 30 | 29 (%97) | 26 | 30 | 30 | $4,99 | 100 |

Yani tedarikçi adı kapsamı AliExpress'in 10/60'ından **30/30**'a, MOQ kapsamı
0'dan **%97-100**'e çıktı.

### İki kart şeması AYNI ayrıştırıcıda

| Şema | İşaret | Ölçüldü |
| --- | --- | --- |
| A | `<div class="list-node">` + `<h2 class="product-name" title=…>` + `<span class="price_hint"> (MOQ)` | Arama sonuç listesi (30 kart) |
| B | `<a class="prod-item">` + `<a class="prod-name" title=…>` | Sayfa içi vitrin şeridi |

Ölçülen iki ayrıştırma hatası ve düzeltmeleri:

1. **Tek şemaya bağlanmak kaynağı tümden susturdu.** İlk sürüm `prod-item`
   sınırında bölüyordu; `led desk lamp`/`wireless earbuds` sorgularında **0 kart**
   döndü çünkü sayfa şema A ile gelmişti. Artık iki sınır da taranır; ayrıca iç
   kap `list-node-content` dışlanır (`\b` sınırı onu da yakalıyordu ve 2 kartlık
   sayfa 3 blok üretiyordu, yani kartlar ortadan bölünüyordu).
2. **6 KB blok sınırı kartın KUYRUĞUNU kesiyordu.** `list-node` kartı ~37 KB;
   kesme yüzünden 30 kartın yalnız **12**'sinde tedarikçi adı okunuyordu. Sınır
   60 KB'a alındı → **30/30** (aynı sayfa, üç ardışık koşuda doğrulandı).

### MOQ neden yalnız `(MOQ)` ipucuyla kabul edilir

Aynı sayfa “`50000pieces/Year`” gibi **yıllık kapasite** yazar. O sayıyı minimum
sipariş sanmak kullanıcıya yanlış sermaye rakamı gösterirdi. Ayrıştırıcı MOQ'yu
yalnız arkasında `<span class="price_hint"> (MOQ)` ipucu olan satırdan okur;
yoksa `null` kalır (0 yazılmaz).

## 5d. Lansman kapısı — ölçülen kanıttan “atılabilir mi?” kararı

`src/lib/launch-readiness.ts` (saf fonksiyon) **yedi** kapıyı ölçer; ölçülmemiş
kapı `unknown`dır ve **asla `pass` sayılmaz**:

| Kapı | Ölçüm | Politika eşiği |
| --- | --- | --- |
| Tedarik | **Birebir** ürün teklifi (niş bandı birebir SAYILMAZ) | — |
| İlk sipariş | MOQ × FOB (aralıkta KONSERVATİF üst uç) | ≤ $1.500 |
| Satış fiyatı | Ölçülen perakende fiyat | ≥ $15 |
| Brüt marj | Ölçülen toptan − perakende | ≥ **%60** (kargo/komisyon öncesi) |
| Reklam bütçesi | Sipariş başına katkı (perakende − toptan) | ≥ **$35** (ölçülen medyan CPA $38,99) |
| Rakip yoğunluğu | Aynı havuzda ayırt edici kelimelerin ≥2/3'ünü paylaşan satır sayısı | ≤ 12 |
| Mevzuat/IP | Başlıkta yasaklı kategori sözlüğü (VETO yönlü) | kelime yok |

`launchable` = hiç `fail` yok **ve** tedarik · fiyat · marj · reklam bütçesi
ÖLÇÜLMÜŞ ve geçmiş. Canlı ölçüm (`MIC_LIVE=1 MIC_LIVE_NICHES="…" npx vitest run
mic-supplier.live`, perakende = 3 × medyan FOB varsayımı):

| Niş | Karar | Ölçülen sebep |
| --- | --- | --- |
| air fryer | ❌ Atılamaz | katkı $22,31 < $35 |
| led desk lamp | ❌ Atılamaz | katkı $20,03 < $35 |
| pet water fountain | ✅ Atılabilir | 5/7 kapı · ilk sipariş ≈ $160 (2 kapı ölçülmedi) |
| yoga mat | ❌ Atılamaz | fiyat $14,97 < $15 · katkı $9,97 < $35 |

### 5e. ÖLÇÜLÜP DÜZELTİLEN karar hatası: niş bandı (proxy) “atılabilir” sayılıyordu

Uçtan uca canlı koşuda (air fryer, 2026-10-16) ölçülen tablo: 30 adayın 29'u
tedarik kanıtı buldu, ama bunların **12'si yalnız niş bandıyla** fiyatlanmıştı
(yani bu ürünün kendi toptan teklifi YOK) ve eski kod onları da "atılabilir"
sayıyordu → **4/30**. Araştırma bunu açıkça hatalı buluyor: bir kategori/niş
medyanı ürünün maliyeti yerine konmaz; go/no-go kararı ürünün KENDİ teklifini
ister (AutoDS sourcing dokümanı "benzer (aynı değil)" sonuçları için karşılaştırma
ister; Alibaba RFQ akışı tam da bu yüzden vardır).

Düzeltme üç parçalı ve hepsi ölçülebilir:

1. `launch-readiness.ts` girdisine `supplierMatchKind` eklendi; `"niche"`
   geldiğinde **tedarik kapısı `unknown`** olur (değer "… çevresi (niş bandı)",
   detay "bu bir PROXY'dir") ve `launchable` olamaz.
2. İlk sipariş kapısı proxy'de açıkça yazar: "MOQ ve fiyat aynı nişteki bir
   tedarikçiden ölçüldü — bu ürünün kendi teklifi değil."
3. Niş havuzunda MOQ/FOB aralığı artık havuzun İLK teklifinden değil **en
   başlatılabilir** teklifinden alınır (deterministik; MOQ teklife özel bir alan,
   havuz medyanı onu taşımaz). Ölçülen etki: adım notunda MOQ ölçülen ürün sayısı
   5 → **19**.

Canlı yeniden ölçüm (aynı niş, aynı gün): "atılabilir" **4/30 → 2/30**; notlarda
`Tedarik proxy'si: 12 aday yalnız NİŞ bandıyla fiyatlandı … "atılabilir"
SAYILMAZ` satırı görünür. Ayrıca notu yanlış olan bir cümle düzeltildi: eski
metin "ilk sipariş sermayesi ölçüldü" diyordu ama karar kuralı MOQ'u hiç aramaz
(ölçülen örneklerde kapı `unknown`du) — yeni metin hangi dört ölçümün karara
girdiğini adıyla yazıyor.

Karar sunucuda üretilir (kohort rekabet sayısı yalnız orada bilinir), ürünle
birlikte taşınır (`launch`, `cohortCompetitors`) ve kartta kapı kapı gösterilir.
Sıralamaya **ek** bir bonus olarak girer (`WINNER_LAUNCH_BONUS = 6`): mevcut
ağırlıklar (`0.85/0.10/0.05`) değiştirilmedi, bonus kanıtı olmayan üründe 0'dır.

## 6. Doğrulama

```sh
npx tsc --noEmit
npx vitest run                                  # 137 dosya / 1887 test
PRODUCT_DISCOVERY_E2E_LIVE=1 \
  PRODUCT_DISCOVERY_E2E_NICHES="air fryer,robot vacuum" \
  npx vitest run src/lib/product-discovery.e2e.live.test.ts
MIC_LIVE=1 MIC_LIVE_NICHES="air fryer,yoga mat" \
  npx vitest run src/lib/mic-supplier.live.test.ts   # toptan kaynak + lansman kararı
```

> Not: tam proje `npx tsc --noEmit` bu sandbox'ın 180 sn'lik komut tavanını
> aşıyor. Bu turda düzenlenen dosyalar dar bir geçici tsconfig ile ayrıca
> doğrulandı (`tsc -p tsconfig.check.json` → 0 hata); tam proje tip kontrolü
> platformun kendi `tsc -b --noEmit` adımında koşar.

Yeni testler: `src/lib/product-brand.test.ts`, `src/lib/product-catalog.test.ts`,
`src/lib/product-discovery-deal-feed.test.ts` (10 test: fiyat/görsel/satıcı/oy
ölçümü, puan `null` dürüstlüğü, niş ve ABD süzgeçleri),
`src/lib/product-discovery-dealfeed-ab.live.test.ts` (canlı A/B ölçümü),
`src/lib/reader-source-matrix.test.ts` (Best Buy kategori alanı eklendi),
`src/lib/mic-supplier.test.ts` (12 test: iki kart şeması, MOQ'nun yıllık
kapasiteyle karışmaması, tekilleştirme, boş nişte ağa çıkmama),
`src/lib/launch-readiness.test.ts` (25 test: eşikler, konservatif FOB ucu, mevzuat
vetosu, **niş-proxy'nin "atılabilir" sayılmaması** ve “ölçülmeyen kapı pass/fail
olmaz” sözleşmesi),
`src/lib/supplier-economics.test.ts` (37 test: eşleştirme eşiği, fiyat akıl
kontrolü, başlatılabilir tedarikçi seçimi, **niş havuzunda MOQ'nun en
başlatılabilir tekliften alınması**, eski kayıt uyumluluğu),
`src/lib/product-discovery-launch.wiring.test.ts` (11 test: kaynağın hatta bağlı
olduğu, kararın zod katmanlarından düşmediği, `supplierMatchKind`ın bağlandığı).
