# Velora: 4 Yeni Büyüme Modülü

Seçtiğin dört modülü sırayla ekliyorum. Hiçbir mevcut özellik kaldırılmıyor; hepsi mevcut kredi, dil, para birimi ve admin altyapısına bağlanıyor.

## 1. Kazanan Ürün Radarı

Kullanıcı hiç arama yapmadan her gün değer gören bir akış.

- Yeni `/radar` sayfası: "Bugün yükselenler" kartları (ürün adı, niş, ülke, Winner Score, momentum oku).
- Skor motoru mevcut Winner Score + trend verisini kullanır, günde bir kez arka planda üretilir ve önbelleğe alınır (kullanıcı kredisi harcanmaz).
- Favori ürünler için izleme: skor, tahmini fiyat bandı veya rekabet seviyesi belirgin değiştiğinde bildirim üretilir (mevcut bildirim sistemi ve tercih anahtarları kullanılır).
- Kart üzerinden tek tıkla "derin analiz" veya "karşılaştırmaya ekle".

## 2. Kâr / ROI Takip Paneli

Simülasyon değil, kullanıcının gerçek mağaza rakamları.

- Yeni `/roi` sayfası: ürün ekle, alış maliyeti, satış fiyatı, kargo, reklam harcaması, sipariş ve iade sayısı gir.
- Otomatik hesap: birim kâr, net kâr, ROAS, break-even ROAS, CAC, kâr marjı ve kümülatif kâr grafiği.
- Ürün bazlı durum rozeti (ölçekle / izle / durdur) ve portföy özeti.
- Ürün bulucudan gelen tahmini ekonomiyle gerçekleşen sonucun yan yana karşılaştırması ("tahmin vs gerçek" sapma göstergesi).
- Veri kullanıcıya özel, dışa aktarım mevcut veri indirme paneline eklenir.

## 3. AI Mağaza Denetçisi

- Yeni araç sayfası: mağaza URL'si girilir, sayfa içeriği okunur ve AI ile denetlenir.
- Rapor başlıkları: ilk izlenim ve güven sinyalleri, ürün sayfası dönüşüm kırıcıları, fiyat ve teklif stratejisi, kargo/iade netliği, mobil ve hız izlenimi, SEO temelleri.
- Her bulgu için etki (yüksek/orta/düşük) ve uygulanabilir düzeltme cümlesi; 0-100 mağaza sağlık skoru.
- Kredi maliyeti mevcut kredi sistemine bağlanır, sonuç geçmişe kaydedilir.

## 4. Reklam Kreatif Stüdyosu

Mevcut SEO ve Creative sekmelerini kaldırmadan, onları tek akışta birleştiren üst katman.

- Yeni `/studio` sayfası: ürün seç (favoriler veya son arama sonuçları) ve tek çalıştırmada üret:
  - 5 hook varyantı (platform bazlı: TikTok / Reels / Shorts)
  - 30-45 saniyelik UGC video senaryosu (sahne sahne, çekim notlu)
  - Reklam başlıkları ve açıklamaları
  - Görsel/ürün fotoğrafı prompt seti
- Çıktıyı kopyala, favoriye kaydet ve metin dosyası olarak indir.
- Dil ayarına saygı duyar; mevcut AI anahtar havuzu ve yedekleme zinciri kullanılır.

## Teknik notlar

- Yeni tablolar: `roi_entries` (kullanıcıya ait gerçek performans satırları), `radar_items` (günlük üretilen radar akışı, tümüne okuma), `store_audits` (denetim geçmişi), `creative_assets` (stüdyo çıktıları). Hepsinde RLS + GRANT, kullanıcı bazlı politikalar.
- Sunucu tarafı iş mantığı `createServerFn` ile: `radar.functions.ts`, `roi.functions.ts`, `store-audit.functions.ts`, `creative-studio.functions.ts`; AI çağrıları mevcut `ai.server.ts` anahtar rotasyonundan geçer.
- Radar günlük yenileme için `/api/public/radar-refresh` üzerinde gizli anahtarla korunan bir uç nokta ve zamanlanmış tetikleme.
- Yeni sayfalar mevcut üst menü, kenar çubuğu, ambient arka plan ve i18n katmanına bağlanır; her sayfa kendi başlık/açıklama meta bilgisiyle gelir.
- Ücretsiz plan sınırları: radar herkese açık, ROI paneli ücretsiz 3 ürüne kadar, denetçi ve stüdyo kredi ile çalışır.

## Sıra

1. Kazanan Ürün Radarı
2. Kâr / ROI Takip Paneli
3. AI Mağaza Denetçisi
4. Reklam Kreatif Stüdyosu
