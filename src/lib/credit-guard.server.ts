/**
 * Kredi güvenliği (tek kaynak).
 *
 * Kural: Bir analiz kredi düştükten sonra başarısız olursa kredi kullanıcıya
 * iade edilir. Böylece başarısız analiz kullanıcıya asla kredi kaybı olarak
 * yansımaz ve arayüzdeki "kredin harcanmadı" güvencesi doğru kalır.
 *
 * Finder'da bu güvence kuyruk/worker tarafında vardı; eşzamanlı çalışan
 * motorlar (konsey, mağaza denetimi, kreatif stüdyo, doğrulama/SEO araçları)
 * için burada merkezî hâle getirildi.
 */

/** `no_credits` dışındaki düşme hataları da kullanıcıya anlamlı şekilde döner. */
export function creditDeductError(message: string | null | undefined): Error {
  const text = String(message ?? "");
  if (text.includes("no_credits")) return new Error("NO_CREDITS");
  return new Error("CREDIT_DEDUCT_FAILED");
}

/**
 * Düşülen krediyi iade eder. İade başarısız olsa bile asıl hata kullanıcıya
 * döner; iade hatası loglanır (service_role gerekir).
 *
 * TEK SEFERLİK İADE (ölçülen hata): iade yolu `increment_profile_credits`i
 * koşulsuz çağırıyordu, yani aynı iş iki kez iade edilirse (QStash retry'si,
 * çift hata, iki farklı hata yolu) kredi İKİ KEZ artıyordu — kullanıcı
 * "sistem kendi kendine kredi tanımlıyor" diye bildirdi. Artık
 * `refund_credit_once` veritabanında `ref_key` ile TEK SEFER uygular.
 *
 * `refKey` verilmezse eski davranış korunur (çağıran sözleşmeyi bilmiyorsa
 * iade kaybolmasın). Migration uygulanmamışsa fonksiyon bulunamaz ve eski RPC'ye
 * düşülür — yani bu değişiklik migration'dan ÖNCE de uygulamayı bozmaz.
 */
export async function refundCredit(
  userId: string,
  amount = 1,
  reason = "analysis_failed",
  refKey?: string | null,
): Promise<boolean> {
  const credits = Math.max(1, Math.round(amount));
  try {
    // Dinamik import: admin istemcisi yalnızca iade anında yüklenir, böylece
    // *.functions.ts dosyaları istemci paketine sunucu kodu çekmez.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (refKey) {
      const { data, error } = await supabaseAdmin.rpc("refund_credit_once", {
        _profile_id: userId,
        _amount: credits,
        _reason: reason,
        _ref_key: refKey,
      });
      if (!error) {
        // `false` = bu anahtar zaten kullanılmış, yani ikinci iade yapılmadı.
        if (data !== true) {
          console.warn(`[credits] duplicate refund ignored (${reason}, key=${refKey})`);
          return false;
        }
        console.log(
          `[credits] refunded ${credits} credit(s) to ${userId.slice(0, 8)}… (${reason})`,
        );
        return true;
      }
      // Migration henüz uygulanmamışsa eski yola düş; hat çalışmaya devam eder.
      console.warn(
        `[credits] refund_credit_once kullanılamıyor (${error.message}) — eski yola düşülüyor`,
      );
    }
    const { error } = await supabaseAdmin.rpc("increment_profile_credits", {
      _profile_id: userId,
      _amount: credits,
    });
    if (error) {
      console.error(`[credits] refund failed (${reason}): ${error.message}`);
      return false;
    }
    console.log(`[credits] refunded ${credits} credit(s) to ${userId.slice(0, 8)}… (${reason})`);
    return true;
  } catch (error) {
    console.error(`[credits] refund threw (${reason})`, error);
    return false;
  }
}

/**
 * Server fonksiyonları (`createServerFn`) için standart kredi kapısı.
 *
 * NEDEN VAR: Kredi düşme mantığı `*.functions.ts` dosyalarında tekrar tekrar
 * kopyalanıyordu ve bu yüzden bazı AI özellikleri (ürün karşılaştırma, rakip
 * denetimi, viral reklam üretimi, radar tazeleme) **tamamen ücretsiz** kalmıştı —
 * yani anahtar havuzu karşılıksız yanıyordu. Tek kapı, yeni bir AI özelliğinin
 * sessizce bedava kalmasını engeller.
 *
 * @param deduct `context.supabase.rpc("deduct_product_finder_credit")` gibi
 *   kullanıcı-kapsamlı (RLS + `auth.uid()`) bir düşme çağrısı.
 * @returns İşin gerçekten koşması durumunda `true`; tahsilat yapılamazsa
 *   `NO_CREDITS` / `CREDIT_DEDUCT_FAILED` fırlatır (fail-closed).
 */
export async function chargeForAi(
  deduct: () => PromiseLike<{ error: { message?: string | null } | null }>,
  amount = 1,
): Promise<void> {
  const n = Math.max(1, Math.round(amount));
  for (let i = 0; i < n; i++) {
    const { error } = await deduct();
    if (error) throw creditDeductError(error.message);
  }
}

/**
 * `deduct_*` çağrısından sonra çalışan analiz gövdesi. Gövde hata fırlatırsa
 * kredi iade edilir ve hata yukarı taşınır.
 */
export async function withCreditRefund<T>(
  userId: string,
  run: () => Promise<T>,
  amount = 1,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    await refundCredit(userId, amount, "analysis_failed");
    throw error;
  }
}
