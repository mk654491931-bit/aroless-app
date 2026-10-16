# Ürün Bulma Hattı — Kod Temelli Denetim

Kapsam: `/` üzerindeki klasik ürün bulucu hattı (`src/lib/gemini.functions.ts` → `WinningProduct`) ve
`/discover` üzerindeki ölçümlü Product Discovery hattı (`src/lib/product-discovery-*.ts`).
Yöntem: yalnız kod okuması. Her iddianın yanında `dosya` + sembol/satır aralığı verilmiştir.
**Çalıştırılmamıştır:** bu denetimde hiçbir hat canlı ağda koşulmadı; canlı uçtan uca test
(`src/lib/product-discovery.e2e.live.test.ts`) `PRODUCT_DISCOVERY_E2E_LIVE=1` ister ve burada
çalıştırılmadı. Sayısal örnekler yalnız kodda **yazılı olan** ölçüm hatalarından alıntıdır.

---

## 1. Özet

1. **Hattın dürüstlük mimarisi gerçek ve kodda karşılığı var.** `src/lib/discovery-quality.ts`
   (başlık, satır 1-16) "ÖLÇÜLMEYEN ŞEY TAHMİN EDİLMEZ. Skor düşer, alan `null` kalır" kuralını
   yazıyor; `src/lib/recommendation.ts` (satır 26-56) ölçülmemiş alanlar için `null` + `"—"`
   gösterimini uyguluyor. Bu, sektörde nadir bir duruş.
2. **Klasik hat (`/`) hâlâ AI'nın ürün verisi ÜRETTİĞİ hattır.** `src/lib/gemini.functions.ts`
   (satır 1-80) `callGemini` + `extractJson` ile `WinningProduct` üretiyor; `selling_price_usd`,
   `cost_breakdown`, `competition_level`, `viral_proof` bu çıktının alanları. Ölçüm hattının
   `verified: false` / "AI tahmini" etiketlemesi bu alanların çoğunda **yalnız skor dökümü
   panelinde** görünür, kartın kendisinde görünmez.
3. **`winner_score` formülünün belirgin bir kısmı sabit varsayılandır.** `src/lib/winner-score.ts`
   (`computeWinnerScore`, satır 1-120 ve 380-400): `trend_score ?? 55`, `momentum ?? 0` →
   `momentumBoost = 50`, `viral === false` → `45`; rekabet bilinmiyorsa taban `62`; marj
   ölçülmediyse nötr `50`; lojistik taban `78`; farklılaşma tabanı `35`; `realism_score ?? 45`.
   Yani veri yokluğunda elemanlar 35-78 bandına "yapışır" ve puan ayırt ediciliğini kaybeder.
   Bilinmeyen veri için verilen tek ceza `evidencePenalty` ve bu **yalnız 10 puan**
   (aynı dosya, `evidence_level === "ai_only" ? 10`).
4. **"14 ajan" etiketi koşullu bir gerçeği anlatıyor.** `src/lib/product-discovery-steps.server.ts`
   (satır 350-385) log satırı `14 ajan ... (N rol gerçek AI, M rol deterministik yedek)` yazıyor.
   Yani zaman bütçesi baskısı veya sağlayıcı hatası altında rollerin bir kısmı **AI değil
   deterministik yedektir**, ama arayüz metni "14 ajan oyladı" diyor
   (`src/routes/discover.tsx`, sonuç başlığı çipi).
5. **Nihai kalite kapısı çok düşük eşikte.** `src/lib/product-discovery-pipeline.server.ts`
   (`WINNER_MIN_COUNCIL_SCORE = 22`, `WINNER_MIN_COUNCIL_SCORE_WEAK_EVIDENCE = 33`,
   satır 1-80 ve `isWinnerWorthy` satır ~1030-1045). 100 üzerinden **22** alan bir aday
   "kazanan ürün" olarak teslim edilebilir; üstelik `MIN_DELIVERED_WINNERS` kurtarma kuralı listeyi
   boş bırakmamak için kapıdan geçmeyeni geri alıyor.
6. **Sıralamada kanıtın ağırlığı %5.** `WINNER_SCORE_WEIGHTS = { council: 0.85, confidence: 0.1,
   evidence: 0.05 }` (a.y., satır ~74). Yani "kazanan" sıralamasını fiilen **AI konsey oyu**
   belirliyor; ölçülmüş kanıt derinliği neredeyse sıralamayı değiştirmiyor.
7. **İki dosya "kanıt" tanımında birbiriyle çelişiyor.** `discovery-quality.ts`
   (`COMPLETENESS_FIELDS`, satır 97-125) `description`/`notes` alanlarını gerekçesiyle **kanıt
   saymıyor** ("serbest metin ölçüm değildir"). Buna karşılık
   `src/lib/product-discovery-filter.server.ts` (`EVIDENCE_SLOTS`, satır 1-90) talep kanıtını
   `/\d/.test(p.notes)` ile ölçüyor — notes içindeki **herhangi bir rakam** "ölçülmüş talep"
   sayılıyor. Fiyat metni bu yuvayı doldurur.
8. **Gürültü kaynakları havuzda duruyor.** `src/lib/product-discovery-sources.server.ts`
   (`PRODUCT_SOURCES`, satır 2258-2325) ticari okuyucuların (trReader, AliExpress, Newegg, Otto,
   Flipkart, Rakuten, BestBuy, Steam, SerpAPI Shopping, Bing Shopping) yanında
   `githubSource`, `hackerNewsSource`, `redditArchiveSource`, `wikipediaSource`,
   `openFoodFactsSource`, `wikidataSource`, `openLibrarySource` kaynaklarını da çalıştırıyor.
   `src/lib/product-discovery-query.ts` (başlık, satır 1-27) bu hatanın ölçülmüş kaydını taşıyor:
   "web-reviews 10 satır ← bunlar ÜRÜN DEĞİL, github 5 satır ← bunlar da ÜRÜN DEĞİL".
   `looksLikeProductRow` filtresi eklenmiş ama ayrım desen tabanlı.

---

## 2. Ölçülen / Tahmin / Bilinmiyor ayrımı ve arayüz etiketi

**Ölçülen (kaynak sayfasından okunan):** ürün başlığı, URL, görsel, fiyat, para birimi, puan,
değerlendirme sayısı, "N sold", mağaza/satıcı, kargo çıkış ülkesi.
Referans: `src/lib/product-discovery-reader.server.ts` (`ReaderRow` / `GlobalReaderRow`, satır 60-100)
ve `scrapeAliExpress` gövdesi (satır ~1510-1560: fiyatsız/görselsiz satır `no_price`/`no_image`
gerekçesiyle **sayılarak** düşürülüyor).

**Tahmin / model kurgusu:**
- `src/lib/real-economics.ts` (satır 1-80) eksik girdileri **varsayılanla doldurur** (tedarik ≈
  perakende %30'u, reklam bütçesi, iade oranı, sabit gider). Dosyanın kendisi bunu "benchmark
  tabanlı model" olarak adlandırıyor ve `benchmarks[]` içinde kaynak linklerini taşıyor. Doğru
  etiket: **model çıktısı**, ölçüm değil.
- `src/lib/supplier-economics.ts` (satır 1-45): `netMarginPct: null` **bilerek** boş; yalnız brüt
  marj (iki ölçümün aritmetiği) ve "kargoya kalan pay" yazılıyor. `SUPPLIER_MIN_RELEVANCE = 0.5`.
- `winner-score.ts`: `trend_score`, `competition_level`, `market_saturation.score`,
  `realism_score`, `viral_proof` ve `differentiation` / `review_pain_points` / `bundles` klasik
  hatta AI üretimidir; `ScoreEvidence.source` bu alanlarda `"AI tahmini"` ve `verified: false`
  yazar (satır 250-300 civarı). **Ancak bu etiket yalnız skor dökümü bileşeninde görünür.**

**Bilinmiyor (`null`):** `recommendation.ts` içindeki tüm `est_monthly_*` ve `monthly_net_*`
alanları ölçülmüş ekonomi yoksa `null` döner (`hasMeasuredEconomics` kapısı, satır 78-96).
`NOT_MEASURED = "—"` (satır 39) arayüzde bunun karşılığıdır.

**Arayüz etiketi:** kanıt seviyesi üç kademeye ayrılıyor ve etiketleniyor —
`evidenceLabel()` → "Doğrulanmış / Kısmen doğrulanmış / Yalnızca AI tahmini" (`winner-score.ts`,
`evidenceLabel`/`evidenceStyle`). Bu iyi bir tasarım. Zayıf nokta: aynı kartta AI üretimi
**fiyat ve rekabet** alanları ayrıca etiketlenmiyor; kullanıcı "AI tahmini" etiketini ancak
dökümü açarsa görüyor.

---

## 3. Aldatma / yanıltma riskleri

| # | Risk | Kanıt |
| --- | --- | --- |
| R1 | **"Kazanan ürün" dilinin eşiği düşük.** Ajan oyu 22/100 olan aday, kanıtı 3/5 ise listede kalır. | `product-discovery-pipeline.server.ts` · `isWinnerWorthy` (satır ~1030-1045), `WINNER_MIN_COUNCIL_SCORE = 22` |
| R2 | **Kapı, boş liste korkusuyla geri alınıyor.** `MIN_DELIVERED_WINNERS` kadar "kurtarma" yapılıyor; not olarak yazılıyor ama kart aynı görünüyor. | a.y. · `runFinalRankStep` kurtarma bloğu |
| R3 | **"14 ajan oyladı" ≠ 14 AI çağrısı.** Deterministik yedek roller aynı başlık altında sunuluyor. | `product-discovery-steps.server.ts` (satır 350-372) log; `src/components/discover` metni |
| R4 | **Sıralama fiilen AI oyuna bağlı**, ölçülmüş kanıt %5 ağırlıkta. | `WINNER_SCORE_WEIGHTS` (satır ~74) |
| R5 | **Klasik hatta fiyat/rekabet/marj AI çıktısıdır** ve kart bunu ölçüm gibi gösterebilir. | `gemini.functions.ts` (satır 1-80), `winner-score.ts` evidence `source: "AI fiyat önerisi"`, `verified: false` |
| R6 | **"Ölçülmüş talep" tanımı gevşek**: notes içinde rakam yeterli. | `product-discovery-filter.server.ts` · `EVIDENCE_SLOTS` (satır ~70) |
| R7 | **Ticari olmayan kaynaklar aday havuzuna giriyor** (GitHub, HN, Reddit, Wikipedia, Open Library, OpenFoodFacts, Wikidata). Bir kitap veya bir repo "ürün" olarak listelenebilir. | `PRODUCT_SOURCES` (satır 2258-2325); `discovery-quality` `sourceConfidence` düşük güvenle işaretler ama **elemez** |
| R8 | **Skor dökümü sabitlerden şişebilir**: lojistik tabanı 78, farklılaşma tabanı 35, marj nötrü 50. Ölçüm olmadan "Güçlü aday" bandına yaklaşmak mümkün. | `winner-score.ts` `logistics = 78` başlangıcı, `differentiation = clamp(35 + …)`, `margin = 50` |
| R9 | **Konsey "hakem" bağımsızlığı koşullu**: ekip puanı üretici + hakem modelden geliyor; yedek zincirde ikisi aynı sağlayıcıya düşebilir. | `council.server.ts` (başlık satır 1-21: "6 ekip × 2 model"), `TeamReport.raw_score` / `review_score` |
| R10 | **Bayat fiyat**: okuyucu önbelleği 3 saat (`CACHE_TTL_MS`, `product-discovery-reader.server.ts` satır ~50) ve SWR katmanı bayat veriyi **anında** döndürür (`swr-cache.server.ts`). Fiyat damgası (`priceStamp`) notes'a yazılıyor, ama arayüzün bunu her yerde gösterdiği doğrulanmadı. | a.y. + `swr-cache.server.ts` |

Alıntılanan iki ölçülmüş hata, ekibin bu riskleri **gerçekten** avladığını gösteriyor ve raporda
kanıt olarak duruyor:
- `supplier-economics.ts` (satır 74-84): "Frisco & Co. Extra Large Heavy Duty Dog Crate" başlığı
  kedi ağacı teklifleriyle 0,75 skorla eşleşip kartta **$83,58 sahte tedarik fiyatı** gösterdi →
  `GENERIC_WORDS` eklendi.
- `recommendation.ts` (satır 12-20): $24,99'luk ürün için "21 adet/ay, $525 ciro, −$97 net"
  üretiliyordu → artık `null` dönüyor ve `"—"` gösteriliyor.

---

## 4. Somut arıza modları

1. **Sessiz kalite düşüşü (en kritik).** Yeni şema/RPC'ler yoksa hat istisna fırlatmadan klasik
   yola iniyor; kullanıcı yalnızca sonucun zayıflığını görür. Kanıt:
   `src/lib/product-discovery-jobs.server.ts` (satır 100-119) "Migration yoksa … hat TAMAMI
   düşüyordu … canlıda görülen '14 ajan çalışmıyor' belirtisinin en olası nedeni budur".
   `SUPABASE_SERVICE_ROLE_KEY` yokluğu da iş kaydını açamıyor (README'de aynı teşhis).
2. **AI anahtarı yoksa zincir hiç koşmuyor** (`gemini_shortlist` + `deep_analysis`): kredi düşülür,
   `503` döner, kredi iade edilir. Yani "14 ajan" özelliği bu kurulumda **ulaşılamaz** (README
   "Product Discovery hattı — gereken anahtarlar" tablosu).
3. **Zaman aşımı / dilim bütçesi.** Her teslimat bir dilim (varsayılan 10 sn, işe 7 sn;
   `product-discovery-slices.server.ts` satır 50-120) koşar. Dilim yetmezse iş ara noktaya yazılıp
   sıradaki dilim yayınlanır; adım 16 dilimde zorla bitirilir. Bu tasarım doğru, ama **kalan iş
   deterministiğe düşerek** bittiğinde sonuç AI'sız yedeklerle üretilir ve kullanıcı bunu görmez.
4. **Aday kaybı görsel/fiyat kapısında.** Ölçülmüş olgu: "HB sayfası 37 kart döndürürken yalnız
   12'sinde ürün görseli var; satır kaybının %68'i görsel kapısında"
   (`product-discovery-reader.server.ts`, satır ~1444-1455). Kayıp **sayılıyor** (`noteSourceDrop`)
   ama sonuç listesini belirgin şekilde daraltıyor.
5. **Boş sonuç ≠ sessiz boş sonuç.** `/discover` boş sonuçta dürüst bir mesaj gösteriyor
   (`src/routes/discover.tsx`, "Bu niş için ölçülebilir kanıt bulunamadı"). İyi.
6. **Tekrarlı ürünler.** Kimlik kaynağa göre önce `id`'ye bakıyor (`discovery-quality.ts` ·
   `stableProductId`), filtre ise `fingerprint` ile tekilleştiriyor
   (`product-discovery-filter.server.ts` başlık kuralları). Aynı ürünün iki kaynaktaki iki kaydı
   **farklı `productId`** alıp birlikte kalabilir; bunu kesin dışlayan bir kontrol okumadım.
7. **Kredi davranışı doğru kurulmuş.** `credit-charge.server.ts` (satır 1-45): yalnız gerçek AI
   çağrısında düşer, başarısızlıkta iade eder, iade `refKey` ile tek seferdir, tahsilat
   yapılamazsa AI çalıştırılmaz. Burada bulgu yok.
8. **Önbellek tazeliği dürüst ama görünürlüğü doğrulanmadı.** `priceStamp()` ölçüm anını notes'a
   yazıyor; kartta gösterildiğini doğrulamadım — bu bir **açık doğrulama borcu**.

---

## 5. Önceliklendirilmiş iyileştirmeler

| Öncelik | Ne | Neden | Dosya |
| --- | --- | --- | --- |
| P0 | Kanıt ağırlığını yükselt (`evidence: 0.05` → ≥0.2) ve `council`ı düşür | Sıralama şu an AI oyuna bağlı; "kanıtlı kazanan" iddiası bununla çelişiyor | `product-discovery-pipeline.server.ts` · `WINNER_SCORE_WEIGHTS` |
| P0 | `WINNER_MIN_COUNCIL_SCORE`'u yükselt (22 → ≥45) ve kurtarma kuralını **görünür** kıl | 22/100 alan aday "kazanan" başlığı altında sunuluyor | a.y. · `isWinnerWorthy`, `runFinalRankStep` |
| P0 | "14 ajan" metnini gerçek sayıya bağla: `N rol gerçek AI` sayısını sonuç başlığında göster; yedek oranı yüksekse ifadeyi düşür | Etiket, ölçülmemiş bir gerçeği iddia ediyor | `product-discovery-steps.server.ts` (log) + `src/routes/discover.tsx` + `src/components/search-states.tsx` |
| P1 | Klasik hatta kart üstünde alan bazlı kaynak etiketi (AI / ölçülmüş / bilinmiyor) zorunlu kıl | Fiyat-marj-rekabet AI çıktısı; etiket yalnız dökümde | `src/features/finder/components/product-card.tsx`, `winner-score.ts` |
| P1 | `EVIDENCE_SLOTS` içindeki `demand` yuvasını notes-rakamı yerine ölçülmüş sinyale bağla (puan/yorum/momentum alanı) | İki modül aynı kavramı farklı tanımlıyor; zayıf tanım kanıtı şişirir | `product-discovery-filter.server.ts` |
| P1 | Ticari olmayan kaynakları aday havuzundan **ayır** (kanıt olarak kalsın, kart olmasın) ve `looksLikeProductRow`'u test edilebilir kıl | Kitap/repo/haber "ürün" olarak listelenebiliyor | `product-discovery-sources.server.ts`, `product-discovery-query.ts` |
| P1 | Önbellek/servis durumunu (`ready`/`stale`/`warming` + fiyat damgası) kart üzerinde göster | Bayat fiyat "güncel" sanılabilir | `src/features/finder/utils/response.ts`, kart bileşeni; `swr-cache.server.ts` |
| P2 | Sessiz klasik-hat düşüşünü kullanıcıya bildir (şu an yalnız `/health`) | "14 ajan çalışmadı" şikâyetinin kök nedeni görünmez | `product-discovery-jobs.server.ts`, `src/routes/api/public/build-info.ts` |
| P2 | Konsey hakem bağımsızlığını zorla (üretici ≠ hakem sağlayıcı) ve yedek oranını metrikle | "Hakem"i aynı model oynarsa oy bağımsız değil | `council.server.ts`, `council-budget.server.ts` |
| P2 | `winner_score` sabitlerini (78/62/55/50/45/35) gerekçeli ve test edilmiş hâle getir; bilinmeyen veride **daha güçlü** ceza uygula | Veri yokluğu puanı 35-78 bandına sabitliyor | `winner-score.ts` + `src/lib/*.test.ts` |

**Doğrulama borcu (kodda kanıt bulamadığım noktalar):** fiyat damgasının kartta gösterimi,
`swr-cache` bayat durumunun arayüzde etiketlenmesi, çapraz kaynak tekrar birleştirmesi ve
"Hot Products" akışındaki (`src/lib/hot-products.ts`) `why_now` / `first_week_plan` gibi metin
alanlarının AI üretimi olup olmadığının arayüzde belirtilmesi. Bunlar bu denetimde okunmadı;
canlı uçtan uca koşu yapılmadan doğrulanmış sayılmamalıdır.
