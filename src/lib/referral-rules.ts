/**
 * Davet (referral) akışının saf kuralları — DB ve istemci yok.
 *
 * `?ref=KOD` ile gelen kullanıcının kodu localStorage'da saklanır ve profil
 * hazır olduğunda kullanılır. Kritik kural: kod, davet KALICI olarak
 * reddedilmedikçe silinmez; aksi halde profil satırı geç oluşan yeni
 * kayıtların bonusu kalıcı olarak kaybolurdu.
 */

/** Davet kodu yalnızca hesabın ilk N gününde kullanılabilir. */
export const REFERRAL_CLAIM_WINDOW_DAYS = 30;
export const REFERRAL_CLAIM_WINDOW_MS = REFERRAL_CLAIM_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** Sunucunun döndürdüğü makine tarafından okunabilir sonuç kodu. */
export type ReferralClaimCode =
  | "ok"
  | "profile_missing"
  | "self"
  | "already_used"
  | "not_found"
  | "referrer_limit"
  | "window_closed"
  | "insert_failed"
  | "credit_failed";

export type ReferralClaimResult = {
  ok: boolean;
  code: ReferralClaimCode;
  reason?: string;
  credits?: number;
};

/** Bir daha denenmesinde hiçbir faydası olmayan kodlar. */
const TERMINAL_CLAIM_CODES: ReadonlySet<ReferralClaimCode> = new Set([
  "self",
  "already_used",
  "not_found",
  "referrer_limit",
  "window_closed",
]);

/** "Bu davet kodu bir daha denenmemeli mi?" — geçici hatalar false döner. */
export function isTerminalClaim(code: ReferralClaimCode): boolean {
  return TERMINAL_CLAIM_CODES.has(code);
}

/** Saklanan davet kodunun akıbeti: temizlensin mi, kalsın mı? */
export type StoredRefAction = "clear" | "keep" | "retry";

/**
 * Saklanan `aroless.ref` koduna ne olacağına karar verir.
 *  - `ok`                 → kullanıldı, temizle
 *  - `profile_missing`    → profil henüz yok, kısa süre sonra tekrar dene
 *  - kalıcı red           → temizle (yeniden denemek anlamsız)
 *  - diğer hatalar        → sakla, sonraki açılışta yeniden dene
 */
export function storedRefAction(code: ReferralClaimCode): StoredRefAction {
  if (code === "ok") return "clear";
  if (code === "profile_missing") return "retry";
  return isTerminalClaim(code) ? "clear" : "keep";
}

/** Hesabın yaşı (ms) bu kullanıcı için davet penceresini kapatıyor mu? */
export function isWithinClaimWindow(ageMs: number | null | undefined): boolean {
  if (typeof ageMs !== "number" || !Number.isFinite(ageMs)) return false;
  return ageMs < REFERRAL_CLAIM_WINDOW_MS;
}
