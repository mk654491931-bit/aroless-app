// ============================================================================
// PROVIDER-BASED SCRAPING LAYER — `ProductSource` sözleşmesi ve kaynaklar.
//
// Tasarım kuralları:
//   1. FAIL-SOFT. Her kaynak bağımsız çalışır; biri hata verirse diğerleri
//      etkilenmez. Kaynak sağlığı `SourceReport` ile ÖLÇÜLÜR ve döner —
//      sessizce kaybolan kaynak, "kanıt topladık" diye yalan söylemektir.
//   2. $0 MALİYET. Tüm kaynaklar anahtarsız/ücretsizdir; API çağrısı yoktur.
//   3. DÜRÜSTLÜK. Olmayan alan `null` döner. `inStock` bilinmiyorsa `null`
//      (false DEĞİL) çünkü "stok yok" ile "bilmiyorum" farklıdır ve hard
//      filter ikisini ayırmak zorundadır.
//   4. ZAMAN TAVANI. Her kaynak kendi tavanına sahiptir; yavaş kaynak diğer
//      kaynakların kanıtını silmez (Vercel Hobby fonksiyon payı).
// ============================================================================

import type { RawProduct } from "./product-discovery.types";

/** Bir scraping kaynağının sözleşmesi. Yeni kaynak = bu arayüzü uygulamak. */
export interface ProductSource {
  /** Panelde ve logda görünen kaynak adı. */
  name: string;
  /**
   * Niş için ham ürün satırlarını döner.
   * Hata fırlatabilir — `runSources` bunu yakalar ve `error` olarak raporlar.
   */
  scrape(niche: string): Promise<RawProduct[]>;
  /** Bu kaynağın tek başına harcadığı üst zaman tavanı (ms). */
  timeoutMs: number;
}

export type SourceReport = {
  name: string;
  ok: boolean;
  items: number;
  ms: number;
  error: string;
};

/* ------------------------------------------------------------------ utils */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

async function grab(
  url: string,
  ms: number,
  accept = "text/html,application/xhtml+xml",
): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(ms),
    headers: { "user-agent": UA, accept },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/* ------------------------------------------------- 1. Hacker News (Algolia) */

/**
 * Hacker News — nişe dair gerçek teknik tartışma hacmi.
 *
 * ÖLÇÜLDÜ: 200, ~300 ms, anahtarsız. Ürün satmaz ama "niş gerçekten mi
 * hareketli?" sorusuna gerçek yanıt verir (demand sinyaline beslenir).
 * `rating`/`price` YOKTUR → alanlar `null` kalır, hard filter bunları
 * gereksiz yere elemez (sadece fiyat geçersizse eler).
 */
export const hackerNewsSource: ProductSource = {
  name: "hackernews",
  timeoutMs: 3_000,
  async scrape(niche: string): Promise<RawProduct[]> {
    const q = encodeURIComponent(niche.slice(0, 60));
    const json = JSON.parse(
      await grab(
        `https://hn.algolia.com/api/v1/search?query=${q}&tags=story&hitsPerPage=10`,
        2_500,
        "application/json",
      ),
    ) as {
      hits?: {
        title?: string | null;
        points?: number | null;
        num_comments?: number | null;
        url?: string | null;
        objectID?: string;
      }[];
    };
    const out: RawProduct[] = [];
    for (const hit of json.hits ?? []) {
      const title = String(hit.title ?? "").trim();
      if (!title) continue;
      out.push({
        title,
        brand: "",
        seller: "",
        priceUsd: null,
        rating: null,
        ratingCount: null,
        inStock: null,
        source: "hackernews",
        url: String(hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID ?? ""}`),
        // Etkileşim hacmi niş hareketliliğinin gerçek ölçüsü.
        notes: `${Number(hit.points ?? 0)} puan · ${Number(hit.num_comments ?? 0)} yorum`,
      });
    }
    return out.slice(0, 8);
  },
};

/* --------------------------------------------------- 2. Reddit arşivi (ARŞIV) */

/**
 * Reddit tüketici sinyali — arctic-shift arşivinden, FİLTRELİSİZ.
 *
 * ÖLÇÜLEN GERÇEK (2026-09): arşivin sunucu taraflı filtresi (`title=`,
 * `selftext=`) 422 "Timeout. Maybe slow down a bit" döndürüyor ve ~5 sn
 * sürüyor. FİLTRELİSİZ çağrı (`?subreddit=&limit=100&sort=desc`) ise 200,
 * ~810 ms ve **hata vermiyor**. Yani kaynak sağlıklı, sadece sunucu filtresi
 * bozuk. Bu yüzden filtreleme İSTEMCİ TARAFINDA yapılır.
 *
 * Reddit.com'un kendisi bu IP'de 429/403 veriyor ve ücretsiz proxy'ler
 * (allorigins/corsproxy/r.jina.ai) denendi — HEPSİ ÖLÜ ya da Reddit'a
 * kendisi 403 dönüyor. Arşiv bu yüzden tek güvenilir yol.
 */
const ARCTIC = "https://arctic-shift.photon-reddit.com/api";
const REDDIT_SUBS = ["amazonfinds", "TikTokMadeMeBuyIt", "BuyItForLife"];

const COMPLAINT_TERMS = [
  "broke",
  "broken",
  "stopped working",
  "defective",
  "cheap",
  "flimsy",
  "disappoint",
  "regret",
  "returned",
  "return it",
  "refund",
  "waste of money",
  "overpriced",
  "scam",
  "avoid",
  "don't buy",
  "do not buy",
  "worst",
  "leaked",
  "too small",
  "not worth",
];

export function isComplaintTitle(title: string): boolean {
  const t = String(title ?? "").toLowerCase();
  return COMPLAINT_TERMS.some((term) => t.includes(term));
}

export const redditArchiveSource: ProductSource = {
  name: "reddit-archive",
  timeoutMs: 6_000,
  async scrape(niche: string): Promise<RawProduct[]> {
    const words = niche
      .toLowerCase()
      .split(/[^a-z0-9çğıöşü]+/i)
      .filter((w) => w.length >= 4)
      .slice(0, 2);
    if (!words.length) return [];

    const out: RawProduct[] = [];
    const seen = new Set<string>();
    // Sıralı: arşiv paralel istekleri kuyruğa alıyor (ölçüldü).
    for (const sub of REDDIT_SUBS) {
      try {
        const res = await fetch(`${ARCTIC}/posts/search?subreddit=${sub}&limit=100&sort=desc`, {
          signal: AbortSignal.timeout(2_500),
          headers: { "user-agent": UA },
        });
        if (!res.ok) continue;
        const json = (await res.json()) as {
          data?: {
            title?: unknown;
            score?: unknown;
            num_comments?: unknown;
            permalink?: unknown;
          }[];
        };
        for (const post of json.data ?? []) {
          const title = String(post.title ?? "").trim();
          if (!title || seen.has(title)) continue;
          // NİŞ RELEVANSI İSTEMCİDE: arşivin sunucu filtresi bozuk olduğu için
          // burada kelime eşleşmesi şart. Aksi halde alakasız gürültü listeyi kirletir.
          if (!words.some((w) => title.toLowerCase().includes(w))) continue;
          seen.add(title);
          out.push({
            title: title.slice(0, 180),
            brand: "",
            seller: sub,
            priceUsd: null,
            rating: null,
            ratingCount: null,
            inStock: null,
            source: "reddit-archive",
            url: `https://reddit.com${String(post.permalink ?? "")}`,
            notes: `${Number(post.score ?? 0)}↑ ${Number(post.num_comments ?? 0)}yorum${
              isComplaintTitle(title) ? " · ŞİKÂYET" : ""
            }`,
          });
        }
      } catch {
        continue; // bu alt topluluk kapalı — diğerleri yaşar
      }
      // Arşiv kendi içinde kuyruk yapıyor; ölçülen taban bekleme.
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (out.length >= 15) break;
    }
    return out.slice(0, 15);
  },
};

/* ---------------------------------------------------- 3. Hacker News değil: GitHub */

/**
 * GitHub — nişe yönelik açık kaynak hareketi.
 *
 * ÖLÇÜLDÜ: 200, ~380 ms, anahtarsız. Ürün satmaz; nişin ekosistem
 * büyüklüğünü gösterir (demand sinyaline zayıf katkı).
 */
export const githubSource: ProductSource = {
  name: "github",
  timeoutMs: 3_000,
  async scrape(niche: string): Promise<RawProduct[]> {
    const q = encodeURIComponent(`${niche} in:name,description,readme`);
    const json = JSON.parse(
      await grab(
        `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=8`,
        2_500,
        "application/vnd.github+json",
      ),
    ) as {
      items?: {
        full_name?: string;
        description?: string | null;
        stargazers_count?: number;
        html_url?: string;
      }[];
    };
    const out: RawProduct[] = [];
    for (const item of json.items ?? []) {
      const title = String(item.full_name ?? "").trim();
      if (!title) continue;
      out.push({
        title: `${title} — ${String(item.description ?? "niş aracı").slice(0, 120)}`,
        brand: "",
        seller: "",
        priceUsd: null,
        rating: null,
        ratingCount: null,
        inStock: null,
        source: "github",
        url: String(item.html_url ?? ""),
        notes: `${Number(item.stargazers_count ?? 0)} yıldız`,
      });
    }
    return out;
  },
};

/* ------------------------------------------------- 4. Wikipedia (talep proksisi) */

/**
 * Wikipedia — niş talebinin ÖLÇÜLMÜŞ proksisi.
 *
 * ÖLÇÜLEN: pageviews API 200/~380 ms, anahtarsız. Ürün listelemez; nişin
 * insan ilgisini gerçek sayılarla verir. `preScore` hesabında demand
 * bileşenine beslenir.
 */
const WIKI_SEARCH = "https://api.wikimedia.org/core/v1/wikipedia/en/search/page";
const WIKI_PV = "https://wikimedia.org/api/rest_v1/metrics/pageviews";

const wikiStamp = (daysAgo: number): string => {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  return `${d.toISOString().slice(0, 10).replace(/-/g, "")}00`;
};

async function wikiViews(title: string, from: string, to: string): Promise<number[]> {
  const res = await fetch(
    `${WIKI_PV}/per-article/en.wikipedia/all-access/user/${encodeURIComponent(
      title,
    )}/daily/${from}/${to}`,
    { signal: AbortSignal.timeout(3_000), headers: { "user-agent": UA } },
  );
  if (!res.ok) return [];
  const json = (await res.json()) as { items?: { views: number }[] };
  return (json.items ?? []).map((i) => Number(i.views)).filter((n) => Number.isFinite(n));
}

export const wikipediaSource: ProductSource = {
  name: "wikipedia-demand",
  timeoutMs: 5_000,
  async scrape(niche: string): Promise<RawProduct[]> {
    // Google Trends datacenter IP'lerinde 429 verdiği için (ölçüldü) burada
    // talep ölçümü Wikipedia üzerinden yapılır. Arama ağ geçidi kanonik
    // başlığı verir; başlık tahmini çoğu nişte 404 döndüğü için önce aranır.
    let titles: string[] = [];
    try {
      const res = await fetch(
        `${WIKI_SEARCH}?q=${encodeURIComponent(niche.slice(0, 80))}&limit=5`,
        { signal: AbortSignal.timeout(3_000), headers: { "user-agent": UA } },
      );
      if (res.ok) {
        const json = (await res.json()) as { pages?: { title?: string }[] };
        titles = (json.pages ?? [])
          .map((p) => String(p.title ?? "").replace(/\s+/g, "_"))
          .filter(Boolean);
      }
    } catch {
      titles = [];
    }
    if (!titles.length) {
      titles = [
        niche
          .trim()
          .split(/\s+/)
          .map((w) => w[0]!.toUpperCase() + w.slice(1))
          .join("_"),
      ];
    }

    for (const title of titles) {
      const series = await wikiViews(title, wikiStamp(30), wikiStamp(0));
      if (series.length < 5) continue;
      const half = Math.max(1, Math.floor(series.length / 2));
      const first = series.slice(0, half).reduce((a, b) => a + b, 0) / half;
      const last = series.slice(-half).reduce((a, b) => a + b, 0) / half;
      const momentum = first > 0 ? Math.round(((last - first) / first) * 100) : 0;
      return [
        {
          title: `${niche} — Wikipedia talep proksisi (${title})`,
          brand: "",
          seller: "",
          priceUsd: null,
          rating: null,
          ratingCount: null,
          inStock: null,
          source: "wikipedia-demand",
          url: `https://en.wikipedia.org/wiki/${title}`,
          notes: `30 günlük momentum ${momentum > 0 ? "+" : ""}${momentum}% · günlük ~${Math.round(
            series.reduce((a, b) => a + b, 0) / series.length,
          ).toLocaleString("en-US")} görüntülenme`,
        },
      ];
    }
    return [];
  },
};

/* --------------------------------------------------- 6. Marketplace (fiyat) */

/**
 * Fiyat kaynağı — projede ZATEN ÇALIŞAN pazaryeri kazıyıcısı yeniden kullanılır.
 *
 * ÖLÇÜM (2026-09): eBay RSS bu IP'den **403** döndü (ölçüldü, 98 ms), Etsy de
 * 403; Google Shopping ise JS gerektirdiği için fiyat üretmiyor. Buna karşılık
 * mevcut `scrapeMarketplaceSellers` (DuckDuckGo→pazaryeri + Amazon + Bing)
 * canlı testlerde GERÇEK fiyat döndürdü (medyan $300 / $259.5 ölçüldü).
 *
 * YENİ SCRAPER YAZMAK YERİNE mevcut kanıtı kullanıyoruz: projede iki ayrı
 * fiyat kazıyıcısı olması, biri çalışmayı bıraktığında diğerinin boşluğu
 * doldurması demektir — iki gerçek kaynak, tek bakım yükü.
 *
 * Bu kaynak `rating` sağlamaz; alan `null` kalır ve hard filter puanı olmayan
 * ürünü ELEMEZ (yalnız hacimle düşük puan elenir).
 */
export const marketplacePriceSource: ProductSource = {
  name: "marketplace-price",
  timeoutMs: 4_000,
  async scrape(niche: string): Promise<RawProduct[]> {
    const { scrapeMarketplaceSellers } = await import("./market-data.server");
    const sellers = await scrapeMarketplaceSellers(niche, "US");
    if (!sellers.length) throw new Error("no marketplace listings");
    return sellers.slice(0, 12).map((s) => ({
      title: s.title?.trim() || `${niche} — ${s.platform} ilanı`,
      brand: "",
      seller: s.platform,
      priceUsd: Number.isFinite(s.price_usd) && s.price_usd > 0 ? s.price_usd : null,
      rating: null,
      ratingCount: null,
      // Pazaryeri listesi canlı bir ilandır ama STOK bilgisi verilmez →
      // `null` (bilinmiyor) yazılır, UYDURULMAZ.
      inStock: null,
      source: "marketplace-price",
      url: s.url,
      notes: `${s.platform}${s.domain ? ` (${s.domain})` : ""}${s.price_usd ? ` · $${s.price_usd}` : ""}`,
    }));
  },
};

/* -------------------------------------------------------- Kaynak kaydı */

/** Tüm kaynaklar — sıra, eşzamanlılık ve rapor sırasını belirler. */
export const PRODUCT_SOURCES: readonly ProductSource[] = [
  hackerNewsSource,
  redditArchiveSource,
  githubSource,
  wikipediaSource,
  marketplacePriceSource,
];

/**
 * Tüm kaynakları FAIL-SOFT çalıştırır ve sağlık raporu döner.
 *
 * Sözleşme: HİÇBİR kaynak bu fonksiyonu DÜŞÜREMEZ. Hata yakalanır, rapora
 * yazılır, diğer kaynaklar çalışmaya devam eder. Dönen `items` boş olabilir
 * ama `reports` her zaman doludur — "hiçbir şey bulunamadı" ile
 * "hiçbir şey aranmadı" ayrımı kaybolmaz.
 */
export async function runSources(
  niche: string,
  sources: readonly ProductSource[] = PRODUCT_SOURCES,
): Promise<{ products: RawProduct[]; reports: SourceReport[] }> {
  const products: RawProduct[] = [];
  const reports: SourceReport[] = await Promise.all(
    sources.map(async (source): Promise<SourceReport> => {
      const startedAt = Date.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const rows = await Promise.race([
          source.scrape(niche),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`timeout>${source.timeoutMs}ms`)),
              source.timeoutMs,
            );
          }),
        ]);
        products.push(...rows);
        return {
          name: source.name,
          ok: true,
          items: rows.length,
          ms: Date.now() - startedAt,
          error: "",
        };
      } catch (error) {
        return {
          name: source.name,
          ok: false,
          items: 0,
          ms: Date.now() - startedAt,
          error: error instanceof Error ? error.message.slice(0, 90) : "unreachable",
        };
      } finally {
        if (timer) clearTimeout(timer);
      }
    }),
  );
  return { products, reports };
}
