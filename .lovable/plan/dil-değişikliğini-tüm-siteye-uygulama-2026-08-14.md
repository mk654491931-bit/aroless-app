# Dil değişikliğini tüm siteye uygulama

Bugün dil seçici çalışıyor ama yalnızca birkaç ekranı (ana sayfa kısmen, ayarlar, sidebar, rapor modalı, viral reklamlar, dashboard) etkiliyor. Diğer ~35 dosyadaki metinler koda gömülü olduğu için dil değiştirince aynı kalıyor. Ayrıca AI çıktıları sabit dilde üretiliyor.

## Hedef

Dil seçildiğinde arayüzün tamamı ve AI'ın ürettiği içerikler o dile geçsin. Diller: İngilizce, Türkçe, İspanyolca, Almanca, Fransızca, Arapça (Arapça'da sağdan sola düzen zaten mevcut).

## Yapılacaklar

### 1. Metin envanteri ve anahtar yapısı

- Tüm sayfa ve bileşenlerdeki sabit metinler taranır ve alan bazlı gruplara ayrılır: `finder`, `training`, `academy`, `tools`, `news`, `council`, `trends`, `legal`, `auth`, `admin`, `common`.
- Mevcut sözlük dosyası bu gruplara göre yeniden düzenlenir; var olan anahtarlar korunur (kırılma olmaz).

### 2. Ekranların çeviriye bağlanması

Sabit metinler sırayla çeviri anahtarlarına taşınır:

- Ana akış: ürün bulucu ana sayfası, ürün kartları, Winner Score paneli, derin analiz modalları, kanıt panelleri
- Simülatör (en yoğun dosya): görevler, koç mesajları, yükseltmeler, olay/karar metinleri, HUD etiketleri
- Akademi: ders başlıkları, görevler, rozet ve seviye adları
- Araç sayfaları: finans, büyüme, tedarik, uyumluluk, rakip analizi, trend radar, haberler, konsey
- Çevresel yüzeyler: giriş ekranı, fiyatlandırma, footer, çerez bandı, yasal sayfalar, admin panelleri, bildirim (toast) mesajları

### 3. Diğer 5 dilin doldurulması

Yeni ve mevcut tüm anahtarlar için İspanyolca, Almanca, Fransızca, Arapça ve İngilizce karşılıkları üretilir; eksik kalan anahtar için İngilizce'ye düşme davranışı korunur.

### 4. AI çıktıları seçilen dilde

- İstemcideki AI çağrılarına aktif dil kodu iletilir.
- Sunucu tarafındaki istemlere "yanıtı bu dilde yaz" talimatı eklenir: ürün analizi, derin inceleme, haber/canlı akış, SEO & kreatif üretimi, simülatör koçu, konsey ajanları.
- Ürün adları, marka adları ve tedarikçi/link verileri çevrilmez; yalnızca açıklama ve tavsiye metinleri dile uyar.

### 5. Biçimlendirme ve doğrulama

- Tarih, sayı ve yüzde biçimleri seçilen dile göre yerelleştirilir (para birimi mevcut ayarına dokunulmaz).
- Arapça'da sağdan sola düzen tüm yeni ekranlarda kontrol edilir.
- Her dil için gezinti testi yapılır; çevrilmemiş metin kalmadığı doğrulanır.

## Teknik notlar

- react-i18next altyapısı korunur; dil tercihi tarayıcıda (localStorage) saklanmaya devam eder.
- Çeviri sözlüğü tek dosya olarak büyümemesi için dil başına ayrı modüllere bölünür ve tip güvenli anahtar yapısı kullanılır.
- Sunucu fonksiyonlarına dil parametresi eklenirken mevcut imzalar geriye dönük uyumlu tutulur (dil verilmezse İngilizce varsayılır).
- İş, ekran gruplarına bölünerek paralel yürütülür; her grup sonrası tip kontrolü yapılır.
