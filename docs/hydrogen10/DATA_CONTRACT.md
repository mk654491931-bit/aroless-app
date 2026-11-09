# Hidrojen10 — Veri Sözleşmesi v1

> **Durum:** Uygulandı (kod). Migration dosyası `docs/hydrogen10/MIGRATION.sql`;
> kullanıcı SQL editöründe çalıştırana kadar canlı şemada tablolar yoktur.
>
> **Kapsam:** MVP — Pazar Laboratuvarı, ürün geçmişi, kaynak sağlığı,
> ham ingest arşivi.
> **Kararlar:** Global pazar, 24 saat cache, DB-first arama, manuel yenileme.

---

## 1. Amaç

Bu sözleşme, Hidrojen10’a veri veren her kaynağın, veritabanının, sunucu
fonksiyonlarının ve arayüzün **aynı veriyi aynı anlamda** kullanmasını sağlar.

Sözleşme şu soruları yanıtlar:

- Hangi alan zorunlu, hangisi opsiyonel?
- `null` ne demek, `0` ne demek?
- Fiyat hangi para biriminde ve nasıl saklanır?
- Veri ölçüldü mü, türetildi mi, tahmin mi edildi?
- Aynı niş nasıl tanımlanır?
- Cache ne zaman taze, ne zaman bayat sayılır?
- Kaynak çökerse kullanıcı ne görür?
- Hangi veri ne kadar saklanır, kim erişebilir?

Bu belge hukuki bir sözleşme değildir. Teknik veri sözleşmesidir.

---

## 2. Temel ilkeler

1. **Ölçülmeyen alan `null` kalır.** `0`, “ölçtüm ve sıfır buldum” demektir.
2. **Sessiz başarısızlık yoktur.** Çöken kaynak “sonuç yok” gibi gösterilmez.
3. **Her kazınan satır saklanır.** Filtreye takılan satır da gözlem olarak kalır.
4. **Geçmiş ezilmez.** Fiyat/stok/puan geçmişi append-only tutulur.
5. **Para birimi karışmaz.** Yerel fiyat ve USD karşılığı ayrı, kur zamanı ile saklanır.
6. **Aynı niş anahtarı tek kazıma üretir.** Filtre değişikliği kazıma başlatmaz.
7. **AI sayı üretmez.** Fiyat, stok, puan ve yorum sayısı yalnız kaynaktan gelir.
8. **Kaynak lisansı veri saklama kuralından önce gelir.**

---

## 3. Terimler

| Terim | Anlam |
|---|---|
| **Pazar** | Ülke + platform + yerel para birimi. Ör. `US + amazon + USD`. |
| **Platform filtresi** | `general` tüm kaynakları kabul eder; diğer seçimlerde yalnız kaynak/URL/satıcı/not kanıtı seçilen pazaryerini gösteren satırlar ürüne çevrilir. Eşleşmeyen satır yine `h10_ingest_rows` arşivine yazılır. |
| **Niş** | Normalize edilmiş arama sorgusu + pazar. Ör. `air fryer / US / amazon`. |
| **Run** | Bir niş için başlatılan tek kazıma işi. |
| **Source run** | Bir run içindeki tek kaynağın sonucu. |
| **Ürün** | Pazaryerinden bağımsız kanonik ürün kimliği. |
| **Teklif (offer)** | Bir ürünün bir kaynaktaki güncel fiyat/stok/puan durumu. |
| **Gözlem (observation)** | Her kazımada yazılan, değiştirilemez satır. |
| **Cache hit** | Aynı nişin DB’de taze kaydının bulunması; kazıma yapılmaması. |
| **Taze** | `lastScrapedAt + 24 saat > now`. |
| **Bayat** | Cache var ama 24 saat geçmiş; eski veri gösterilir, yenileme tetiklenir. |

---

## 4. Global pazar ve niş anahtarı

### 4.1 Anahtar

```text
v1|<normalize(query)>|<country>|<platform>|<currency>
```

Örnekler:

```text
v1|air fryer|US|amazon|USD
v1|air fryer|DE|amazon|EUR
v1|hava fritözü|TR|trendyol|TRY
```

`country` ISO 3166-1 alpha-2, `currency` ISO 4217’dir.

### 4.2 Anahtara girmeyenler

- Fiyat, puan, stok, yorum, marj filtreleri
- `topN`
- Arayüz dili
- Kullanıcı kimliği

Bu alanlar değişince DB’deki niş verisi yeniden filtrelenir; **yeni kazıma
başlatılmaz**.

### 4.3 Normalizasyon

- Unicode NFKC
- Baştaki/sondaki boşlukları temizle
- Ardışık boşlukları tek boşluğa indir
- Görünür noktalama işaretlerini kaldır
- Büyük/küçük harf katlaması pazar diline göre yapılır
- İlk sürümde otomatik eşanlamlı birleştirme **yoktur**

`airfryer` ve `air fryer` gibi güvenli eşleşmeler ileride yönetilen bir alias
tablosuyla eklenebilir. Yanlış cache, eksik cache’ten daha kötüdür.

### 4.4 Global kural

- Aynı sorgunun farklı ülkelerdeki sonucu ayrı niştir.
- Bir kaynak her ülkede çalışmıyorsa `not_configured` olur; “sonuç yok” sayılmaz.
- Aynı ürün farklı ülkelerde `h10_products` üzerinden birleşebilir; teklifler ayrıdır.
- Kaynak yapılandırılmış yerel fiyat sağlıyorsa korunur; sağlamıyorsa
  `priceLocalMinor` `null` kalır. USD karşılığı çekim anındaki kurla türetilir
  ve ayrı alanda tutulur.

---

## 5. Kaynak adaptörü sözleşmesi

Her kaynak aynı zarfı döndürür:

```json
{
  "source": "google_shopping",
  "status": "ok",
  "items": [],
  "invalidItems": 0,
  "latencyMs": 820,
  "fetchedAt": "2026-11-08T10:00:00.000Z",
  "error": null
}
```

### 5.1 Durumlar

| Durum | Anlam | `items` |
|---|---|---|
| `ok` | Kaynak çalıştı, en az bir geçerli satır var | > 0 |
| `no_results` | Kaynak çalıştı, eşleşme yok | 0 |
| `partial` | Bazı sayfalar/satırlar başarısız, yine de satır var | > 0 |
| `not_configured` | Anahtar/yapılandırma veya ülke desteği yok | 0 |
| `failed` | Ağ, kimlik doğrulama, engel veya ayrıştırma hatası | 0 |

`failed` ve `no_results` birbirine karıştırılmaz. `not_configured` bir hata
değildir; arayüzde ayrı gösterilir.

### 5.2 Kaynak politikası

Her kaynak kaydı şunları taşır:

- `cacheAllowed` — veri kalıcı saklanabilir mi?
- `retentionDays` — normalize veri ne kadar tutulur?
- `attributionRequired` — kaynak atfı gerekli mi?
- `enabled` — kaynak şu an kullanılabilir mi?

MVP’de kaynaklar `cacheAllowed = true` varsayılanıyla oluşturulur; alanlar
politika genişlemesi için hazırdır. Kaynak yasaklayıcı bir politika
tanımlarsa yazma katmanı bu kaynağı kalıcı cache’e almamalıdır; bu kontrol
Faz 2’de `h10_sources` okumasıyla etkinleştirilecektir.

### 5.3 Geçersiz satır

- `title` boşsa satır ürüne dönüştürülemez.
- Satır atılmazsa `invalidItems` sayılır; source run `partial` olur.
- Geçersiz satırın ham nedeni `h10_ingest_rows.rejection_reason` alanına yazılır.
- Geçersiz satır için sahte ürün kaydı üretilmez.

---

## 6. Ürün, teklif ve gözlem

### 6.1 Ürün kimliği

Sıra:

1. Doğrulanmış GTIN
2. Marka + MPN
3. Marka + model kodu
4. Tam normalize başlık + marka

Kurallar:

- Satıcı, ürün kimliğine girmez; satıcı teklif alanıdır.
- GTIN varsa kaynaklar arası birleştirme güvenlidir.
- Yalnızca başlık benzerliğiyle birleştirme yapılmaz.
- Şüpheli durumda ayrı ürün kaydı tercih edilir.
- Aynı ürün farklı nişlerde görünebilir; teklifler niş + kaynak bazlıdır.

### 6.2 Ürün alanları

| Alan | Tip | Null | Kural |
|---|---|---|---|
| `identityKey` | string | hayır | Benzersiz kimlik anahtarı |
| `title` | string | hayır | Boş olamaz |
| `brand` | string | boş olabilir | Uydurulmaz |
| `gtin` | string | evet | Varsa normalize edilir |
| `mpn` | string | evet | Varsa normalize edilir |
| `imageUrl` | string | boş olabilir | Kaynak görseli |
| `category` | string | boş olabilir | Kaynak kategorisi |

### 6.3 Teklif / gözlem alanları

MVP'de bir ürün + kaynak için tek güncel teklif tutulur. Çok satıcılı offer
listesi Faz 2'dir; bu yüzden `h10_offers` tekliliği
`(niche_id, product_id, source)` üçlüsüdür.

| Alan | Tip | Null | Kural |
|---|---|---|---|
| `source` | string | hayır | Sabit kaynak adı |
| `seller` | string | boş olabilir | Ürün kimliğine girmez |
| `priceLocalMinor` | bigint | evet | Kaynak yerel fiyatı yapılandırılmış verdiyse; USD pazarında dolar kuruşu |
| `currency` | string | hayır | ISO 4217 pazar para birimi |
| `priceUsd` | numeric | evet | Çekim anındaki kurla türetilir |
| `fxRate` | numeric | evet | Kaynak kur oranını yapılandırılmış verdiyse; yoksa `null` |
| `fxAt` | timestamp | evet | Kurun zamanı; yoksa `null` |
| `rating` | numeric | evet | 0–5; yoksa `null` |
| `ratingCount` | integer | evet | Yoksa `null` |
| `inStock` | boolean | evet | Bilinmiyorsa `null` |
| `sourceUrl` | string | boş olabilir | Kanıt adresi |
| `sourceItemId` | string | evet | Kaynağın kendi kimliği |
| `evidence` | enum | hayır | `measured / derived / estimated` |
| `observedAt` | timestamp | hayır | UTC çekim zamanı |

### 6.4 Para kuralı

- Para için kayan noktalı `float` kullanılmaz.
- Kaynak yapılandırılmış yerel fiyat veriyorsa ilgili para biriminin en küçük
  biriminde tam sayı saklanır; vermiyorsa `priceLocalMinor` `null` olur.
- USD karşılığı ayrı alandır; yerel fiyatın üzerine yazılmaz.
- Kaynak kur oranı/zamanı veriyorsa saklanır; vermiyorsa `null` kalır ve
  `priceUsd` yalnız çekim anındaki hesap olarak işaretlenir.
- `priceLocalMinor = 0` gerçekten sıfır fiyat demektir; bilinmeyen fiyat `null` olur.

### 6.5 Ölçüm türü

| Değer | Anlam | Örnek |
|---|---|---|
| `measured` | Doğrudan kaynaktan okundu | Fiyat, stok, puan |
| `derived` | Deterministik hesaplandı | USD karşılığı, birim normalizasyonu |
| `estimated` | Tahmin | Gelecekteki talep/satış tahmini |

Fiyat, stok, puan ve yorum sayısı **asla `estimated` olamaz**. AI bu alanları
doldurmaz.

### 6.6 Her kazınan veri

- `h10_ingest_rows` **her ham satırı** append-only saklar; ürünle eşleşmeyen,
  başlıksız veya normalize edilemeyen satırlar da `eligible = false` ve
  `rejectionReason` ile burada kalır.
- `h10_observations` ürünle eşleşen her satırı ayrıca append-only saklar.
- Her geçerli ham ürün satırı için bir gözlem yazılır.
- Filtreye takılan ürün satırları da yazılır; `eligible = false` ve
  `rejectionReason` taşır.
- Aynı veri tekrar gelse bile yeni `observedAt` kaydı oluşur.
- Ürün kaybolursa geçmiş silinmez; `lastSeenAt` güncellenir.
- `h10_offers` yalnız güncel, uygun teklifi temsil eder; geçmiş ve filtrelenen
  satırlar `h10_observations` / `h10_ingest_rows` içindedir.
- Kaynağı bu turda tamamlanmış (`ok` / `no_results` / `partial`) ama satırı
  artık dönmemiş teklifler güncel tablodan silinir. `failed` / `not_configured`
  kaynağın önceki teklifleri korunur.

---

## 7. Cache, tazelik ve hata davranışı

### 7.0 Niş durumları

| Durum | Anlam |
|---|---|
| `empty` | Henüz hiç run yok |
| `queued` | Run sırada |
| `scraping` | Kaynaklar çalışıyor |
| `ready` | En az bir kaynak başarılı; 0+ satır |
| `partial` | Bazı kaynaklar başarısız; veri var |
| `failed` | Hiçbir kaynak başarılı olmadı |

Tüm kaynaklar `not_configured` ise bu bir “hata” değil, kapsam yokluğudur;
arayüz bunu ayrıca söyler.

### 7.1 Tazelik

Varsayılan:

```text
freshUntil = lastScrapedAt + 24 saat
```

- `now < freshUntil` → **taze**: yalnız DB’den dön.
- `now >= freshUntil` → **bayat**: DB’den dön + yenileme kuyruğa al.
- Kayıt yok → **miss**: kazıma işi başlat.

### 7.2 API cevabı

Arayüz her zaman verinin kaynağını bilmelidir:

```json
{
  "dataSource": "db",
  "stale": false,
  "refreshing": false,
  "lastScrapedAt": "2026-11-08T10:00:00.000Z",
  "freshUntil": "2026-11-09T10:00:00.000Z",
  "nextRefreshAt": "2026-11-09T10:00:00.000Z",
  "sourceHealth": []
}
```

`dataSource`:

- `db` — DB’deki cache’ten geldi
- `live` — senkron ilk tarama veya manuel yenileme sonrası

`stale` ve `refreshing` birbirinden bağımsızdır.

### 7.3 Eşzamanlılık

- Bir niş için aynı anda **tek aktif run** olabilir.
- İkinci istek mevcut run’ı bekler veya DB’deki veriyi görür.
- QStash dedupe anahtarı ile çift mesaj engellenir.
- Aynı filtre kombinasyonu yeni run üretmez.

### 7.4 Kaynak hatası

- Bir kaynak çökerse önceki teklifler silinmez.
- `h10_source_runs` içinde `failed` kaydı açılır.
- Niş `partial` olabilir; kullanıcı satırları görmeye devam eder.
- Tüm kaynaklar çökerse `h10_niches.lastScrapedAt` ilerlemez; niş bayat kalır.
- Başarısız kaynak “0 sonuç” olarak gösterilmez.

### 7.5 Manuel yenileme

- Taze cache’te normal “Yenile” kazıma başlatmaz.
- Kullanıcı “Yine de yenile” derse kota/kredi kontrolü yapılır.
- Bayat cache’te “Yenile” arka plan işini başlatır.
- Aktif run varken yeni run başlatılamaz.

---

## 8. Saklama, erişim ve güvenlik

### 8.1 Saklama

- Normalize ürün/teklif/gözlem verisi kalıcıdır.
- Her ham **satır** (`h10_ingest_rows.raw`, JSONB) saklanır; ham HTML
  varsayılan olarak saklanmaz.
- Kaynak izin veriyorsa sıkıştırılmış ham yanıt opsiyonel saklanır.
- Kaynak başına `retentionDays` uygulanır.
- Eski gözlem/ingest satırları ileride aylık partition/arşiv ile yönetilir.

### 8.2 Erişim

- `h10_niches`, `h10_products`, `h10_offers`, `h10_observations`,
  `h10_ingest_rows`, `h10_runs`, `h10_source_runs`, `h10_sources` ortak cache
  tablolarıdır.
- Bu tablolara istemciden doğrudan yazma/okuma açılmaz; server function ve
  service role kullanılır.
- Watchlist ve alarmlar ileride `user_id` ile RLS korumalı olacaktır.
- Kullanıcıya ait hiçbir veri ortak cache tablolarına yazılmaz.

---

## 9. Sözleşme testleri

Her kaynak adaptörü için ortak fixture testleri:

- `source`, `status`, `items`, `fetchedAt` zarfı doğru mu?
- `failed` ile `no_results` ayrı mı?
- `priceLocalMinor` sayı mı, `null` mı?
- Bilinmeyen fiyat `0` olarak yazılıyor mu? **Olmamalı.**
- `currency` ISO 4217 mi?
- `rating` 0–5 dışında reddediliyor mu?
- `inStock` üç durumlu mu?
- Aynı niş anahtarı tek run üretiyor mu?
- Filtre değişikliği yeni kazıma başlatmıyor mu?
- 24 saat taze cache doğru mu?
- Kaynak çökünce önceki teklifler korunuyor mu?

Bu testler UI testi değil, **veri sözleşmesi testleridir**.

---

## 10. Sürümleme

- Sözleşme sürümü: `v1`.
- Alan eklemek geriye uyumludur.
- Alan silmek veya anlamını değiştirmek `v2` gerektirir.
- `schema_version` cache anahtarına girer; eski cache otomatik geçersizleşir.
- Yeni sürüm uygulanmadan önce migration + fixture testleri birlikte yazılır.

---

## 11. MVP kabul kriterleri

- Aynı niş + farklı filtre → **kazıma yok**, DB’den sonuç.
- 24 saat içindeki niş → **kazıma yok**.
- Bayat niş → eski sonuç hemen görünür, yenileme arka planda başlar.
- Tüm kaynaklar çökse bile önceki veri korunur.
- Her run’da kaynak sağlığı ve satır sayısı görünür.
- Her gözlem veritabanında append-only olarak durur.
- Global pazarda ülke/para birimi ayrı cache’lenir.
- “DB’den” ve “canlı” etiketi birbirine karışmaz.
