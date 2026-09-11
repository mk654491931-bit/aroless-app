// ============================================================================
// Outbound URL safety (server only)
//
// The store auditor fetches a URL the user typed. Without a guard that is a
// textbook SSRF primitive: `http://169.254.169.254/...` (cloud metadata),
// `http://localhost:5432`, internal dashboards, ... all reachable from inside
// the deployment. This module validates every hop — including each redirect —
// before a socket is opened.
//
// Scope note: hostnames are checked against loopback/private/link-local
// patterns and IP literals. We deliberately do NOT resolve DNS here (no DNS
// rebinding protection), which is documented in the report; the practical
// attack surface (metadata endpoints, localhost services, private ranges by
// literal address) is closed.
// ============================================================================

export type UrlRejection =
  "invalid" | "protocol" | "credentials" | "blocked_host" | "blocked_ip" | "too_long";

export type UrlSafety = { ok: true; url: URL } | { ok: false; reason: UrlRejection };

/** Hostnames that must never be reachable from the server. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
]);

/** Suffixes used by internal naming (Kubernetes, mDNS, cloud-internal). */
const BLOCKED_SUFFIXES = [
  ".localhost",
  ".local",
  ".localdomain",
  ".internal",
  ".intranet",
  ".lan",
  ".home.arpa",
  ".in-addr.arpa",
  ".ip6.arpa",
];

const MAX_URL_LENGTH = 2048;

function ipv4Octets(host: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return null;
  const octets = match.slice(1).map((part) => Number(part));
  return octets.every((n) => n >= 0 && n <= 255) ? octets : null;
}

/** Loopback, private, link-local, CGNAT, multicast and reserved IPv4 space. */
function isBlockedIpv4(host: string): boolean {
  const octets = ipv4Octets(host);
  if (!octets) return false;
  const [a, b] = octets as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 + 192.0.2.0/24
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

/** Expands a compressed IPv6 literal into its eight 16-bit groups. */
function expandIpv6(value: string): number[] | null {
  const [address] = value.split("%");
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  const numbers = groups.map((group) => Number.parseInt(group || "0", 16));
  return numbers.every((n) => Number.isFinite(n) && n >= 0 && n <= 0xffff) ? numbers : null;
}

/**
 * Loopback, unspecified, unique-local (fc00::/7), link-local (fe80::/10),
 * multicast and IPv4-mapped (`::ffff:a.b.c.d`, also in hex form) addresses.
 */
function isBlockedIpv6(host: string): boolean {
  const value = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (!value.includes(":")) return false;

  const groups = expandIpv6(value);
  if (!groups) {
    // Could not parse it: refuse rather than guess.
    return value === "::" || value === "::1";
  }
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];

  const isUnspecified = groups.every((n) => n === 0);
  const isLoopback =
    g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g7 === 1;
  if (isUnspecified || isLoopback) return true;

  // IPv4-mapped / IPv4-compatible → validate the embedded IPv4 part.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) {
    const dotted = [g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff].join(".");
    if (isBlockedIpv4(dotted)) return true;
  }

  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g0 === 0x64 && g1 === 0xff9b) return true; // 64:ff9b::/96 NAT64
  return false;
}

/** Validates a user-supplied URL for outbound fetching. */
export function checkExternalUrl(raw: string): UrlSafety {
  const value = String(raw ?? "").trim();
  if (!value || value.length > MAX_URL_LENGTH) return { ok: false, reason: "too_long" };

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "invalid" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "protocol" };
  }
  if (url.username || url.password) return { ok: false, reason: "credentials" };

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return { ok: false, reason: "invalid" };
  if (BLOCKED_HOSTNAMES.has(host)) return { ok: false, reason: "blocked_host" };
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return { ok: false, reason: "blocked_host" };
  }
  if (host.includes(":")) {
    if (isBlockedIpv6(host)) return { ok: false, reason: "blocked_ip" };
  } else if (ipv4Octets(host) !== null) {
    if (isBlockedIpv4(host)) return { ok: false, reason: "blocked_ip" };
  } else {
    // http://2130706433/ is 127.0.0.1 in integer form.
    const asNumber = /^\d{1,10}$/.test(host) ? Number(host) : Number.NaN;
    if (Number.isFinite(asNumber) && asNumber <= 0xffffffff) {
      const dotted = [24, 16, 8, 0].map((shift) => (asNumber >>> shift) & 255).join(".");
      if (isBlockedIpv4(dotted)) return { ok: false, reason: "blocked_ip" };
    }
  }

  return { ok: true, url };
}

export type SafeFetchResult = {
  html: string;
  status: number;
  ms: number;
  finalUrl: string;
};

export type SafeFetchOptions = {
  /** Total wall-clock budget for the whole redirect chain. */
  timeoutMs?: number;
  /** Maximum response body kept in memory. */
  maxBytes?: number;
  /** How many redirect hops we are willing to follow. */
  maxRedirects?: number;
  userAgent?: string;
};

export class UnsafeUrlError extends Error {
  readonly reason: UrlRejection;

  constructor(reason: UrlRejection) {
    super(`Blocked outbound URL: ${reason}`);
    this.name = "UnsafeUrlError";
    this.reason = reason;
  }
}

/**
 * Fetches an external page with SSRF protection.
 *
 * Redirects are followed manually so every hop is validated again — the
 * "valid public URL redirects to 169.254.169.254" bypass is closed.
 */
export async function fetchExternalText(
  raw: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? 12_000;
  const maxBytes = options.maxBytes ?? 220_000;
  const maxRedirects = options.maxRedirects ?? 5;
  const deadline = AbortSignal.timeout(timeoutMs);

  let target = raw.startsWith("http") ? raw : `https://${raw}`;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const checked = checkExternalUrl(target);
    if (!checked.ok) throw new UnsafeUrlError(checked.reason);

    const response = await fetch(checked.url, {
      redirect: "manual",
      signal: deadline,
      headers: { "user-agent": options.userAgent ?? "Mozilla/5.0 (compatible; ArolessAudit/1.0)" },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return { html: "", status: response.status, ms: Date.now() - started, finalUrl: target };
      }
      target = new URL(location, checked.url).toString();
      continue;
    }

    const html = (await response.text()).slice(0, maxBytes);
    return { html, status: response.status, ms: Date.now() - started, finalUrl: target };
  }

  throw new UnsafeUrlError("invalid");
}
