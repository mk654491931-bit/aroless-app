# Projeyi Lovable'dan bağımsız hale getirme (VS Code / Codespaces)

Amaç: ZIP'i indirip Codespaces veya kendi VS Code'unda açtığında hatasız kurulup çalışması; aynı zamanda burada da çalışmaya devam etmesi. Codespaces'teki hataların kaynağı aşağıdaki Lovable'a özel paket ve servisler.

## Kaldırılacak 4 Lovable bağımlılığı

### 1. Build yapılandırması — `@lovable.dev/vite-tanstack-config`
`vite.config.ts` tek satırda Lovable'ın hazır paketini kullanıyor; içinde TanStack Start, React, Tailwind, tsconfig-paths, Nitro (Cloudflare) ve Lovable'a özel sandbox/hata eklentileri var. Codespaces'te bu paketin sandbox/port davranışı ve özel eklentileri en büyük hata kaynağı.

Yapılacak: paketi kaldırıp `vite.config.ts` içinde eklentileri tek tek, standart şekilde tanımlamak (`tanstackStart`, `viteReact`, `tailwindcss`, `tsConfigPaths`, `nitro` cloudflare preset). Port/host ayarı normal Vite `server` bloğuna taşınır, böylece her ortamda çalışır.

### 2. Tek tıkla Google girişi — `@lovable.dev/cloud-auth-js`
`src/integrations/lovable/index.ts` ve `src/routes/auth.tsx` Google girişini Lovable'ın OAuth köprüsünden yapıyor. Kendi ortamında bu köprü yok, giriş hata veriyor.

Yapılacak: Google girişini doğrudan Supabase üzerinden yapmak (`supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })`). Bunun için Google Cloud Console'da bir OAuth Client ID/Secret oluşturup Supabase Auth > Providers > Google alanına girmen ve izinli redirect URL'lerine `http://localhost:8080`, Codespaces URL'in ve kendi domainini eklemen gerekiyor.

### 3. Yapay zekâ ağ geçidi — `LOVABLE_API_KEY` / `ai.gateway.lovable.dev`
`src/lib/ai.server.ts` içindeki `callLovableAI`, hibrit motorlarda 4. sağlayıcı olarak kullanılıyor (`tools-ai.server.ts`, `trend-radar.server.ts`, growth ekranı).

Yapılacak: bu motoru Lovable'a özel olmaktan çıkarıp **OpenAI uyumlu genel bir sağlayıcıya** çevirmek — `AI_GATEWAY_URL` + `AI_GATEWAY_API_KEY` (yoksa OpenRouter'a düşer). Anahtar tanımlı değilse motor sessizce devre dışı kalır, hibrit 3 motorla çalışır ve hiçbir ekran hata vermez. Böylece Lovable'da da, dışarıda da çalışır.

### 4. Hata raporlama — `src/lib/lovable-error-reporting.ts`
Sadece Lovable önizlemesindeki `window.__lovableEvents`'a yazıyor. Dosya nötr bir isim ve güvenli davranışa çevrilir: Lovable ortamındaysa oraya, değilse `console.error`'a raporlar. Her yerde çalışır.


## Hedef: kurulumda tek iş = Supabase + `.env`

Değişiklikler bittiğinde projeyi herhangi bir yerde (Codespaces, VS Code, sunucu) açtığında yapman gereken tek şey şu olacak:

1. Bir Supabase projesi bağlamak (URL + publishable key + service role key).
2. `.env` dosyasına API anahtarlarını yazmak.

Bunu garanti etmek için:

- **`.env.example`** dosyası projeye eklenir; içinde tüm değişkenler adı adına listelenir: Supabase (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID` + aynılarının `VITE_` öneksiz sunucu sürümleri, `SUPABASE_SERVICE_ROLE_KEY`), `GEMINI_1/2/3_API_KEY`, `GROQ_API_KEY(_2)`, `OPENROUTER_API_KEY1/2`, `HUGGING_FACE_API_KEY1/2`, `RESEND_API_KEY*`, `AI_GATEWAY_URL/KEY`, LemonSqueezy webhook secret'ı, `VITE_TURNSTILE_SITE_KEY`.
- **Opsiyonel anahtarlar hiçbir yerde çökmeye yol açmaz:** eksik anahtar → o servis/motor sessizce devre dışı, uygulama çalışmaya devam eder (Resend, Turnstile, LemonSqueezy, AI gateway zaten böyle çalışacak şekilde düzenlenir).
- **Veritabanı şeması tek komutla kurulur:** `supabase/migrations` klasöründeki dosyalar yeni bir Supabase projesine `supabase db push` ile uygulanır; README'de bu adım yazılı olur. Ekstra elle SQL yazman gerekmez.
- **Kod içinde hiçbir Lovable servisi zorunlu değil:** Lovable yoksa da uygulama aynı çalışır (Google girişi Supabase'in kendi provider'ı üzerinden). Google girişi için Supabase panelinde Google provider'ını açman gerekir — bu da Supabase kurulumunun bir parçası.

## Nasıl çalıştıracaksın

```text
npm install    (veya bun install)
cp .env.example .env  ->  değerleri doldur
npx supabase db push  ->  şemayı kur (yeni Supabase projesi ise)
npm run dev   ->  http://localhost:8080
npm run build ->  Cloudflare Workers çıktısı (Nitro)
```

Yayınlama: proje Cloudflare Workers hedefine göre kurulu; `wrangler deploy` ile kendi hesabına çıkarsın. Vercel/Netlify istersen Nitro preset'ini değiştiririz.


## Uygulama adımları (onaylarsan)

1. `vite.config.ts`'i Lovable paketi olmadan standart eklentilerle yeniden yaz; `package.json`'dan `@lovable.dev/vite-tanstack-config`'i kaldır, gereken eklentileri ekle.
2. Google girişini `supabase.auth.signInWithOAuth`'a çevir; `src/integrations/lovable/` klasörünü ve `@lovable.dev/cloud-auth-js` paketini kaldır.
3. `callLovableAI`'yi `AI_GATEWAY_URL`/`AI_GATEWAY_API_KEY` ile çalışan genel OpenAI uyumlu istemciye çevir; anahtar yoksa motor otomatik devre dışı.
4. `lovable-error-reporting.ts`'i ortamdan bağımsız güvenli sürüme çevir.
5. `.env.example` ve `README.md`: kurulum adımları + tüm anahtarların listesi (Codespaces dahil).
6. `bunfig.toml` içindeki Lovable'a özel paket istisnalarını temizle.
7. Temiz kurulum testi: bağımlılıkları sıfırdan kurup dev + build çalıştırarak doğrula.

Not: değişikliklerden sonra proje burada da çalışmaya devam eder; tek fark Lovable'ın tek tık Google girişi yerine kendi Google OAuth istemcinin kullanılması.

