/**
 * Herkese açık sayfaların ortak `head()` yardımcıları.
 *
 * NEDEN: `canonical`, `og:url`, `og:site_name` ve `twitter:title` her sayfada
 * elle yazılıyordu; hiçbirinde canonical yoktu. Ayrıca mutlak adres
 * üretilemediğinde GÖRELİ bir canonical yazmak arama motoruna yanlış sinyal
 * verir — bu yüzden origin bilinmiyorsa canonical hiç yazılmaz.
 *
 * Origin sırası: APP_URL → VITE_APP_URL → Vercel'in VERCEL_URL'ü → (istemcide)
 * tarayıcının kendi origin'i. Sabit domain yazılmaz (README kuralı).
 */

export const SITE_NAME = "Aroless";

/** Mutlak origin (sondaki `/` atılmış) veya bilinmiyorsa null. */
export function siteOrigin(): string | null {
  // Sıra korunur; BOŞ değer "tanımsız" sayılır (Vercel'de APP_URL boş string
  // olarak tanımlıysa VERCEL_URL'e düşebilmek için `??` yeterli değildi).
  const vercel = String(process.env["VERCEL_URL"] ?? "").trim();
  const candidates =
    typeof window === "undefined"
      ? [process.env["APP_URL"], process.env["VITE_APP_URL"], vercel ? `https://${vercel}` : ""]
      : [import.meta.env["VITE_APP_URL"]];

  const fallback = typeof window !== "undefined" ? window.location.origin : "";
  const origin =
    candidates.map((value) => String(value ?? "").trim()).find((value) => value.length > 0) ??
    fallback.trim();

  const normalized = origin.replace(/\/+$/, "");
  if (!normalized) return null;
  return /^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`;
}

/** Yolun mutlak adresi; origin bilinmiyorsa null. */
export function canonicalUrl(path: string): string | null {
  const origin = siteOrigin();
  if (!origin) return null;
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}

type MetaEntry =
  { title: string } | { name: string; content: string } | { property: string; content: string };

export interface PublicPageHead {
  meta: MetaEntry[];
  links: { rel: string; href: string }[];
}

/**
 * Herkese açık (indekslenebilir) bir sayfanın ortak meta'sı.
 *
 * `og:title`/`og:description` sayfaya özgü verilir: kök şablonun genel metni
 * paylaşımda yanlış başlık gösteriyordu.
 */
export function publicPageHead(args: {
  path: string;
  title: string;
  description: string;
}): PublicPageHead {
  const url = canonicalUrl(args.path);
  const meta: MetaEntry[] = [
    { property: "og:title", content: args.title },
    { property: "og:description", content: args.description },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:locale", content: "tr_TR" },
    { name: "twitter:title", content: args.title },
    { name: "twitter:description", content: args.description },
    { name: "robots", content: "index,follow" },
  ];
  if (url) meta.push({ property: "og:url", content: url });
  return {
    meta,
    links: url ? [{ rel: "canonical", href: url }] : [],
  };
}
