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

**Özelliklere göre eklenebilenler:**

```text
# AI: .env.example içindeki tüm tanımlı provider anahtarları
GEMINI_API_KEY_1..6
GROQ_API_KEY_1..4
TOGETHER_API_KEY
CEREBRAS_API_KEY
SAMBANOVA_API_KEY
OPENROUTER_API_KEY_1..2
HF_TOKEN_1..2
AI_GATEWAY_URL
AI_GATEWAY_API_KEY
AI_GATEWAY_MODELS

# Ödeme / e-posta / bot koruması
PADDLE_API_KEY
PADDLE_WEBHOOK_SECRET
PADDLE_CLIENT_TOKEN
PADDLE_PUBLIC_KEY
PADDLE_VENDOR_ID
PADDLE_STARTER_PRICE_ID
PADDLE_PRO_PRICE_ID
PADDLE_BUSINESS_PRICE_ID
RESEND_API_KEY
RESEND_FROM_EMAIL
VITE_TURNSTILE_SITE_KEY
TURNSTILE_SECRET_KEY

# AWS/SES kullanılıyorsa
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION
AWS_SES_FROM_EMAIL
```

Render'a **değer değil, yalnızca anahtar adı** `render.yaml` içinde yazılır; gerçek değerleri Dashboard → Environment'e gir. Secret'ları Git'e, `render.yaml`'a veya `.env.example`'a yazma.


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
