/**
 * ÜCRETSİZ HABER AKIŞI — AI anahtarı olmadığında da News modülü boş kalmasın.
 *
 * Kaynaklar herkese açık RSS akışlarıdır; anahtar veya ödeme gerektirmez.
 * AI varsa aynı başlıklar prompt'a KANIT olarak eklenir; AI yoksa kartlar
 * "AI yorumu" yerine dürüstçe "Kaynak özeti" olarak gösterilir.
 *
 * UYDURMA YOK: başlık, tarih, kaynak ve özet yalnız feed'de yazdığı kadardır.
 * Impact/aksiyon alanları yalnız başlık+özet metnindeki anahtar kelimelerden
 * türetilir; "AI analizi" diye etiketlenmez.
 */

export type FreeNewsFeed = {
  id: string;
  name: string;
  url: string;
  category: string;
};

export const FREE_NEWS_FEEDS: readonly FreeNewsFeed[] = [
  {
    id: "retaildive",
    name: "Retail Dive",
    url: "https://www.retaildive.com/feeds/news/",
    category: "Perakende",
  },
  {
    id: "supplychaindive",
    name: "Supply Chain Dive",
    url: "https://www.supplychaindive.com/feeds/news/",
    category: "Lojistik",
  },
  {
    id: "modernretail",
    name: "Modern Retail",
    url: "https://www.modernretail.co/feed/",
    category: "E-ticaret",
  },
  {
    id: "practicalecommerce",
    name: "Practical Ecommerce",
    url: "https://www.practicalecommerce.com/feed",
    category: "E-ticaret",
  },
] as const;

export type FreeNewsItem = {
  title: string;
  source: string;
  date: string;
  time_ago: string;
  category: string;
  summary: string;
  impact: "high" | "medium" | "low";
  action?: string;
  url?: string;
  /** false = AI açıklaması değil, RSS kaynak özeti. */
  ai: false;
};

const RSS_TTL_MS = 10 * 60 * 1000;
const RSS_FAIL_TTL_MS = 45 * 1000;
const FEED_TIMEOUT_MS = 6_000;
const MAX_ITEMS = 24;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

const cache = new Map<string, { at: number; value: FreeNewsItem[] }>();

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCodePoint(n) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const n = Number.parseInt(code, 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : "";
    });
}

/** CDATA, HTML etiketi ve entity'leri temizler; feed metnini sınırlar. */
export function cleanFeedText(value: string, limit = 300): string {
  return decodeEntities(
    String(value ?? "")
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]{1,200}>/g, " ")
      .replace(/\s+/g, " "),
  )
    .trim()
    .slice(0, limit);
}

function tagValue(block: string, names: readonly string[]): string {
  for (const name of names) {
    const match = new RegExp(
      `<${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s[^>]*)?>([\\s\\S]*?)</${name.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      )}>`,
      "i",
    ).exec(block);
    if (match) return cleanFeedText(match[1], 900);
  }
  return "";
}

function linkValue(block: string): string {
  const raw = tagValue(block, ["link"]);
  if (/^https?:\/\//i.test(raw)) return raw;
  const alternate = /<link\b[^>]*\brel=["']alternate["'][^>]*\bhref=["']([^"']+)["']/i.exec(block);
  if (alternate) return decodeEntities(alternate[1]);
  const href = /<link\b[^>]*\bhref=["']([^"']+)["']/i.exec(block);
  return href ? decodeEntities(href[1]) : "";
}

function publishDate(block: string): Date | null {
  const raw = tagValue(block, ["pubDate", "published", "updated", "dc:date", "date"]);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function newsTimeAgo(date: Date, now = Date.now()): string {
  const diff = Math.max(0, now - date.getTime());
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < hour) return `${Math.max(1, Math.round(diff / minute))} dk önce`;
  if (diff < day) return `${Math.round(diff / hour)} saat önce`;
  if (diff < 7 * day) return `${Math.round(diff / day)} gün önce`;
  return date.toLocaleDateString("tr-TR", { day: "2-digit", month: "short" });
}

export function classifyNewsImpact(text: string): FreeNewsItem["impact"] {
  const value = text.toLowerCase();
  if (
    /tariff|duty|customs|tax|vat|ban\b|suspend|recall|strike|outage|shutdown|bankrupt|fee increase|new fee|(?:raise|increase|hike)\w*\s+(?:\w+\s+){0,4}fees?|policy change|regulation/.test(
      value,
    )
  )
    return "high";
  if (
    /launch|update|change|expand|partner|acquisition|fulfillment|shipping|delivery|commission|pricing|marketplace|logistics/.test(
      value,
    )
  )
    return "medium";
  return "low";
}

export function inferNewsCategory(text: string, fallback: string): string {
  const value = text.toLowerCase();
  if (/tariff|customs|duty|tax|vat|regulation/.test(value)) return "Vergi & Gümrük";
  // Pazaryeri adı geçen bir başlık, içinde "fulfillment" geçse de pazaryeri
  // haberi sayılır; yoksa Amazon/FBA haberleri yanlışlıkla Lojistik'e düşüyor.
  if (/amazon|tiktok|shopify|etsy|walmart|ebay|marketplace|seller/.test(value)) return "Pazaryeri";
  if (/payment|checkout|stripe|paypal|fintech/.test(value)) return "Ödeme";
  if (/ad\b|ads\b|advertising|campaign|marketing/.test(value)) return "Reklam";
  if (/shipping|freight|logistics|port|carrier|delivery|fulfillment/.test(value)) return "Lojistik";
  return fallback;
}

function inferredAction(impact: FreeNewsItem["impact"], text: string): string | undefined {
  const value = text.toLowerCase();
  if (/tariff|customs|duty|tax|vat/.test(value))
    return "Etkilenen SKU'ların landed cost ve fiyat tabanını yeni oranla yeniden hesapla.";
  if (/ban\b|suspend|recall|policy|regulation/.test(value))
    return "Etkilenen listing ve ürünleri kontrol listesine al; kaynağı doğrula.";
  if (impact === "high" && /strike|outage|port|carrier|shipping|logistics/.test(value))
    return "Teslim tarihlerini ve alternatif taşıyıcıyı gözden geçir.";
  if (/commission|fee|pricing/.test(value))
    return "Kanal komisyonu ve fiyat bandını yeniden kontrol et.";
  return undefined;
}

/**
 * RSS 2.0 veya Atom gövdesini araç kartlarının beklediği biçime çevirir.
 * Tarihi okunamayan veya çok eski kayıtlar elenir; başlık yoksa satır üretilmez.
 */
export function parseNewsFeed(xml: string, feed: FreeNewsFeed, now = Date.now()): FreeNewsItem[] {
  const source = String(xml ?? "");
  if (!/<(?:rss|feed|rdf:RDF)\b/i.test(source)) return [];
  const blocks = [
    ...source.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi),
    ...source.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi),
  ]
    .map((match) => match[1])
    .slice(0, 40);

  const items: FreeNewsItem[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    const title = tagValue(block, ["title"]);
    const date = publishDate(block);
    if (!title || !date) continue;
    if (now - date.getTime() > MAX_AGE_MS) continue;
    const url = linkValue(block);
    const summary = tagValue(block, ["description", "summary", "content:encoded", "content"]);
    const text = `${title} ${summary}`.trim();
    const key = title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "")
      .slice(0, 100);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const impact = classifyNewsImpact(text);
    items.push({
      title,
      source: feed.name,
      date: date.toISOString().slice(0, 10),
      time_ago: newsTimeAgo(date, now),
      category: inferNewsCategory(text, feed.category),
      summary: summary && summary.toLowerCase() !== title.toLowerCase() ? summary : title,
      impact,
      action: inferredAction(impact, text),
      ...(url ? { url } : {}),
      ai: false,
    });
  }
  return items;
}

async function fetchFeed(feed: FreeNewsFeed): Promise<FreeNewsItem[]> {
  try {
    const response = await fetch(feed.url, {
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
      headers: {
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
        "user-agent": "ArolessNewsBot/1.0 (+https://aroless.app)",
      },
    });
    if (!response.ok) return [];
    return parseNewsFeed(await response.text(), feed);
  } catch {
    return [];
  }
}

/**
 * Son 14 günden en yeni başlıkları getirir. Aynı feed tekrar çağrıldığında
 * 10 dakika önbellekten döner; başarısız tur 45 saniye negatif önbelleklenir.
 */
export async function fetchFreeNews(limit = 8): Promise<{
  items: FreeNewsItem[];
  sources: { label: string; url: string; fetchedAt: string }[];
}> {
  const capped = Math.max(1, Math.min(MAX_ITEMS, Math.floor(limit)));
  const settled = await Promise.allSettled(
    FREE_NEWS_FEEDS.map(async (feed) => {
      const hit = cache.get(feed.id);
      if (hit && Date.now() - hit.at < (hit.value.length ? RSS_TTL_MS : RSS_FAIL_TTL_MS)) {
        return { feed, items: hit.value };
      }
      const items = await fetchFeed(feed);
      cache.set(feed.id, { at: Date.now(), value: items });
      return { feed, items };
    }),
  );

  const items: FreeNewsItem[] = [];
  const sources: { label: string; url: string; fetchedAt: string }[] = [];
  const seen = new Set<string>();
  for (const result of settled) {
    if (result.status !== "fulfilled" || !result.value.items.length) continue;
    const { feed, items: feedItems } = result.value;
    sources.push({
      label: `RSS · ${feed.name}`,
      url: feed.url,
      fetchedAt: new Date().toISOString(),
    });
    for (const item of feedItems) {
      const key = item.title
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "")
        .slice(0, 100);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }

  items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { items: items.slice(0, capped), sources };
}

/** AI prompt'una girecek kısa, kaynaklı RSS bağlamı. */
export async function buildNewsRssContext(): Promise<{
  text: string;
  sources: { label: string; url: string; fetchedAt: string }[];
} | null> {
  const { items, sources } = await fetchFreeNews(10);
  if (!items.length) return null;
  const lines = items.map(
    (item) => `- ${item.date} · ${item.source} · ${item.title}${item.url ? ` (${item.url})` : ""}`,
  );
  return {
    text: `CANLI RSS HABER KANITI (yalnız aşağıdaki gerçek feed başlıklarını kullan; kaynakta olmayan bir olayı ekleme):\n${lines.join("\n")}`,
    sources,
  };
}
