# Ürün Bulucu: ülke + platform hassasiyeti

Amaç: seçilen ülke ve seçilen satış platformlarına gerçekten uyan ürünler çıkarmak; o ülkede/platformda satılamayacak ya da mantıksız adayları elemek.

## Bugünkü durum (kodda doğrulandı)

- Aramada 22 platform seçilebiliyor (`PLATFORMS`) ve 21 hedef ülke var (`TARGET_COUNTRIES`), ama ikisi arasında **hiçbir eşleşme kuralı yok**: kullanıcı hedef ülke ABD iken Trendyol'u, hedef ülke Almanya iken Shopee'yi seçebiliyor ve prompt bunu olduğu gibi modele veriyor.
- Yapay zekâ istemi ülkeyi sadece ikili bir "MARKETPLACE FOCUS: global | turkey" satırı olarak görüyor. `countries.ts` içindeki KDV oranı, para birimi, ülkeye özel kolaylıklar/zorluklar (LUCID, UKCA, SABER, COD alışkanlığı, iade oranı vb.) isteme hiç girmiyor.
- Ülke sinyali yalnızca iki yerde kullanılıyor: canlı kanıt bloğu (`buildLiveEvidenceBlock`) ve ülke skoru (`scoreProductForCountry`). Skor düşük çıksa bile ürün "platforma uymuyor" diye elenmiyor — `winnerGate` sadece tekrar/doygunluk eliyor.

## Yapılacaklar

### 1. Ülke ↔ platform uygunluk haritası
Yeni `src/lib/platform-market.ts`:
- Her platform için hangi ülkelerde gerçekten satış yapılabildiği, ülke bazlı komisyon aralığı, tipik kargo süresi ve ödeme alışkanlığı (COD, taksit, Klarna, Paczkomaty vb.).
- `platformsForCountry(code)` ve `countryFit(platform, code)` → `native | cross-border | unavailable`.

### 2. Arayüzde uyarı ve akıllı ön seçim
`src/routes/index.tsx` platform seçicisinde:
- Seçili ülkede çalışmayan platformlar soluk gösterilir ve "bu ülkede kullanılamıyor" rozetiyle işaretlenir.
- Ülke değişince o ülkenin ana platformları önerilir (mevcut seçim silinmez, "önerilenleri uygula" düğmesi eklenir).

### 3. İstemin ülke + platform bilgisiyle zenginleştirilmesi
`src/lib/gemini.functions.ts`:
- İkili turkey/global bloğu yerine, seçilen ülkenin adı, para birimi, KDV/vergi etiketi, kolaylıkları ve zorlukları ile seçili her platformun o ülkedeki komisyon aralığı ve teslimat gerçeği istemin zorunlu kısıt bölümüne yazılır.
- Zorunlu kural: ürünün talep kanıtı hedef ülke pazarından olmalı; fiyatlar ülkenin para biriminde verilmeli; ülkeye özel sertifika/gümrük engeli olan ürünler (ör. AE için ESMA, SA için SABER, DE için ambalaj kaydı) elenmeli veya engel açıkça yazılmalı.
- Arama açılarının bir kısmı ülkeye özel hale getirilir (yerel trend, yerel platform en çok satanlar).

### 4. Elemede ülke/platform kapısı
`src/lib/winner-gate.server.ts` + `src/lib/winner-score.ts`:
- Ürünün `platform_fit` alanı seçili platformlarla kesişmiyorsa ürün reddedilenler paneline "platform uyumsuz" gerekçesiyle düşer.
- Ülke uygunluğu düşük olan adaylar (yasak/sertifika riski, 25+ gün teslimat, ülke skoru düşük) skorda ceza alır; Winner Score kırılımına "Ülke & platform uyumu" bileşeni eklenir, kanıt panelinde kaynak olarak platform komisyon/ülke vergi referansları gösterilir.

### 5. Ekonomi hesabı ülkeye bağlanır
`src/lib/real-economics.ts` zaten ülke ve sektör kıyas verisi tutuyor; komisyon hesabı seçilen platformun o ülkedeki gerçek oranıyla, vergi ise hedef ülkenin KDV'siyle çalışacak şekilde bağlanır ve kâr rakamları ülkenin para biriminde de gösterilir.

## Teknik notlar

- Yeni dosya: `src/lib/platform-market.ts` (istemci güvenli, saf veri + yardımcı fonksiyonlar).
- Değişecek dosyalar: `src/lib/gemini.functions.ts` (istem + kapı), `src/lib/winner-score.ts`, `src/lib/winner-gate.server.ts`, `src/lib/real-economics.ts`, `src/routes/index.tsx`.
- Mevcut özelliklerin hiçbiri kaldırılmaz; Turkey/Global modu geriye dönük uyumlu kalır.
