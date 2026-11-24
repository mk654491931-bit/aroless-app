# Meta Pixel + Conversions API

Pixel kimliği: **1144034978511312**.

## Ne gönderiliyor?

| Olay                   | Nerede                                       | Amaç                                      |
| ---------------------- | -------------------------------------------- | ----------------------------------------- |
| `PageView`             | Her rota değişimi (SPA)                      | Ziyaret ölçümü, yeniden pazarlama kitlesi |
| `ViewContent`          | `/pricing`, `/hot/:id`, derin analiz modalı  | Fiyat/ürün inceleyen sıcak kitle          |
| `CompleteRegistration` | E-posta doğrulaması + oturum kurulduğunda    | Kayıt dönüşümü                            |
| `InitiateCheckout`     | Paddle ödeme penceresi gerçekten açıldığında | Ödeme başlangıcı                          |
| `Purchase`             | Ödeme onaylandığında / webhook'ta            | Ciro ölçümü, ROAS                         |

`Purchase` iki kanaldan gider:

- **Tarayıcı:** Yalnız `PricingModal` akışında, `checkout.completed` geldikten ve
  abonelik webhook/tazeleme ile **gerçekten ücretli** göründükten sonra.
- **Sunucu (Conversions API):** Paddle `transaction.completed` webhook'u
  veritabanına yazdıktan sonra, tutar ve işlem kimliği doğrulanmışsa.

`pricing-card` bileşeni artık `checkout.completed` anında `Purchase`
göndermez; bu, gecikmeli tahsilatta doğrulanmamış ciro yazmayı önler. O yüzeyde
dönüşüm sunucu CAPI'den gelir.

İki kanal aynı `event_id` değerini kullanır: `purchase-<Paddle işlem kimliği>`.
Meta bu sayede aynı satın almayı **iki kez saymaz**. Yenilemelerde işlem kimliği
değiştiği için her tahsilat ayrı `Purchase` olur.

### `Lead` neden yok?

Bu uygulamada ücretsiz **deneme (trial)** akışı yok; ücretsiz başlangıç Free
plana kayıtla oluyor ve bu `CompleteRegistration` olarak gönderiliyor. Ayrı bir
`Lead` olayı göndermek aynı dönüşümü iki kez saymak olurdu. İleride deneme
başlatan bir akış eklenirse tek çağrı yeterli:

```ts
trackMetaEvent("Lead", { content_name: "Free trial" });
```

### Fiyatlar

Tutarlar `src/lib/plans.ts` → `PLAN_BY_ID` üzerinden gelir (Starter **$39**, Pro
**$59**, Business **$199**). Paddle ödemesinde gerçek ödenen tutar
`checkout.completed` olayındaki `totals.total` ve webhook'taki `grandTotal`
dan okunur; böylece indirim/vergi farkı varsa Meta'ya doğru tutar gider.
Fiyatlar bu entegrasyon kapsamında **değiştirilmedi**.

## Çerez izni

Meta Pixel bir **pazarlama** aracıdır. Çerez banner'ında “Pazarlama” izni
verilmeden:

- `connect.facebook.net/en_US/fbevents.js` yüklenmez,
- `_fbp` çerezi yazılmaz,
- hiçbir olay gönderilmez.

İzin aynı sekmede banner'dan veya başka sekmede değiştirilirse piksel buna
anında uyum sağlar. İzin geri çekilirse sonraki olaylar gönderilmez ve daha
önce Meta tarafından yazılmış `_fbp`/`_fbc` çerezleri silinir.

### Sunucu tarafı (CAPI) izin kapısı

CAPI webhook isteğinde tarayıcı çerezi yoktur. Bu yüzden izin iki sunucu
kaynağından okunur:

- **Hesap metadata'sı:** Banner kararı, oturum açıksa
  `cookie_marketing_consent` alanına yazılır; geri çekme de aynı yolla anında
  yansır.
- **Paddle `customData`:** Checkout anındaki tercih `marketingConsent` olarak
  sunucuda transaction'a yazılır ve Paddle tarafından yenilemelere kopyalanır.

Kural: kaynaklardan biri açıkça `denied` ise **gönderim yoktur**. Yalnız en az
bir açık `granted` varsa gönderilir. İki kaynak da yoksa varsayılan **HAYIR**dır.
Bu nedenle izin vermemiş bir kullanıcı için CAPI `Purchase` üretilmez.

İzin vermeden önce yapılan bir satın almanın yenilemesi, sonradan izin
verilmediği sürece CAPI'ye gitmez; bu bilinçli ve güvenli varsayılandır.

### Eşleştirme verisi (fbp / fbc / IP / user-agent)

Bu dört alan Meta'nın eşleşme kalitesini artırır ancak kişisel veridir. Kurallar:

- Yalnızca checkout **açık pazarlama izniyle** açıldığında toplanır
  (`metaAttributionFromRequest`). İzin yoksa sunucu bu verileri okumaz.
- `_fbp`/`_fbc` çerezleri biçim doğrulamasından geçer; serbest metin atlanır.
  IP yalnızca geçerli IPv4/IPv6 ise kabul edilir, user-agent 500 karaktere
  kırpılır.
- Veri Paddle `customData`'ya YAZILMAZ (yenilemelere kopyalanırdı). Yalnız o
  transaction için `meta_capi_attribution` tablosuna yazılır ve **7 gün** sonra
  silinir.
- `Purchase` gönderilirken yalnız izin kapısı geçildikten sonra okunur.

## Kalıcı outbox ve yeniden deneme

CAPI `Purchase` tek bir `fetch` ile gönderilmez. Akış:

1. Olay `meta_capi_outbox` tablosuna yazılır (`event_id` UNIQUE).
2. Hemen gönderilir; başarılıysa `sent` işaretlenir.
3. Meta 5xx/429/network hatası döndürürse olay `pending` kalır ve üstel geri
   çekilmeyle yeniden denenir: 60 sn → 5 dk → 15 dk → 1 saat → 6 saat
   (en fazla 8 deneme).
4. 400/401/403 gibi kalıcı hatalar tekrar denenmez (`failed`).
5. Günlük cron (`/api/cron/radar-refresh`) kuyruğu işler ve 30 günden eski
   kayıtları siler. `?job=meta-capi` yalnız kuyruğu çalıştırır.
6. 46 saatten eski kayıtlar Meta'nın tekilleştirme penceresi dışına çıktığı
   için GÖNDERİLMEZ; `failed` olarak görünür kalır.

Aynı `event_id` (`purchase-<Paddle txn>`) hem tarayıcıya hem sunucuya verildiği
için yeniden denemeler Meta'da **çift `Purchase` saymaz**. Paddle aynı işlem
için ikinci bir webhook gönderirse kuyrukta yeni satır açılmaz; yalnız süresi
gelmiş bekleyen kayıt yeniden denenir.

> **Migration gerekir:** `supabase/migrations/20261124120000_meta_capi_outbox.sql`
> uygulanmadan RPC'ler yoktur. Kod bu durumda doğrudan gönderime düşer ve
> uyarı loglar; kalıcı retry devreye girmez.

## Conversions API kurulumu

1. Meta Events Manager → ilgili Pixel → **Settings** → **Conversions API** →
   **Generate access token**.
2. Token'ı ortam değişkeni olarak ekleyin (Vercel → Environment Variables veya
   Freebuff → Settings → Environment):

   ```
   META_CAPI_ACCESS_TOKEN=EAA...
   ```

3. (Opsiyonel) Events Manager → **Test Events** ekranındaki kodu test sırasında
   ekleyin; canlıda boş bırakın:

   ```
   META_TEST_EVENT_CODE=TEST12345
   ```

4. Domain doğrulaması: Events Manager → **Settings** → **Domain verification**
   (DNS veya meta etiketi). Tarayıcı pikseli için önerilir.

Token yoksa sunucu tarafı olaylar sessizce devre dışı kalır; tarayıcı pikseli
çalışmaya devam eder ve ödeme akışı etkilenmez.

## Production kontrol listesi

- `SUPABASE_SERVICE_ROLE_KEY` (ve `SUPABASE_URL`) tanımlı olmalı; outbox ve
  attribution yalnız `service_role` ile yazılır. Anahtar yoksa kalıcı kuyruk ve
  eşleştirme devre dışı kalır.
- `APP_URL=https://www.aroless.tech` tanımlı olmalı; CAPI `event_source_url`
  değeri buradan üretilir.
- `VITE_META_PIXEL_DISABLED` **tanımlı olmamalı**; tanımlıysa tarayıcı pikseli
  hiç yüklenmez.
- `META_CAPI_ACCESS_TOKEN` tanımlı olmalı; yoksa sunucu `Purchase` göndermez.
- `CRON_SECRET` (veya `JOB_WORKER_SECRET`) tanımlı olmalı; yoksa cron ucu 503
  döner ve outbox retry'ları planlanan biçimde koşmaz.
- `meta_capi_outbox` migration'ı uygulanmış olmalı; aksi hâlde kalıcı retry ve
  attribution devre dışıdır (doğrudan gönderim çalışmaya devam eder).
- `META_TEST_EVENT_CODE` production'da **boş** olmalı. Vercel'de
  `VERCEL_ENV=production`, Freebuff/Nitro'da `NODE_ENV=production` iken kod
  zaten yok sayılır; yine de yanlışlıkla test verisi üretmemek için kaldırın.
- Paddle webhook için `PADDLE_WEBHOOK_SECRET_KEY` (veya eski adı
  `PADDLE_WEBHOOK_SECRET`) zorunlu; eksikse imza doğrulanamaz ve webhook 500
  döner.
- `PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN` ve Starter/Pro/Business fiyat veya
  ürün kimliklerinden en az biri tanımlı olmalı.
- Paddle panelindeki webhook adresi **`https://www.aroless.tech/api/webhooks/paddle`**
  olmalı (mevcut çalışan adres). Aynı güvenli handler
  `https://www.aroless.tech/api/public/webhook/paddle` yolunda da açıktır; iki
  yol da `handlePaddleWebhook`'u çağırır. Apex `aroless.tech` → `www` 308
  yönlendirmesi yaptığı için webhook'ta **www** kullanılmalıdır.
- Meta Events Manager'da domain doğrulaması ve (varsa) CAPI kalite kontrolü
  yapılmalı.

## Test / production ayrımı

- **Tarayıcı pikselini kapatmak:** önizleme/staging ortamında
  `VITE_META_PIXEL_DISABLED=1` verin; piksel hiç yüklenmez ve hiçbir tarayıcı
  olayı gitmez.
- **Test Events kodu:** `META_TEST_EVENT_CODE` yalnızca **production dışındaki**
  dağıtımlarda kullanılır. Vercel `VERCEL_ENV=production` iken env'de dursa bile
  yok sayılır; böylece canlı veri yanlışlıkla test verisine karışmaz.
- **Ayrı token'lar:** production ve preview ortamlarına farklı
  `META_CAPI_ACCESS_TOKEN` değerleri tanımlamak en temiz ayrımdır.
- **Paddle:** preview ortamı `PADDLE_ENV=sandbox` ve sandbox anahtarlarıyla
  çalışmalıdır. Preview production anahtarlarına bağlıysa kod `[Paddle]`
  uyarısı loglar; test ödemesi gerçek para çekebilir.

## Mimari notu

Bu proje **TanStack Start (React 19 + Vite)** kullanır; Next.js App Router
yoktur. Piksel istemci tarafında kök bileşene bağlıdır ve TanStack Router'ın
`pathname` değeriyle SPA geçişlerini izler; Next.js'e özgü bir kod gerekmez.

## Test

1. Siteyi açın, çerez banner'ında **Tümünü Kabul Et** (pazarlama dahil) seçin.
2. DevTools → Network → `fbevents.js` ve `tr?id=1144034978511312` isteklerini
   görün.
3. Meta Pixel Helper eklentisi veya Events Manager → **Test Events** ile
   `PageView`, `InitiateCheckout`, `Purchase` olaylarını doğrulayın.
4. Test ödemesi yaptıysanız `Purchase` olayının `event_id` değeri
   `purchase-txn_...` biçiminde olmalı; aynı olay hem tarayıcı hem sunucudan
   geldiyse Meta tek satır gösterir.

## Uyumluluk notu

Tarayıcı pikseli pazarlama çerez iznine bağlıdır. **Conversions API sunucudan
çalışır ve tarayıcı çerezi gerektirmez**; ancak hesap metadata'sı ve Paddle
`customData` üzerinden **izin kapısına** tabidir. E-posta ve kullanıcı kimliği
Meta'ya sadece SHA-256 özetiyle gider; ödeme kartı bilgileri hiçbir zaman
gönderilmez.

KVKK Aydınlatma Metni ve Çerez Politikası'nda Meta Pixel/Conversions API,
Meta Platforms ile paylaşılan veri ve SHA-256 özetleme açıkça belirtilir.
Webhook loglarında e-posta adresi yazılmaz; CAPI hata gövdesi de loglanmaz.

## Sınırlamalar

- Google ile hızlı kayıt akışı `CompleteRegistration` göndermez (yalnızca
  e-posta doğrulamalı kayıt gönderir); bu, dönen kullanıcıların yeniden
  “kayıt” sayılmaması için bilinçli bir tercihtir.
- `noscript` görseli yoktur: izin kontrolü yapamadan çalışacağı için pazarlama
  rızasını delen bir istek üretirdi.
- `fbp`/`fbc` yalnız çerez varsa taşınır. Reklam tıklamasıyla gelen `fbclid`
  parametresi çereze dönüşmeden checkout'a ulaşırsa (ör. ilk oturumda çerez
  engeli) bu alan boş kalır; kod uydurma değer üretmez.
- Sunucu tarafı yalnız `Purchase` gönderir. `CompleteRegistration`,
  `ViewContent` ve `InitiateCheckout` tarayıcıdan gider; sunucudan ikinci kez
  gönderilmez.
- `PricingCard` yüzeyinde tarayıcı `Purchase` yoktur; dönüşüm sunucu CAPI'den
  gelir. Bu bileşen şu anda uygulamada kullanılmıyor.
