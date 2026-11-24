/**
 * META CAPI KULLANICI VERİSİ — saf doğrulayıcılar (ağ/DB yok).
 *
 * `_fbp`/`_fbc` çerezleri ve `user-agent` istemci tarafından yazılabildiği
 * için Meta'ya GÖNDERİLMEDEN ÖNCE doğrulanır. Doğrulanmayan değer sessizce
 * atlanır; olayın kendisi gönderilir.
 *
 * E-posta ve kullanıcı kimliği burada DEĞİL, `meta-capi.server.ts` içinde
 * SHA-256 ile özetlenir.
 */
import { isIP } from "node:net";

/**
 * `_fbp`/`_fbc` biçimi: `fb.<sürüm>.<zaman>.<değer>`.
 *
 * Serbest metin KABUL EDİLMEZ: çerez istemci tarafından yazılabildiği için
 * doğrulanmamış bir değer Meta'ya kişisel veri sızdırabilir.
 */
export function sanitizeMetaBrowserId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 320) return null;
  return /^fb\.\d+\.\d{10,}\.[A-Za-z0-9._-]{1,300}$/.test(trimmed) ? trimmed : null;
}

/** Geçerli bir IP adresi değilse `null` (Meta yalnız gerçek IP kabul eder). */
export function sanitizeMetaClientIp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64) return null;
  return isIP(trimmed) ? trimmed : null;
}

/** User-agent tek satıra indirilir ve Meta için 500 karakterle sınırlanır. */
export function sanitizeMetaUserAgent(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // Kontrol karakterleri regex yerine kod noktasıyla boşluğa çevrilir
  // (lint `no-control-regex`; davranış aynı).
  const normalized = [...value]
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code < 32 || code === 127 ? " " : char;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, 500) : null;
}

/** `cookie` başlığından tek bir çerezi okur (yoksa `null`). */
export function readCookieValue(
  cookieHeader: string | null | undefined,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}
