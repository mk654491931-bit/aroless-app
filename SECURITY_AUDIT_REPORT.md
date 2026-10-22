# Güvenlik Denetimi Raporu — Aroless

**Tarih:** 22 Ekim 2026
**Kapsam:** İstemci (React / TanStack Start), sunucu fonksiyonları, HTTP API rotaları,
Supabase şeması ve RLS politikaları, kimlik doğrulama, ödeme/abonelik, jeton (kredi)
altyapısı, affiliate akışı, e-posta/OTP ve dağıtım yapılandırması.
**Yöntem:** Kod okuma + saldırgan gözüyle kötüye kullanım senaryoları, ardından
düzeltme + regresyon testi.

---

## 1. Kritik bulgu — Kullanıcı kendi jeton bakiyesini yazabiliyordu

`public.profiles` tablosunda `authenticated` rolüne **tablo düzeyinde** `UPDATE`
verilmişti ve RLS yalnızca satırı sınırlıyordu (`auth.uid() = id`). Sütun kısıtı
olmadığı için herhangi bir oturum açmış kullanıcı Supabase REST API'sine doğrudan:

```
PATCH /rest/v1/profiles?id=eq.<kendi-id>
{ "credits": 999999, "finder_credits": 999999 }
```

yazabiliyordu. Böylece `chargeAiCredits`, `PLAN_LIMIT` ve `NO_CREDITS` kapılarının
tamamı atlatılabiliyor, ücretli AI özellikleri sınırsız ve bedava kullanılabiliyordu.

Ek olarak: PostgreSQL'de tablo düzeyi yetki varken sütun düzeyinde
`REVOKE UPDATE (kolon)` **etkisizdir**. Bu yüzden önceki migration'larda abonelik ve
`referred_by` sütunları için yazılan sütun bazlı REVOKE'lar fiilen çalışmıyordu.

**Kapatıldı:** `supabase/migrations/20261022000000_lock_server_managed_columns.sql`

- Tablo düzeyi `UPDATE`/`INSERT` yetkisi `authenticated` ve `anon`'dan alındı.
- Yalnız gerçekten istemciye ait dört sütun geri verildi:
  `language`, `currency`, `notifications_enabled`, `onboarding_completed`.
- Savunma derinliği: `profiles_guard_server_columns` BEFORE UPDATE trigger'ı,
  `service_role` / `postgres` dışındaki rollerin bakiye, kota, abonelik ve atıf
  sütunlarını değiştirmesini reddeder (yetki yanlışlıkla geri verilse bile).
- İade yolları artık kullanıcı istemcisiyle profil yazmıyor; sunucu tarafında
  `refund_credit_once` (service_role) kullanılıyor.

**Yan etki kapatıldı:** `profiles.email` de yazılabilir olduğu için bir kullanıcı
kendi e-postasını başka bir müşterinin adresiyle değiştirip
`reconcileMySubscription` üzerinden o müşterinin Paddle aboneliğini kendi hesabına
bağlayabilirdi. E-posta artık yalnız auth trigger'ı ve `service_role` tarafından
yazılır.

---

## 2. Yüksek — SSRF (ürün görseli ucu)

`GET /api/public/product-image?u=<adres>` herkese açıktı ve sunucuda istek atıyordu.
Eski koruma yalnız `10.x`, `127.x`, `169.254.x` gibi yazılı adresleri reddediyor,
`redirect: "follow"` kullanıyordu. Atlatma yolları:

- DNS rebinding (genel alan adı iç IP'ye çözümlenir),
- genel alan adından `302 → http://169.254.169.254/latest/meta-data/`,
- `http://2130706433/`, `http://0x7f000001/`, `http://[::ffff:127.0.0.1]/`,
- `:6379`, `:11211` gibi standart dışı portlarla iç servis taraması.

**Kapatıldı:** `src/lib/product-image-source.server.ts`

- Yalnız `80`/`443` portları; kullanıcı bilgisi içeren URL'ler reddedilir.
- IPv4/IPv6 özel, ayrılmış, CGNAT, link-local, multicast ve NAT64 aralıkları bloklanır;
  ondalık/oktal/hex IP kodlamaları reddedilir.
- Alan adı gerçekten DNS ile çözümlenir ve özel aralığa düşerse istek yapılmaz
  (fail-closed).
- Yönlendirmeler elle, en fazla 3 adım izlenir ve **her adım yeniden doğrulanır**.
- Gövde boyutu sınırlandı (2 MB) — bellek/zip bombası koruması.

---

## 3. Yüksek — Host header ile işçi sırrı sızdırma

`appOrigin()` (ve iki kopyası) `x-forwarded-host` / `Host` başlığını ilk sırada
kullanıyordu. Bu değer QStash yayınının hedefi oluyor ve yayına
`Upstash-Forward-x-job-secret: <JOB_WORKER_SECRET>` başlığı ekleniyor.
Saldırgan başlığı değiştirerek yayını kendi sunucusuna yönlendirip paylaşılan işçi
sırrını ele geçirebilir, sonra sahte iş tetikleyip maliyet üretebilirdi.

**Kapatıldı:** `src/lib/discovery-jobs.server.ts` (+ `routes/api/jobs.ts`,
`routes/api/public/agent.ts` kopyaları kaldırıldı)
Sıra artık: `APP_URL` → `PUBLIC_APP_URL` → Vercel URL → isteğin kendi URL'i.
İstemci başlıkları hiç kullanılmaz.

---

## 4. Yüksek — IDOR: başka kullanıcının ajan karnesi

`GET /api/public/agent?runId=…` yalnız oturum istiyor, **sahiplik kontrolü
yapmıyordu**. Ayrıca `runId` istemciden alınabiliyor ve varsayılan üretim
`velora_<zaman damgası>_<4 karakter>` biçiminde tahmin edilebilirdi.

Sonuç: bir kullanıcı (a) başkasının koşu durumunu/karne­sini okuyabiliyor,
(b) kendi `runId`'sini dayatarak başkasının koşu durumunu ezebiliyordu.

**Kapatıldı:** `src/lib/velora-orchestrator.server.ts`, `src/routes/api/public/agent.ts`

- Kimlik her zaman sunucuda `crypto.randomUUID()` ile üretilir; istemci değeri atılır.
- `veloraRunStatus` artık `requestedBy` alır; sahibi eşleşmeyen istek
  `RUN_NOT_FOUND` (durum: `unknown`) alır — koşunun varlığı da sızmaz.

---

## 5. Orta — Eksik istek sınırları (maliyet / kuyruk kötüye kullanımı)

| Uç | Sorun | Düzeltme |
|---|---|---|
| `POST /api/checkout` | Sınırsız Paddle oturumu | 10/dk kullanıcı başına |
| `POST /api/search` | Sınırsız iş kaydı (kuyruk şişirme) | 10/dk kullanıcı başına |
| `POST /api/product-discovery/start` | Sınırsız hat başlatma + sınırsız gövde | 6/dk + 64 KB gövde sınırı |
| `askCopilot` (server fn) | Jeton harcamayan AI ucu, sınırsız çağrı | 20/dk kullanıcı başına |

---

## 6. Orta — Sabit olmayan zamanlı sır karşılaştırmaları

`cronAuthorized`, `verifyWorkerRequest` ve QStash `x-job-secret` yolu sırları `===`
ile karşılaştırıyordu (timing attack ile ön ek tahmini).
**Kapatıldı:** `src/lib/safe-compare.ts` + üç çağrı noktası.

---

## 7. Orta — Üretimde OTP'nin sunucu loguna yazılması

Hiçbir e-posta sağlayıcısı tanımlı değilken `sendViaConsole` üretimde de çalışıyor,
gövde önizlemesini (6 haneli doğrulama kodu dahil) loga yazıyor ve `sent: true`
dönüyordu. Yani kod hem log okuyanlara sızıyor hem de "gönderildi" yalanı akışı
bozuyordu.
**Kapatıldı:** `src/lib/email-service.ts` — üretimde fail-closed (`sent:false`,
`no_email_provider`), log yok. Geliştirme kolaylığı korunur.

---

## 8. Düşük — Sahte arama sonucu yazımı

`searches_update_own` politikası istemcinin kendi iş satırındaki `status` / `result`
sütunlarını yazmasına izin veriyordu (uydurma "completed" + uydurma ürünler).
İstemci bu tabloyu yalnız okuyor; politika kaldırıldı (yazma `service_role`'de).

---

## 9. Gizlilik / KVKK

Hesap silme akışı `sim_runs` ve `device_fingerprints` kayıtlarını bırakıyordu.
İkisi de kişisel veri; silme akışına eklendi. Finansal kayıtlar (`transactions`)
yasal saklama yükümlülüğü nedeniyle korunuyor.

---

## 10. Denetlenip **yeterli** bulunan alanlar

- Paddle webhook: SDK ile HMAC imza doğrulaması, 1 MB gövde sınırı, atomik ve
  idempotent RPC, iade/chargeback mahsubu.
- Admin uçları: `has_role` + designated-admin kontrolü, fail-closed; para ile ilgili
  RPC'ler `service_role`'e kapalı ve fonksiyon içinde `has_role` doğrulaması var.
- Oturum doğrulama: `getClaims` (imza doğrulamalı), Bearer zorunlu, `aud`/`sub`
  kontrolü; service-role anahtarı istemci paketine girmiyor (Vite allowlist).
- XSS: kullanıcı verisi `dangerouslySetInnerHTML` ile basılmıyor; üç kullanım sabit
  tema script'i ve JSON-LD.
- Açık yönlendirme: `redirect` parametresi yalnız `/` ile başlayan ve `//` olmayan
  yolları kabul ediyor.
- Güvenlik başlıkları: nosniff, frame-ancestors, HSTS (HTTPS), referrer-policy,
  permissions-policy her yanıta uygulanıyor.
- OTP: 10 dk TTL, 5 hatalı deneme, IP + e-posta bazlı sınır, tek kullanımlık tüketim.
- RLS: kullanıcıya ait tablolar (`favorites`, `notifications`, `transactions`,
  `sim_runs`, `affiliate_*`) satır bazlı korumalı; `email_otps`, `device_fingerprints`,
  `ai_cache`, `api_rate_limits` istemciye tamamen kapalı.

---

## 11. Kalan riskler (kabul edilen / operasyonel)

1. **Migration uygulanmalı.** Kritik düzeltme veritabanı şemasındadır; canlı ortamda
   `20261022000000_lock_server_managed_columns.sql` uygulanana kadar açık devam eder.
2. **`SUPABASE_SERVICE_ROLE_KEY`** tanımlı değilse iade ve bazı admin/atıf yolları
   fail-closed davranır (özellik çalışmaz, güvenlik açılmaz). Üretimde tanımlı olmalı.
3. **Hesap numaralandırma:** kayıt/giriş akışları "bu e-posta kayıtlı" diyebiliyor
   (UX gereği). Oran sınırı ve OTP ile risk düşürüldü.
4. **IP hash'i tuzsuz SHA-256**: IPv4 uzayı küçük olduğundan hash'ler kaba kuvvetle
   geri çevrilebilir. Panelde yalnız admin görebilir.
5. **Eski `runId`'ler** (tahmin edilebilir biçimde üretilmiş geçmiş koşular) için
   `radar_items` üzerinden geri kurma yolu sahiplik doğrulaması içermez; yeni
   koşullarda kimlik UUID olduğu için pratikte erişilemez.
6. **`/health` ve `/api/public/build-info`** yapılandırma bayraklarını (anahtar
   var/yok) herkese açık gösterir; sır değeri içermez, teşhis amacıyla bilinçlidir.

---

## 12. İkinci sertleştirme turu

İlk turdan sonra "daha da iyi" hedefiyle yapılan ek denetim:

### 12.1 IP tabanlı hız sınırları sahte başlıkla atlatılabiliyordu
`clientIp()` sırayla `cf-connecting-ip` → `x-forwarded-for` **ilk halkası** →
`x-real-ip` okuyordu. Bu başlıkların tamamı istemci tarafından gönderilebilir;
platform gerçek IP'yi zincirin **sonuna** eklediği için saldırgan her istekte
"ilk halka"yı değiştirip kayıt/OTP/AI sınırlarını sınırsız aşabiliyordu.
**Kapatıldı:** `src/lib/client-ip.ts` — yalnız `x-vercel-forwarded-for`,
`cf-ray` varsa `cf-connecting-ip`, `x-real-ip` ve XFF'in **son** halkası güvenilir;
IPv4:port normalize edilir. `api-guard` ve `turnstile` aynı kaynağı kullanır.

### 12.2 Turnstile jetonu tekrar oynatılabiliyordu
Başarılı doğrulama sonucu 5 dakika cache'leniyordu; Turnstile jetonları tek
kullanımlık olduğu için bir kez çözülen CAPTCHA ile aynı jeton defalarca
kullanılabiliyordu. **Kapatıldı:** başarı asla cache'lenmez; yalnız başarısız
sonuçlar, 500 girişlik sınırlı bir bellekte tutulur.

### 12.3 Promosyon kodları topluca listelenebiliyordu
`Authenticated view active codes` politikası oturum açmış herkese tüm aktif
kodları ve affiliate sahiplerini açıyordu (rakip istihbaratı + hedefli deneme).
**Kapatıldı:** politika kaldırıldı; doğrulama/sahiplik sunucu fonksiyonlarından
yürür. Ayrıca `validatePromoCode` sınırsızdı → 20/dk sınır eklendi.

### 12.4 `searches` tablosuna istemci yazımı
`searches_insert_own` politikası, istemcinin kendi iş satırını uydurma
`result`/`status` ile açmasına izin veriyordu. İstemci bu tabloya hiç yazmıyor;
INSERT/UPDATE/DELETE yetkileri kaldırıldı, yalnız `SELECT` (kendi satırı) kaldı.

### 12.5 Daha sıkı yetki modeli
`profiles` için `REVOKE ALL` → `GRANT SELECT` + yalnız dört sütun `UPDATE`.
Böylece varsayılan yetkilerle gelebilecek `DELETE/TRUNCATE/REFERENCES/TRIGGER`
de kapanır (TRUNCATE, RLS'i tamamen atlar). Migration sonunda
`NOTIFY pgrst, 'reload schema'` ile PostgREST önbelleği tazelenir.

### 12.6 Zayıf şifre politikası
Kayıt ve şifre sıfırlama alt sınırı 6 → **10 karakter** (bcrypt tavanı 72).
Giriş alanı 6'da bırakıldı: mevcut hesapların girişi engellenmez.

### 12.7 Bağımlılık denetimi
`bun audit` başlangıçta **27 açık** (1 kritik, 13 yüksek) bildirdi; güvenli
aralık içinde güncellendi (`bun audit fix`, vite 8.2.4, shell-quote 1.11.0,
js-yaml 4.3.2, source-map-js 1.2.2, nanoid 3.3.18, dompurify 3.4.16 …).
Sonuç: **0 açık**. (Bulguların tamamı derleme/test araçlarındaydı; üretim
paketine girmiyorlardı, yine de kapatıldı.)

---

## 13. Doğrulama

- `bunx vitest run` → **160 dosya / 2171 test geçti** (15 canlı test atlandı).
- `bun audit` → **No vulnerabilities found** (537 paket).
- Değişen tüm dosyalar + `routeTree.gen.ts` için `tsc --noEmit` → **temiz**.
  (Tam proje `tsc` bu ortamda 180 sn komut sınırını aştığı için parçalı doğrulandı;
  platformun tam tip kontrolü ayrıca koşar.)
- `eslint` → değişen dosyalarda **0 hata**.
- Yeni regresyon testleri: `src/lib/security-hardening.test.ts`
  (sabit zamanlı karşılaştırma, host-header yok sayma, işçi sırrı, IDOR sahiplik kapısı).
