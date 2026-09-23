/**
 * Ürün fotoğrafı çözümleme (sunucu tarafı).
 *
 * Fotoğraflar gerçek mağaza/arama sayfalarından kazınır. `SCRAPERAPI_KEY`
 * (ScrapAPI / ScraperAPI) tanımlıysa istekler bu servis üzerinden yapılır:
 * proxy + CAPTCHA/anti-bot çözümü sayesinde Bing Görseller gibi sayfalar
 * güvenilir biçimde çekilir. Anahtar yoksa hat doğrudan kazımaya düşer ve
 * özellik otomatik devre dışı kalmaz.
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

/** Anahtar modül yüklemesinde DEĞİL, çağrı anında okunur (istemci paketine sızmasın). */
function scraperKey(): string {
  // Anahtar adı kullanıcının panelde yazdığı biçime göre değişebilir: üçünü de
  // kabul et ki "anahtarı ekledim ama fotoğraf gelmiyor" durumu oluşmasın.
  return (
    process.env.SCRAPERAPI_KEY?.trim() ||
    process.env.SCRAPAPI_KEY?.trim() ||
    process.env.SCRAP_API_KEY?.trim() ||
    ""
  );
}

export function scraperApiConfigured(): boolean {
  return scraperKey().length > 0;
}

/**
 * Bir URL'nin metnini döner. ScrapAPI/ScraperAPI anahtarı varsa istek onun
 * üzerinden (ülke: US) yapılır; aksi halde ya da servis hata verirse doğrudan
 * `fetch` kullanılır. Hiçbir koşulda fırlatmaz.
 */
async function fetchText(
  target: string,
  headers: Record<string, string> = {},
): Promise<{ text: string | null; viaScraperApi: boolean }> {
  const key = scraperKey();
  if (key) {
    try {
      const proxied = `https://api.scraperapi.com/?api_key=${encodeURIComponent(
        key,
      )}&country_code=us&url=${encodeURIComponent(target)}`;
      const r = await fetch(proxied);
      if (r.ok) {
        const text = await r.text();
        if (text.trim()) return { text, viaScraperApi: true };
      }
    } catch {
      /* servis düştü → doğrudan kazımaya düş */
    }
  }
  try {
    const r = await fetch(target, { headers: { "user-agent": UA, ...headers } });
    return { text: r.ok ? await r.text() : null, viaScraperApi: false };
  } catch {
    return { text: null, viaScraperApi: false };
  }
}

async function ddgToken(q: string): Promise<string | null> {
  const { text } = await fetchText(
    `https://duckduckgo.com/?q=${encodeURIComponent(q)}&iax=images&ia=images`,
  );
  const m = text?.match(/vqd=(?:"|&quot;|')?([\d-]+)(?:"|&quot;|')?/);
  return m ? m[1] : null;
}

async function ddgFirstImage(q: string): Promise<string | null> {
  const vqd = await ddgToken(q);
  if (!vqd) return null;
  const { text } = await fetchText(
    `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(
      q,
    )}&vqd=${vqd}&f=,,,,,&p=1`,
    { referer: "https://duckduckgo.com/", accept: "application/json, text/javascript, */*; q=0.01" },
  );
  if (!text) return null;
  try {
    const data = JSON.parse(text) as { results?: Array<{ image?: string; thumbnail?: string }> };
    const first = data?.results?.find((x) => x.image || x.thumbnail);
    return first?.image || first?.thumbnail || null;
  } catch {
    return null;
  }
}

/** Bing Görseller'den ilk gerçek fotoğrafı kazır. */
async function bingFirstImage(q: string): Promise<{ url: string | null; viaScraperApi: boolean }> {
  const { text, viaScraperApi } = await fetchText(
    `https://www.bing.com/images/search?q=${encodeURIComponent(q)}&form=HDRSC2&first=1`,
    { accept: "text/html" },
  );
  if (!text) return { url: null, viaScraperApi };
  const m = text.match(/murl&quot;:&quot;(https?:\/\/[^&]+?)&quot;/);
  if (m) return { url: m[1].replace(/\\\//g, "/"), viaScraperApi };
  const m2 = text.match(/"murl":"(https?:\/\/[^"]+?)"/);
  return { url: m2 ? m2[1].replace(/\\\//g, "/") : null, viaScraperApi };
}

/** Wikimedia Commons — gerçek, serbest lisanslı fotoğraf (son çare). */
async function wikimediaFirstImage(q: string): Promise<string | null> {
  const { text } = await fetchText(
    `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrlimit=1&gsrsearch=${encodeURIComponent(
      q,
    )}&prop=imageinfo&iiprop=url&iiurlwidth=800`,
  );
  if (!text) return null;
  try {
    const data = JSON.parse(text) as {
      query?: { pages?: Record<string, { imageinfo?: { thumburl?: string; url?: string }[] }> };
    };
    const pages = data?.query?.pages ? Object.values(data.query.pages) : [];
    const info = pages[0]?.imageinfo?.[0];
    return info?.thumburl || info?.url || null;
  } catch {
    return null;
  }
}

/**
 * Ürün fotoğrafını çözer. Öncelik sırası:
 *   1. ScrapAPI/ScraperAPI anahtarı varsa Bing Görseller (proxy → güvenilir),
 *   2. DuckDuckGo Görseller (doğrudan),
 *   3. Bing Görseller (doğrudan),
 *   4. Wikimedia Commons.
 * Dönen `source` gerçekte hangi yolun kullanıldığını dürüstçe bildirir;
 * fotoğraf bulunamazsa uydurma/stok görsel ASLA döndürülmez.
 */
export async function resolveProductImage(
  q: string,
): Promise<{ url: string | null; source: string }> {
  if (scraperApiConfigured()) {
    try {
      const bing = await bingFirstImage(`${q} product photo`);
      if (bing.url) return { url: bing.url, source: "scraperapi" };
    } catch {
      /* düş */
    }
  }
  try {
    const ddg = await ddgFirstImage(`${q} product`);
    if (ddg) return { url: ddg, source: "ddg" };
  } catch {
    /* düş */
  }
  try {
    const bing = await bingFirstImage(`${q} product photo`);
    if (bing.url) return { url: bing.url, source: "bing" };
  } catch {
    /* düş */
  }
  try {
    const wiki = await wikimediaFirstImage(q);
    if (wiki) return { url: wiki, source: "wikimedia" };
  } catch {
    /* düş */
  }
  return { url: null, source: "none" };
}
