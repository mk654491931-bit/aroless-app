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

## 6. Doğrulama

```sh
npx tsc --noEmit
npx vitest run                                  # 132 dosya / 1800 test
PRODUCT_DISCOVERY_E2E_LIVE=1 \
  PRODUCT_DISCOVERY_E2E_NICHES="air fryer,robot vacuum" \
  npx vitest run src/lib/product-discovery.e2e.live.test.ts
```

Yeni testler: `src/lib/product-brand.test.ts`, `src/lib/product-catalog.test.ts`.
