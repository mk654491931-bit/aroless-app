/**
 * Jeton (kredi) bakiyesi — TEK KAYNAK.
 *
 * NEDEN GEREKLİ: `profiles` tablosunda iki ayrı harcanabilir havuz var:
 *   - `finder_credits` → ücretsiz plandaki 2 hoş geldin jetonu (ürün bulucuya özel)
 *   - `credits`        → genel/ücretli jetonlar (konsey, stüdyo, denetim, bulucu…)
 *
 * Veritabanı kuralı nettir (SQL: `deduct_product_finder_credit`,
 * `deduct_product_finder_credit_for_job`): ürün bulucu ÖNCE `finder_credits`'i
 * harcar, o bitince `credits`'e düşer. Ama arayüz yalnızca `credits` gösteriyordu:
 * ücretsiz kullanıcı (0 genel + 2 finder) rozetinde sürekli **0** görüyor,
 * üstelik `credits <= 0` kontrolü aramayı "kredin bitti" diye ENGELLİYORDU —
 * yani kullanıcı "jeton eksilmiyor" diyordu, çünkü gerçekten harcayan havuz hiç
 * görünmüyordu.
 *
 * Bu modül iki havuzu tek bir harcanabilir toplamda birleştirir ve düşmenin
 * hangi havuzdan yapılacağını da (DB ile birebir aynı kural) söyler; böylece
 * arayüz, iade ve muhasebe aynı sayıyı konuşur.
 */

export type CreditProfile = {
  credits?: number | null;
  finder_credits?: number | null;
  credits_spent?: number | null;
};

export type CreditBalances = {
  /** Ürün bulucunun ilk harcadığı havuz (ücretsiz hoş geldin jetonları). */
  finder: number;
  /** Genel/ücretli jetonlar. */
  general: number;
  /** Kullanıcının harcayabileceği toplam jeton. */
  total: number;
  /** Bugüne kadar harcanan (iade edilenler düşülmüş) jeton sayısı. */
  spent: number;
};

/** Hangi sütundan düşülecek — SQL fonksiyonlarıyla aynı kural: önce finder. */
export type CreditPool = "finder_credits" | "credits";

function count(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

export function creditBalances(profile: CreditProfile | null | undefined): CreditBalances {
  const finder = count(profile?.finder_credits);
  const general = count(profile?.credits);
  return { finder, general, total: finder + general, spent: count(profile?.credits_spent) };
}

/** Bu iş için yeterli jeton var mı? (Arayüz kapısı ve sunucu kontrolü aynı sayıyı kullanır.) */
export function hasSpendableCredits(profile: CreditProfile | null | undefined, need = 1): boolean {
  return creditBalances(profile).total >= Math.max(1, Math.floor(need));
}

/**
 * Düşmenin yapılacağı havuz: ücretsiz hoş geldin jetonu bitmemişse oradan,
 * yoksa genel jetonlardan. `deduct_product_finder_credit()` ile birebir aynı.
 */
export function chargePoolFor(profile: CreditProfile | null | undefined): CreditPool {
  return count(profile?.finder_credits) > 0 ? "finder_credits" : "credits";
}

/** Rozet/tooltip için kısa döküm: "Ürün Bulucu 2 · Genel 0". */
export function creditBreakdownLabel(balances: CreditBalances): string {
  return `Ürün Bulucu ${balances.finder} · Genel ${balances.general}`;
}
