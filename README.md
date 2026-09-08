# Aroless

E-ticaret büyüme paneli: ürün bulucu, kazanan ürün radarı, ROI takibi, mağaza denetçisi, reklam kreatif stüdyosu ve eğitim simülatörü.

Teknoloji: TanStack Start (React 19) + Vite + Tailwind v4 + Supabase. Dağıtım: **Vercel**.

## Hızlı kurulum (VS Code / Codespaces / herhangi bir makine)

Gereken tek şey: bir Supabase projesi ve `.env` dosyası.

```sh
# 1) Bağımlılıklar
npm install

# 2) Ortam değişkenleri
cp .env.example .env # değerleri doldur

# 3) Veritabanı şeması (tek komut)
npx supabase link --project-ref <PROJE_REF>
npx supabase db push

# 4) Geliştirme sunucusu
npm run dev          # http://localhost:8080
```

`.env` yalnızca yerel geliştirme içindir ve depoya **girmez**. Canlı ve preview
değerleri Vercel proje ayarlarından okunur.

## Google ile giriş

1. Supabase panelinde **Authentication → Providers → Google** açılır.
2. Google Cloud Console'da OAuth istemcisi oluşturulur; **Authorized redirect URI** olarak
   `https://<PROJE_REF>.supabase.co/auth/v1/callback` eklenir.
3. Supabase **Site URL** ve **Redirect URLs** listesine uygulama adresleri eklenir:
   `http://localhost:8080/auth/callback` ve üretim adresiniz.

Uygulama `supabase.auth.signInWithOAuth` kullanır — hiçbir üçüncü parti köprü gerekmez.

## Opsiyonel servisler

Aşağıdakiler boş bırakılırsa özellik otomatik devre dışı kalır, uygulama çalışmaya devam eder:

| Değişken                                               | Etki                                                              |
| ------------------------------------------------------ | ----------------------------------------------------------------- |
| `GEMINI_*`, `GROQ_*`, `OPENROUTER_*`, `HUGGING_FACE_*` | AI motorları (havuz hâlinde sırayla döner, rate-limit'e takılmaz) |
| `AI_GATEWAY_URL` + `AI_GATEWAY_API_KEY`                | Ek OpenAI uyumlu ağ geçidi (yedek motor)                          |
| `RESEND_API_KEY`                                       | E-posta gönderimi                                                 |
| `VITE_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY`     | Bot koruması                                                      |

En az bir AI anahtarı önerilir; hiçbiri yoksa AI özellikleri hata yerine "yapılandırılmadı" uyarısı verir.

## Komutlar

| Komut               | Açıklama                     |
| ------------------- | ---------------------------- |
| `npm run dev`       | Geliştirme sunucusu (8080)   |
| `npm run build`     | Üretim derlemesi (Vercel)    |
| `npm run preview`   | Derlemeyi yerelde çalıştır   |
| `npm run typecheck` | TypeScript kontrolü          |
| `npm test`          | Birim testleri (vitest)      |
| `npm run lint`      | ESLint                       |

## GitHub Codespaces

Depo Codespaces'te açıldığında `.devcontainer/devcontainer.json` otomatik olarak
Node 22 kurar, `.env` dosyasını `.env.example`'dan oluşturur, bağımlılıkları yükler
ve 8080 portunu yönlendirir. Sonrasında tek yapman gereken `.env` içindeki
Supabase ve AI anahtarlarını doldurup `npm run dev` demek.

## Üretime alma — yalnızca Vercel

Tek desteklenen hedef Vercel'dir. `nitro.config.ts` `vercel` preset'ini sabitler;
`npm run build` istemci paketini ve SSR handler'ı, tüm sunucu fonksiyonlarını ve
`src/routes/api/` altındaki tüm rotaları birer Vercel function olarak üretir.
Ayrı bir API sunucusu, Cloudflare preset'i veya editör üzerinden yayın yoktur.

| | |
| --- | --- |
| Build komutu | `npm run build` (`vercel.json` içinde tanımlı) |
| Node | >= 20 |
| Çıktı | `.vercel/output` (Nitro Vercel preset'i) |
| Webhook adresi | `https://<alan-adınız>/api/public/webhook/paddle` |

Tüm değişken listesi ve ayrıntılar için: **`docs/VERCEL-DEPLOYMENT.md`**.

Notlar:

- `vite build`, Nitro yüklenemezse artık **hata verir**. Önceden bu import bir
  `try/catch` içindeydi ve sessizce atlanıyordu; sonuç yeşil görünen ama sunucu
  paketi olmayan bir derleme, yani canlıda 404 veren tüm `/api` rotalarıydı.
- Sabit domain yazılı hiçbir yer yoktur — OAuth ve paylaşım linkleri
  `window.location.origin` üzerinden üretilir.
- Sunucu ilk isteği aldığında zorunlu değişkenleri kontrol eder ve eksikse
  konsola tek satırlık uyarı basar (`[env] Eksik zorunlu değişken(ler): ...`).
- Veritabanı migration'ları Vercel derlemesiyle değil, Supabase CLI ile uygulanır
  (`supabase db push`).

### Supabase Auth adresleri

**Authentication → URL Configuration** altında hem yerel hem canlı adresler ekli olmalı:

- Site URL: canlı adresiniz (örn. `https://app.example.com`)
- Redirect URLs: `http://localhost:8080/auth/callback` **ve** `https://app.example.com/auth/callback`

Google Cloud OAuth istemcisine de aynı iki origin ve
`https://<PROJE_REF>.supabase.co/auth/v1/callback` redirect URI'si girilir.

### Yayın öncesi doğrulama listesi

```sh
npm run typecheck
npm test
npm run build
npm run dev      # Google girişi, ürün bulucu, admin paneli akışlarını elle dene
```
