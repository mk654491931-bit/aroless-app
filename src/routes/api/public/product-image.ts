import { createFileRoute } from "@tanstack/react-router";
import { guardPublic } from "@/lib/api-guard.server";

// Simple in-memory cache (per worker instance). Key: normalized query.
const cache = new Map<string, { url: string; at: number }>();
const TTL_MS = 1000 * 60 * 60 * 24; // 24h

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, max-age=86400",
};

async function ddgToken(q: string): Promise<string | null> {
  const r = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(q)}&iax=images&ia=images`, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    },
  });
  const html = await r.text();
  const m = html.match(/vqd=(?:"|&quot;|')?([\d-]+)(?:"|&quot;|')?/);
  return m ? m[1] : null;
}

async function ddgFirstImage(q: string): Promise<string | null> {
  const vqd = await ddgToken(q);
  if (!vqd) return null;
  const url = `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(
    q,
  )}&vqd=${vqd}&f=,,,,,&p=1`;
  const r = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      referer: "https://duckduckgo.com/",
      accept: "application/json, text/javascript, */*; q=0.01",
    },
  });
  if (!r.ok) return null;
  const data = (await r.json().catch(() => null)) as {
    results?: Array<{ image?: string; thumbnail?: string }>;
  } | null;
  const first = data?.results?.find((x) => x.image || x.thumbnail);
  return first?.image || first?.thumbnail || null;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

/** Real image search fallback: scrape Bing Images for the first real photo. */
async function bingFirstImage(q: string): Promise<string | null> {
  try {
    const r = await fetch(
      `https://www.bing.com/images/search?q=${encodeURIComponent(q)}&form=HDRSC2&first=1`,
      { headers: { "user-agent": UA, accept: "text/html" } },
    );
    if (!r.ok) return null;
    const html = await r.text();
    const m = html.match(/murl&quot;:&quot;(https?:\/\/[^&]+?)&quot;/);
    if (m) return m[1].replace(/\\\//g, "/");
    const m2 = html.match(/"murl":"(https?:\/\/[^"]+?)"/);
    return m2 ? m2[1].replace(/\\\//g, "/") : null;
  } catch {
    return null;
  }
}

/** Wikimedia Commons — real, freely licensed photography as a last resort. */
async function wikimediaFirstImage(q: string): Promise<string | null> {
  try {
    const r = await fetch(
      `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrlimit=1&gsrsearch=${encodeURIComponent(
        q,
      )}&prop=imageinfo&iiprop=url&iiurlwidth=800`,
      { headers: { "user-agent": UA } },
    );
    if (!r.ok) return null;
    const data = (await r.json().catch(() => null)) as any;
    const pages = data?.query?.pages ? Object.values<any>(data.query.pages) : [];
    const info = pages[0]?.imageinfo?.[0];
    return info?.thumburl || info?.url || null;
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/public/product-image")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const limited = await guardPublic(request, "product-image", 240, 60);
        if (limited) return limited;
        const url = new URL(request.url);
        const q = (url.searchParams.get("q") || "").trim().slice(0, 120);
        if (!q) {
          return Response.json({ error: "missing q" }, { status: 400, headers: CORS });
        }
        const key = q.toLowerCase();
        const hit = cache.get(key);
        if (hit && Date.now() - hit.at < TTL_MS) {
          return Response.json({ url: hit.url, cached: true }, { headers: CORS });
        }
        let img: string | null = null;
        let source = "fallback";
        try {
          img = await ddgFirstImage(`${q} product`);
          if (img) source = "ddg";
          if (!img) {
            img = await bingFirstImage(`${q} product photo`);
            if (img) source = "bing";
          }
          if (!img) {
            img = await wikimediaFirstImage(q);
            if (img) source = "wikimedia";
          }
        } catch {
          img = null;
        }
        if (!img) {
          // No real image found — never return a fabricated/stock placeholder.
          return Response.json({ url: null, cached: false, source: "none" }, { headers: CORS });
        }
        cache.set(key, { url: img, at: Date.now() });
        return Response.json({ url: img, cached: false, source }, { headers: CORS });
      },
    },
  },
});
