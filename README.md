# Aroless

E-ticaret büyüme paneli: ürün bulucu, kazanan ürün radarı, ROI takibi, mağaza denetçisi, reklam kreatif stüdyosu ve eğitim simülatörü.

Teknoloji: TanStack Start (React 19) + Vite + Tailwind v4 + Supabase.

## Hızlı kurulum (VS Code / Codespaces / herhangi bir makine)

Gereken tek şey: bir Supabase projesi ve `.env` dosyası.

```sh
# 1) Bağımlılıklar (bun veya npm)
npm install          # ya da: bun install

# 2) Ortam değişkenleri
cp .env.example .env # değerleri doldur

# 3) Veritabanı şeması (tek komut)
npx supabase link --project-ref <PROJE_REF>
npx supabase db push

# 4) Geliştirme sunucusu
npm run dev          # http://localhost:8080
```

Üretim derlemesi: `npm run build` → `dist/` (Cloudflare/Nitro çıktısı).

## Google ile giriş

1. Supabase panelinde **Authentication → Providers → Google** açılır.
2. Google Cloud Console'da OAuth istemcisi oluşturulur; **Authorized redirect URI** olarak
   `https://<PROJE_REF>.supabase.co/auth/v1/callback` eklenir.
3. Supabase **Site URL** ve **Redirect URLs** listesine uygulama adresleri eklenir:
   `http://localhost:8080/auth/callback` ve üretim adresiniz.

Uygulama `supabase.auth.signInWithOAuth` kullanır — hiçbir üçüncü parti köprü gerekmez.

## Opsiyonel servisler

Aşağıdakiler `.env`'de boş bırakılırsa özellik otomatik devre dışı kalır, uygulama çalışmaya devam eder:

| Değişken                                               | Etki                                                              |
| ------------------------------------------------------ | ----------------------------------------------------------------- |
| `GEMINI_*`, `GROQ_*`, `OPENROUTER_*`, `HUGGING_FACE_*` | AI motorları (havuz hâlinde sırayla döner, rate-limit'e takılmaz) |
| `AI_GATEWAY_URL` + `AI_GATEWAY_API_KEY`                | Ek OpenAI uyumlu ağ geçidi (yedek motor)                          |
| `COUNCIL_CONCURRENCY`                                   | 14 ajanın aynı anda koşan rol sayısı (1-8, varsayılan 4)        |
| `RESEND_API_KEY`                                       | E-posta gönderimi                                                 |
| `VITE_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY`     | Bot koruması                                                      |

En az bir AI anahtarı önerilir; hiçbiri yoksa AI özellikleri hata yerine "yapılandırılmadı" uyarısı verir.

## Komutlar

| Komut             | Açıklama                   |
| ----------------- | -------------------------- |
| `npm run dev`     | Geliştirme sunucusu (8080) |
| `npm run build`   | Üretim derlemesi           |
| `npm run preview` | Derlemeyi yerelde çalıştır |
| `npm run lint`    | ESLint                     |

## GitHub Codespaces

Depo Codespaces'te açıldığında `.devcontainer/devcontainer.json` otomatik olarak
Node 22 kurar, `.env` dosyasını `.env.example`'dan oluşturur, bağımlılıkları yükler
ve 8080 portunu yönlendirir. Sonrasında tek yapman gereken `.env` içindeki
Supabase ve AI anahtarlarını doldurup `npm run dev` demek.

Ek komutlar: `npm run setup` (env + install), `npm run typecheck` (TypeScript kontrolü).

## Üretime alma (canlı)

Aynı kod tabanı lokal, preview ve canlıda değişiklik gerektirmeden çalışır; sadece
ortam değişkenleri hedef platformun secret ekranına girilir. Sabit domain yazılı
hiçbir yer yoktur — OAuth ve paylaşım linkleri `window.location.origin` üzerinden
üretilir.

| Hedef              | Adımlar                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| Cloudflare Workers | `npm run build` → `npx wrangler deploy` (Nitro `cloudflare-module` preset'i ile `dist/` üretilir)           |
| **Vercel Hobby**   | **Önerilen.** `npm run build` (Nitro `vercel` preset'i) + QStash kuyruğu; ücretsiz, kalıcı servis yok            |
| Node sunucu / VPS  | `npm run build` → `npm run start` (`.output/server/index.mjs`)                                             |
| Vercel             | `npm run build` → Vercel'in Nitro/Vercel preset'i; fonksiyon süresi plan limitlerine tabidir                |
| Lovable            | Publish butonu; env değerleri proje secret'larından okunur                                                  |

### Vercel Hobby + QStash'e taşıma (önerilen deployment)

Bu repo **Vercel'e** bağlıdır; ikinci bir platform (kalıcı Node servisi) yoktur.
Ağır işler uygulamanın **kendi** `/api/worker` ucuna QStash ile yayınlanır, yani
ayrı servis açmanız gerekmez.

- Build: `npm install && npm run build` (Nitro `vercel` preset'i)
- Health check: `/health`
- Fonksiyon tavanı: 300 sn (`nitro.config.ts`), `VERCEL_FUNCTION_MAX_DURATION` ile ezilebilir

Kurulum:

1. Vercel'de projeyi `aroless-repo` dalına bağla (Settings → Git → Production Branch).
2. Aşağıdaki secret'ları **Project → Settings → Environment Variables** ekranına ekle
   (üretim + önizleme için ayrı ayrı işaretlenebilir).
3. Deploy bitince `https://www.aroless.tech/health` adresinin `{"status":"ok"}` ve
   `commit` alanının yeni commit'i döndürdüğünü kontrol et.
4. `/health` → `workflow.dispatch` = `qstash` ve `discoveryChain.missing` = `[]` olmalı.
5. Custom domain olarak `aroless.tech` ekle ve DNS kayıtlarını Vercel'in verdiği hedefe yönlendir.
6. Supabase Dashboard → **Authentication → URL Configuration** içinde Site URL ve Redirect URLs'e canlı domaini ekle; Google OAuth redirect ayarlarını da güncelle.

#### Vercel Environment değişkenleri

**Zorunlu çekirdek değişkenler:**

```text
APP_URL=https://aroless.tech
PUBLIC_APP_URL=https://aroless.tech
VITE_APP_URL=https://aroless.tech
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY
```

**Ürün bulucu asenkron işleri için:**

```text
QSTASH_TOKEN
QSTASH_CURRENT_SIGNING_KEY
QSTASH_NEXT_SIGNING_KEY
JOB_WORKER_SECRET
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

QStash'in callback adresi `https://aroless.tech/api/worker` olduğu için `APP_URL` gerçek canlı domain olmalıdır. `JOB_WORKER_SECRET`, QStash forward secret ile aynı değer olmalıdır.

> `QSTASH_TOKEN` (yayınlama) ile `QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY`
> (imza doğrulama) **farklı iki şeydir**; ikisi de QStash panelinde ayrı yerlerde
> görünür. İmza anahtarları tanımlı değilse Product Discovery hattının her adımı
> 401 ile reddedilir.

#### 504 koruması (Vercel Hobby'de en kritik ayar)

Vercel fonksiyonu 300 sn'de öldürür (`504 FUNCTION_INVOCATION_TIMEOUT`). Bu yüzden ağır işler **istek içinde beklenmez**:

| Katman | Dosya | Davranış |
| --- | --- | --- |
| Arka plan kuyruğu | `src/lib/job-runner.server.ts` | Ürün bulucu ve AI Konsey işleri süreç içinde arka planda koşar, istek anında `jobId`/`processing` döner. **QStash anahtarı girilmemiş olsa bile çalışır.** |
| Önbellek | `src/lib/swr-cache.server.ts` | `ready` / `stale` / `warming`: bayat veri anında döner, tazesi arka planda üretilir; istek asla platform kesme süresine dayanmaz. |
| Bütçeler | `src/lib/host-runtime.server.ts` | Platform algılama (Vercel / kendi Node sunucumuz) ve istek süresi üst sınırları tek kaynaktan. |
| Teşhis | `GET /health` | Platform, istek bütçesi, arka plan kuyruğu ve önbellek sayaçları (sır içermez). |

İsteğe bağlı ayarlar — boş bırakılırsa akıllı varsayılanlar kullanılır:

```text
REQUEST_BUDGET_MS=45000            # tek etkileşimli isteğin üst sınırı
BACKGROUND_JOB_CONCURRENCY=2       # aynı anda arka planda koşan iş (1..8)
BACKGROUND_JOB_TIMEOUT_MS=900000   # tek işin sert zaman aşımı (ms)
WARM_WAIT_MS=20000                 # soğuk önbellekte istek içi bekleme (ms)
HOT_PRODUCTS_WAIT_MS=14000         # sıcak ürün taraması bekleme (ms)
BACKGROUND_JOBS=                   # 0/1: arka plan işlerini zorla kapat/aç
```

Bir 504/hata şikâyetinde ilk bakılacak adres: `https://<domain>/health`.

#### ÜCRETSİZ kurulum (önerilen): yalnız Vercel Hobby + QStash

Ücretli/kalıcı sunucu **gerekmez**. Vercel Hobby fonksiyon tavanı 300 sn'dir (fluid
compute ile varsayılan ve üst sınır) ve hat 260 sn'de kendi kendine biter; bu
yüzden ağır iş uygulamanın **kendi** `/api/worker` ucunda güvenle koşar:

| Kurulum | Ne yapılır | `/health` çıktısı |
| --- | --- | --- |
| **Ücretsiz** (önerilen) | Yalnız Vercel Hobby. Vercel env'de `QSTASH_TOKEN` + `JOB_WORKER_SECRET` olsun; **`DISCOVERY_WORKER_URL`/`WORKER_URL` BOŞ kalsın** | `workflow.discoveryChain.mode: "qstash"` |

> ⚠️ **HANGİ ANAHTAR EKSİK?** `/health` → `workflow.discoveryChain.missing`
> eksik anahtarları **adlarıyla** listeler. `workflow.dispatch` tek BAŞINA
> yeterli bir gösterge DEĞİLDİR: o yalnız token + sır arar, Product Discovery
> zinciri ise imza anahtarını da ister. İkisi çeliştiği için teşhis sessizce
> yanlış yönlendirirdi (panel “qstash” der, hat `inline` çalışır, kullanıcı
> zaman aşımı görür).

Boş kalması şu demektir: iş, uygulamanın kendi origin'ine
(`https://<domain>/api/worker`) QStash ile yayınlanır. Bu **ayrı bir fonksiyon
çağrısıdır** — kullanıcının isteği anında `jobId` ile döner, ağır hat arka
gönde koşar, ön sonuçlar yoklamada görünür. Ayrı servis, uyku, soğuk başlangıç
yoktur ve hiçbir şey ücretli plan gerektirmez.

QStash anahtarları hiç yoksa hat istek içinde (`inline`) koşar: yine 280 sn sözü
korunur (260 sn < 300 sn), ama ön sonuç/arka plan dayanıklılığı olmaz.

#### Product Discovery hattı (Vercel) — gereken anahtarlar

Yeni hat (`/api/product-discovery/*`) dört adımlık QStash zinciridir ve Vercel'de
şu anahtarlar olmadan **çalışmaz** (kod değişikliği değil, env eksikliği):

| Anahtar | Zorunlu | Neden |
| --- | --- | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | evet | İş kaydı, sahiplik ve kredi iadesi servis rolüyle yazılır (RLS bypass) |
| `QSTASH_TOKEN` | evet | Adımları kuyruğa alan yayınlama isteği |
| `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` | hayır** | Adım uçlarının JWS imza doğrulaması. **Zorunlu DEĞİLDİR:** adım ucu yayıncının ilettiği `x-job-secret` başlığını da kabul eder (fail-closed). Tanımlıysa ikinci bir katmandır |
| `GEMINI_API_KEY` (veya `GEMINI_API_KEY_1..8`) | evet | Yalnız iki AI adımı: Top 75→15 kısa liste ve 14 ajan konseyi |
| `JOB_WORKER_SECRET` | evet | Yayınlama için işçi sırrı; teslimatın doğrulanmasında da kullanılır |
| `APP_URL` | önerilir | Adım adresleri boş env'den istek origin'ine düşer; sabit adres daha güvenli |
| `COUNCIL_CONCURRENCY` | hayır | 14 ajanın aynı anda koşan rol sayısı (1-8, varsayılan 4) |

Eksik anahtar davranışı kontrollüdür: kredi düşülür, `503` döner ve kredi tam
bir kez iade edilir — kullanıcı çalışmayan bir iş için ödeme yapmaz.

#### Kurulumu 30 saniyede doğrulama: `/health`

Zinciri çalıştırmadan önce **tek komut** yeterlidir:

```sh
curl -s https://<domain>/health | jq .workflow
```

Burada **üç** alana bak. Kullanıcının “Arka plan analizi zaman aşımına uğradı”
demesinin üç ayrı sebebi burada ADIYLA görünür:

| Alan | Sağlıklı değer | Semptom |
| --- | --- | --- |
| `discoveryChain.mode` | `"qstash"` | `inline` ise ağır hat tek istekte koşuyor, platform tavanına dayanır |
| `discoveryChain.missing` | `[]` | Doluysa kuyruk kurulu **görünüyor** ama hiçbir adım çalışmıyor |
| `discoveryStore.ok` | `true` | `false` ise iş kaydı yazılamıyor; zincin sessizce klasik hatta düşüyor ve 280 sn sonra zaman aşımı çıkıyor |

`discoveryStore.missing` doluysa en sık sebep **`SUPABASE_SERVICE_ROLE_KEY`**
eksikliğidir: `jobStore()` servis rolü olmadan iş kaydı açamaz ve arayüz bunu
göremeden eski hatta iner. Bu anahtar **anon değil, service-role** olmalıdır.

#### Hat gerçek ağda doğrulandı

Zincirin kendisi (kazıma → 75 → 25 → 14 ajan → 5) canlı ağda uçtan uca
çalıştırılmış ve **çalıştığı kanıtlanmıştır** — üç gerçek nişte ölçülen süre:

| Niş | Kazıma | → 75 | → 25 | 14 ajan | Toplam |
| --- | --- | --- | --- | --- | --- |
| air fryer | 4.2 sn | 41 aday | 25 | 5 ms | **4.2 sn** |
| robot vacuum | 1.5 sn | 47 aday | 25 | 6 ms | **1.5 sn** |
| standing desk | 1.8 sn | 56 aday | 25 | 2 ms | **1.8 sn** |

Tekrarlamak için:

```sh
PRODUCT_DISCOVERY_E2E_LIVE=1 PRODUCT_DISCOVERY_E2E_NICHES="air fryer,robot vacuum" \
  npx vitest run src/lib/product-discovery.e2e.live.test.ts
```

Bu, “zaman aşımına uğradı” belirtisinin **hattan değil, hatta ulaşan istekten /
kuyruktan** kaynaklandığını gösterir: boru hattı saniyeler içinde bitiyor.

#### Ürün kalitesi: ölçüleni yaz, ölçülmeyeni `null` bırak

Ürün bulucunun ilk aşaması dört katmana ayrılır ve **hiçbiri değer uydurmaz**:

| Katman | Dosya | Ne yapar |
| --- | --- | --- |
| Kaynak kapısı | `product-discovery-filter.server.ts` | Ürün SATMAYAN kaynaklar (Wikipedia, GitHub, Hacker News, Reddit arşivi, haber, trend, Wikidata) aday havuzuna hiç girmez; satırlar talep bağlamı olarak yaşamaya devam eder |
| Marka çıkarımı | `product-brand.ts` | Marka kaynak alanında yoksa **başlığın kendisinden yapısal olarak** çıkarılır (`Brand: X`, model kodu öncesi öbek, `by X`). Jenerik/ürün cinsi/milliyet/pazaryeri sözcükleri marka sayılmaz — anlaşılmıyorsa `""` kalır |
| Katalog zenginleştirmesi | `product-catalog.server.ts` | Anahtarsız ücretsiz ürün kataloğu (UPCitemdb): marka · model · GTIN · kategori · kayıtlı fiyat. Yalnız eşleşme eşiğini geçen kayıtlar kullanılır ve **yalnız boş alanlar** doldurulur |
| Deal akışı | `product-discovery-sources.server.ts` (`deal-feed`) | Anahtarsız ABD indirim akışı (Slickdeals arama RSS'i): gerçek fiyat · satıcı · ürün görseli · topluluk oyu. Nişle eşleşmeyen veya fiyatı okunamayan öğe havuza **girmez**; puan/değerlendirme RSS'te olmadığı için `null` kalır |
| Kanıt bütünlüğü | `evidenceCompleteness` | 5 çekirdek yuva (fiyat · marka · satıcı · url · talep) + bonuslar. `notes` içindeki rakam talep kanıtı SAYILMAZ; talep yalnız sayısal alanlardan gelir |

İki kural, ölçülmüş iki hatayı kapatır:

1. **Türev, kanıt değildir.** Başlıktan çıkarılan marka kartta GÖSTERİLİR ama
   `brandMeasured: false` taşır ve bütünlük yuvasını doldurmaz; katalog/kaynak
   markası (`brandMeasured: true`) doldurur.
2. **Yanlış marka, marka yokluğundan kötüdür.** Katalog eşleşmesi kimlik çapası
   ister (model kodu, GTIN ya da KAYDIN markası başlıkta). Çapa yoksa benzerlik
   yarıya iner ve eşik (`CATALOG_MIN_MATCH = 0.6`) aşılamaz — aksi hâlde
   `Air Fryer 5.5L` gibi jenerik bir başlık başka bir ürünün markasını alıyordu.

Ölçülen etki (canlı, 2026-10-15, `runScrapeFilterStep`):

| Niş | Ham → aday | Marka | Kategori | Görsel | Fiyat | Satış |
| --- | --- | --- | --- | --- | --- | --- |
| air fryer / US | 53 → 21 | 6-12 (ölçülmüş 0-5) | 0-4 | 21/21 | 21/21 | 14/21 |
| robot vacuum / US | 44 → 10 | 7 | 0 | 10/10 | 10/10 | 7/10 |

Dürüst sınırlar (bunlar eksik değil, **ölçülmüş** sınırlardır): puan ve
 değerlendirme sayısı anahtarsız kaynaklarda yok (Bing Shopping bu ağdan kart
 döndürmüyor, `ratingCount` yalnız TR okuyucusunda var) — Best Buy ücretsiz
 anahtarıyla açılır; katalog ücretsiz planı sorgu başına 5 kayıt döndürüyor, bu
 yüzden katalog katkısı nişe göre 0-4 satırdır; marka boşluğu gerçek ilanların
 marka alanını yayınlamamasındandır.

**Ücretsiz kaynak eklendi: `deal-feed` (anahtarsız).** Aynı ağ koşusunda kaynak
VAR/YOK çalıştırılarak ölçüldü (`PRODUCT_DISCOVERY_AB=1`, ülke US, 9 sn dilim,
2026-10-16):

| Niş | Aday (YOK → VAR) | Fiyatlı satır | Markalı satır | ≥4/5 kanıt |
| --- | --- | --- | --- | --- |
| air fryer | 22 → **34** (+55%) | 22 → 34 | 5 → 8 | 21 → 33 |
| robot vacuum | 19 → **31** (+63%) | 19 → 31 | 11 → 15 | 16 → 26 |

Ayrıca `bestbuy-api` artık **kategori** de getiriyor (`categoryPath.name`):
ölçülen kategori boşluğu (0-4 satır) ücretsiz anahtar girildiğinde bu kaynaktan
kapanır — anahtar yokken hiç ağ çağrısı yapılmaz.

ÖLÇÜLÜP **REDDEDİLEN** ücretsiz kaynaklar (ölçmeden eklemek "çalışıyor"
iddiası olurdu): `api.mercadolibre.com` → 403 (anahtar) · Target RedSky → 435
(PerimeterX) · dealnews RSS → 404 · bensbargains RSS → 403 · Indiegogo proje
API'si → 200 ama `query` yok sayılıyor (224 sabit proje, film/yardım ağırlıklı)
· Stack Exchange (300/gün anahtarsız) → 200 ama tüketici nişleri başlıkta yok
(ürün katkısı ~0) · Open Products/Beauty Facts → 200 ama `brands` çoğu kayıtta
boş.

**Ücretsiz kaynak: `made-in-china` (anahtarsız toptan katalog, `robots.txt`'e
UYUMLU yol).** Zincirin ölçemediği üç yuvayı kapatır: **MOQ** (minimum sipariş),
**tedarikçi firma adı** ve **FOB fiyat bandı**. AliExpress kaynağı bunların
hiçbirini veremiyordu (ölçüldü: 60 kartın yalnız 10'unda mağaza adı var, MOQ hiç
yok). Kaynak `aliexpress` ile **paralel** çalışır ve aynı aylık kota kovasını
paylaşır (`SUPPLIER_MONTHLY_LIMIT`); biri hata verirse diğeri eskisi gibi
çalışmaya devam eder (fail-soft).

**YOL DEĞİŞİKLİĞİ — uyum + ölçüm (2026-10-16).** Eski adres
`productdirectory.do?word=…` idi ve `made-in-china.com/robots.txt` bu yolu
`Disallow: /*.do?` ile yasaklıyor. Artık kazınan yol
`products-search/hot-china-products`tır (izinli). İki yol AYNI gün
karşılaştırıldı ve **izinli yol daha zengin** çıktı (air fryer: izinli 41 kart,
bunların 31'i fiyatlı+MOQ'lu+tedarikçi adlı; yasaklı 37 kart, 37'si fiyatlı ama
yalnız 23'ünde MOQ ve 22'sinde tedarikçi adı). Ayrıca **dürüst bot User-Agent**
(`... (+https://<domain>; bot@<domain>)`) aynı içeriği döndürdü — kimliği
gizlemeye gerek yok, ve kaynak artık kullanım koşullarına uygun yoldan okunur.

Canlı ölçüm (2026-10-16, anahtar YOK, izinli yol, istek başına ~1,2 MB / 0,6-0,9 sn):

| Niş | Teklif | FOB fiyatlı | FOB aralığı | MOQ ölçüldü | Tedarikçi adı | medyan FOB | medyan MOQ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| air fryer | 30 | 30 (%100) | 23 | 30 | 30 | $20,37 | 500 |
| led desk lamp | 30 | 30 (%100) | 22 | 30 | 30 | $7,34 | 100 |
| pet water fountain | 30 | 30 (%100) | 14 | 30 | 30 | $15,23 | 100 |
| yoga mat | 30 | 29 (%97) | 26 | 30 | 30 | $4,99 | 100 |

#### Lansman kapısı: “bu ürün gerçekten atılabilir mi?”

Ölçülen tedarik kanıtı artık bir KARARA dönüşür (`src/lib/launch-readiness.ts`,
saf fonksiyon). **Yedi kapı** vardır ve her biri ya ölçülmüştür ya `unknown`dır —
**ölçülmemiş bir kapı asla `pass` sayılmaz**:

| Kapı | Ölçüm | Eşik (POLİTİKA, ölçüm değil) |
| --- | --- | --- |
| Tedarik | **Birebir** ürün teklifi var mı (niş bandı ≠ birebir) | — |
| İlk sipariş | **MOQ × FOB** (aralıkta konservatif ÜST uç) | ≤ $1.500 |
| Satış fiyatı | Ölçülen perakende fiyat | ≥ $15 |
| Brüt marj | Ölçülen toptan − perakende aritmetiği | ≥ **%60** (kargo/komisyon öncesi) |
| Reklam bütçesi | Sipariş başına katkı (perakende − toptan) | ≥ **$35** (Meta medyan CPA ≈ $38,99) |
| Rakip yoğunluğu | Aynı havuzda ayırt edici kelimelerin ≥2/3'ünü paylaşan satır sayısı | ≤ 12 |
| Mevzuat/IP | Başlıkta yasaklı kategori sözlüğü taraması (VETO yönlü) | kelime yok |

Eşiklerin gerekçesi ölçüm + kaynak araştırmasıdır: %60 brüt marj, toptan
ekonomisinin yaygın "iniş maliyetinin 2,5-3 katı satış fiyatı" kuralıdır (3 kat
= %67); %40 tabanı reklam + kargo + komisyon sonrası pay bırakmıyordu.
$35 katkı tabanı, ölçülmüş medyan CPA'nın ($38,99) altında bırakılmış güvenli
marjdır. Mevzuat/IP kapısı **yalnız veto yönünde** çalışır: kelime bulunmazsa bu
"hukuki temizlik" DEMEK DEĞİLDİR (kapı detayı bunu açıkça söyler).

`Atılabilir` denmesi için üç şart birlikte gerekir: hiçbir kapı `fail` olmayacak,
**tedarik · fiyat · marj · reklam bütçesi ÖLÇÜLMÜŞ olacak** ve hepsi geçecek.
Ürün kartında kapı kapı yeşil/kırmızı/kesik-çizgi olarak görünür; sunucuda
hesaplanır (kohort rekabet sayısı yalnız orada bilinir) ve karar ürünle birlikte
taşınır. Sıralamada da **eşit oy ve eşit kanıtta atılabilir ürün öne geçer**
(`WINNER_LAUNCH_BONUS`, mevcut ağırlıklar değiştirilmedi; kanıtı olmayan üründe
bonus 0'dır, yani eski kayıtların sırası bozulmaz).

**NİŞ BANDI (PROXY) ATILABİLİR SAYILMAZ.** Birebir ürün teklifi bulunamazsa
kanıt aynı nişten ölçülen fiyat bandından kurulur; bu bir **proxy**'dir ve
`supplierMatchKind` alanı onu açıkça taşır. Kaynak araştırması bir kategori/niş
medyanının ürünün maliyeti yerine sessizce konmasını hatalı buluyor
("do not silently substitute its median for the item's cost"); ölçüm de bunu
doğruladı — canlı uçtan uca koşuda 30 adayın 12'si yalnız niş bandıyla
fiyatlanmıştı ve eski kod bunları da "atılabilir" sayıyordu. Artık tedarik kapısı
proxy'de `unknown`dır (değer "… çevresi (niş bandı)"), ilk sipariş kapısı MOQ'nun
bu ürüne ait olmadığını yazar ve adım notuna **`Tedarik proxy'si: N aday…`**
satırı düşer. Proxy seçimi de düzeltildi: niş havuzunda MOQ/FOB aralığı havuzun
İLK teklifinden değil, **en başlatılabilir** teklifinden alınır.

Canlı ölçüm (`MIC_LIVE=1 MIC_LIVE_NICHES="…" npx vitest run mic-supplier.live`,
perakende = 3 × medyan FOB varsayımıyla):

| Niş | Karar | Ölçülen sebep |
| --- | --- | --- |
| air fryer | ❌ Atılamaz | Reklam bütçesi: katkı $22,31 < $35 |
| led desk lamp | ❌ Atılamaz | Reklam bütçesi: katkı $20,03 < $35 |
| pet water fountain | ✅ Atılabilir | 5/7 kapı, ilk sipariş ≈ $160 (2 kapı ölçülmedi) |
| yoga mat | ❌ Atılamaz | Satış fiyatı $14,97 < $15 · katkı $9,97 < $35 |

Yoga mat örneği, kapının neden gerekli olduğunun kanıtıdır: marj iyi olsa bile
$14,97 satış fiyatı trafik maliyetini kaldırmaz — eski şema bu ürünü “yüksek
marj” diye öne çıkarıyordu. Uçtan uca canlı koşuda (air fryer) kararın etkisi
sayıyla görünür: kapı devreye girmeden önce 4/30 aday "atılabilir"di (12'si
proxy), şimdi **2/30** ve proxy'ler sayıldı.

Anahtar gerekmez. İsteğe bağlı ayarlar:

```text
CATALOG_DAILY_LIMIT=16      # günlük katalog araması (ücretsiz plan tavanı 20)
DEAL_FEED_DAILY_LIMIT=60    # günlük deal akışı okuması (nezakat bütçesi)
SUPPLIER_MONTHLY_LIMIT=400  # aliexpress + made-in-china ortak aylık kazıma bütçesi
BESTBUY_API_KEY=            # ücretsiz anahtar: kategori + GERÇEK puan + değerlendirme sayısı
```

#### Zincir süresi nerede harcanyor?

`[discovery] adım bitti: <adım> <ms> · durum=… · ürün=… · oy=…` satırı
platform loglarına düşer. Bu satır olmadan “zaman aşımına uğradı” belirtisinin
**hangi adımdan** geldiği yalnız tahminle anlaşılır; oysa hat bütçesinin
nerede harcandığını doğrudan gösterir.

#### 504'ü yapısal olarak imkânsız kılan kesme noktası (`src/server.ts`)

Sunucusuz ortamda (Vercel Hobby) fonksiyon **300 sn**'de platform tarafından
öldürülür ve yanıt `504 FUNCTION_INVOCATION_TIMEOUT` olur. Bütçesi olan uçlar
(ürün bulucu, SWR önbellekli uçlar) zaten zamanında döner; ama bütçesi olmayan
bir uç (ör. çok adımlı 14 ajanlık zincir) bu tavana dayanabilir. Bu yüzden sunucu
girişi tek bir noktada korur:

- `requestDeadlineMs()` platform limitinin 8 sn altını verir → Hobby'de **292 sn**.
- İş bu süre içinde bitmezse `504` yerine **`503` + `Retry-After`** ve
  `{ status: "warming", retryable: true, code: "REQUEST_BUDGET_EXCEEDED" }` döner
  (`/api/*` JSON, sayfa istekleri kısa bir bilgi sayfası).
- `/health` → `requestDeadlineMs` alanı bu değeri gösterir; `null` = kalıcı süreç,
  global kesme yok.

Kendi kalıcı Node sunucumuzda koruma devre dışıdır: orada platform
işi kesmez ve uç nokta bazlı bütçeler (`REQUEST_BUDGET_MS`) yeterlidir. Araç ucu da
zaman aşımında artık `504` değil `503 + Retry-After` + `code: "TOOL_WARMING"` döner —
böylece hiçbir araç "504" göstermez.

#### Araç önbelleği — ücretsiz planın en kritik tasarrufu (`src/lib/tools-cache.server.ts`)

Bu mimaride **ilk tükenecek kaynak AI sağlayıcı kotalarıdır** (QStash'ten bile önce),
çünkü her araç çağrısı bir veya daha fazla model isteğidir. Bu yüzden araç ucu
(`/api/public/tool`) artık sonucu önbelleğe alır: aynı araç + aynı girdi + aynı dil
ikinci kez geldiğinde model **hiç çağrılmaz** (kalıcı katman: `ai_cache`).

| Kademe | Süre | Araçlar | Neden |
| --- | --- | --- | --- |
| Canlı | 10 dk | `news` | Sonuç doğrudan güncel olaya bağlı; uzun önbellek geçmiş haberi "taze" gösterirdi |
| Piyasa | 3 saat | `consensus`, `price-strategy`, `arbitrage-matrix`, `listing-seo`, `review-sentiment` | Fiyat/komisyon/sıralama gün içinde değişir |
| Yapısal | 12 saat | Kalan 13 hesaplayıcı araç | Aynı girdi aynı sonucu verir; değişen kullanıcı verisidir ve o da anahtarda |

Kurallar:

- **Boş/degrade sonuç asla önbelleğe yazılmaz** (başlık + madde veya metrik şartı):
yoksa o girdi saatlerce boş sonuç döndürürdü — bu, uydurma sonuç kadar kötüdür.
- **Dil anahtarın parçasıdır** (istemci `uiLang` gönderir): Türkçe isteyen kullanıcı
İngilizce sonucu almaz.
- **Yeni araç eklenirse önbellek tanımı zorunludur**: `satisfies Record<ToolId, number>`
sayesinde politika haritası güncellenmezse derleme hata verir.
- Bilinmeyen araç önbelleğe alınmaz (politikası tanımlanmamış çıktı "canlı" gibi sunulmaz).

Etki: tekrarlanan tıklamalar hem anında döner (gecikme ↓ → platform bütçesine daha
az yük) hem de AI kotasını yakmaz ("tüm motorlar meşgul" hatası ↓).

#### Ücretsiz planların gerçek sınırları (bu kurulumun dayandığı sayılar)

| Servis | Ücretsiz sınır | Bu projedeki rolü |
| --- | --- | --- |
| Vercel Hobby | fonksiyon başına 300 sn (AÇIKÇA yazılı), 1 GB bellek, 4.5 MB gövde | Uygulama + `/api/worker` |

Platform ayarları **kasıtlı olarak `vercel.json`'da değil, `nitro.config.ts`
içinde** durur (`vercel.functions.maxDuration`, `VERCEL_FUNCTION_MAX_DURATION`
ile ezilebilir). Sebep: Vercel'in `vercel.json` şeması
`additionalProperties: false` kullanır, yani `"//yorum"` diye açıklama
anahtarları **derlemeyi şema doğrulamasında kırar** ve o commit'ten itibaren
hiçbir deployment prod'a çıkmaz. Bellek tavanı ve `NODE_OPTIONS` da aynı
sebeple eklenmedi: 1 GB lambda zaten platform varsayılanıdır, V8 yığını
taşarsa süreç `JavaScript heap out of memory` ile açıkça ölür.

| Ayar | Nerede | Değer |
| --- | --- | --- |
| `functions.maxDuration` | `nitro.config.ts` | `300` (`VERCEL_FUNCTION_MAX_DURATION` ile ezilebilir) |
| `functions.memory` | platform varsayılanı | `1024` (Hobby tavanı) |
| `regions` | platform varsayılanı | tek bölge |
| Upstash QStash | günde 1.000 mesaj, mesaj başına 1 MB, yanıt süresi en fazla 15 dk (tekrar denemeler de mesaj sayılır) | Ağır işi `202` ile arka plana atar; kota dolarsa hat istek içinde koşar (`discoveryFallbackDecision`) |
| Upstash Redis | günlük komut kotası | AI/ürün önbelleği (kalıcı SWR katmanı) |
| Supabase | ücretsiz proje | Kimlik, veritabanı, `search_jobs` kuyruğu, `ai_cache` (araç sonuçları dahil) |
| AI sağlayıcı havuzu | Sağlayıcı başına ücretsiz kota (`*_API_KEY_1..8` ile dağıtılır) | **En dar kaynak** → araç önbelleği burayı korur |
| UPCitemdb (`/prod/trial`, anahtarsız) | günde 100 istek / en fazla **20 arama**; **patlama: 2 arama / 30 sn** (ölçüldü: 3. istek `429`) | Ürün kataloğu zenginleştirmesi (marka · model · GTIN · kategori). Koşu başına en fazla **2 sorgu**, yanıt 24 saat önbellekte, günlük kova `CATALOG_DAILY_LIMIT` (varsayılan 16) |
| Best Buy API (ücretsiz anahtar: `BESTBUY_API_KEY`) | yayınlanan profil: anahtar başına günde 50.000 çağrı | ABD/CA: marka · **kategori** · GERÇEK kullanıcı puanı + değerlendirme sayısı · görsel · fiyat. Anahtar yoksa **0 ağ çağrısı** |
| Slickdeals arama RSS'i (anahtarsız) | yayınlanmış sayı YOK → günde `DEAL_FEED_DAILY_LIMIT` (varsayılan 60) nezakat bütçesi, günlük kovada | ABD indirim akışı: gerçek fiyat · satıcı · görsel · topluluk oyu; ölçüldü ~1,0-1,4 sn, aday havuzunu **%55-63** büyütüyor |

> **Modal.com / kiralık GPU gerekmez:** hat GPU'ya değil dış AI API'lerine bağlıdır
> (I/O-bound). 300 sn'lik duvar hesaplamadan değil platformun fonksiyon süresinden
> gelir; kiralanan bir GPU bu duvarı kaldırmaz, çünkü çağrı yine Vercel
> fonksiyonunun içinde bekler. Kalıcı worker için ek servis açmak yerine mevcut
> QStash + Vercel yolu kullanılır.

> **Ek servis gerekmez:** hat GPU'ya değil dış AI API'lerine bağlıdır (I/O-bound).
> 300 sn'lik duvar hesaplamadan değil platformun fonksiyon süresinden gelir.

#### Kurulum seçenekleri

| Kurulum | Ne yapılır | `/health` çıktısı |
| --- | --- | --- |
| **Yalnız Vercel Hobby (önerilen)** | `QSTASH_TOKEN` + `JOB_WORKER_SECRET` tanımlı, `DISCOVERY_WORKER_URL`/`WORKER_URL` **boş** | `workflow.dispatch: "qstash"`, `discoveryChain.mode: "qstash"` |
| **Kendi Node sunucun** | `WORKER_URL=https://<sunucu>/api/jobs` (+ `DISCOVERY_WORKER_URL=.../api/worker`) | `workflow.dispatch: "qstash"`, `longJob: "qstash-worker"` |

Sunucusuz ortamda ne QStash ne de uzak worker tanımlıysa ağır iş istek içinde
koşar; fonksiyon limiti daraltılmışsa (ör. eski `VERCEL_FUNCTION_MAX_DURATION=60`)
hızlı ve açık bir hata döner, kredi iade edilir (`longJob: "unavailable"`).

Süre bütçesi platformdan otomatik türetilir (`src/lib/host-runtime.server.ts` + `discovery-jobs.server.ts`), ama ürün bulucu TEK bir söz verir: **uçtan uca en fazla 280 sn** (`DISCOVERY_END_TO_END_MS`). Hattın kendi payı 260 sn'dir (280 − 20 sn dönüş payı) ve platform daha uzun bir limit verse bile hat bu sayıya sığar; istemcinin yoklama penceresi de aynı sabitten gelir (`jobPollingPlan`).

**Söz, tıkla anından ölçülür** (`remainingWorkerBudgetMs`): iş QStash'te beklerken
veya işçi soğuk başlarken geçen süre hattın bütçesinden düşülür. Böylece platform
ne kadar uyutursa uyutsun "tıkla → sonuç" 280 sn'yi aşmaz. Kuyruk gecikmesi
bütçeyi işe yaramaz hâle getirdiyse (kalan < 45 sn) hat **kredi harcamadan** ve
açık sebeple (`QUEUE_DELAY_EXCEEDED_BUDGET`) durur.

İş kilidi (`jobLeaseSeconds` = 310 sn) platform tavanına göre kısadır: iş ortasında
öldürülürse QStash'in tekrar denemesi işi devralabilir; eskiden 900 sn'lik kilit
yüzünden kayıt sonsuza kadar `processing` kalıyordu.

Ürünler 280 sn'yi beklemez: canlı doğrulanmış ürünler AI Konsey karneye başlamadan önce yazılır ve istemci ilk yoklamada gösterir (bkz. `publishPartial` / `markJobPartial`). Tipi bir arama ~1,5-2 dk'da ürün gösterir, karne birkaç on saniye sonra kartın üstüne gelir.

> **Vercel notu:** Eski "Hobby = 60 sn" kuralı artık geçerli değil (fluid compute ile Hobby'de de varsayılan ve üst sınır 300 sn). Bu yüzden `nitro.config.ts` varsayılanı 300'dür. Projede eski bir `VERCEL_FUNCTION_MAX_DURATION=60` değişkeni kaldıysa silin ya da 300 yapın; build ve tüm runtime bütçeleri bu tek değişkenden türediği için 60'ta kalırsanız ağır analizler fonksiyon ortasında kesilip 504 üretir.

İki değişken yalnızca gerektiğinde elle sabitlemek içindir:

```text
# QStash `Upstash-Timeout` (15..900 sn). Boşsa platforma göre seçilir.
QSTASH_TIMEOUT_SECONDS
# Sadece HİBRİT kurulumda gerekir (aşağıya bak).
DISCOVERY_WORKER_URL
```

**Özelliklere göre eklenebilenler:**

```text
# AI: her sağlayıcı için BASE adı + _1.._8 slotları otomatik taranır
#      (src/lib/ai-keys.server.ts) — hangi soneki kullanırsan bulunur.
GEMINI_API_KEY(_1..8)
GROQ_API_KEY(_1..8)
OPENROUTER_API_KEY(_1..8)
HF_TOKEN(_1..8)
CEREBRAS_API_KEY(_1..8)
SAMBANOVA_API_KEY(_1..8)
TOGETHER_API_KEY
PROVIDER_A..D_1..5 (+ PROVIDER_<X>_BASE_URL / _MODEL)
AI_GATEWAY_URL
AI_GATEWAY_API_KEY
AI_GATEWAY_MODELS

# Ödeme / e-posta / bot koruması
PADDLE_ENV
PADDLE_API_KEY
PADDLE_WEBHOOK_SECRET_KEY
PADDLE_WEBHOOK_SECRET
PADDLE_CLIENT_TOKEN
PADDLE_PRODUCT_ID
PADDLE_STARTER_PRODUCT_ID / PADDLE_PRO_PRODUCT_ID / PADDLE_BUSINESS_PRODUCT_ID
PADDLE_STARTER_PRICE_ID / PADDLE_PRO_PRICE_ID / PADDLE_BUSINESS_PRICE_ID
VITE_PADDLE_ENV
VITE_PADDLE_CLIENT_TOKEN
VITE_PADDLE_PRICE_STARTER_MONTHLY / VITE_PADDLE_PRICE_PRO_MONTHLY / VITE_PADDLE_PRICE_BUSINESS_MONTHLY
RESEND_API_KEY
RESEND_FROM_EMAIL
VITE_TURNSTILE_SITE_KEY
TURNSTILE_SECRET_KEY

# Veri kaynakları
GITHUB_PAT
OPEN_PAGERANK_KEY
TREND_WEBHOOK_SECRET
HOT_PRODUCTS_WAIT_MS

# Ürün okuyucu (Jina Reader) — her anahtar 10M token, yük paylaşılır
JINA_API_KEY_1
JINA_API_KEY_2
# Yedek okuma (Jina kota/engel verirse ürün satırı kaybolmasın) — ücretsiz katman
FIRECRAWL_API_KEY        # firecrawl.dev · 1.000 kredi/ay ücretsiz
SCRAPINGBEE_API_KEY      # scrapingbee.com · 1.000 kredi ücretsiz
# Ücretsiz katalog API'si (ABD/Kanada): gerçek fiyat + GERÇEK puan + görsel
BESTBUY_API_KEY          # developer.bestbuy.com · ücretsiz anahtar
#   (isteğe bağlı ayarlar)
# JINA_KEY_TOKEN_BUDGET  → anahtar başına bütçe (varsayılan 10000000)
# DISCOVERY_READER_PAGES → arama başına HB sayfası (varsayılan 2, 1..6)

# AWS/SES kullanılıyorsa
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION
AWS_SES_FROM_EMAIL
```

Gerçek değerler **yalnızca** Vercel'in Environment Variables ekranına girilir (veya
yerelde `.env`'e); `.env.example` sadece anahtar adlarını içerir. Secret'ları
Git'e yazma.

#### Ürün okuyucu bütçesi (Jina Reader)

Ürün satırlarının tamamı `r.jina.ai` üzerinden okunur (Hepsiburada, n11,
AliExpress, Newegg). Anahtarsız ücretsiz katman ~20 istek/dk olduğu için yoğun
saatte 429 alınır ve O SAYFANIN ürün satırları havuzdan düşer — sessiz ürün
kaybının en büyük kaynağı buydu. Ücretsiz hesap **anahtar başına 10M token**
verir; anahtarlar arasında yük paylaşılır ve kota dolan anahtar 60 sn soğumaya
alınır (`JINA_API_KEY_1`, `JINA_API_KEY_2`, … `_8`).

Ölçülen maliyet (2026-10-12, gerçek Jina gövdeleri):

| Sayfa | Karakter | Tahmini token |
| --- | --- | --- |
| Hepsiburada arama sayfası | 85.266 | ~21.300 |
| n11 arama sayfası | 58.025 | ~14.500 |
| AliExpress liste sayfası | ~34.000 | ~8.500 |
| Newegg liste sayfası | ~80.000 | ~20.000 |

Yani bir TR araması ≈ **57K token** (2 HB sayfası + n11), bir global arama
≈ 90K token. 10M tokenlık bir anahtar ≈ 175 TR aramasına yeter. Bu yüzden:

- `DISCOVERY_READER_PAGES` varsayılanı **2**'dir (eskiden 4 sayfa okunuyordu ve
  arama başına ~85K token gidiyordu — ölçülen ürün kaybı olmadan yarıya indi).
- Aynı niş 3 saat içinde tekrar aranırsa Jina'ya **hiç** istek gitmez (önbellek).
- Sayfa başına ürün görseli ölçümü: HB 37 kartın 12'sinde görsel taşır; geri
  kalanı görsel kapısında elenir. Bu kayıp `/health` → `reader.sources`
  altında `droppedNoImage` olarak görünür (sessiz kaybolmaz).

ÜLKE-KAYNAK MATRİSİ (rapor P0-4): her okuyucu yalnız ANLAMLI olduğu ülkede koşar —
`tr-reader` (Hepsiburada+n11) TR'de, `otto-reader` DE/AT/CH'de, `flipkart-reader`
IN'de, `rakuten-reader` JP'de, `newegg-reader` US/CA/GB/AU/NZ/IE'de; AliExpress
ülkeden bağımsızdır. Arama başına ölçülen maliyet: TR ≈74K · DE ≈33K · IN ≈40K ·
JP ≈33K · US ≈57K token. Ülke seçimi bu yüzden doğrudan bütçe demektir; tablo
`/health` → `reader.plan` altında ülke ülke görünür.

Canlı kanıt: `/health` yanıtındaki `reader` bloğu kaç anahtar tanımlı olduğunu,
anahtar başına okuma/token sayacını, bütçenin yüzde kaçının harcandığını ve
tahmini kalan arama sayısını gösterir. Aynı bilgi ön kontrol panelinde de
(`jina_reader` satırı) vardır.

#### Uzak işçi kullanırsanız (isteğe bağlı)

Vercel'deki fonksiyon limiti (Hobby'de 300 sn) yalnızca tetikleyici isteğini
etkiler; ağır iş QStash üzerinden başka bir kalıcı Node sürecine devredilebilir:

```text
WORKER_URL=https://<sunucu>/api/jobs
DISCOVERY_WORKER_URL=https://<sunucu>/api/worker
JOB_WORKER_SECRET=<aynı değer>
QSTASH_TOKEN=<aynı QStash token'ı>
```

`DISCOVERY_WORKER_URL` tanımlı olduğu anda `qstashTimeoutSeconds()` uzak işçiyi
gördüğü için QStash bekleme süresi 298 sn yerine 890 sn'ye çıkar; istemci yoklama
bütçesi de tetikleyicinin barındığı host'a göre hesaplanır.

#### Paket yöneticisi / lockfile

Vercel `npm install` kullanır, yani dağıtımda **`package-lock.json`**
geçerlidir. `bun.lock` yerel geliştirme içindir; bağımlılık değiştirdikten sonra
iki dosyanın da güncel kaldığından emin ol (aksi halde CI ile yerel ortam farklı
ağaç kurar).


- `nitro` kurulu değilse `npm run build` düz Vite SSR çıktısı üretir; geliştirme ve
  `npm run preview` için bu yeterlidir, Cloudflare dağıtımı için `nitro` gerekir.
- Sunucu ilk isteği aldığında zorunlu değişkenleri kontrol eder ve eksikse konsola
  tek satırlık uyarı basar (`[env] Eksik zorunlu değişken(ler): ...`).
- `.env` asla depoya girmez; `.env.example` güncel şablon olarak tutulur.

### Affiliate programı (%30 yinelenen komisyon)

Zincir: **başvuru → kod → kayıt → ödeme → komisyon → manuel ödeme (Wise/IBAN)**.

> **Bekleme süresi (hold):** bir komisyon ödenebilir hâle gelmeden önce **30 gün**
> bekler (iade/chargeback penceresi). Kural tek kaynaktan yönetilir:
> `src/lib/affiliate-payout.ts` (`PAYOUT_HOLD_DAYS`) + SQL tarafı
> (`20261014000000_affiliate_program_v2.sql`). İkisi birlikte değiştirilir.
>
> **Komisyon penceresi:** komisyon, müşteri **ücretli kaldığı sürece** her
> yenilemede yazılır — ama bir müşteri için **en fazla 12 ay**. Müşteri erken
> bırakırsa yalnız ücretli kaldığı ayların komisyonu doğar; 12 ay dolunca yeni
> komisyon yazılmaz (iade ile düşülen ay pencereyi tüketmez). Sayı tek kaynaktan:
> `src/lib/affiliate.ts` (`COMMISSION_MAX_MONTHS`) + SQL bekçisi
> (`20261015000000_affiliate_commission_cap.sql` → `enforce_affiliate_commission_cap`
> trigger'ı ve `record_affiliate_commission()` içindeki `_max_months`).
> Ayrışmayı `supabase-migrations.test.ts` testi engeller.

1. **Kod**: Admin → Affiliate Programı ekranında hesap görevlendirilir (başvuru
   beklenmez) ve o affiliate'e ÖZEL bir promo kodu bağlanır
   (`promo_codes.affiliate_id`). Kod **indirim taşımaz** (`discount_pct = 0`):
   indirimler tek kaynaktan — Paddle panelinden — yönetilir, böylece "hangi indirim
   uygulandı" sorusunun tek yanıtı olur. Admin isterse Paddle'da aynı metinle bir
   indirim kodu da tanımlar. Kullanıcının hesabına bağlı kod ödeme ekranına
   **otomatik ön-doldurulur** (`paddlePrefillDiscountCode`); kod alanı ayrıca
   açıktır (`showAddDiscounts: true`) ve yanlış bir kod kaldırılabilir
   (`allowDiscountRemoval: true`). Ön-doldurma YALNIZ indirim taşıyan
   (`discount_pct > 0`) kodlar için yapılır — affiliate kodları indirim taşımadığı
   ve Paddle'da indirim kaydı olmadığı için checkout'a **hiç gönderilmez**.
2. **Kayıt**: influencer'ın linki `https://<site>/auth?promo=KOD` biçimindedir. Kod
   URL'de yoksa `aroless.promo` localStorage anahtarından okunur (`__root.tsx`) —
   landing'e uğrayan ya da Google ile hesap açan kullanıcıda atıf böylece kaybolmaz.
   `claimPromoCode` kodu hesap açıldıktan sonra bağlar; kural: kod yalnız hesabın ilk
   30 gününde ve hesaba başka kod bağlı değilken sahiplenilir.
**Başvuru**: kullanıcı Ayarlar → Affiliate panelinden **kitle/kanal beyanı ve program
şartlarını kabul ederek** başvurur (`apply_for_affiliate()` / sunucu doğrulaması;
şart kabulü olmadan kayıt oluşmaz). Admin, başvuruyu görevlendirme formundan da
onaylayabilir.
3. **Komisyon**: her başarılı `transaction.completed` olayında
   `process_paddle_event()` komisyon satırı yazar (varsayılan **%30**;
   `affiliates.commission_rate_pct` ile değiştirilebilir). Komisyon **ödenen tutar**
   üzerinden hesaplanır: indirimli alışverişte komisyon da düşer, %100 indirimli
   (0 tutarlı) alışverişte komisyon doğmaz. Yinelenen (her fatura dönemi) ödemelerde
   de yazılır; `transaction_id` UNIQUE olduğu için aynı ödeme İKİ KEZ komisyon
   üretmez. İade/chargeback (`process_paddle_refund()`) satırı `reversed` yapar.
   Kullanıcı kodu YALNIZ Paddle ödeme ekranında girdiyse (kayıtta kullanmadıysa)
   atıf Paddle'ın indirim kaydından çözülüp `record_affiliate_commission()` ile
   yazılır ve `profiles.referred_by` bağlanır — böylece YENİLEME ödemeleri de aynı
   affiliate'e sayılır. Yeni yazılan komisyon için affiliate'e **bilgilendirme
   e-postası** gider (tekrar/iade/pencere-dolumu için gönderilmez).
   **Pencere:** her müşteri için en fazla 12 aylık ödeme komisyon üretir
   (`COMMISSION_MAX_MONTHS`); pencere dolduğunda satır yazılmaz ve webhook
   `cap_reached` durumunu ayrıca loglar — bu bir hata değildir.
4. **Ödeme (Wise/IBAN) — manuel**: eşik **$75** (`MIN_PAYOUT_CENTS`); altındaki
   bakiye devreder. Eşik **ödenebilir** (bekleme süresi dolmuş) bakiyeye göre
   değerlendirilir; beklemedeki tutar ödenemez. Ödeme yapılmadan önce affiliate'in
   **yapılandırılmış ödeme bilgisi** (yöntem + hesap sahibi + IBAN/Wise e-postası)
   kayıtlı olmalıdır; IBAN **mod-97** ile doğrulanır ve eksikse "Ödendi işaretle"
   reddeder. Vergi no alanı **opsiyoneldir**: şirket olmayan (şahıs) affiliate boş
   bırakır ve bu ödemeyi ENGELLEMEZ — alan yalnız bazı ülkelerde banka/Wise'ın
   istediği bilgi için CSV'ye taşınır. Admin "Ödendi işaretle" dediğinde satırlar `PAY-...` referansıyla
   `paid` olur; affiliate paneli birikmiş/ödenebilir/beklemede/ödenmiş toplamlarını
   ve sonraki ödeme tarihini gösterir. Toplamlar `affiliate_payout_summary()` ile
   veritabanında hesaplanır (panelde liste sınırı yoktur). Bankaya toplu girmek için
   admin panelindeki **“Ödeme listesini indir (CSV)”** düğmesi kullanılır.

Koruma: aynı cihazdan (`visitor_id`) kendi affiliate koduyla ikinci hesap açılırsa
atıf yazılmaz ve adminlere bildirim düşer, böylece %30'un kendine ödenmesi engellenir.
Kapsam sınırı: cihaz parmak izi yalnız e-posta doğrulamasından geçen kayıtlarda tutulur.

İlgili migration'lar: `20260908000000_affiliate_commissions.sql`,
`20261007000000_affiliate_payouts.sql`, `20261008000000_affiliate_codes_no_discount.sql`,
`20261014000000_affiliate_program_v2.sql` (bekleme süresi, yapılandırılmış ödeme
bilgisi, başvuru detayları + şart kabulü, indirim kodu → affiliate atfı),
`20261015000000_affiliate_commission_cap.sql` (12 aylık komisyon penceresi).

### Abonelik kredisi idempotansı (Paddle)

Ölçülen hata (gerçek Postgres 18'de `process_paddle_event` çağrılarak üretildi):
kredi **koşulsuz** ekleniyordu (`credits = credits + _search_credits`) ve
tekilleştirme yalnız `event_id` bazındaydı. Paddle aynı ödeme için birden çok olay
gönderir (`transaction.completed` + `transaction.updated`, her biri KENDİ
`event_id`siyle); uygulama katmanındaki “bu işlem kayıtlı mı?” kontrolü ÖNCE
OKU–SONRA YAZ olduğu için aynı anda gelen iki teslimatı kapatmıyor ve kredi İKİ KEZ
eklenebiliyordu. Kredi paranın karşılığıdır; iki kat vermek geri alınamaz.

Çözüm tek yerdedir ve veritabanındadır: kredi `credit_ledger` üzerinden
`ref_key = 'paddle:<işlem kimliği>'` ile **tek seferlik** talep edilir
(`ON CONFLICT (ref_key) … DO NOTHING RETURNING id`); satır yazılamadıysa kredi
artmaz. Karar tekil indekse dayanır, okuma yarışına değil. Her abonelik kredisi
ayrıca deftere düşer (`reason = 'paddle'`, işlem/olay/plan/tutar ile) — “bu
krediler nereden geldi?” sorusu artık sorgulanabilir.

| Durum | Ölçülen sonuç |
| --- | --- |
| Aynı işlem, iki farklı olay (sıralı) | kredi **BİR** kez; tek `paddle:<işlem>` satırı |
| Aynı işlem, olaylar **eşzamanlı** | kredi **BİR** kez; iki çağrı da `ok` |
| `transaction.updated` önce, `completed` sonra | kredi **kaybolmaz** (anahtar işlem kimliğidir, olay sırası değil) |
| Aynı olay kimliği tekrar | `duplicate` (eski davranış korunur) |
| Yenileme (yeni işlem kimliği) | kredi verilir |
| `credit_ledger` yoksa (göç uygulanmamış) | eski davranış: kredi yine eklenir |

Uygulama: `20261016000000_paddle_credit_idempotency.sql` (`npx supabase db push`).
Göç uygulanana kadar koruma uygulama katmanındaki kontrolde kalır; göç GEÇMİŞTE
çift eklenmiş kredileri geriye dönük düzeltmez, yalnız sonraki olayları korur.
Regresyon testi: `src/lib/paddle-credit-idempotency.test.ts` (etkin SQL tanımını ve
çağrı imzası uyumunu kilitler).

### Supabase Auth adresleri

**Authentication → URL Configuration** altında hem yerel hem canlı adresler ekli olmalı:

- Site URL: canlı adresiniz (örn. `https://app.example.com`)
- Redirect URLs: `http://localhost:8080/auth/callback` **ve** `https://app.example.com/auth/callback`

Google Cloud OAuth istemcisine de aynı iki origin ve
`https://<PROJE_REF>.supabase.co/auth/v1/callback` redirect URI'si girilir.

### Yayın öncesi doğrulama listesi

```sh
npm run typecheck
npm run build
npm run dev      # Google girişi, ürün bulucu, admin paneli akışlarını elle dene
```
