# Kazanan Ürün Bulucu — Arayüz Denetimi ve "Siyah / Profesyonel" Yeniden Tasarım

Tarih: 2026-10-14 · Kapsam: `/` (Kazanan ürün bulucu), paylaşılan tema (`src/styles.css`)

## 0. İnceleme yöntemi (ve sınırı)

Bu ortamda tarayıcı otomasyonu (tıklama/ekran görüntüsü) aracı yok. Bu yüzden
"kullanıcı gibi kayıt ol → gez" adımı **birebir yapılamadı**; onun yerine şunlar
doğrulandı:

- Preview ayakta ve sağlıklı: `freebuff-preview start` → `"Preview is ready"`.
- Rotalar canlı olarak yanıt veriyor: `/` → 200, `/auth` → 200, `/discover` → 200,
  `/pricing` → 200.
- Değiştirdiğim modüller Vite tarayıcıdan gerçekten derleniyor (200 + gerçek JS
  çıktısı): `src/routes/index.tsx`, `src/features/finder/components/product-card.tsx`,
  `src/styles.css`.
- Bulucu hattının testleri geçiyor: 6 dosya / 83 test.

Yani denetim **kod + gerçek render çıktısı** üzerinden yapıldı; oturum açmış bir
kullanıcının tıklama akışı gözlemlenmedi. Aşağıdaki tespitler bu sınırla okunmalı.

## 1. Neden "profesyonel durmuyor" — kök neden

Sorun renk paleti değil, **görsel yoğunluk ve katman yığılmasıydı**. Aynı ekranda
birbirine rakip 10+ dekoratif katman vardı:

| # | Bulgu | Kanıt |
| --- | --- | --- |
| 1 | Sayfa arkasında iki büyük mavi "bloom" + 9 katmanlı animasyonlu sahne (`amb-swirl`, `amb-aurora`, 2 `amb-blob`, `amb-rays`, `ambre-grid`, `amb-beam`, `amb-scan`, `amb-particles`) | `src/components/ambient-background.tsx`, `src/styles.css` batch `#1418+` |
| 2 | İçerik **sahte dizüstü kasası** içinde sunuluyordu: çerçeve + alt gövde + altında turuncu ışıma | `src/routes/index.tsx` (`laptop-shell grain`, `laptop-base`), `.laptop-shell::after`, `.laptop-base::after` |
| 3 | Sayfa başlığında blur'lu halo, "rotating slogan" ve 4 rozet; başlık `text-6xl font-extrabold` | `index.tsx` hero bloğu; `.finder-hero-halo` |
| 4 | Arama alanının içinde parçacık animasyonu (`field-particles`), sınırlarda ışık dalgası (`light-wave`), yanında dekoratif "biometric" buton | `index.tsx` + `.field-particles`, `.light-wave::before` |
| 5 | CTA'da gradient + neon glow + sonsuz "sheen" taraması (`cta-sweep`) | `.cta-sweep::after`, `shadow-[0_14px_35px…]` |
| 6 | Header'da 10'dan fazla "morph-pill" (her biri kendi animasyonuyla) | `index.tsx` header bloğu, `.morph-pill::before/::after` |
| 7 | Kartlarda parlama/tahıl dokusu katmanları (`premium-card::before`, `grain`) | `src/styles.css` |
| 8 | Taban renk maviye çalan siyahtı (`#05070d`) + kart renkleri de mavi tonluydu | `:root` token'ları |

Kısacası: **siyah değil lacivert**, ve her yüzeyde aynı anda oynayan bir animasyon.
Profesyonel veri ürünleri (Linear, Vercel, Stripe paneli) tam tersini yapar: düz koyu
zemin, hairline kenar, tek vurgu rengi, hareket yalnızca anlam taşıdığında.

## 2. Yapılan değişiklikler

### 2.1 Tema artık gerçekten siyah (`src/styles.css`)

- `--background: #05070d` → **`#050505`**, `--surface: #0a1020` → `#0b0b0c`,
  `--popover` aynı şekilde nötr.
- `--card`, `--muted`, `--accent`, `--secondary` mavi tonlardan **nötr griye** çekildi.
- `--primary` **beyaz** yapıldı (`--primary-foreground` koyu): birincil butonlar
  "siyah üzerinde beyaz" premium görünüme geçti.
- Tek vurgu rengi korundu ama ölçülendirildi: `--brand: oklch(0.66 0.16 257)`.
- `body` arka planındaki **iki büyük mavi radial bloom kaldırıldı**; yerine tek ve çok
  düşük yoğunluklu üst kenar ışığı geldi (düz siyah hissi).

### 2.2 Dekor katmanları kapatıldı (yeni "AROLESS PRO" bloğu)

`src/styles.css` sonuna eklenen tek blok şunları kapatır — **hiçbir işlev/veri/metin
silinmedi**:

- `.amb-layer`, `.ambient-drift`, `.ambient-halo`, `.finder-hero-halo`,
  `.field-particles`, `.light-wave::before`, `.laptop-base`, `.laptop-shell::after`,
  `.cta-sweep::after`, `.grain::before/::after` → `display: none`.
- `.laptop-shell` → çerçevesiz, gölgesiz düz yüzey.
- `.glass` (yapışkan başlık) → bulanıklık yok, düz siyah + ince kenar.
- `.premium-card` / `.live-card` → nötr siyah degrade + hairline; parlama katmanları kapalı.
- `.morph-pill`, `.heartbeat`, `.press` → animasyon ve dönüşüm yok.
- `.glow`, `.elite-glow` → gölge yok.
- `.finder-form` → glow yerine ince kenar; panel içi yüzeyler düzleştirildi.

### 2.3 Bulucu sayfası sadeleştirildi (`src/routes/index.tsx`)

- Hero: halo + rotating slogan + rozet yığını kaldırıldı → **sol hizalı**, tek
  eyebrow, `text-3xl md:text-4xl font-semibold` başlık ve tek satır güven notu +
  hairline ayraç. Gradient başlık yerine tek renk vurgu.
- Arama alanı: `light-wave` sarmalayıcı, parçacıklar ve **BiometricButton** kaldırıldı;
  input artık hairline kenarlı, odakta tek vurgu rengi (`border-[var(--brand)]`).
- "Validate My Product" alanı da aynı şekilde sadeleştirildi.
- Birincil CTA: gradient + glow + sheen yerine **düz vurgu rengi** ve sade hover.
- Mobil "aramaya dön" FAB'ı düz renge indirildi.
- Sahte dizüstü kasası ve alt gövde (`laptop-shell`, `laptop-base`) kaldırıldı;
  içerik doğrudan sayfa üzerinde duruyor.

## 3. Sonuç ve doğrulama

- Sayfa artık düz siyah bir yüzey üzerinde, tek vurgu rengiyle ve hareket etmeyen
  bir başlık yapısıyla okunuyor; "ürünü satan şey" (arama formu + sonuç kartları)
  sayfanın en yüksek kontrastlı nesnesi.
- Preview'da canlı: `https://8082-i3ti9itg27o3mn719ecpe.e2b.app`
- Doğrulanan kontroller: 4 rota 200 · 3 modül Vite'ta derleniyor · bulucu testleri
  83/83 geçti · servis edilen CSS'te `--background: #050505` ve 26 `display:none`
  kuralı mevcut.
- **Doğrulanamayan:** tam proje `tsc --noEmit` (bu makinede 180 sn komut tavanını
  aşıyor; değişikliklerim yalnızca JSX/className/CSS olduğu için tip riski düşük
  ama "tip kontrolü geçti" denmiyor). Oturum açmış kullanıcının tıklama akışı da
  gözlemlenmedi (bölüm 0).

## 4. Sıradaki adımlar (öneri, henüz yapılmadı)

1. **Header'ı sözleşmeye indir**: 10+ pill'i tek "Ayarlar" menüsü + 3 birincil eylem
   yapmak; her eklenen pill okunabilirliği düşürüyor.
2. **Tablo/liste görünümü**: 3'lü kart ızgarası yerine sıralanabilir tablo (kâr, marj,
   rekabet, skor kolonları) — "profesyonel araç" hissini en çok artıran tek değişiklik.
3. **Tek tip sayı biçimi**: tüm metriklerde tabular-nums + `pro-stat` sınıfı.
4. **`ArolessCover` + `ActivationChecklist`**: formun üstündeki iki blok, ilk ekranda
   aracı aşağıya itiyor; onboarding tek seferlik bir modala taşınabilir.
5. Karışık TR/EN metinleri tek dile toplamak (ör. "Find Winners", "Validate My Product").
