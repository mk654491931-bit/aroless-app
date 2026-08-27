# Velora SaaS Lansman Paketi

Odak: kullanıcı büyümesi + güven/operasyon. Ödeme tarafı LemonSqueezy ile devam eder. Fiyatlandırma bölgeye göre TRY/USD gösterilir.

## 1. Halka açık pazarlama yüzü (büyüme)

- Yeni `/` öncesi pazarlama katmanı: giriş yapmamış ziyaretçi için hero, "nasıl çalışır", ürün bulucu demo ekran görüntüleri, sosyal kanıt alanı, SSS ve CTA. Giriş yapan kullanıcı doğrudan uygulamaya düşer.
- `/pricing` genel sayfası: planlar, kredi paketleri, TRY/USD para birimi seçici (ziyaretçi ülkesine göre varsayılan), yıllık indirim, SSS.
- `/blog` benzeri statik içerik yerine hafif "use-case" sayfaları: ülke + platform bazlı landing (örn. "Trendyol ürün bulucu", "Amazon US winning product"). SEO için ayrı route + benzersiz head metadata + JSON-LD.
- Tüm pazarlama sayfaları mevcut çok dilli altyapıyı kullanır.

## 2. Onboarding ve aktivasyon

- Kayıt sonrası 4 adımlı kurulum sihirbazı: hedef ülke, platform, kategori, bütçe → ilk aramayı otomatik hazırlar.
- İlk arama için "rehberli tur" (ürün kartı, Winner Score, karşılaştırma).
- Boş durum ekranları: her sayfada örnek çıktı + tek tıkla deneme.
- Aktivasyon kontrol listesi kartı (ilk arama, ilk favori, ilk simülasyon) ve tamamlayınca bonus kredi.

## 3. Davet / referans sistemi

- Her kullanıcıya referans kodu; davet edilen kayıt olunca her iki tarafa kredi.
- `referrals` tablosu + kötüye kullanım kontrolü (mevcut device fingerprint altyapısına bağlanır).
- Ayarlar içinde "Davet et" paneli: link kopyala, istatistikler.
- Mevcut promo kodu sistemiyle çakışmadan çalışır.

## 4. E-posta yaşam döngüsü

- Karşılama, ilk aramaya davet, kredi azaldı, abonelik yenilendi/başarısız, haftalık trend özeti.
- Kullanıcı e-posta tercihleri mevcut `notification_preferences` üzerinden yönetilir; her postada abonelikten çık bağlantısı.

## 5. Güven, yasal ve şeffaflık

- Uygulama sahibi imzalı `/privacy`, `/terms`, `/security`, `/subprocessors` sayfalarının güncellenmesi (metinleri sizden alacağım; uydurma uyumluluk iddiası yazılmaz).
- KVKK/GDPR: hesabı ve verileri dışa aktar / hesabı sil akışı (Ayarlar içinde, onaylı).
- Çerez tercih yönetimi (mevcut banner'ın kategori bazlı hale getirilmesi).
- Durum/şeffaflık: AI sağlayıcı durum rozeti, son güncelleme zamanı.

## 6. Operasyon ve dayanıklılık

- Kullanıcı bazlı hız sınırı ve eşzamanlı istek limiti (kredi düşmeden önce kontrol) — kötüye kullanım ve API maliyeti koruması.
- Kredi kullanım günlüğü tablosu: hangi araç, hangi model, kaç kredi, ne kadar sürdü. Kullanıcı için "Kullanım" ekranı, admin için maliyet raporu.
- Hata dayanıklılığı: sağlayıcı düşerse otomatik ikinci havuza geçiş ve kullanıcıya anlaşılır mesaj; kredi başarısız işlemde iade edilir.
- Admin panel derinleştirme: kullanıcı arama, plan/kredi düzenleme, gelir ve dönüşüm özeti, referans ve promo performansı, son hatalar.
- Destek: uygulama içi geri bildirim/destek formu → admin panelde liste.

## 7. Faturalandırma tamamlayıcıları

- Abonelik durumu ekranı: plan, yenileme tarihi, iptal/yükselt bağlantısı, geçmiş faturalar (transactions üzerinden).
- Ödeme başarısız / iptal durumlarında planı düşürme ve bilgilendirme.
- Kredi paketleri (tek seferlik) satın alma akışının fiyatlandırma sayfasına eklenmesi.

## Teknik notlar

- Yeni tablolar: `referrals`, `credit_usage_log`, `support_tickets`, `rate_limit_events`. Hepsi RLS + GRANT ile; admin görünümleri `has_role` üzerinden.
- Hız sınırı ve kullanım kaydı, mevcut `createServerFn` çağrılarının ortak sarmalayıcısına eklenir (ai.server / gemini.functions yolları).
- Pazarlama sayfaları ayrı route dosyaları; her biri kendi `head()` metadata'sı ile.
- E-postalar Lovable Cloud e-posta altyapısı üzerinden; alan adı doğrulaması gerekir.
- Para birimi: mevcut `currency.tsx` genişletilir, fiyatlar TRY/USD çift gösterim.

## Sıralama önerisi

1. Pazarlama + fiyatlandırma sayfaları, onboarding
2. Referans sistemi + e-posta yaşam döngüsü
3. Hız sınırı, kullanım günlüğü, kredi iadesi
4. Yasal/veri hakları, destek, admin derinleştirme
