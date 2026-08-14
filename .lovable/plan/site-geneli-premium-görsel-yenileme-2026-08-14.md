# Site geneli premium görsel yenileme

Amaç: giriş ekranındaki hareketli atmosferi tüm siteye taşımak, üstüne "veri" hissi veren ince katmanlar eklemek ve kartları elle tasarlanmış gibi duran, canlı ama abartısız bir dile taşımak. Mevcut Klasik/Aurora palet seçimi korunur; efektler paletin renk değişkenlerinden beslendiği için Aurora'ya geçince zemin de birlikte değişir.

## 1. Global animasyonlu zemin

Tüm sayfaların arkasına tek bir sabit (fixed) atmosfer katmanı gelir — her sayfaya ayrı ayrı eklenmez, kök düzende bir kez render edilir:

- Yumuşak aurora bulutları (giriş ekranındaki dil, sayfa içinde daha düşük yoğunlukta)
- Yavaş kayan ince veri ızgarası, merkeze doğru silinen maske ile
- Ekranda tembelce yükselen ışıklı veri parçacıkları (az sayıda, düzensiz hızlarda)
- Sayfanın kenarlarını koyulaştıran hafif vinyet, içeriği öne çıkarmak için

Yoğunluk seviye 3'te tutulur: hareket fark edilir ama okumayı bozmaz; metin ve form alanlarının arkası daima sakin kalır.

## 2. Sayfa başlıkları

Araç sayfalarının ortak başlık bloğu (Growth, Finance, Sourcing, Compliance) ve diğer sayfa başlıkları:

- Başlığın arkasında nefes alan ışık halesi
- Başlık altında paletten beslenen ince akışkan çizgi
- Rozetlerde (motor sayısı, çıktı türü, anahtar rotasyonu) hafif iç parlama ve hover'da yükselme

## 3. Kart dili

"Yapay zekâ şablonu" hissi vermemesi için tek tip cam kart yerine kademeli bir sistem:

- Ana kartlar: gerçek derinlik veren çok katmanlı gölge, üst kenarda ince ışık çizgisi, hover'da yumuşak yükselme ve kenar renginin canlanması
- Sonuç/metrik kartları: sayılar için ayrı tipografik ağırlık, ölçüm çubuklarında dolum animasyonu
- Yükleme durumu: boş gri kutular yerine kartın kendi iskeletinde ilerleyen shimmer
- İçerik geldiğinde kısa, sıralı giriş animasyonu (hepsi aynı anda değil, ufak gecikmelerle)

Köşe yarıçapı, boşluk ve gölge değerleri tek bir ölçekten türetilir; her kart kendi başına değil, sayfa ritmi içinde çalışır.

## 4. Etkileşim detayları

- Butonlarda basınca hafif çökme, birincil butonlarda kenar boyunca yürüyen ışık
- Sekme geçişlerinde altta kayan gösterge
- Gauge/skor daireleri ekrana girince 0'dan hedefe animasyonla sayar
- Bağlantı ve satır hover'larında yalnızca renk değil, ince arka plan tonu değişimi

## 5. Erişilebilirlik ve performans

- `prefers-reduced-motion` açıkken tüm zemin ve giriş animasyonları durur, statik gradyanla değişir
- Zemin katmanları `pointer-events: none` ve GPU dostu (transform/opacity) tutulur; parçacık sayısı düşük tutulup mobilde daha da azaltılır
- Metin kontrastı her iki palette ve açık/koyu modda kontrol edilir

## Teknik notlar

- Yeni `src/components/ambient-background.tsx` bileşeni `src/routes/__root.tsx` içinde bir kez, içerik katmanının altına yerleştirilir (`fixed inset-0 -z-10`).
- Tüm efekt sınıfları `src/styles.css` içine, mevcut `auth-*` bloklarının yanına `amb-*` ön ekiyle eklenir; renkler `var(--brand)`, `var(--brand-2)`, `var(--accent-active)` üzerinden alınır, sabit renk kodu yazılmaz.
- Kart dili `.premium-card` ve `src/components/ui/card.tsx` varyantları üzerinden merkezileştirilir; sayfalar tek tek elden geçirilmez, ortak `HubShell` ve kart bileşenleri güncellenir.
- Sayaç ve dolum animasyonları için ek paket kurulmaz; CSS geçişleri ve mevcut React durumu kullanılır.
- Değişiklik sonrası ana sayfa, bir araç sayfası, akademi ve haberler ekranları her iki palette tarayıcıda görsel olarak doğrulanır.
