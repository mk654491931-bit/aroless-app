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


## Lovable'a bağlı olmayan, ama senin doldurman gereken şeyler

- **`.env` dosyası:** repoya inmez. Kendi makinende `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID` ve sunucu tarafı için aynı değerlerin `VITE_` önekisiz halleri gerekir.
- **Sunucu tarafı gizli anahtarlar:** `GEMINI_1/2/3_API_KEY`, `GROQ_API_KEY(_2)`, `OPENROUTER_API_KEY1/2`, `HUGGING_FACE_API_KEY1/2`, `RESEND_API_KEY*`, LemonSqueezy webhook secret'ı ve Supabase **service role key** (admin işlemleri için). Bunlar şu an Lovable'ın gizli anahtar deposunda; kendi `.env`'ine kopyalaman gerekir. Service role key'i Lovable üzerinden alamazsın — kendi Supabase projene geçersen oradan alırsın.
- **Veritabanı:** Supabase Lovable'ın bir parçası değil, kalabilir. İstersen aynı projeyi kullanmaya devam edersin; tamamen ayrılmak istersen şemayı + verileri yeni bir Supabase projesine taşırız (migration dosyaları zaten repoda).

## Nasıl çalıştıracaksın

```text
bun install     (veya npm install)
.env dosyasını doldur
bun run dev  ->  http://localhost:8080
bun run build ->  Cloudflare Workers çıktısı (Nitro)
```

Yayınlama: proje Cloudflare Workers hedefine göre kurulu; `wrangler deploy` ile kendi Cloudflare hesabına çıkarsın. Vercel/Netlify istersen Nitro preset'ini değiştiririz.

## Uygulama adımları (onaylarsan)

1. `vite.config.ts`'i Lovable paketi olmadan yeniden yaz, `package.json`'dan `@lovable.dev/vite-tanstack-config`'i kaldır, gerekli eklentileri ekle.
2. Google girişini `supabase.auth.signInWithOAuth`'a çevir, `src/integrations/lovable/` klasörünü ve `@lovable.dev/cloud-auth-js` paketini kaldır.
3. `callLovableAI`'yi seçtiğin sağlayıcıya (A) yönlendir veya motoru (B) kaldır.
4. `lovable-error-reporting.ts`'i güvenli bir no-op/console sürümüne indir.
5. `.env.example` ve `README.md`'ye kurulum + tüm anahtar listesi ekle.
6. `bunfig.toml` içindeki Lovable'a özel paket istisnalarını temizle.

Not: bu değişikliklerden sonra proje Lovable önizlemesinde de çalışmaya devam eder, ancak Lovable'ın tek tık Google girişi yerine kendi Google OAuth istemcin kullanılır.
