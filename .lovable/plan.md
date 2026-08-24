# Canlıya Çıkış Öncesi Tam Denetim ve Sertleştirme

Tüm site tarandı. Tip kontrolü temiz, tüm sayfalarda meta etiketleri mevcut. Ancak canlıya çıkmadan önce kapatılması gereken somut güvenlik ve maliyet riskleri var. Aşağıdaki iş, tespit edilen bulgulara göre sıralandı.

## 1. Kritik: Korumasız yapay zeka uçları (maliyet ve kötüye kullanım)

`/api/public/tool`, `/api/public/agent`, `/api/public/predictive-trends`, `/api/public/trend-analysis`, `/api/public/trend-radar`, `/api/public/viral-feed` uçları kimlik doğrulaması olmadan çalışıyor. Bugün internetteki herhangi biri bu adreslere istek atıp:

- API anahtarlarınızın kotasını tüketebilir (rate limit ve ücret riski),
- kredi sistemini tamamen atlayarak ücretli modülleri bedava kullanabilir.

Yapılacak:
- Bu uçları oturum zorunlu hale getirmek (webhook'lar ve gerçekten herkese açık olması gereken `fx` / `hot-products` hariç).
- Uygulama içi çağrıları oturumlu sunucu fonksiyonlarına taşımak, böylece kredi düşümü sunucu tarafında garanti altına alınır.
- Kalan açık uçlara IP başına oran sınırı (rate limit) ve istek gövdesi boyut sınırı eklemek.

## 2. Veritabanı erişim politikaları

RLS açık ama hiç politikası olmayan 3 tablo var: `ai_cache`, `device_fingerprints`, `email_otps`. Şu an bunlar yalnızca sunucu tarafından okunuyor; niyetin bu olduğunu kalıcı hale getirmek için açık "yalnızca servis" politikaları ve doğru GRANT'ler yazılacak, denetim uyarıları temizlenecek.

Ayrıca:
- `promo_codes`: kullanıcı tarafında kod doğrulaması yapılıyorsa yalnızca aktif/süresi geçmemiş kodları gösteren dar bir okuma politikası; yapılmıyorsa sunucu tarafı doğrulamanın teyidi.
- `promo_redemptions`: kullanım kaydının sunucu tarafından yazıldığının doğrulanması.
- Signed-in kullanıcıların çağırabildiği `SECURITY DEFINER` fonksiyonlarının gözden geçirilmesi; gereksiz olanlarda EXECUTE yetkisinin geri alınması.

## 3. Yetkili (admin) listesinin kilitlenmesi

Şu anda veritabanı tetikleyicisi yalnızca `omnic.111111@gmail.com` adresine admin veriyor. Yeni kural:

Sabit admin listesi (yalnızca bu 4 adres):
- mryetenek@gmail.com
- mk654491931@gmail.com
- omnic.111111@gmail.com
- mk65449199@gmail.com

Ek olarak `@aroless.com` uzantılı adreslerden kayıt sırasına göre **yalnızca ilk 2 tanesi** otomatik admin olur; sonrakiler normal kullanıcı kalır. Bu sayım veritabanında yapılır, yarış durumuna karşı kilitlenir, yani üçüncü bir `@aroless.com` adresi hiçbir koşulda admin olamaz.

Ayrıca:
- Listede olmayan mevcut tüm admin kayıtları temizlenir.
- Admin rolü yalnızca bu kuralla verilir; kullanıcı arayüzünden veya API'den rol yazımı tamamen kapatılır.
- E-posta karşılaştırması küçük harfe indirgenip kırpılarak yapılır (büyük/küçük harf veya boşlukla atlatma engellenir).
- Admin rotası ve admin sunucu fonksiyonları her istekte rol denetiminden geçirilir.

## 4. Kullanıcı kimlik numarası (8 haneli)

Her kullanıcıya rastgele, benzersiz 8 haneli bir numara atanır (örn. `48210736`).

- Kayıt anında otomatik üretilir, çakışma olursa yeniden denenir.
- Mevcut tüm kullanıcılara geriye dönük atanır.
- Kullanıcı kendi numarasını Ayarlar ve profil/topbar alanında görür, tek tıkla kopyalayabilir.
- Destek taleplerinde ve admin panelinde bu numara gösterilir, böylece destek e-posta yerine numarayla çalışır.
- Numara tahmin edilebilir sıra içermez ve tek başına hiçbir yetki vermez; sadece kimliklendirme amaçlıdır.

## 5. Genel güvenlik sertleştirmesi

- Güvenlik başlıkları: `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`/`frame-ancestors`, temel bir Content-Security-Policy.
- Webhook uçlarında imza doğrulamasının ve tekrar saldırısına (replay) karşı korumanın teyidi.
- Hata mesajlarının kullanıcıya ham şekilde dönmemesi (şu an bazı uçlar iç hata metnini aynen döndürüyor).
- Sunucu loglarında e-posta/IP gibi kişisel verilerin maskelenmesi.
- Kredi düşümü, promosyon kodu ve abonelik yükseltmelerinin yalnızca sunucu tarafında yapılabilmesi.


## 6. Mobil uyum ve kullanıcı deneyimi

Öncelikli ekranlar 390px, 768px ve 1280px genişliklerde tek tek kontrol edilip düzeltilecek:
- Ürün bulucu (kart ızgarası, filtre çubuğu, karşılaştırma tepsisi)
- Komuta merkezi / 14 ajan paneli
- Akademi ve eğitim simülatörü sekmeleri
- Fiyatlandırma, ayarlar, admin tabloları (yatay kaydırma taşmaları)
- Giriş/kaydolma ekranı ve açılış sayfası

Düzeltmeler: yatay taşmaların giderilmesi, dokunma hedeflerinin en az 44px olması, uzun tabloların mobilde kart görünümüne dönmesi, modal ve tepsilerin güvenli alan (safe-area) desteği.

Kullanıcı dostuluk:
- Tüm uzun işlemlerde iskelet (skeleton) ve ilerleme durumu.
- Hata durumlarında anlaşılır Türkçe/çok dilli mesaj ve "tekrar dene" aksiyonu.
- Boş durum ekranlarının netleştirilmesi.

## 7. Performans optimizasyonu

- Ağır bileşenlerin (simülatör, stüdyo, admin panelleri, grafikler) tembel yüklenmesi.
- Görsellerde `loading="lazy"` ve boyut niteliklerinin tamamlanması.
- Arka plan animasyonlarının `prefers-reduced-motion` ve düşük güçlü cihazlarda hafifletilmesi.
- Üretim derlemesinde paket boyutu kontrolü ve gereksiz bağımlılıkların ayıklanması.

## 8. Canlı öncesi son kontrol

- Tip kontrolü ve üretim derlemesi.
- Google ile giriş, kayıt, kredi düşümü, ödeme akışı ve webhook'un uçtan uca testi.
- Admin listesinin doğrulanması (4 adres + en fazla 2 `@aroless.com`) ve başka kimsenin admin olamadığının test edilmesi.
- Güvenlik taramasının yeniden çalıştırılıp bulguların temizlendiğinin doğrulanması.

## Teknik notlar

- Korumalı uçlar `requireSupabaseAuth` middleware'i ile oturumlu sunucu fonksiyonlarına taşınacak; dışarıdan çağrılması gereken uçlar `src/routes/api/public/*` altında kalıp kendi doğrulamasını yapacak.
- Oran sınırı, kalıcı olması için veritabanı tabanlı bir sayaçla uygulanacak (worker'lar durumsuzdur).
- RLS düzeltmeleri tek bir migration ile, her tablo için GRANT'leriyle birlikte yazılacak.
- Admin kuralı `grant_admin_for_designated_email` fonksiyonu yeniden yazılarak uygulanacak: sabit 4 adres + `@aroless.com` için `count < 2` kontrolü (satır kilidiyle). Rol tablosuna yazma yalnızca bu tetikleyici ve servis rolü üzerinden mümkün olacak.
- 8 haneli kimlik `profiles` tablosuna benzersiz `public_id` sütunu olarak eklenecek; çakışmada yeniden üreten bir tetikleyici ile doldurulacak ve mevcut satırlar geriye dönük güncellenecek.
- Mevcut özelliklerde eksiltme yapılmayacak; yalnızca erişim kontrolü, düzen ve performans iyileştirilecek.
