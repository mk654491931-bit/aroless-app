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
| Render             | Render Blueprint (`render.yaml`) → **Web Service** → `npm install && npm run build` / `npm start`           |
| Node sunucu / VPS  | `npm run build` → `npm run start` (`.output/server/index.mjs`)                                             |
| Vercel             | `npm run build` → Vercel'in Nitro/Vercel preset'i; fonksiyon süresi plan limitlerine tabidir                |
| Lovable            | Publish butonu; env değerleri proje secret'larından okunur                                                  |

### Render'a taşıma (önerilen backend deployment)

Bu repo Render için **Static Site değil, Web Service** olarak yapılandırıldı. `render.yaml` şu ayarları kullanır:

- Nitro `render_com` preset'i ile persistent Node server
- Build: `npm install && npm run build`
- Start: `npm start` → `.output/server/index.mjs`
- Health check: `/health`
Render'ın **ücretli `1c-2g` planı** ile başlamak, ağır AI işlerinde cold start ve bellek baskısını azaltır; bütçe kısıtlıysa Blueprint'te planı `free` veya `0.5c-512mb` olarak değiştirebilirsin, ancak ücretsiz servis uykuya geçebilir.

Kurulum:

1. GitHub'da repo erişimi olan Render hesabında **New → Blueprint** seç ve `render.yaml` dosyasını göster.
2. Servis tipinin **Web Service** olduğunu kontrol et; Static Site seçme.
3. İlk deploy'dan önce aşağıdaki secret'ları Render Dashboard → **Service → Environment** bölümüne ekle.
4. Deploy tamamlanınca `https://<servis-adı>.onrender.com/health` adresinin `{"status":"ok"}` döndürdüğünü kontrol et.
5. Custom domain olarak `aroless.tech` ekle ve DNS kayıtlarını Render'ın verdiği hedefe yönlendir.
6. Supabase Dashboard → **Authentication → URL Configuration** içinde Site URL ve Redirect URLs'e canlı domaini ekle; Google OAuth redirect ayarlarını da güncelle.

#### Render Environment değişkenleri

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
JOB_WORKER_SECRET
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

QStash'in callback adresi `https://aroless.tech/api/worker` olacağı için `APP_URL` kesinlikle Render servisinin geçici adresi değil, DNS geçişinden sonra gerçek canlı domain olmalıdır. `JOB_WORKER_SECRET`, QStash forward secret ile aynı değer olmalıdır.

#### 504 koruması (Render'ın en kritik ayarı)

Render kalıcı bir Node servisi çalıştırır: istek yanıtlandıktan sonra süreç yaşamaya devam eder. Bu yüzden ağır işler **istek içinde beklenmez**:

| Katman | Dosya | Davranış |
| --- | --- | --- |
| Arka plan kuyruğu | `src/lib/job-runner.server.ts` | Ürün bulucu ve AI Konsey işleri süreç içinde arka planda koşar, istek anında `jobId`/`processing` döner. **QStash anahtarı girilmemiş olsa bile çalışır.** |
| Önbellek | `src/lib/swr-cache.server.ts` | `ready` / `stale` / `warming`: bayat veri anında döner, tazesi arka planda üretilir; istek asla platform kesme süresine dayanmaz. |
| Bütçeler | `src/lib/host-runtime.server.ts` | Platform algılama (Render / Vercel / kalıcı Node) ve istek süresi üst sınırları tek kaynaktan. |
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
| **Ücretsiz** (önerilen) | Yalnız Vercel Hobby. Vercel env'de `QSTASH_TOKEN` + `JOB_WORKER_SECRET` olsun; **`DISCOVERY_WORKER_URL`/`WORKER_URL` BOŞ kalsın** | `workflow.dispatch: "qstash"` |

Boş kalması şu demektir: iş, uygulamanın kendi origin'ine
(`https://<domain>/api/worker`) QStash ile yayınlanır. Bu **ayrı bir fonksiyon
çağrısıdır** — kullanıcının isteği anında `jobId` ile döner, ağır hat arka
gönde koşar, ön sonuçlar yoklamada görünür. Ayrı servis, uyku, soğuk başlangıç
yoktur ve hiçbir şey ücretli plan gerektirmez.

QStash anahtarları hiç yoksa hat istek içinde (`inline`) koşar: yine 280 sn sözü
korunur (260 sn < 300 sn), ama ön sonuç/arka plan dayanıklılığı olmaz.

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

Kalıcı süreçte (Render / kendi Node sunucusu) koruma devre dışıdır: orada platform
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
| Vercel Hobby | fonksiyon başına 300 sn (varsayılan = üst sınır), 2 GB / 1 vCPU, 4.5 MB gövde | Uygulama + `/api/worker` |
| Upstash QStash | günde 1.000 mesaj, mesaj başına 1 MB, yanıt süresi en fazla 15 dk (tekrar denemeler de mesaj sayılır) | Ağır işi `202` ile arka plana atar; kota dolarsa hat istek içinde koşar (`discoveryFallbackDecision`) |
| Upstash Redis | günlük komut kotası | AI/ürün önbelleği (kalıcı SWR katmanı) |
| Supabase | ücretsiz proje | Kimlik, veritabanı, `search_jobs` kuyruğu, `ai_cache` (araç sonuçları dahil) |
| AI sağlayıcı havuzu | Sağlayıcı başına ücretsiz kota (`*_API_KEY_1..8` ile dağıtılır) | **En dar kaynak** → araç önbelleği burayı korur |

> **Modal.com / kiralık GPU gerekmez:** hat GPU'ya değil dış AI API'lerine bağlıdır
> (I/O-bound). 300 sn'lik duvar hesaplamadan değil platformun fonksiyon süresinden
> gelir; kiralanan bir GPU bu duvarı kaldırmaz, çünkü çağrı yine Vercel
> fonksiyonunun içinde bekler. Kalıcı worker için ek servis açmak yerine mevcut
> QStash + Vercel yolu kullanılır.

> **Render ücretsiz planı bu iş için uygun değil:** 15 dk hareketsizlikte uyur ve
> geri açılması ~1 dk sürer (bu süre hat bütçesinden düşülür, yani kaliteden
yer), "harici API/veritabanı trafiği" nedeniyle askıya alınabilir ve aylık 750
> instance saat sınırı vardır. Worker için ücretli instance açmıyorsanız Render'ı
> hiç kullanmayın.

#### Hibrit kurulum: tetikleyici Vercel + worker Render (ücretli instance)

Ağır işi kalıcı bir sürece devretmek isterseniz (Render **ücretli** instance):

| Kurulum | Ne yapılır | `/health` çıktısı |
| --- | --- | --- |
| **Domain Render'da** | `render.yaml` ile Web Service aç, `APP_URL=https://aroless.tech` | `workflow.dispatch: "in-process"`, `longJob: "in-process"` |
| **Domain Vercel'de, worker Render'da** | `WORKER_URL=https://<servis>.onrender.com` (+ `DISCOVERY_WORKER_URL=.../api/worker`), `QSTASH_TOKEN`, `JOB_WORKER_SECRET` | `workflow.dispatch: "qstash"`, `longJob: "qstash-worker"` |

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

# AWS/SES kullanılıyorsa
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION
AWS_SES_FROM_EMAIL
```

Render'a **değer değil, yalnızca anahtar adı** `render.yaml` içinde yazılır; gerçek değerleri Dashboard → Environment'e gir. Secret'ları Git'e, `render.yaml`'a veya `.env.example`'a yazma.

#### Hibrit kurulum (frontend Vercel + worker Render)

Vercel'deki fonksiyon limiti (güncel Hobby'de 300 sn) yalnızca tetikleyici isteğini
etkiler; ağır iş QStash üzerinden Render'a devredilebilir. Bunun için **Vercel**
tarafına şunu ekle:

```text
DISCOVERY_WORKER_URL=https://aroless.tech/api/worker
JOB_WORKER_SECRET=<Render'dakiyle aynı değer>
QSTASH_TOKEN=<aynı QStash token'ı>
```

`DISCOVERY_WORKER_URL` tanımlı olduğu anda `qstashTimeoutSeconds()` hem Render'ı
hem de bu değişkeni gördüğü için QStash bekleme süresi 60 sn yerine 890 sn'ye
çıkar; istemci yoklama bütçesi de tetikleyicinin barındığı host'a göre hesaplanır.
Bu değişken olmadan hibrit kurulumda uzun iş yine 60 sn'de 504 olarak kesilir.

#### Paket yöneticisi / lockfile

Render ve Vercel `npm install` kullanır, yani dağıtımda **`package-lock.json`**
geçerlidir. `bun.lock` yerel geliştirme içindir; bağımlılık değiştirdikten sonra
iki dosyanın da güncel kaldığından emin ol (aksi halde CI ile yerel ortam farklı
ağaç kurar).


- `nitro` kurulu değilse `npm run build` düz Vite SSR çıktısı üretir; geliştirme ve
  `npm run preview` için bu yeterlidir, Cloudflare dağıtımı için `nitro` gerekir.
- Sunucu ilk isteği aldığında zorunlu değişkenleri kontrol eder ve eksikse konsola
  tek satırlık uyarı basar (`[env] Eksik zorunlu değişken(ler): ...`).
- `.env` asla depoya girmez; `.env.example` güncel şablon olarak tutulur.

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
