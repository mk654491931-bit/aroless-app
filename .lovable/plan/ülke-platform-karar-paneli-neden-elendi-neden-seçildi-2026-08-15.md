# Ülke-platform karar paneli: neden elendi / neden seçildi

Amaç: her ürün için "bu ülkede seçtiğin kanallarla neden mantıklı (ya da neden elendi)" sorusunu komisyon, teslimat ve sertifika bariyeri gibi somut gerekçelerle açıklayan bir bilgi paneli.

## Bugünkü durum (kodda doğrulandı)

- Eleme kararı `src/lib/winner-gate.server.ts` içinde veriliyor ama dışarı yalnızca tek satırlık serbest metin (`rejection_reason`) çıkıyor; hangi kanal, hangi komisyon, hangi bariyer kuralı tetikledi bilgisi kayboluyor.
- `src/components/winner-score-panel.tsx` içindeki `RejectedPanel` bu tek satırı gösteriyor, başka gerekçe yok.
- Hayatta kalan ürünler için hiçbir yerde "neden seçildi" gerekçesi gösterilmiyor; `platform-market.ts` içindeki komisyon/teslimat/uygunluk verisi sadece isteme ve elemeye giriyor, arayüze yansımıyor.

## Yapılacaklar

### 1. Karar gerekçesini veriye dönüştür

`src/lib/winner-gate.server.ts`: her ürün için yapılandırılmış bir `MarketVerdict` üret ve hem hayatta kalanlara hem elenenlere ekle:

- `fit`: seçili her kanal için `yerel / sınır ötesi / kullanılamıyor`, komisyon aralığı, teslimat gün aralığı, kanal notu.
- `barrier`: ülkeye özel sertifika kuralı eşleştiyse kural adı + açıklama (SABER, ESMA, VerpackG, EPR, BIS, ANATEL, PSE…).
- `checks`: geçilen/kalınan kontrollerin listesi (fiyat bandı, net marj eşiği, doygunluk, hacim/kargo, yasal risk) — her biri `geçti / kaldı`, ölçülen değer ve eşik ile.
- `decision`: `kept | rejected | rescued` (eşik altında kalıp geri alınanlar da işaretlenir).

### 2. Gerekçeyi uçtan uca taşı

`src/lib/gemini.functions.ts`: `rejectedCandidates` eşlemesine `verdict` alanını ekle ve hayatta kalan ürünlere de `market_verdict` olarak iliştir; mevcut alanların hiçbiri kaldırılmaz.

### 3. Bilgi paneli

Yeni `src/components/market-fit-panel.tsx`:

- Kanal tablosu: kanal · durum rozeti · komisyon %'si · teslimat günü · kısa not.
- Bariyer uyarısı (varsa) ve gerekçesi.
- Kontrol listesi: yeşil/kırmızı işaretli eşik satırları ("Net marj %21 ≥ %18", "Fiyat $6 < $9").
- Ülke özeti: KDV etiketi/oranı ve para birimi (`countries.ts`).
- Altta tek cümlelik karar özeti ("Almanya'da Amazon yerel kanal, %15 komisyon ve 2 gün teslimatla marj korunuyor").

### 4. Arayüze bağla

- `src/routes/index.tsx`: ürün kartında açılır "Ülke & platform uyumu" bölümü olarak paneli göster.
- `src/components/winner-score-panel.tsx` içindeki `RejectedPanel`: her elenen adayın altına aynı paneli katlanabilir şekilde ekle, tek satırlık sebep başlık olarak kalır.

## Teknik notlar

- Yeni dosya: `src/components/market-fit-panel.tsx` (saf sunum).
- Değişecek: `src/lib/winner-gate.server.ts` (verdict üretimi), `src/lib/gemini.functions.ts` (alanı taşıma), `src/routes/index.tsx`, `src/components/winner-score-panel.tsx`.
- `platform-market.ts` verisi (komisyon, teslimat, uygunluk) tek kaynak olarak kullanılır; kural metinleri Türkçe/İngilizce mevcut i18n katmanından geçer.
