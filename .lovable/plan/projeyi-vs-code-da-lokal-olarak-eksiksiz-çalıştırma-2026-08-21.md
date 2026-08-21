# Projeyi VS Code'da lokal olarak eksiksiz çalıştırma

Amaç: `git clone` + `.env` doldurma dışında hiçbir manuel iş kalmadan, buradaki davranışın birebir aynısı lokalde çalışsın (Google ile giriş, 14 ajanlı AI konseyi, ürün bulucu, admin paneli dahil).

## 1) Makinede olması gerekenler

- Node.js 22 (proje `.nvmrc` ile 22 istiyor) — `nvm install 22 && nvm use 22`
- npm (veya bun). Kurulum: `npm install`
- VS Code eklentileri (opsiyonel): ESLint, Prettier, Tailwind CSS IntelliSense
- Supabase CLI (migration'ları kendi projene basmak istersen): `npm i -g supabase`

Komutlar: `npm run dev` (http://localhost:8080), `npm run build`, `npm run typecheck`.

Not: `npm install` sırasında `@lovable.dev/*` paketleri `optionalDependencies` içinde; kurulmazsa Vite config onları sessizce atlar, lokal çalışma etkilenmez.

## 2) Senin gireceğin `.env` değerleri (tek tek)

**Zorunlu — Supabase (backend)**
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PROJECT_ID`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (admin paneli, kayıt akışı, ücretsiz kredi denetimi bunu kullanıyor — olmadan signup ve admin çalışmaz)

**Zorunlu değil ama AI özellikleri için gerekli (en az bir sağlayıcı)**
- `GEMINI_1_API_KEY`, `GEMINI_2_API_KEY`, `GEMINI_3_API_KEY`
- `GROQ_API_KEY`, `GROQ_API_KEY_2`
- `OPENROUTER_API_KEY1`, `OPENROUTER_API_KEY2`
- `HUGGING_FACE_API_KEY1`, `HUGGING_FACE_API_KEY2`

**Opsiyonel — kendi AI ağ geçidin (OpenAI uyumlu)**
- `AI_GATEWAY_URL`, `AI_GATEWAY_API_KEY`, `AI_GATEWAY_MODELS`

**Opsiyonel — e-posta ve bot koruması**
- `RESEND_API_KEY` (+ istersen `RESEND_API_KEY_2`, `RESEND_API_KEY_3`, `RESEND_FROM_EMAIL`) — boşsa OTP e-postası gönderilmez
- `VITE_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` — boşsa captcha devre dışı

Bu ortamda `LOVABLE_API_KEY` platform tarafından veriliyor; lokalde yok. Bu yüzden AI çağrıları lokalde senin Gemini/Groq/OpenRouter anahtarlarınla veya `AI_GATEWAY_*` ile çalışacak.

## 3) Supabase tarafında yapılacaklar

- Mevcut backend'i kullanacaksan: sadece yukarıdaki URL/anahtarları `.env`'e yaz.
- Kendi Supabase projeni kuracaksan: `supabase/migrations` klasörünü `supabase db push` ile uygula (tüm tablolar, RLS, GRANT, trigger'lar ve `has_role`/kredi fonksiyonları burada).
- Google ile giriş: Supabase panelinde Authentication → Providers → Google'ı aç, Google Cloud'dan Client ID/Secret gir; Redirect URL olarak `http://localhost:8080` ve `http://localhost:8080/auth/callback` ekle.

## 4) Kodda yapılacak düzenlemeler (bende)

1. **Google girişi lokalde çalışsın:** `src/routes/auth.tsx` içindeki Lovable OAuth köprüsü, köprü yoksa otomatik olarak `supabase.auth.signInWithOAuth({ provider: "google", redirectTo: window.location.origin })` yoluna düşsün. Böylece hem burada hem lokalde tek tıkla giriş çalışır.
2. **AI zinciri anahtarsız ortamda düzgün davransın:** `src/lib/ai.server.ts` içinde `LOVABLE_API_KEY` yoksa doğrudan kendi anahtar havuzlarıyla başlasın (şu an önce ağ geçidini deneyip hata alıp düşüyor — lokalde gereksiz gecikme yaratır). Hiç anahtar yoksa kullanıcıya net "AI anahtarı tanımlı değil" mesajı dönsün.
3. **Hata raporlama no-op:** `src/lib/lovable-error-reporting.ts` sandbox dışında hiçbir şey yapmasın (konsolu kirletmesin).
4. **`.env.example` güncellensin:** yukarıdaki tüm anahtarlar, hangisinin zorunlu olduğu ve kısa açıklamalarla eksiksiz listelensin.
5. **README'ye lokal kurulum bölümü:** Node 22 → `npm install` → `.env` → `supabase db push` → `npm run dev` adımları ve Google OAuth ayarı.
6. **Admin erişimi:** `omnic.111111@gmail.com` kaydı migration'daki trigger ile otomatik admin + 250 kredi alır; kendi Supabase projende de bu yüzden ek iş gerekmez.

## Teknik notlar

- Vite config zaten taşınabilir: Lovable eklentileri sadece sandbox'ta yükleniyor, `command === "build"` dışında Nitro'ya dokunulmuyor.
- Sunucu tarafı sırlar yalnızca `createServerFn` handler'ları içinde `process.env[...]` ile okunuyor; `.env` dosyası `vite dev` tarafından otomatik yükleniyor, ek dotenv paketi gerekmiyor.
- Build çıktısı Cloudflare preset'i ile üretiliyor; lokalde `npm run dev` ve `npm run preview` için bu gerekli değil.

## 5) Canlıya alırken sorun çıkmaması için (aynı kod, üç ortam)

Hedef: aynı kod tabanı sandbox, lokal ve canlıda ortam değişkeni farkı dışında hiçbir değişiklik istemeden çalışsın.

- **Ortam algılama tek noktada:** Lovable köprüsü, hata raporlama ve AI ağ geçidi için tek bir `src/lib/runtime-env.ts` yardımcı modülü (sandbox mı, lokal mi, prod mu). Tüm koşullar buradan okunsun; dağınık `typeof window`/`LOVABLE_*` kontrolleri kalksın.
- **Origin bağımlı URL'ler sabit yazılmasın:** OAuth `redirect_uri`, paylaşım linkleri ve e-posta linkleri `window.location.origin` / istek host'undan türetilsin (localhost, preview ve canlı domain otomatik doğru olsun).
- **Build doğrulaması:** `npm run build` + `npm run preview` ile production SSR çıktısı lokalde test edilebilir olsun. Cloudflare (Nitro) preset'i kurulu değilse build düz Vite SSR'a düşüyor — bu davranış README'de yazılı olacak.
- **Prod dağıtım seçenekleri README'de:** (a) Cloudflare Workers — `npm run build` + `wrangler deploy`, (b) Node sunucu/VPS, (c) Lovable publish. Her biri için gereken env değişkeni listesi aynı; sadece `SUPABASE_*` ve AI anahtarları hedef platformun secret yönetimine girilir.
- **Env doğrulayıcı:** uygulama açılışında sunucu tarafında zorunlu değişkenler (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_*`) eksikse konsola tek satırlık net bir uyarı; eksik anahtar yüzünden anlamsız 500'ler yerine anlaşılır mesaj.
- **Supabase Auth ayarları:** Site URL ve Redirect URLs listesine hem `http://localhost:8080` hem canlı domain eklenir (adım README'de yazılı olacak). Google Cloud OAuth istemcisine de aynı iki origin girilir.
- **Sırlar repoda olmasın:** `.env` `.gitignore` içinde kalır, `.env.example` güncel tutulur; canlıya alırken sadece platformun secret ekranı doldurulur.
- **Doğrulama listesi:** değişiklikler sonrası `npm run typecheck`, `npm run build` ve lokal `npm run dev` üzerinden Google girişi + ürün bulucu + admin paneli akışları elle test edilir.
