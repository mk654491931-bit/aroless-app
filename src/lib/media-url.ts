/** Shared media URL guard used by both server routes and browser components. */

export const DEFAULT_MEDIA_FALLBACK = "/logo-mark.png";

/**
 * Return a safe absolute HTTP(S) URL for an upstream media resource.
 * Bare hostnames are upgraded to HTTPS; non-network protocols are rejected.
 */
export function normalizeExternalMediaUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    parsed.protocol = "https:";
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Normalize a browser image source while preserving same-origin app paths.
 * Invalid or unsupported values always resolve to the local branded fallback.
 */
export function normalizeMediaUrl(value: unknown, fallback = DEFAULT_MEDIA_FALLBACK): string {
  if (typeof value !== "string") return fallback;
  const raw = value.trim();
  if (!raw) return fallback;
  if (raw.startsWith("/")) return raw;

  return normalizeExternalMediaUrl(raw) ?? fallback;
}
