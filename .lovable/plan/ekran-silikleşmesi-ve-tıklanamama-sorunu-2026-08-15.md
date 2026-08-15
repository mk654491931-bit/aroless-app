# Ekran silikleşmesi ve tıklanamama sorunu

## Ne oluyor

Ana sayfada "Hızlı kurulum" (onboarding) penceresi açılıyor, ama penceresinin kartı görünür alanın çok altında kalıyor. Ekranda sadece kartın arkasındaki koyu/bulanık perde görünüyor — bu yüzden sayfa silik görünüyor ve hiçbir yere tıklanamıyor.

Canlı sayfada doğrulanan durum: perde `top: 0` yerine 2314 px yüksekliğinde, sola 48 px kaymış; kart ise y ≈ 905 px'te, yani ekran dışında.

## Neden

Sayfa geçiş animasyonu olarak eklenen `.page-fade` sınıfı, `transform` ve `filter` özelliklerini animasyonluyor ve animasyon bitince de bu değerleri üzerinde bırakıyor. Bir öğede `transform`/`filter` olduğunda, içindeki tüm `position: fixed` katmanlar artık ekrana değil o öğeye göre konumlanır. Sonuç: sayfa içindeki tüm tam ekran modallar (onboarding, fiyatlandırma modalı, sürüklenebilir Co-Pilot, çerez bandı vb.) yanlış yere düşüyor.

## Çözüm

1. `src/styles.css` içindeki `.page-fade` animasyonunu yalnızca `opacity` (ve gerekirse çok hafif bir `translate` yerine hiçbir dönüşüm olmayan) tabanlı hale getirmek; animasyon bittiğinde öğede `transform`/`filter` kalmamasını sağlamak. Böylece geçiş hissi korunur, ama `fixed` katmanlar kırılmaz.
2. Aynı animasyonun mobil/`prefers-reduced-motion` varyantlarını da bu kurala uydurmak.
3. Onboarding penceresini ek güvence olarak sayfa ağacının dışına (portal) taşımak — ileride herhangi bir üst katman `transform` alsa bile modal ekranın ortasında kalır.
4. Kontrol: ana sayfa açıldığında kurulum penceresinin ortada göründüğü, "Atla" ile kapandığı ve ardından sayfanın tıklanabildiği tarayıcıda doğrulanacak; fiyatlandırma modalı ve Co-Pilot butonunun konumu da kontrol edilecek.

## Teknik notlar

- Dosyalar: `src/styles.css` (`.page-fade`, `@keyframes page-fade-in` ve reduced-motion bloğu), `src/components/onboarding-wizard.tsx` (portal ile render).
- Davranışsal başka değişiklik yok; içerik, akış ve mevcut özellikler aynı kalır.
