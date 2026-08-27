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
| Node sunucu / VPS  | `npm run build` → `npm run preview` veya çıktı `dist/server` girişini bir Node süreç yöneticisiyle çalıştır |
| Lovable            | Publish butonu; env değerleri proje secret'larından okunur                                                  |

Notlar:

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
