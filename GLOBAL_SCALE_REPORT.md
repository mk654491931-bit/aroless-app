# Aroless — Global Ölçek Raporu

Tarih: 2026-10-12 · Kapsam: ürün keşfi veri katmanı + global site gereksinimleri
Yöntem: kod okuma (19 kaynak, okuyucu, FX, pipeline) + **canlı ölçüm** (16 pazaryeri,
Jina Reader, aynı gün, niş `thermos`)

---

## 0. UYGULANANLAR (2026-10-12) — rapor sonrası yapılan işler

| # | İş | Durum | Kanıt (aynı gün, canlı) |
| --- | --- | --- | --- |
| P0-2 | Genel para birimi ayrıştırıcı (€, ₹, ¥, zł, R$, TL; 3 ondalık biçimi) | ✅ | 11 birim testi; her biçim GERÇEK fiyatlarla kilitli |
| P0-1 | Otto (DE) · Flipkart (IN) · Rakuten (JP) okuyucuları | ✅ | **Otto 18 · Flipkart 35 · Rakuten 44** gerçek ürün satırı (önce 0) |
| P0-4 | Ülke-kaynak matrisi + token bütçesi | ✅ | `readerPlanFor` / `readerTokensPerSearch` + `/health` → `reader.plan`; 11 test |
| P0-3 | Görsel kıtlığı doldurucusu (listenin en çok %20'si görselsiz) | ✅ | 5 test; kapı yine görselli ürünü öne alır, kayıp sayılır |
| P1-8 | Yedek okuma: Firecrawl + ScrapingBee (ücretsiz katman) | ✅ | 4 test; anahtar yoksa hiç çağrılmaz |
| P1-8 | Best Buy katalog API'si (ücretsiz anahtar, US/CA) | ✅ | 3 test; fiyat+puan+görsel eşlemesi fixture ile kilitli |

Ek olarak: Newegg ülke kapısı artık ABD-merkezli listeye bağlı (rapor P0-4'ün
uygulaması), `/health` → `reader` bloğu anahtar/kota/token/sayfa-düşme kanıtı veriyor
ve ön kontrol panelinde `jina_reader`, `reader_fallback`, `bestbuy` satırları var.

---

## 1. Bugünkü durum (ölçülmüş)

| Katman | Durum | Kanıt |
| --- | --- | --- |
| Kaynak sayısı | 19 (`product-discovery-sources.server.ts`) | grep: 19 tanım |
| Gerçek ürün satırı veren kaynak | 3 aktif (Hepsiburada, n11, AliExpress) + 1 (Newegg, TR'de kapalı) | canlı probe |
| Okuyucu | Jina Reader, anahtar havuzu (10M token/anahtar), sayfa bütçesi 2, motor yükseltmesi | `product-discovery-reader.server.ts` |
| Arama başına token | TR ≈ 57K (2 HB + n11), global ≈ 90K (AE 2 + Newegg 2) | ölçülen gövde boyutları |
| 10M token kapasitesi | ≈ 175 TR araması / anahtar | `TOKENS_PER_SEARCH_ESTIMATE` |
| Görsel darboğazı | HB sayfası 37 kart → yalnız 12'sinde ürün görseli (%68 satır düşüyor) | canlı probe |
| Engel oynaklığı | n11: aynı gün `direct` 200 (önbellek) **ve** 1.042 karakter + Cloudflare (taze) | iki ayrı ölçüm |

Ölçülen sayfa maliyeti: HB 85.266 karakter (~21.300 token) · n11 58.025 (~14.500) ·
Otto 61.603 (~15.400) · Flipkart 91.115 (~22.800) · Rakuten 85.961 (~21.500) ·
Newegg ~80.000 (~20.000) · AliExpress ~34.000 (~8.500).

---

## 2. Global okunabilirlik ölçümü (2026-10-12, Jina, `direct` motor)

| Site | Karakter | Ürün görsel bloğu | Fiyat eşleşmesi | Sonuç |
| --- | --- | --- | --- | --- |
| Hepsiburada (TR) | 67.977 | 13 | 25 (TL) | ✅ okunur |
| Otto (DE) | 61.603 | 18 | 32 (€) | ✅ okunur — **yeni kaynak** |
| Flipkart (IN) | 91.115 | 46 | 85 (₹) | ✅ okunur — **yeni kaynak** |
| Rakuten (JP) | 85.961 | 134 | 0 (¥) | ✅ liste okunur, fiyat biçimi ayrıştırıcı ister |
| n11 (TR) | 1.042 | 0 | 0 | ⚠️ engellendi → tarayıcı motoru (kodda var) |
| Trendyol (TR) | 146 | 0 | 0 | ❌ engelli |
| Amazon US / DE | 82 / 738 | 0-1 | 0 | ❌ engelli |
| Walmart (US) | 694 | 0 | 0 | ❌ engelli |
| eBay (US) | 389 | 0 | 0 | ❌ engelli |
| Etsy (US) | 282 | 0 | 0 | ❌ engelli |
| Argos (UK) | 360 | 0 | 0 | ❌ engelli |
| Cdiscount (FR) | 99 | 0 | 0 | ❌ engelli |
| Mercado Livre (BR) | 1.044 | 1 | 0 | ❌ engelli |
| Allegro (PL) | 288 | 0 | 0 | ❌ engelli |
| Bol.com (NL) | 1.428 | 0 | 0 | ❌ engelli |

**Çıkarım:** "global" hedefi bugün 2-3 kaynağa bağlı. Üç pazar yeri (DE/IN/JP)
**hemen** eklenebilir; geri kalan büyük pazar yerleri Jina üzerinden okunamıyor,
bunlar için API'li yol (SerpAPI Google Shopping ülke parametresi / ScraperAPI /
Zenserp) veya bölgesel proxy gerekir.

---

## 3. Global ölçek için 8 yapısal boşluk

1. **Kaynak kapsamı ülke başına 2-3 site.** TR ve US dışında "ülkeye özel" okuma
   yok; kullanıcı DE/IN/JP seçtiğinde havuz ABD/global kaynaklarla doluyor.
2. **Para birimi ayrıştırıcısı yalnız ₺ ve $.** `parseTry` + `parseUsd` var; EUR,
   INR, JPY, PLN, BRL biçimleri (`1.299,00 €`, `₹1,299`, `1,980円`, `1 299 zł`)
   yok. FX katmanı hazır (`toUsd(amount, ISO)`), eksik olan metin ayrıştırma.
3. **Token bütçesi doğrusal büyüyor.** Global aramada 90K, tüm kaynaklar açıkken
   ~170K token/arama. Ülke başına kaynak seçimi + paylaşımlı önbellek olmadan
   günlük 1.000 arama ≈ 100-170M token (10-17 hesap) gerektirir.
4. **Görsel kapısı havuzun %68'ini düşürüyor** (HB ölçümü). Ürün sayfası görsel
   doğrulama katmanı var ama HB/n11 satırlarıyla bağlanmamış.
5. **Engel oynaklığı.** Aynı site aynı gün hem okunabilir hem engelli olabiliyor;
   bunu yalnız anahtar/motor düzeyinde telafi ediyoruz, "kaynak verimi" puanı yok.
6. **Kaynak verimi ölçülmüyor.** `readerHealth().sources` satır/düşme sayıyor ama
   *token başına satır verimi* yok → hangi kaynağın kapatılması gerektiği
   veriyle söylenemiyor.
7. **Site katmanı globale hazır değil.** Fiyat gösterimi tek para birimi varsayımı,
   ülke başına SEO (hreflang), dil, ödeme/support saatleri, gecikme (tek bölge
   dağıtım) ele alınmadı; KVKK/GDPR metinleri ve veri işleme notları yok.
8. **Tek sağlayıcı riski.** Bütün okuma Jina'ya bağlı; anahtar kotası dolarsa
   ürün hattı durur (yedek: doğrudan fetch + API'li kaynaklar).

---

## 4. Öncelikli öneriler (etki × efor)

### P0 — 1 hafta içinde, hepsi ölçülmüş veriye dayanıyor

| # | İş | Etki | Efor | Kanıt / kabul ölçütü |
| --- | --- | --- | --- | --- |
| 1 | **Otto (DE) + Flipkart (IN) + Rakuten (JP) ayrıştırıcıları** | 3 ülkede gerçek ürün satırı (bugün 0) | Orta (her site için ayrıştırıcı + fixture testi) | Canlı liste ≥30 satır/sayfa; fiyat + görsel + link dolu |
| 2 | **Genel para birimi ayrıştırıcı** (`€ ₹ ¥ zł R$`, hem `1.299,00` hem `1,299.00` hem `1 299`) | Yeni kaynakların fiyatı ölçülebilir olur | Düşük (saf fonksiyon + test) | Birim testleri: 12 biçim doğru sayıya çevrilir |
| 3 | **Görsel kapısını gevşet:** görselsiz satır "görsel doğrulanıyor" durumunda havuza girsin, mevcut doğrulama katmanı doldursun | TR havuzu ~3× (12 → 37 satır/sayfa) | Orta | Havuza giren satır sayısı; kartta "görsel doğrulanamadı" dürüst durumu |
| 4 | **Ülke-kaynak matrisi:** her ülke için yalnız ilgili kaynaklar + ölçülmüş token bütçesi | Arama maliyeti ~%40-60 düşer | Düşük-Orta | /health `reader.sources` + arama başına token ölçümü |

### P1 — 2-4 hafta

| # | İş | Etki | Not |
| --- | --- | --- | --- |
| 5 | **Kaynak verim puanı** (havuza giren satır / harcanan token) + eşik altı kaynağı otomatik kıs | Boşa giden kotayı keser | Sayaçlar hazır; yalnız oran + eşik eklenir |
| 6 | **Önbellek paylaşımı ve ön ısıtma:** niş anahtarı ülkeden bağımsız; popüler nişleri günlük cron ile tazele | Aynı nişte tekrar aramada Jina'ya 0 istek | Cron altyapısı var (`/api/cron/radar-refresh`) |
| 7 | **Kota alarmı:** bütçe %80'e gelince uyarı (log + e-posta) | Hat kesintisiz kalır | `readerHealth().budgetUsedPct` hazır |
| 8 | **Engel yedek yolu:** SerpAPI Google Shopping ülke parametresi (anahtar varsa) + ScraperAPI karşılaştırması | Amazon/Walmart/Trendyol satırları | Ücretli; önce ücretsiz kota ile ölç |

### P2 — çeyrek hedefi (site katmanı)

9. **Ülke/para birimi deneyimi:** otomatik yerel para birimi seçimi + kullanıcı
   seçimi, ülke başına fiyat biçimi, "kargo/vergi hariç" dürüst etiketler.
10. **SEO ve dil:** ülke başına `hreflang`, yerelleştirilmiş URL'ler, mevcut
    `auto-i18n` sözlüklerinin ülke varyantları (de-DE, en-IN, ja-JP).
11. **Gecikme ve dayanıklılık:** çok bölgeli dağıtım/CDN, görsel proxy'si için
    önbellek başlıkları, kuyruk eşzamanlılık tavanı (`/health` → `jobs`).
12. **Uyumluluk:** KVKK/GDPR veri işleme notları, çerez/analitik onayı, ülke
    başına ödeme vergisi (Paddle zaten MoR).
13. **Bağımlılık dağıtımı:** Jina'ya ek ikinci okuma yolu (doğrudan fetch +
    bölgesel proxy) — tek sağlayıcı riskini böler.

---

## 5. Yol haritası

**Bu hafta:** P0-2 (para birimi ayrıştırıcı) → P0-1 (Otto; sonra Flipkart, Rakuten)
→ P0-4 (ülke-kaynak matrisi) → P0-3 (görsel kapısı).
**2-4 hafta:** P1-5, P1-6, P1-7; P1-8 için anahtar/ücret kararı.
**Çeyrek:** P2-9…P2-13 (site katmanı + uyumluluk + ikinci okuma yolu).

---

## 6. Her maddenin kanıtı nasıl üretilir

- **Canlı probe:** bu raporun tablosu yeniden üretilebilir (`X-Engine: direct`,
  `X-Return-Format: markdown`, niş sabit) — yeni kaynak eklerken aynı ölçüm.
- **Birim testi + fixture:** her yeni ayrıştırıcı için gerçek gövdelerden
  kırpılmış fixture (ağ yok, vitest).
- **`/health` → `reader`:** anahtar/kota/okuma, `sources` satır-düşme sayaçları,
  `searchesLeftEstimated`. Kota ve kaynak verimi kararları buradan okunur.
- **Uçtan uca:** bir TR ve bir DE araması koşup havuza giren satır, görselli satır
  ve harcanan token'ı ölçmek (kabul ölçütü: DE aramasında ≥20 gerçek satır).

---

## 7. Riskler ve sınırlar

- **Yasal:** pazaryeri ToS'ları otomatik okumayı sınırlayabilir; Jina üzerinden
  okuma teknik olarak çalışıyor olsa da ticari kullanımda robots/ToS gözden
  geçirilmeli, rate-limit'lere saygı gösterilmeli (kaynak başına istek tavanı).
- **Ölçüm tek güne ait:** engel durumu gün gün değişiyor (n11 örneği); rapor
  tablosu karar için başlangıç, kalıcılık için tekrarlı ölçüm gerekir.
- **Token tahminleri:** `chars/4` yaklaşımı; kesin sayaç Jina panelinde.
- **Anahtar bağımlılığı:** 10M token/anahtar varsayımı `JINA_KEY_TOKEN_BUDGET` ile
  yapılandırılabilir; ücretli plana geçilirse yalnız bu değer ve kaynak bütçesi
  güncellenir.
