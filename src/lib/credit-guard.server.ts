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
 */
export async function refundCredit(
  userId: string,
  amount = 1,
  reason = "analysis_failed",
): Promise<boolean> {
  try {
    // Dinamik import: admin istemcisi yalnızca iade anında yüklenir, böylece
    // *.functions.ts dosyaları istemci paketine sunucu kodu çekmez.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("increment_profile_credits", {
      _profile_id: userId,
      _amount: Math.max(1, Math.round(amount)),
    });
    if (error) {
      console.error(`[credits] refund failed (${reason}): ${error.message}`);
      return false;
    }
    console.log(`[credits] refunded ${amount} credit(s) to ${userId.slice(0, 8)}… (${reason})`);
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
