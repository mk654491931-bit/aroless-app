// ============================================================================
// Pure request-hygiene helpers used by the API guard layer.
//
// These live apart from api-guard.server.ts because they are the parts worth
// testing: picking the client IP decides the rate-limit key, and the byte
// limit decides how much untrusted input we are willing to parse.
// ============================================================================

export type HeaderReader = (name: string) => string | null | undefined;

export const UNKNOWN_IP = "unknown";

/**
 * Resolve the client IP for rate limiting.
 *
 * Header order matters for security, not for taste. Vercel overwrites
 * `x-vercel-forwarded-for` and `x-real-ip` on every inbound request, so those
 * cannot be forged. `x-forwarded-for` is appended to, so only the first entry
 * is meaningful, and it is still weaker than the two above.
 *
 * `cf-connecting-ip` is only trusted when `trustCloudflare` is set, i.e. when
 * a Cloudflare proxy really is in front of the deployment. Reading it
 * unconditionally on a Vercel-only deployment turns an attacker-supplied
 * header into the rate-limit key, which lets one client rotate it and get
 * unlimited buckets.
 */
export function pickClientIp(
  getHeader: HeaderReader,
  options: { trustCloudflare?: boolean } = {},
): string {
  const candidates: Array<string | null | undefined> = [];
  if (options.trustCloudflare) candidates.push(getHeader("cf-connecting-ip"));
  candidates.push(getHeader("x-vercel-forwarded-for"));
  candidates.push(getHeader("x-real-ip"));
  candidates.push((getHeader("x-forwarded-for") ?? "").split(",")[0]);

  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value) return value;
  }
  return UNKNOWN_IP;
}

/** Byte length of a UTF-8 string. `String.length` counts UTF-16 units, not bytes. */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Is this payload within the byte cap?
 *
 * The previous check compared `text.length`, which is UTF-16 code units. A
 * Turkish or emoji-heavy body could therefore be up to ~3x the intended byte
 * size and still pass a "64 KB" limit.
 */
export function isWithinByteLimit(text: string, maxBytes: number): boolean {
  return byteLength(text) <= maxBytes;
}

/** Content-Length, when the client sent a usable one. */
export function declaredContentLength(getHeader: HeaderReader): number | null {
  const raw = getHeader("content-length");
  if (!raw) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

// Control characters (C0/C1) except tab and newline, plus zero-width and
// bidi-override characters. The latter are how "invisible" text is smuggled
// into prompts and stored records.
const STRIP_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g;

export const DEFAULT_TEXT_LIMIT = 2000;

/**
 * Normalise untrusted free text before it reaches an AI prompt or the database.
 *
 * Deliberately conservative: it does not strip punctuation, HTML or quotes,
 * because the values are product queries and prompts, not markup. It removes
 * characters that carry no meaning for the user but do carry meaning for a
 * parser or a prompt.
 */
export function sanitizeText(input: unknown, maxLength = DEFAULT_TEXT_LIMIT): string {
  if (typeof input !== "string") return "";
  return input
    .normalize("NFC")
    .replace(STRIP_PATTERN, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    .slice(0, maxLength);
}

/** Single-line variant: newlines collapse to spaces. For search queries and codes. */
export function sanitizeLine(input: unknown, maxLength = 200): string {
  return sanitizeText(input, maxLength).replace(/[\r\n]+/g, " ").replace(/ {2,}/g, " ").trim();
}
