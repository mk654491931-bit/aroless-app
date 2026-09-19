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

Bir 504/hata şikâyetinde ilk bakılacak adres: `https://<servis-adı>.onrender.com/health`.

#### Hibrit kurulum: tetikleyici Vercel + worker Render

Ağır işi yapısal olarak bitirmek için iki geçerli kurulum vardır:

| Kurulum | Ne yapılır | `/health` çıktısı |
| --- | --- | --- |
| **Domain Render'da** (önerilen) | `render.yaml` ile Web Service aç, `APP_URL=https://aroless.tech` | `workflow.dispatch: "in-process"`, `longJob: "in-process"` |
| **Domain Vercel'de, worker Render'da** | Render servisini aç; Vercel env'e `WORKER_URL=https://<servis>.onrender.com` (+ `DISCOVERY_WORKER_URL=https://<servis>.onrender.com/api/worker`), `QSTASH_TOKEN`, `JOB_WORKER_SECRET` ekle | `longJob: "qstash-worker"` |

Sunucusuz ortamda uzak worker tanımlı değilse ağır iş **istek içinde koşturulmaz**: onun yerine hızlı ve açık bir hata döner ve kredi iade edilir (`longJob: "unavailable"`). Konsey işi Render'daki `/api/jobs` ucuna QStash ile gider; uç işi süreç içi kuyruğa atıp anında `202` döner.

Süre bütçesi platformdan otomatik türetilir (`src/lib/host-runtime.server.ts` + `discovery-jobs.server.ts`): Render'da worker ~884 sn, yoklama ~14,9 dk; Vercel'de fonksiyon limiti 300 sn (Hobby güncel limiti) olduğu için worker ~284 sn, yoklama ~4,9 dk.

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

Vercel'deki 60 sn'lik fonksiyon limiti yalnızca tetikleyici isteği etkiler; ağır iş
QStash üzerinden Render'a devredilebilir. Bunun için **Vercel** tarafına şunu ekle:

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
