# Meta Pixel + Conversions API

Pixel kimliği: **1144034978511312**.

## Ne gönderiliyor?

| Olay                   | Nerede                                       | Amaç                                      |
| ---------------------- | -------------------------------------------- | ----------------------------------------- |
| `PageView`             | Her rota değişimi (SPA)                      | Ziyaret ölçümü, yeniden pazarlama kitlesi |
| `ViewContent`          | `/pricing` açılışı                           | Fiyatları inceleyen sıcak kitle           |
| `CompleteRegistration` | E-posta doğrulaması + oturum kurulduğunda    | Kayıt dönüşümü                            |
| `InitiateCheckout`     | Paddle ödeme penceresi gerçekten açıldığında | Ödeme başlangıcı                          |
| `Purchase`             | Ödeme onaylandığında / webhook'ta            | Ciro ölçümü, ROAS                         |

`Purchase` iki kanaldan gider:

- **Tarayıcı:** `checkout.completed` olayından sonra, abonelik doğrulanınca.
- **Sunucu (Conversions API):** Paddle `transaction.completed` webhook'u veritabanına yazdıktan sonra.

İki kanal aynı `event_id` değerini kullanır: `purchase-<Paddle işlem kimliği>`.
Meta bu sayede aynı satın almayı **iki kez saymaz**. Yenilemelerde işlem kimliği
değiştiği için her tahsilat ayrı `Purchase` olur.

## Çerez izni

Meta Pixel bir **pazarlama** aracıdır. Çerez banner'ında “Pazarlama” izni
verilmeden:

- `connect.facebook.net/en_US/fbevents.js` yüklenmez,
- `_fbp` çerezi yazılmaz,
- hiçbir olay gönderilmez.

İzin aynı sekmede banner'dan veya başka sekmede değiştirilirse piksel buna
anında uyum sağlar. İzin geri çekilirse sonraki olaylar gönderilmez.

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

Tarayıcı pikseli pazarlama çerez iznine bağlıdır. **Conversions API ise
sunucudan çalışır ve çerez gerektirmez**; e-posta ve kullanıcı kimliği Meta'ya
sadece SHA-256 özetiyle gider. Sunucu taraflı ölçümün KVKK aydınlatma metni ve
gizlilik politikasında belirtilmesi gerekir. Kullanıcı bazında sunucu tarafı
izin kapısı istiyorsanız çerez tercihinin profile yazılması ve webhook'ta
okunması gerekir — mevcut akışta tercih yalnızca tarayıcıda saklanıyor.

## Sınırlamalar

- Google ile hızlı kayıt akışı `CompleteRegistration` göndermez (yalnızca
  e-posta doğrulamalı kayıt gönderir); bu, dönen kullanıcıların yeniden
  “kayıt” sayılmaması için bilinçli bir tercihtir.
- `noscript` görseli yoktur: izin kontrolü yapamadan çalışacağı için pazarlama
  rızasını delen bir istek üretirdi.
