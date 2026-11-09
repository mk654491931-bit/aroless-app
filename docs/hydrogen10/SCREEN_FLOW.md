# Hidrojen10 — MVP Ekran Akışı

> **Durum:** Uygulandı. Route: `src/routes/hidrojen10.tsx`.
> Migration: `docs/hydrogen10/MIGRATION.sql` (kullanıcı SQL editöründe çalıştırır).
> **Kapsam:** Pazar Laboratuvarı + ürün geçmişi + kaynak sağlığı.
> **Kararlar:** Global pazar, 24 saat cache, DB-first arama, manuel yenileme.

---

## 1. Ürün konumu

Hidrojen10 ayrı bir ürün veya landing page değildir. Aroless içinde,
**E-Com News Explainer** grubunun altında duran bir modüldür.

```text
📰 E-Com News Explainer
   🎯 News & AI Explainer        /news
   ⚛ Hidrojen10                  /hidrojen10   [BETA]
```

- Ayrı pazarlama sayfası yok.
- Ayrı fiyatlandırma sayfası yok.
- `/news` ile aynı **PRO erişim kapısı** kullanılır.
- Sidebar daraltıldığında Hidrojen10’un görünmesi için `news` grubunun
  collapsed davranışı düzeltilir. Global sidebar davranışı değiştirilmez.

---

## 2. Sayfa yapısı

### Rota

```text
/hidrojen10
```

Örnek URL durumu:

```text
/hidrojen10?q=air%20fryer&country=US&platform=amazon
```

- Arama, ülke ve platform URL’de tutulur; paylaşılabilir.
- Filtreler de URL’de tutulabilir; fakat filtre değişikliği **kazıma
  başlatmaz**.
- Sayfa yenilendiğinde aynı niş DB’den gelir.

### Üst bölüm

```text
┌────────────────────────────────────────────────────────────────────┐
│ ⚛ Hidrojen10   [BETA]                         [DB-first] [•]      │
│ Global pazar istihbaratı — kanıtlı, tazeliği ölçülen ürün verisi   │
├────────────────────────────────────────────────────────────────────┤
│ [ air fryer................................ ] [US ▾] [Amazon ▾] [Ara] │
│ 24 saat cache · aynı nişte kazıma yapılmaz                         │
└────────────────────────────────────────────────────────────────────┘
```

### Sekmeler

```text
[ Pazar Laboratuvarı ]  [ Veri Sağlığı ]
```

- **Pazar Laboratuvarı:** arama, filtreler, sonuç tablosu.
- **Veri Sağlığı:** kaynak durumları, son run’lar, cache bilgisi.
- Ürün geçmişi ayrı sekme değil; ürün detay drawer’ı içinde.
- Watchlist, alarm, keyword ve reverse ASIN MVP’de yok.

---

## 3. Pazar Laboratuvarı

### 3.1 Arama alanı

| Alan | Davranış |
|---|---|
| Arama kutusu | Niş, ASIN veya URL |
| Ülke | Global pazar seçimi; ISO ülke |
| Platform | `General`, `Amazon`, `Walmart`, `Trendyol`, `eBay`… |
| Ara | Yeni niş anahtarı hesaplar |

Kurallar:

- Aynı sorgu + ülke + platform = aynı niş.
- Aynı niş tekrar aranırsa DB’den gelir.
- Ülke/platform değişirse yeni niş açılır; bu açıkça gösterilir.
- Boş sorgu gönderilmez.

### 3.2 Cache durum satırı

Sonuçların üstünde her zaman görünür:

```text
● Veritabanı · 2 saat önce güncellendi · 24 saat cache
```

Durumlar:

| Durum | Görünüm |
|---|---|
| Taze | `DB · 2 sa önce` — yeşil nokta |
| Bayat | `DB · 26 sa önce · yenileniyor` — sarı nokta |
| Miss | `İlk tarama başlatıldı` — mavi nokta |
| Kısmi hata | `3/4 kaynak çalıştı · 1 kaynak hatalı` — sarı |
| Tümü hatalı | `Kaynaklar yanıt vermedi · eski veri korunuyor` — kırmızı |

Bu satırda “canlı” yazmak için gerçekten canlı çekim olmalıdır. DB’den gelen
bayat veri “canlı” olarak etiketlenmez.

### 3.3 Filtre çubuğu

Örnek:

```text
Fiyat [min] – [max]   Puan [4.0+]   Yorum [100+]   Stok [Var ▾]   Kaynak [Tümü ▾]
```

- Filtreler DB’deki niş verisine uygulanır.
- Filtre değişince yeni kazıma başlamaz.
- Filtre sonucu boşsa “bu filtrelerde sonuç yok” denir; “nişte ürün yok”
  denmez.
- Aktif filtreler chip olarak gösterilir; “Temizle” vardır.

### 3.4 Sonuç tablosu

Kolonlar:

| Kolon | İçerik |
|---|---|
| Ürün | Görsel + başlık + marka |
| Fiyat | Yerel fiyat; altında USD karşılığı |
| Puan | Yıldız + puan |
| Yorum | Yorum sayısı |
| Stok | Var / Yok / Bilinmiyor |
| Kaynak | Kaynak chip’leri |
| Tazelik | `2 sa`, `1 gün` |
| Kanıt | Ölçüldü / türetildi |
| İşlem | Detay |

Kurallar:

- `Bilinmiyor` ile `0` farklı gösterilir.
- Kaynak chip’leri tıklanabilir; kaynak URL’sine gider.
- Fiyat `null` ise `—` gösterilir, `0` gösterilmez.
- Aynı ürünün birden fazla kaynağı varsa tek satırda birleşir; detayda
  kaynak bazlı teklifler görünür.
- Ürün kimliği belirsizse satırlar ayrı kalır; zorla birleştirilmez.

### 3.5 Boş durum

```text
Bu niş ilk kez taranıyor.

Kaynaklar çalışıyor: Google Shopping · Tavily · Trendyol
Sonuçlar hazır olduğunda otomatik görünecek.
```

- Sahte iskelet ürün gösterilmez.
- Kaynak bazlı ilerleme gösterilir.
- Kullanıcı sayfadan ayrılsa bile iş devam eder; döndüğünde DB’den sonuç görür.

### 3.6 Hata durumu

```text
Kaynaklar şu an yanıt vermiyor.

Google Shopping: zaman aşımı
Tavily: tamam
Trendyol: yapılandırılmadı

Önceki veriler korunuyor. [Tekrar dene] [Kaynak sağlığı]
```

- “Sonuç yok” denmez; kaynak hatası ayrı gösterilir.
- Önceki teklifler varsa gösterilmeye devam eder.
- Tekrar dene, aktif run varsa yeni run açmaz.

---

## 4. Ürün detayı

Satıra tıklanınca sağdan drawer açılır. Mobilde tam ekran sheet olur.

### 4.1 Üst kısım

- Ürün görseli, başlığı, markası
- GTIN / MPN / kimlik anahtarı
- Kaynak sayısı
- “Ürün geçmişi” etiketi

### 4.2 Fiyat ve stok geçmişi

```text
Fiyat geçmişi
  ^
  │        ╭─╮
  │   ╭────╯ ╰──╮
  │───╯         ╰────
  └──────────────────→ zaman
```

- Zaman aralığı: 7 / 30 / 90 gün.
- Her noktada kaynak ve çekim zamanı.
- Kur değişimi varsa USD karşılığı ayrı gösterilir.
- Geçmiş veri yoksa “henüz yeterli gözlem yok” denir.

### 4.3 Kaynak bazlı teklifler

| Kaynak | Fiyat | Stok | Puan | Son görülme | Kanıt |
|---|---|---|---|---|---|
| Google Shopping | $79.99 | Var | 4.6 | 2 sa | Ölçüldü |
| Trendyol | ₺2.499 | Bilinmiyor | 4.3 | 2 sa | Ölçüldü |

- Aynı ürünün farklı pazaryerleri ayrı satır.
- Kaynak URL’si kanıt olarak açılır.
- `estimated` etiketi varsa tooltip’te açıklanır.

### 4.4 Veri kalitesi

- Kaç alan ölçüldü?
- Hangi alan eksik?
- Kaynaklar arasında çelişki var mı?
- Fiyatlar arasındaki fark ne kadar?

Örnek:

```text
Fiyat: 2/2 kaynakta ölçüldü
Puan: 1/2 kaynakta ölçüldü
Stok: 1/2 kaynakta ölçüldü
Çelişki: Trendyol fiyatı Google Shopping’dan %18 yüksek
```

---

## 5. Veri Sağlığı sekmesi

### 5.1 Kaynak kartları

Her kaynak için:

```text
Google Shopping                    ● Çalışıyor
Son başarı: 2 saat önce
Bu niş: 38 satır · 820 ms
Anahtar: yapılandırılmış
```

Durumlar:

- `Çalışıyor` — `ok`
- `Sonuç yok` — `no_results`
- `Kısmi` — `partial`
- `Yapılandırılmadı` — `not_configured`
- `Hata` — `failed`

`Yapılandırılmadı` ile `Hata` aynı renkte gösterilmez.

### 5.2 Son run’lar

| Zaman | Kaynak | Durum | Satır | Süre | Hata |
|---|---|---|---|---|---|
| 10:00 | Google Shopping | Çalışıyor | 38 | 820 ms | — |
| 10:00 | Tavily | Kısmi | 12 | 1.4 s | 2 sayfa zaman aşımı |
| 10:00 | eBay | Yapılandırılmadı | 0 | — | Anahtar yok |

### 5.3 Cache özeti

- Toplam niş sayısı
- Taze / bayat / hiç taranmamış
- Ortalama DB yanıt süresi
- Cache isabet oranı
- Son 24 saatte açılan run sayısı
- Kaynak başına hata oranı

Bu ekran, “Helium 10 kadar iyi mi?” sorusunun ölçüm panelidir; süs değil.

---

## 6. Global pazar davranışı

### Ülke değişimi

- Ülke değişince niş anahtarı değişir.
- Yeni ülke cache’i yoksa ilk tarama başlar.
- Eski ülkenin sonuçları yeni ülkeye karışmaz.
- Para birimi ülkeye göre belirlenir.

### Para gösterimi

```text
₺2.499
≈ $73.20 · kur 08.11.2026 10:00
```

- Yerel fiyat ana veridir.
- USD karşılığı türetilmiş veridir.
- Kur zamanı her zaman görünür.
- Geçmiş fiyat, bugünkü kurla yeniden yazılmaz.

### Kaynak kapsamı

Bir kaynak seçili ülkede yoksa:

```text
eBay bu pazarda yapılandırılmadı.
Diğer kaynaklardan gelen sonuçlar gösteriliyor.
```

Bu durum “0 ürün” olarak yorumlanmaz.

---

## 7. Yenileme akışı

### Taze cache

```text
[Yenile] pasif
"24 saat içinde güncellendi. Yine de yenilemek için tıkla."
```

- Normal tıklama kazıma başlatmaz.
- “Yine de yenile” dialog’u kota/kredi uyarısı gösterir.

### Bayat cache

```text
"Veri 26 saat önce güncellendi. Arka planda yenileniyor."
[Yenile]
```

- Eski veri hemen görünür.
- Yenileme arka planda başlar.
- Aktif run varsa ikinci run açılmaz.

### Cache miss

```text
"Bu niş veritabanında yok. İlk tarama başlatılıyor."
```

- Run oluşturulur.
- İlerleme kaynak bazında gösterilir.
- Sayfa yenilenirse aynı run’a bağlanılır.

### Manuel yenileme dialog’u

```text
Bu niş 2 saat önce güncellendi.

Yine de yenilemek istiyor musun?
Bu işlem kota/kredi kullanabilir.

[Vazgeç] [Yine de yenile]
```

---

## 8. Durum matrisi

| Durum | Veri gösterilir | Kazıma | Buton |
|---|---|---|---|
| Taze cache | Evet | Hayır | Pasif |
| Bayat cache | Evet, eski | Arka planda | Yenile |
| Cache yok | Hayır | Run başlar | İlerleme |
| Kısmi kaynak hatası | Evet | Hayır | Yenile |
| Tüm kaynaklar hatalı | Önceki varsa evet | Run biter | Tekrar dene |
| Tüm kaynaklar yapılandırılmadı | Hayır | Run başlamaz | Ülke/kaynak değiştir |
| Nişte gerçekten ürün yok | Hayır | Tamamlandı | Yenile |
| Filtre sonucu boş | “Filtre yok” | Hayır | Filtre temizle |
| Yetkisiz kullanıcı | Hayır | Hayır | PRO’ya geç |

---

## 9. Bileşenler ve veri bağlantısı

Mevcut Aroless görsel dilini kullanırız:

- `PageHero`
- `Tabs`
- `Table`
- `Sheet` / `Drawer`
- `Badge`
- `Button`
- `Input`
- `Select`
- Mevcut `Sparkline` veya basit SVG grafik
- Mevcut `premium-card` stili

Önerilen sunucu fonksiyonları:

| Fonksiyon | Görev |
|---|---|
| `searchHydrogen10` | Niş anahtarı, DB-first arama, cache hit/miss kararı |
| `getHydrogen10Niche` | Niş özeti ve cache durumu |
| `refreshHydrogen10` | Manuel/force yenileme; tek run kilidi |
| `getHydrogen10Product` | Ürün detayı + geçmiş |
| `getHydrogen10SourceHealth` | Kaynak run’ları ve cache metrikleri |

İstemci kazıma kararı vermez. “Cache var mı?” kararı sunucuda verilir.

---

## 10. Kabul kriterleri

- Aynı niş + farklı filtre → **yeni `h10_runs` kaydı yok**.
- 24 saat içindeki niş → kazıma yok.
- Bayat niş → eski sonuç anında, yenileme arka planda.
- Kaynak çökünce önceki teklifler korunur.
- Kaynak hatası “sonuç yok” olarak gösterilmez.
- Ürün geçmişi append-only veriden gelir.
- Global pazarda ülke/para birimi ayrı cache’lenir.
- “DB’den” ve “canlı” etiketi doğru.
- Sidebar collapsed durumda Hidrojen10 erişilebilir.
- Mobilde tablo yatay taşmaz; kart görünümüne döner.
- PRO olmayan kullanıcı `/news` ile aynı kapıdan geçer.
- Sayfa yüklenirken sahte ürün gösterilmez.

---

## 11. MVP dışında

- Watchlist ve alarmlar
- Fiyat düşüşü bildirimi
- Rakip satıcı takibi
- Keyword araştırması
- Reverse ASIN / Cerebro benzeri analiz
- Satış tahmini
- Otomatik saatlik tarama
- Ayrı landing page
- Ayrı ürün markası

Bunlar veri sözleşmesi ve MVP akışı oturduktan sonra ayrı planlanır.
