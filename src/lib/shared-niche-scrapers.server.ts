// ============================================================================
// ORTAK NİŞ KAZIYICI UÇLARI — iki katman, tek HTTP.
// ============================================================================
//
// NEDEN BU DOSYA VAR:
// `velora-niche-scrape.server.ts` (trend radar / 14 ajan kanıtı) ve
// `product-discovery-sources.server.ts` (deterministik filtre) aynı ücretsiz
// uçları tarıyordu. Hacker News çağrısı BİREBİR aynıydı; Reddit arşivi de aynı
// URL'yi kuruyordu. Bir uç değiştiğinde iki dosyada birden güncellenmesi
// gerekiyordu — bu hatta zaten bir kez oldu: Wikidata'nın
// `action=wbsearchentities` uçsunun `totalhits` döndürmediği, tek yerde
// bulunup ölçülerek düzeltilmiş bir hataydı.
//
// NEDEN SEMANTİK PAYLAŞILMIYOR:
// İki katman aynı veriyi FARKLI sorulara çeviriyor.
//   • velora   → `RedditSignal` (şikâyet tespiti, 429 hızlı ret, 3 kademeli
//                RSS yedeği, konuşma hacmine göre sıralama) — ajan istemi için.
//   • discovery → `RawProduct` (niş kelime eşleşmesi, kaynak etiketi, kanıt
//                kapısı) — hard filter + ön skorlama için.
// Bunları tek bir şekle zorlamak ikisini de bozardı. Bu yüzden burada yalnız
// HTTP + yanıt AYRIŞTIRMA paylaşılır; her katman kendi anlamını üretir.
// ============================================================================

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

/* ------------------------------------------------- 1. Hacker News (Algolia) */

/** Algolia'nın döndürdüğü ham hâli — arayüz tarafsız, katmanlar kendi haritasını yapar. */
export type HackerNewsStory = {
  title: string;
  points: number;
  comments: number;
  url: string;
};

/**
 * Hacker News — nişe dair gerçek teknik tartışma hacmi.
 *
 * ÖLÇÜLDÜ: 200, ~200-300 ms, anahtarsız. Ürün satmaz ama "niş gerçekten mi
 * hareketli?" sorusuna ölçülmüş yanıt verir.
 *
 * Sıralama ve dilim KASTEN burada değil: velora konuşma hacmine göre ilk 6'yı,
 * discovery ilk 8'i ister. Karar çağırana bırakılır.
 */
export async function fetchHackerNewsStories(
  niche: string,
  limit: number,
  ms: number,
): Promise<HackerNewsStory[]> {
  const q = encodeURIComponent(niche.slice(0, 60));
  const res = await fetch(
    `https://hn.algolia.com/api/v1/search?query=${q}&tags=story&hitsPerPage=${limit}`,
    { signal: AbortSignal.timeout(ms), headers: { "user-agent": UA, accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`HN ${res.status}`);
  const json = (await res.json()) as {
    hits?: {
      title?: string | null;
      points?: number | null;
      num_comments?: number | null;
      url?: string | null;
      objectID?: string;
    }[];
  };
  const out: HackerNewsStory[] = [];
  for (const hit of json.hits ?? []) {
    const title = String(hit.title ?? "").trim();
    if (!title) continue;
    out.push({
      title,
      points: Number(hit.points ?? 0),
      comments: Number(hit.num_comments ?? 0),
      url: String(hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID ?? ""}`),
    });
  }
  return out;
}

/* --------------------------------------------- 2. Reddit arşivi (Arctic Shift) */

/** Arşiv satırı — alanlar `unknown` çünkü kaynak tipleri zayıf/eksik verebiliyor. */
export type ArcticPost = {
  title?: unknown;
  subreddit?: unknown;
  score?: unknown;
  num_comments?: unknown;
  permalink?: unknown;
  created_utc?: unknown;
};

/** Arşivde taranan tüketici toplulukları. */
export const REDDIT_SUBS = ["amazonfinds", "TikTokMadeMeBuyIt", "BuyItForLife"] as const;

/**
 * Reddit arşivinden bir alt topluluğun gönderileri — FİLTRE UYGULANMAZ.
 *
 * Arşiv sunucu tarafı filtreyi bozuk döndürüyor (ölçüldü: `title=` 422
 * "Timeout. Maybe slow down a bit", ~5 sn). Bu yüzden `selftext` indeksli
 * alanda arama yaptırılır ve sonuç İSTEMCİDE süzulür — bu görev çağırana aittir.
 *
 * İstekler SIRALI yapılmalıdır: paralel arşiv sorguları 422 veriyor.
 * Çağıranlar toplulukları sırayla gezmelidir.
 */
export async function fetchArcticPosts(params: {
  subreddit: string;
  limit: number;
  /** Gövdede aranan kelime (indeksli alan; `title` sorgusu zaman aşımına uğruyor). */
  selftext?: string;
  sort?: string;
  ms: number;
}): Promise<ArcticPost[]> {
  const query = new URLSearchParams({ subreddit: params.subreddit, limit: String(params.limit) });
  if (params.selftext) query.set("selftext", params.selftext);
  if (params.sort) query.set("sort", params.sort);
  const res = await fetch(
    `https://arctic-shift.photon-reddit.com/api/posts/search?${query.toString()}`,
    {
      signal: AbortSignal.timeout(params.ms),
      headers: { "user-agent": UA, accept: "application/json" },
    },
  );
  if (!res.ok) throw new Error(`arctic ${res.status}`);
  const json = (await res.json()) as { data?: ArcticPost[] };
  return json.data ?? [];
}

/** Arşiv permalink'ini okunabilir bir Reddit adresine çevirir. */
export function arcticPostUrl(post: ArcticPost, fallbackSub: string): string {
  const permalink = String(post.permalink ?? "");
  if (!permalink) return `https://reddit.com/r/${fallbackSub}/`;
  return permalink.startsWith("http") ? permalink : `https://reddit.com${permalink}`;
}
