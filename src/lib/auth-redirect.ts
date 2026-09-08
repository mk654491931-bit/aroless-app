// ============================================================================
// Auth URL + password helpers.
//
// These were inline closures and a useMemo inside src/routes/auth.tsx, which
// made them impossible to test even though two of them are security-relevant:
// one decides where a user is sent after signing in, the other reads a
// referral code that is spent for credits.
// ============================================================================

export const DEFAULT_REDIRECT = "/";

export type AuthMode = "signin" | "signup";

/**
 * Resolve the `?redirect=` target for a post-login navigation.
 *
 * Only same-origin absolute paths are allowed. Anything else falls back to
 * DEFAULT_REDIRECT, because this value is handed straight to the router: an
 * attacker who can choose it can send a freshly authenticated user anywhere.
 *
 * Rejected on purpose:
 * - `//evil.com` and `/\evil.com` — protocol-relative URLs. Browsers resolve a
 *   leading backslash like a slash, so blocking only `//` leaves the hole open.
 * - `https://evil.com`, `javascript:…` — not a path at all.
 * - anything not starting with `/`.
 */
export function safeRedirectPath(search: string): string {
  const raw = new URLSearchParams(search).get("redirect");
  if (!raw) return DEFAULT_REDIRECT;
  if (!raw.startsWith("/")) return DEFAULT_REDIRECT;
  const second = raw[1];
  if (second === "/" || second === "\\") return DEFAULT_REDIRECT;
  return raw;
}

/** `/auth?mode=signup` opens the sign-up tab; everything else signs in. */
export function initialAuthMode(search: string): AuthMode {
  return new URLSearchParams(search).get("mode") === "signup" ? "signup" : "signin";
}

/** Referral code from `?ref=`, normalised the way the signup server fn expects. */
export function referralCodeFromSearch(search: string): string {
  return new URLSearchParams(search).get("ref")?.trim().toUpperCase() ?? "";
}

/** Password strength on a 0-4 scale. Same rules as before, now testable. */
export function passwordStrength(password: string): number {
  let score = 0;
  if (password.length >= 6) score++;
  if (password.length >= 10) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password) || /[^A-Za-z0-9]/.test(password)) score++;
  return score;
}

/** Indexed by passwordStrength(); index 0 and 1 are both "weak" by design. */
export const STRENGTH_LABELS = ["weak", "weak", "fair", "good", "strong"] as const;

export function strengthLabel(password: string): string {
  return STRENGTH_LABELS[passwordStrength(password)];
}
