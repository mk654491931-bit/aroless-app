# Görünür Sistem Arayüzü Yenilemesi

## Neden hiçbir şey değişmemiş gibi görünüyor

Canlı önizlemede kontrol ettim: arka plan katmanları sayfada gerçekten var (`.amb-aurora` render ediliyor), ancak

- katman opaklığı 0.22 ve `z-index: -10` ile en arkada,
- `body` arka planı düz opak koyu renk (`rgb(11,15,23)`),
- sayfa içerikleri opak kart/panel yüzeyleri kullanıyor.

Yani animasyonlar teknik olarak çalışıyor ama ekranda pratikte görünmüyor. Ayrıca "sistem arayüzü" (üst bar, sayfa başlıkları, kart/panel dili) hiç değişmedi — sadece arka plan eklenmişti.

## Yapılacaklar

### 1. Arkaya belirgin hareketli animasyon
- Body'yi düz renk yerine derinlikli degrade yap, ambient katmanları içerikle aynı sahnede görünür hale getir.
- Aurora/blob/ışın opaklıklarını belirgin seviyeye çıkar (koyu temada ~0.5–0.7 bant), parçacık sayısını ve hareket genliğini artır.
- Sürekli hareket eden katmanlar: yavaş dönen aurora bulutları, nefes alan renk blobları, ekranı düzenli tarayan ışık huzmesi, yukarı süzülen parçacıklar ve hafifçe kayan ızgara.
- Fare ve kaydırmaya bağlı parallax derinliği (katmanlar farklı hızlarda hareket eder).
- Sayfa kapsayıcılarındaki opak arka planları yarı saydam cam yüzeye çevir ki arka plan hareketi içerik altından okunsun.

### 2. Yeni üst uygulama çubuğu (en görünür değişiklik)
- Tüm oturum içi sayfalara ortak, yapışkan cam efektli bir üst bar: Velora markası, sayfa başlığı/breadcrumb, arama, kredi rozeti, dil, palet ve tema düğmeleri, hesap menüsü.
- Şu an sağ alt köşede duran palet/tema düğmeleri ve sol alt sidebar tetikleyicisi bu bara taşınacak.

### 3. Sayfa başlığı (hero) standardı
- Her ana sayfaya ortak başlık bloğu: ikon + başlık + kısa açıklama + sağda aksiyonlar, altında ince degrade ayırıcı.
- Ürün Bulucu, Dashboard, Haberler, Akademi, Training, Konsey, Karşılaştırma sayfalarına uygulanır.

### 4. Kart ve panel dili
- Ortak `surface` bileşen stili: cam arka plan, ince kenarlık, hover'da yükselme + kenar parlaması.
- Boş durum, yükleniyor (skeleton) ve hata durumları için tutarlı görünüm.

### 5. Kenar çubuğu
- Genişletilmiş varsayılan, gruplu menü başlıkları, aktif öğe için degrade vurgu ve ikon animasyonu.

### 6. Erişilebilirlik ve performans
- `prefers-reduced-motion` desteği korunur; hareket kapalıyken statik degradeye düşer.
- Katman sayısı GPU dostu tutulur (transform/opacity dışında animasyon yok).

## Teknik notlar
- `src/styles.css`: body degradesi, `amb-*` opaklık/animasyon revizyonu, `surface`/`page-hero` yardımcı sınıfları.
- `src/components/ambient-background.tsx`: katman yoğunluğu ve parallax genliği artırılır.
- Yeni `src/components/app-topbar.tsx` ve `src/components/page-hero.tsx`.
- `src/routes/__root.tsx`: topbar entegrasyonu, alt köşe düğmelerinin kaldırılması.
- `src/components/app-sidebar.tsx` ve ana rota dosyalarında hero/kart sınıflarının uygulanması.
- İş mantığı, veri akışı ve mevcut özellikler değiştirilmez; yalnızca sunum katmanı.

## Doğrulama
- Değişiklik sonrası tarayıcıda ekran görüntüsü alınıp arka plan hareketinin ve yeni üst barın gerçekten göründüğü kanıtlanacak.
