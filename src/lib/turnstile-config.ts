/**
 * Cloudflare Turnstile widget ayarları (saf, test edilebilir).
 *
 * Mobil için kritik iki karar burada tutulur:
 * - `size: "flexible"` → widget kapsayıcı genişliğine uyar. Sabit 300px'lik
 *   `"normal"` boyut dar ekranda karttan taşıyor, kartın ölçüsü değişiyor ve
 *   bölüm açılıp kapanıyormuş gibi görünüyordu.
 * - `retry-interval` **ayarlanmaz** → Cloudflare varsayılanı (8 sn) geçerlidir.
 *   1,5 sn'lik agresif aralık, çözülemeyen bir challenge'da hata/deneme
 *   döngüsü üretiyordu (mobilde art arda "verification failed" uyarıları).
 *
 * `appearance: "interaction-only"` korunur; token yine de her durumda
 * `callback`/`error-callback`/`expired-callback` üzerinden akar ve akışı
 * bloke etmez. Geçerli `size` değerleri: "normal" | "compact" | "flexible".
 */

export const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export type TurnstileOptions = Record<string, unknown> & {
  sitekey: string;
  size: string;
  appearance: string;
  callback: (token: string) => void;
  "error-callback": () => void;
  "expired-callback": () => void;
  "timeout-callback": () => void;
};

/** Widget'ın render seçenekleri; tüm hata yolları `onToken("")` ile devam eder. */
export function turnstileWidgetOptions(
  siteKey: string,
  onToken: (token: string) => void,
  warn: (message: string) => void = (message) => console.warn(message),
): TurnstileOptions {
  return {
    sitekey: siteKey,
    size: "flexible",
    appearance: "interaction-only",
    theme: "auto",
    retry: "auto",
    "refresh-expired": "auto",
    callback: (token: string) => onToken(token),
    "error-callback": () => {
      warn("[turnstile] verification failed — continuing without captcha");
      onToken("");
    },
    "expired-callback": () => {
      warn("[turnstile] token expired — continuing without captcha");
      onToken("");
    },
    "timeout-callback": () => {
      warn("[turnstile] timeout — continuing without captcha");
      onToken("");
    },
  };
}
