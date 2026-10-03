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
import {
  isGameNiche,
  normalizeNiche,
  productQueryVariants,
} from "./product-discovery-query";
import {
  arcticPostUrl,
  fetchArcticPosts,
  fetchHackerNewsStories,
  REDDIT_SUBS,
} from "./shared-niche-scrapers.server";

/** Bir scraping kaynağının sözleşmesi. Yeni kaynak = bu arayüzü uygulamak. */
export interface ProductSource {
  /** Panelde ve logda görünen kaynak adı. */
  name: string;
  /**
   * Niş için ham ürün satırlarını döner.
   * Hata fırlatabilir — `runSources` bunu yakalar ve `error` olarak raporlar.
   */
  scrape(niche: string): Promise<RawProduct[]>;
  /**
   * HEDEF ÜLKEYE duyarlı kazıma (global SaaS için).
   *
   * Varsa `runSources` bunu tercih eder; yoksa `scrape` çağrılır. Yani yeni
   * bir kaynak eklemek için ülke desteği zorunlu değildir — ama pazaryeri
   * gibi kaynaklar için ülkeye göre farklı pazar aramak zorunludur
   * (bkz. `MARKETPLACES_BY_COUNTRY`).
   */
  scrapeForCountry?(niche: string, country: string): Promise<RawProduct[]>;
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

async function grabJson<T>(url: string, ms: number): Promise<T> {
  return JSON.parse(await grab(url, ms, "application/json")) as T;
}

/**
 * Marka tahmini — BAŞLIKTAN, UYDURMADAN.
 *
 * Neden gerekli: bu katmandaki KAYNAKLARIN TAMAMI `brand` alanını boş
 * bırakıyordu (ölçülen gerçek: 5 kaynak, 0 marka). Marka iki yerde kritik:
 *   1. `productFingerprint` markayı girdi olarak alır → markasız ürünler
 *      aynı ürünün kopyaları gibi görünür veya kopya sayılıp elenir.
 *   2. 14 ajanın CFO/strateji oyları markayı okur.
 *
 * KURAL: yalnız başlığın İLK kelimesi büyük harfle başlıyorsa ve
 * sayı içermiyorsa marka sayılır. Bu bilinçli olarak KABAT bir tahmindir:
 * yanlış marka uydurmak, marka olmamaktan daha kötüdür (fingerprint çöker).
 * Bir dizi `MARKA_DEĞİL` ile maskelenir.
 */
const NOT_A_BRAND = new Set([
  "the",
  "a",
  "an",
  "best",
  "top",
  "new",
  "how",
  "why",
  "what",
  "when",
  "amazon",
  "ebay",
  "walmart",
  "target",
  "etsy",
  "alibaba",
  "shopify",
  "review",
  "reviews",
  "guide",
  "buying",
  "buy",
  "cheap",
  "sale",
  "deals",
]);

export function brandFromTitle(title: string): string {
  const first =
    String(title ?? "")
      .trim()
      .split(/\s+/)[0] ?? "";
  const cleaned = first.replace(/[^\p{L}\p{N}\-&'.]/gu, "");
  if (cleaned.length < 2 || cleaned.length > 24) return "";
  if (/\d/.test(cleaned)) return "";
  if (!/^\p{Lu}/u.test(cleaned)) return "";
  if (NOT_A_BRAND.has(cleaned.toLowerCase())) return "";
  return cleaned;
}

/**
 * Görünür metinden yıldız puanı + değerlendirme sayısı okur.
 *
 * Sadece GERÇEKTEN yazılmış sayıları kabul eder: "4.5 out of 5",
 * "4,5 yıldız", "Rated 4.3 by 128 buyers", "4.5/5". Tahmin UYDURMAZ; metinde
 * sayı yoksa `null` döner ve hard filter bu ürünü puan yok diye eler.
 */
export function ratingFromText(text: string): { rating: number | null; count: number | null } {
  const clean = decode(text).replace(/\u00a0/g, " ");
  const star =
    /(\d[.,]\d)\s*(?:\/\s*5|out of 5|stars?\b|★|yıldız)/i.exec(clean) ??
    /rated?\s+(\d[.,]\d)/i.exec(clean);
  const rating = star ? Number(star[1]!.replace(",", ".")) : NaN;
  const countMatch =
    /(\d[\d.,]*)\s*(?:reviews?|ratings?|değerlendirme|yorum|değerlendirmeleri)\b/i.exec(clean) ??
    /(?:by|)\s*(\d[\d.,]*)\s*(?:buyers?|customers?|kişi)/i.exec(clean);
  const count = countMatch ? Number(countMatch[1]!.replace(/[.,]/g, "")) : NaN;
  return {
    rating: Number.isFinite(rating) && rating >= 0 && rating <= 5 ? rating : null,
    count: Number.isFinite(count) && count >= 0 ? count : null,
  };
}

/** HTML entity'lerini çözer (fiyat/puan metni okunurken gerekir). */
function decode(text: string): string {
  return String(text ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/gi, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------- 1. Hacker News (Algolia) */

/**
 * Hacker News — nişe dair gerçek teknik tartışma hacmi.
 *
 * HTTP katmanı ortak modülde (`shared-niche-scrapers.server`); burada yalnız
 * `RawProduct` şekline önerilir. ÖLÇÜLDÜ: 200, ~200-300 ms, anahtarsız.
 * `rating`/`price` YOKTUR → alanlar `null` kalır, hard filter bunları
 * gereksiz yere elemez (sadece fiyat geçersizse eler).
 */
export const hackerNewsSource: ProductSource = {
  name: "hackernews",
  timeoutMs: 3_000,
  async scrape(niche: string): Promise<RawProduct[]> {
    // DİLİM KASTEN 8: bu kaynak ÜRÜN satmaz, tartışma hacmi ölçer (2/5 kanıt).
    // 75 hedefini bu satırla doldurmak, havuzu ölçülmüş ürün yerine ölçüm
    // satırıyla şişirmek olurdu. Ölçüldü (2026-09-28): `bing-shopping` tek
    // başına 60 GERÇEK ürün (fiyat/puan) veriyor ve havuz 9/9 nişte 75'e
    // ulaşıyor (ölçüm: 81-100 ham satır) — bu dilimi büyütmeye gerek yok.
    const stories = await fetchHackerNewsStories(niche, 10, 2_500);
    return stories.slice(0, 8).map((s) => ({
      title: s.title,
      brand: "",
      seller: "",
      priceUsd: null,
      rating: null,
      ratingCount: null,
      inStock: null,
      source: "hackernews",
      url: s.url,
      // Etkileşim hacmi niş hareketliliğinin gerçek ölçüsü.
      notes: `${s.points} puan · ${s.comments} yorum`,
    }));
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
  // ÖLÇÜM (2026-09-27): bu kaynak 5,7 sn ile hattın DUĞURLAYAN adımıydı
  // (11 kaynak paralel koştuğunda toplam süre = en yavaşınki). Arşiv 3 alt
  // topluluğu sırayla ve aralarında bekleyerek tarıyor; tavan 4 sn'ye
  // indirildi. Ücretsiz sinyali 1,7 sn'de kaybetmek, tüm hattı 1,7 sn
  // uzatmaktan iyi: Vercel bütçesi adım adımda daralıyor.
  timeoutMs: 4_000,
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
        const posts = await fetchArcticPosts({
          subreddit: sub,
          limit: 100,
          sort: "desc",
          ms: 1_800,
        });
        for (const post of posts) {
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
            url: arcticPostUrl(post, sub),
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
    // DİLİM KASTEN 8: yukarıdaki `hackerNewsSource` ile aynı gerekçe — repo
    // listesi ürün değildir, nişin ekosistem büyüklüğüdür (3/5 kanıt).
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

/* ------------------------------------------- 5b. Google Trends (niş talebi) */

/**
 * Google Trends — nişin GERÇEK arama ilgisi ve momentum.
 *
 * Bu ölçüm trend radar hattında (`velora-niche-scrape.server.ts`) ZATEN
 * çalışıyordu; discovery katmanı onu atlıyordu. Sonuç: talep momentumu YALNIZCA
 * Wikipedia'ya bağlıydı, yani nişte gerçek bir trend varsa ama hakkında Wikipedia
 * maddesi yoksa talep sinyalimiz KÖR kalıyordu.
 *
 * ÖLÇÜLDÜ (2026-09-27, bu sunucudan): `getGoogleTrends` → `active`, 52 nokta,
 * momentum -1 / +5 / -10 (robot vacuum / air fryer / dog harness). Önceki
 * dönemlerde bu uç datacenter IP'lerinde 429 veriyordu; `getGoogleTrends`
 * bunu zaten yedekliyor, bu yüzden biz yedek YAZMIYORUZ.
 *
 * DÜRÜSTLÜK — çift sayım ve uydurma koruması:
 *   • `getGoogleTrends` kendi içinde iki kademe yedekle çalışır: Google ölçemezse
 *     Wikipedia'ya, o da ölçemezse `estimated` serisine düşer.
 *   • YALNIZ `source === "google-trends"` ise satır üretiriz. `wikipedia-views`
 *     ZATEN `wikipediaSource`da ölçülüyor; ikisini de saymak aynı kanıtı iki
 *     kez saymak ve bütünlük puanını şişirmek olurdu.
 *   • `estimated` seri KESİNLİKLE kanıta girmez: 14 ajana "ölçülmüş ilgi" diye
 *     uydurma verilmez.
 */
export const googleTrendsSource: ProductSource = {
  name: "google-trends",
  timeoutMs: 8_000,
  async scrape(niche: string): Promise<RawProduct[]> {
    const { getGoogleTrends } = await import("./market-data.server");
    const series = await getGoogleTrends(niche, "US");
    // Google'dan GERÇEKTEN ölçülmediyse bu kaynak bilerek boş döner.
    if (series.source !== "google-trends" || !Number.isFinite(series.momentum_pct)) return [];
    const momentum = Math.round(series.momentum_pct);
    const avgIndex = series.monthly.length
      ? series.monthly.reduce((a, b) => a + b, 0) / series.monthly.length
      : 0;
    return [
      {
        title: `${niche} — Google Trends arama ilgisi`,
        brand: "",
        seller: "",
        priceUsd: null,
        rating: null,
        ratingCount: null,
        inStock: null,
        source: "google-trends",
        url: `https://trends.google.com/trends/explore?q=${encodeURIComponent(niche.slice(0, 60))}`,
        // "momentum ±N%" hâlinde yazılır: `product-discovery-pipeline.server.ts`
        // bu deseni okuyup `nicheMomentumPct` üretir.
        notes: `30 günlük momentum ${momentum > 0 ? "+" : ""}${momentum}% · ortalama indeks ${Math.round(
          avgIndex,
        ).toLocaleString("en-US")}`,
      },
    ];
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
    // Türkçe sorguda bu kaynak "no marketplace listings" hatası veriyordu
    // (ölçüm, 2026-10-02). Sorgu dili denendi: önce İngilizce karşılık, sonra
    // ASCII'ye inmiş özgün metin.
    return scrapeWithQueryVariants(niche, 4_000, async (query) => {
      const sellers = await scrapeMarketplaceSellers(query, "US");
      if (!sellers.length) throw new Error("no marketplace listings");
      const out: RawProduct[] = [];
      for (const s of sellers) {
        // ÖLÇÜLEN HATA (2026-10-03): başlığı boş gelen ilanlarda eski kod
        // `${niche} — ${platform} ilanı` YAZIYORDU. Yani kullanıcının kendi
        // sorgusu ürün kartı olarak ekrana çıkıyordu — canlı ölçüm, niş
        // "analog film" iken 6 adet "analog film — Bağımsız mağaza ilanı"
        // satırı üretildi. Ürün adı olmayan satır ÜRÜN DEĞİLDİR; başlık
        // ASLA uydurulmaz.
        const title = String(s.title ?? "").trim();
        if (!title) continue;
        const row: RawProduct = {
          title: title.slice(0, 180),
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
        };
        // Aynı gürültü kapısı her ürün kaynağında uygulanır: bu kaynak
        // previously HİÇ `matchesNiche`/`hasMeasuredField` çağırmıyordu.
        if (!matchesNiche(row.title, query)) continue;
        if (!hasMeasuredField(row)) continue;
        out.push(row);
        if (out.length >= 12) break;
      }
      return out;
    });
  },
};

/* ------------------------------------------------- Filtre yardımcıları */

/**
 * Niş alakalılık kapısı — kaynak kendi içinde uygular.
 *
 * NEDEN VAR (ölçülen gerçek, 2026-09-27): iTunes "air fryer" aramasına 20
 * satır döndü ama bunların çoğu UYGULAMA/ŞARKI; "robot vacuum"a ise kitap.
 * Bu satırlar ne ilgiliydi ne de ölçülebilir bir alan taşıyordu; filtreye
 * girmeleri listeyi GÜRÜLTÜYLE dolduruyordu (ölçüm: 59 hayatta kalandan
 * 0'ında gerçek puan vardı).
 *
 * Bu yüzden her satır İKİ kapıdan geçmeli:
 *   1. Başlık nişin en az bir kelimesini içermeli (alakalılık).
 *   2. En az BİR ölçülebilir ticari alanı olmalı (fiyat veya puan).
 * Kapıdan geçemeyen satır DÜŞÜRÜLMEZ, üstüne yazılmaz — kaynak dürüstçe
 * "bu nişte bana ölçülebilir ürün yok" der ve 0 satır döner.
 */
export function nicheTokens(niche: string): string[] {
  return niche
    .toLowerCase()
    .split(/[^a-z0-9çğıöşü]+/i)
    .filter((w) => w.length >= 4)
    .slice(0, 4);
}

export function matchesNiche(title: string, niche: string): boolean {
  const tokens = nicheTokens(niche);
  if (!tokens.length) return true;
  const lower = String(title ?? "").toLowerCase();
  return tokens.some((t) => lower.includes(t));
}

/** En az bir ÖLÇÜLEBİLİR ticari alan var mı? */
/**
 * iTunes kapak görseli → 512'lik sürüm.
 *
 * API yalnız `.../100x100bb.jpg` döndürür. Vitrin kartı 100px'te bulanık
 * göründüğü için boyut 512'ye çıkarılır — bu iTunes'un kendi belgelediği
 * deterministik bir adres değişikliğidir, UYDURMA değildir. Desen tutmazsa
 * (yeni URL şeması) gelen adres olduğu gibi döner.
 */
export function itunesArtwork(url: string): string {
  const raw = String(url ?? "").trim();
  if (!raw) return "";
  // Yalnız `https://` adreslerde ve boyut token'ı URL'nin SON yol segmenti
  // ise yükseltilir (gerçek biçim: /image/thumb/<...>/100x100bb.jpg).
  // `http://` bir Apple adresi değildir; karıştırılıp yeniden yazılmaz.
  return /^https:\/\//i.test(raw) ? raw.replace(/\/100x100bb(\.[a-z0-9]+)$/i, "/512x512bb$1") : raw;
}

/**
 * Bing Shopping kartından GERÇEK ürün görseli.
 *
 * Öncelik schema.org `murl` alanıdır (Bing'in kendi ürün JSON-LD'si, en
 * güvenilir). Yoksa kart içindeki `<img src>` denenir; logo, sprite, 1x1
 * izleyici ve veri-URI'leri elenir — vitrinde yanlış görsel göstermek,
 * görsel göstermemekten kötüdür.
 */
export function imageFromShoppingCard(card: string): string {
  const murl = /"murl"\s*:\s*"(https:\/\/[^"]+)"/i.exec(card)?.[1];
  if (murl) return decode(murl);
  for (const m of card.matchAll(/<img[^>]+src="(https:\/\/[^"]+)"/gi)) {
    const url = decode(m[1] ?? "");
    if (!/^https:\/\//i.test(url)) continue;
    if (/(sprite|logo|blank|1x1|pixel|spacer|placeholder|\/beacon)/i.test(url)) continue;
    if (url.length > 25) return url;
  }
  return "";
}

export function hasMeasuredField(row: {
  priceUsd?: number | null;
  rating?: number | null;
}): boolean {
  return (row.priceUsd ?? null) !== null || (row.rating ?? null) !== null;
}

/* --------------------------------------- 7. iTunes Search (GERÇEK ürün + puan) */

/**
 * iTunes Search API — GERÇEK ürün, GERÇEK fiyat, GERÇEK kullanıcı puanı.
 *
 * Neden bu kaynak en değerli addedir: hattın problemi "ölçülmüş ticari alan"
 * eksikliğiydi. Hacker News/Reddit/GitHub/Wikipedia ürün SATMAZ, talep
 * sinyali verir; `marketplace-price` fiyat verir ama puansız gelir. Bu kaynak
 * `priceUsd` + `rating` + `ratingCount` ÜÇÜNÜ birden gerçekten döndürür —
 * `dataCompleteness` tam 5'e çıkar ve ürün gerçekten satın alınabilir bir
 * şeydir (uygulama mağazasında fiyatı var).
 *
 * DÜRÜSTLÜK: `inStock` veri sunmaz → `null`. Para birimi USD değilse fiyat
 * `null` yapılır; 12.99 TL'yi "12.99 $" diye yazmak yanlış olurdu. Kur
 * dönüşümü yapılmaz, bunun yerine `notes`'e para birimi yazılır.
 *
 * $0 ve anahtarsız: `https://performance-partners.apple.com/search-api`
 * dokümanı açıkça anahtarsız kullanımı destekler.
 *
 * DIKKAT: bu kaynak NİŞ RELEVANSI DÜŞÜK bir katalogdur (uygulama, şarkı,
 * kitap). Ölçüldü ki fiziksel ürün nişlerinde alakasız satır üretir; bu
 * yüzden `matchesNiche` + `hasMeasuredField` kapısından geçemeyen satır
 * alınmaz. Medya/kitap nişlerinde gerçek fiyat+puan sağlar, "air fryer"
 * gibi nişlerde dürüstçe 0 döner.
 */
/*
 * ---------------------------------------------------------------------------
 * iTunes KAYNAĞI KALDIRILDI — dijital lisans kataloğu satılabilir ürün DEĞİLDİR.
 *
 * ÖLÇÜLEN HATA (2026-10-03, kullanıcı raporu: "film önerdi resmen"): bu kaynak
 * `kind` alanı `feature-movie`/`tv-episode`/`music-song` olan kayıtları ürün
 * olarak kabul ediyordu. Nişte "film" kelimesi geçtiği için medya satırları
 * SERBEST BIRAKILIYORDU (eski `isMediaNiche` kaçışı) ve kullanıcı film/dizi/
 * müzik kaydı gördü. İkinci hata: "film" kelimesi geçen her niş medya nişi
 * değildir — "analog film", "film endüstriyel kamera", "35mm film" FİZİKSEL
 * ürün nişleridir ve kelime bakılarak o yol kapatıldığında onlar da kapanıyor.
 *
 * NEDEN SİLİNDİ, YENİ ÜRÜN EKLENEREK DEĞİL: Apple iTunes Store TEK ÇEŞİT mal
 * satar — dijital lisans. Film, şarkı, sesli kitap, uygulama ve e-kitap
 * yeniden SATILAMAZ, tedarik EDİLEMEZ, kargo bedeli yoktur ve marjı yoktur.
 * Apple satıcı hesabı lisans yeniden satımına izin vermez. Dolayısıyla bu
 * katalogdaki hiçbir satır "kazandıran ürün" adayı olamaz; doğru davranış
 * bu satırları hiç üretmemektir.
 *
 * Bu kaynak daha önce iki sorunu çözüyormuş gibi görünüyordu — (a) fiziksel
 * nişlerde iTunes 0 satır dönüyordu, (b) gerçek kullanıcı puanı getiriyordu.
 * (a) zaten ölçülmüş bir HATA DIŞI durumdu, (b) ise dijital ürünlerin puanıdır.
 * Gerçek ürün kanıtı bugün TR pazaryeri (ScraperAPI), Steam ve Bing Shopping
 * kanallarından geliyor.
 *
 * Sınıf düzeltmesi kalıcıdır ve testlidir: `DIGITAL_ONLY_SOURCES` +
 * `looksLikeMediaRelease` (`product-discovery-query.ts`). Aynı hatanın başka
 * bir dijital katalogdan tekrarlanması bu iki kapıyla engellenir.
 * ---------------------------------------------------------------------------
 */


/* ------------------------------------- 8. Open Library (GERÇEK kitap + puan) */

/**
 * Open Library — gerçek kitaplar, GERÇEK okur puanları (ortalama + sayı).
 *
 * Anahtarsız, CORS'lu, hızlı. `ratings_average` + `ratings_count` sayesinde
 * "kaç kişi okudu ve beğendi" kanıtı geliyor. Fiyat para birimi belirtmediği
 * için `null` yazılır (DÜRÜSTLÜK: kur bilgisi olmadan USD uydurulmaz).
 *
 * Ölçüldüğü gibi: kitap dışındaki nişlerde alakasız sonuç verir. Aynı kapı
 * (niş alakalılığı + en az bir ölçülebilir alan) burada da uygulanır.
 */
export const openLibrarySource: ProductSource = {
  name: "openlibrary",
  timeoutMs: 4_000,
  async scrape(niche: string): Promise<RawProduct[]> {
    const q = encodeURIComponent(niche.slice(0, 60));
    const json = await grabJson<{
      docs?: {
        title?: string | null;
        author_name?: string[] | null;
        ratings_average?: number | null;
        ratings_count?: number | null;
        first_publish_year?: number | null;
        key?: string | null;
      }[];
    }>(
      `https://openlibrary.org/search.json?q=${q}&limit=20` +
        `&fields=title,author_name,ratings_average,ratings_count,first_publish_year,key`,
      3_500,
    );

    const out: RawProduct[] = [];
    for (const doc of json.docs ?? []) {
      const title = String(doc.title ?? "").trim();
      if (!title) continue;
      const rating =
        Number.isFinite(Number(doc.ratings_average)) &&
        Number(doc.ratings_average) > 0 &&
        Number(doc.ratings_count) >= 3
          ? Number(doc.ratings_average)
          : null;
      const ratingCount =
        Number.isFinite(Number(doc.ratings_count)) && Number(doc.ratings_count) > 0
          ? Number(doc.ratings_count)
          : null;
      const year = Number(doc.first_publish_year);
      const row: RawProduct = {
        title: title.slice(0, 180),
        brand: String(doc.author_name?.[0] ?? "").slice(0, 60),
        seller: "Open Library",
        priceUsd: null,
        rating,
        ratingCount,
        inStock: null,
        source: "openlibrary",
        url: `https://openlibrary.org${String(doc.key ?? "")}`,
        notes: [
          ratingCount ? `${ratingCount} okur puanı` : "",
          Number.isFinite(year) ? `${year} basımı` : "",
        ]
          .filter(Boolean)
          .join(" · ")
          .slice(0, 200),
      };
      if (!matchesNiche(row.title, niche)) continue;
      if (!hasMeasuredField(row)) continue;
      out.push(row);
    }
    return out.slice(0, 20);
  },
};

/* ------------------------------- 9. Open Food Facts (gıda nişi genişletme) */

/**
 * Open Food Facts — market genişliği sinyali (ürün listesi DEĞİL).
 *
 * Neden sinyal olarak kullanılıyor: API ürün adı/marka verir ama fiyat ve
 * kullanıcı puanı YOKTUR. Bu satırlar ürün olarak eklenseydi hard filter
 * (puan eşiği + veri bütünlüğü) hepsini elerdi; yani kaynak boşuna bütçe
 * harcardı. Bunun yerine ölçülebilir bir genişlik sinyali üretir:
 * "marketplace'de N ürün bulundu, en çok şu markalar".
 *
 * Niş gıda/kahve/diyet ise hattın bugünkü kaynakları HİÇ ürün vermiyordu;
 * bu kaynak o boşluğu doldurur. Lisans: Open Database, anahtarsız.
 *
 * ÖLÇÜLEN İKİ GERÇEK (2026-09-27):
 *   1. Bu API tarayıcı User-Agent'ı ile **503** döndürüyor; kendini tanımlayan
 *      bot UA'sı ile 200 dönüyor. Bu yüzden `FOOD_FACTS_UA` kullanılır.
 *   2. Sunucu **kararsız**: ardışık üç sorguda 200 / 503 / 200 ölçüldü. Bu
 *      yüzden bir kez yeniden denenir; yine 503 gelirse kaynak `ok:false`
 *      olarak raporlanır ve diğer kaynaklar etkilenmez (fail-soft sözleşmesi).
 *   3. Kapsamı dar: market sayısı 0 dönebiliyor ("robot vacuum" → 0 ölçüldü).
 *      Bu kaynak sinyal üretir, ürün listesi DEĞİL.
 */
const FOOD_FACTS_UA = "ArolessBot/1.0 (https://aroless.tech; product research)";

export const openFoodFactsSource: ProductSource = {
  name: "openfoodfacts",
  timeoutMs: 5_000,
  async scrape(niche: string): Promise<RawProduct[]> {
    const q = encodeURIComponent(niche.slice(0, 60));
    const url =
      `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${q}` +
      `&json=1&page_size=10&fields=product_name,brands`;

    type OffResponse = {
      count?: number;
      products?: { product_name?: string | null; brands?: string | null }[];
    };
    let json: OffResponse | null = null;
    let lastError = "";
    for (let attempt = 0; attempt < 2 && !json; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 600));
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(2_000),
          headers: { "user-agent": FOOD_FACTS_UA, accept: "application/json" },
        });
        if (!res.ok) {
          lastError = `HTTP ${res.status}`;
          continue;
        }
        json = (await res.json()) as OffResponse;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "unreachable";
      }
    }
    if (!json) throw new Error(lastError || "no response");

    const count = Number(json.count ?? 0);
    if (count <= 0) return [];
    const top = (json.products ?? [])
      .map(
        (p) =>
          String(p.brands ?? "")
            .split(",")[0]
            ?.trim() ?? "",
      )
      .filter(Boolean);
    const brandCounts = new Map<string, number>();
    for (const brand of top) brandCounts.set(brand, (brandCounts.get(brand) ?? 0) + 1);
    const leaders = [...brandCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([brand]) => brand);

    return [
      {
        title: `${niche} — Open Food Facts market genişliği`,
        brand: "",
        seller: "",
        priceUsd: null,
        rating: null,
        ratingCount: null,
        inStock: null,
        source: "openfoodfacts",
        url: `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${q}`,
        notes:
          `market genişliği ${count} ürün` +
          (leaders.length ? ` · öne çıkan markalar ${leaders.join(", ")}` : ""),
      },
    ];
  },
};

/* ------------------------------------------ 10. Google News RSS (hype/ilgi) */

/**
 * Google News RSS — son 30 gündeki haber hacmi = hype ölçümü.
 *
 * Anahtarsız, ücretsiz, stabil. Arama motoru değil haber RSS'i olduğu için
 * bot korumasına takılmaz (ölçüm: 200 + ~300 ms). "Hype var mı?" sorusuna
 * gerçek sayıyla yanıt verir; `demand` sinyaline beslenir.
 *
 * Google Trends datacenter IP'lerinde 429 verdiği için (daha önce ölçüldü)
 * talep ölçümü burada yapılır.
 */
export const googleNewsSource: ProductSource = {
  name: "google-news",
  timeoutMs: 4_000,
  async scrape(niche: string): Promise<RawProduct[]> {
    const q = encodeURIComponent(`${niche.slice(0, 60)} when:30d`);
    const xml = await grab(
      `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`,
      3_500,
      "application/rss+xml,application/xml,text/xml",
    );
    const items = xml.match(/<item>/g)?.length ?? 0;
    if (items === 0) return [];
    return [
      {
        title: `${niche} — Google News hype ölçümü (son 30 gün)`,
        brand: "",
        seller: "",
        priceUsd: null,
        rating: null,
        ratingCount: null,
        inStock: null,
        source: "google-news",
        url: `https://news.google.com/search?q=${encodeURIComponent(niche)}`,
        notes: `son 30 günde ${items} haber · hype yoğunluğu ${items >= 20 ? "yüksek" : items >= 6 ? "orta" : "düşük"}`,
      },
    ];
  },
};

/* ------------------------------------------------- 11. Wikidata (kapsam) */

/**
 * Wikidata — nişin kavramsal GENİŞLİĞİ.
 *
 * Arama toplamı (`query.searchinfo.totalhits`) "bu nişte kaç ayrı kavram var"
 * sorusunu yanıtlar: dar mı (tek ürün grubu) geniş mi (çok dallı pazar).
 *
 * ÖLÇÜLEN (2026-09-27): `action=wbsearchentities` toplamı DÖNDÜRMEDİ
 * (`searchinfo` yalnız `search` anahtarını taşıyordu → 0 satır). MediaWiki
 * arama uçları `totalhits` verir; `list=search&srinfo=totalhits` ile 200,
 * ~290 ms ve `totalhits: 17` ölçüldü. Bu yüzden o uç kullanılır.
 *
 * Anahtarsız, tek istek. Ürün satmaz — talep kapsamı sinyalidir.
 */
export const wikidataSource: ProductSource = {
  name: "wikidata",
  timeoutMs: 3_500,
  async scrape(niche: string): Promise<RawProduct[]> {
    const q = encodeURIComponent(niche.slice(0, 60));
    const json = await grabJson<{
      query?: {
        searchinfo?: { totalhits?: number };
        search?: { title?: string; snippet?: string }[];
      };
    }>(
      `https://www.wikidata.org/w/api.php?action=query&list=search` +
        `&srsearch=${q}&srlimit=20&srinfo=totalhits&srnamespace=0&format=json`,
      3_000,
    );
    const hits = Number(json.query?.searchinfo?.totalhits ?? 0);
    if (hits <= 0) return [];
    const first = json.query?.search?.[0];
    const qid = String(first?.title ?? "").replace(/^Q/, "");
    const snippet = decode(String(first?.snippet ?? "")).slice(0, 70);
    return [
      {
        title: `${niche} — Wikidata kapsam ölçümü`,
        brand: "",
        seller: "",
        priceUsd: null,
        rating: null,
        ratingCount: null,
        inStock: null,
        source: "wikidata",
        url: qid
          ? `https://www.wikidata.org/wiki/Q${qid}`
          : `https://www.wikidata.org/w/index.php?search=${q}`,
        notes: `${hits} ilgili kavram` + (snippet ? ` · ${snippet}` : ""),
      },
    ];
  },
};

/* --------------------------- 12. Web inceleme/arama (EN GENİŞ, EN KIRILGAN) */

/**
 * Serbest web — inceleme yazıları + liste sayfaları, iki motor (DDG + Bing).
 *
 * Bu kaynak "en geniş, en kırılgan" olan: niş ne olursa olsun bir şeyler
 * bulur. İki motor SIRA ile denenir; biri ölürse diğeri dener.
 *
 * DEĞERİ: (a) marka alanını doldurur — diğer kaynakların hepsi `brand`
 * boş bırakıyordu; (b) snippet içindeki fiyat/puanı okur; (c) niş dışı
 * (arbitrary) ürünler için tek umut.
 *
 * KIRILGANLIK DÜRÜST KABULÜ: arama motoru HTML'i değişirse bu kaynak boş
 * döner — `runSources` onu `ok:false` olarak RAPORLAR, diğer kaynaklar etkilenmez.
 * Yapı değişiklikleri dosya yorumlarında ölçümle birlikte not edilir.
 */
const REVIEW_SUFFIX = "review";

function priceFromText(text: string): number | null {
  const m = /(?:US\s*)?\$\s?(\d{1,4}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)/.exec(decode(text));
  if (!m) return null;
  const value = Number(m[1]!.replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
}

interface WebHit {
  title: string;
  url: string;
  host: string;
  snippet: string;
}

/** DuckDuckGo HTML sonuçları — bot-guard 202 döndüğünde tekrar denenir. */
async function duckduckgoHits(niche: string): Promise<WebHit[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(
    `${niche} ${REVIEW_SUFFIX}`,
  )}`;
  let html = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 900));
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(3_000),
        headers: { "user-agent": UA, accept: "text/html" },
      });
      if (!res.ok) continue;
      const candidate = await res.text();
      // `202` bot-guard sayfasında sonuç bloğu bulunmaz.
      if (candidate.includes("result__a")) {
        html = candidate;
        break;
      }
    } catch {
      // sonraki denemeye geç
    }
  }
  if (!html) return [];

  // Blok yapısı: split sonrası ` href="…">BAŞLIK</a> … result__snippet…SNIP`
  const hits: WebHit[] = [];
  for (const block of html.split(/result__a/).slice(1, 20)) {
    const href = /href="([^"]+)"/.exec(block)?.[1] ?? "";
    const raw = decodeURIComponent(/uddg=([^&"]+)/.exec(href)?.[1] ?? href);
    if (!raw || raw.includes("duckduckgo")) continue;
    // Başlık, ilk `>` ile `</a>` arasındaki metindir.
    const title = decode(/^\s*[^>]*>([\s\S]{4,200}?)<\/a>/.exec(block)?.[1] ?? "");
    if (!title) continue;
    let host = "";
    try {
      host = new URL(raw).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    // Snippet, `result__snippet` işaretinden sonraki metindir.
    const after = block.split("result__snippet")[1] ?? "";
    const snippet = decode(/^\s*[^>]*>([\s\S]{0,600}?)(?:<\/a|<)/.exec(after)?.[1] ?? "");
    hits.push({ title, url: raw, host, snippet: `${title} ${snippet}` });
  }
  return hits;
}

/**
 * Bing sonuçları — DDG'yi yedekleyen motor (ve şu an ÖNCE gelen motor).
 *
 * ÖLÇÜLEN (2026-09-27): Bing bu IP'den **200 + 10 sonuç / ~220 ms** döndü;
 * DDG ise ardışık isteklerden sonra **202 bot-guard** sayfası veriyor
 * (`result__a` = 0). Bu yüzden motor sırası Bing → DDG'dir: önce çalışan
 * motoru sor, DDG'ye yük bindirme (DDG aynı zamanda `marketplace-price`
 * kaynağının arkasındaki motor).
 *
 * ÖNEMLİ: Bing `href` alanı gerçek adresi değil, yönlendirme adresidir:
 * `https://www.bing.com/ck/a?...&u=a1<base64url>`. `bingRealUrl` bunu çözer.
 */
function bingRealUrl(href: string): string {
  const encoded = /[?&]u=a1([A-Za-z0-9_-]+)/.exec(href)?.[1];
  if (!encoded) return href;
  try {
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    return new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)));
  } catch {
    return href;
  }
}

async function bingHits(niche: string): Promise<WebHit[]> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(
    `${niche} ${REVIEW_SUFFIX}`,
  )}&setlang=en`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(3_000),
    headers: { "user-agent": UA, accept: "text/html" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const hits: WebHit[] = [];
  for (const block of html.split(/class="b_algo"/).slice(1, 16)) {
    // Blok, `<h2>` öncesi uzun bir stil/bağlantı dump'u içerir; başlıktan
    // başlayan pencereye bakmak hem hızlı hem güvenilir.
    const start = block.indexOf("<h2");
    if (start < 0) continue;
    const window = block.slice(start, start + 3_000);
    const title = decode(/<a\b[^>]*>([\s\S]{2,200}?)<\/a>/.exec(window)?.[1] ?? "");
    const href = bingRealUrl(decode(/<a\b[^>]*href="([^"]+)"/.exec(window)?.[1] ?? ""));
    if (!title || !href) continue;
    let host = "";
    try {
      host = new URL(href).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    const snippet = decode(/<p\b[^>]*>([\s\S]{2,400}?)<\/p>/.exec(window)?.[1] ?? "");
    hits.push({ title, url: href, host, snippet: `${title} ${snippet}` });
  }
  return hits;
}

export const webReviewSource: ProductSource = {
  name: "web-reviews",
  timeoutMs: 7_000,
  async scrape(niche: string): Promise<RawProduct[]> {
    // SIRA ÖLÇÜMLE BELİRLENDİ: Bing önce (ölçüldü: 200, ~220 ms, 10 sonuç),
    // DDG yedek (ölçüldü: ardışık isteklerden sonra 202 bot-guard).
    const engines = [bingHits, duckduckgoHits];
    let hits: WebHit[] = [];
    let enginesUsed = 0;
    for (const engine of engines) {
      try {
        const found = await engine(niche);
        if (found.length) {
          hits = hits.concat(found);
          enginesUsed++;
        }
      } catch {
        // bu motor öldü — sıradaki denenir
      }
      if (hits.length >= 12) break;
    }
    if (!hits.length) {
      throw new Error(enginesUsed === 0 ? "no engine returned results (ddg+bing)" : "no results");
    }

    const out: RawProduct[] = [];
    const seen = new Set<string>();
    for (const hit of hits) {
      const key = hit.url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const { rating, count } = ratingFromText(hit.snippet);
      const price = priceFromText(hit.snippet);
      out.push({
        title: hit.title.slice(0, 180),
        brand: brandFromTitle(hit.title),
        seller: hit.host.split(".")[0]?.replace(/^\w/, (m) => m.toUpperCase()) ?? "",
        priceUsd: price,
        rating,
        ratingCount: count,
        // Sayfa metninde stok ifadesi geçiyorsa bilinir, yoksa bilinmiyor.
        inStock: /\bout of stock\b|\bsold out\b/i.test(hit.snippet)
          ? false
          : /in stock|available/i.test(hit.snippet)
            ? true
            : null,
        source: "web-reviews",
        url: hit.url,
        notes: [hit.host, price ? `$${price}` : "", count ? `${count} değerlendirme` : ""]
          .filter(Boolean)
          .join(" · ")
          .slice(0, 200),
      });
    }
    return out.slice(0, 16);
  },
};

/**
 * Bing'in "1K+ viewed" / "12,4K" / "842" gösterimini SAYIYA çevirir.
 *
 * DÖNÜŞ: ölçülemediyse `null` — asla 0 değil. "0" demek "kimse görmedi"
 * demektir; "hiç ölçülmedi" ile aynı şey DEĞİLDİR ve talep puanını
 * haksız yere çekerdi.
 */
function parseViewed90d(text: string): number | null {
  const m = /([0-9][0-9.,]*)\s*([KkMm]?)/.exec(String(text ?? ""));
  if (!m) return null;
  const base = Number(m[1]!.replace(/[.,]/g, ""));
  if (!Number.isFinite(base) || base <= 0) return null;
  const unit = m[2]!.toLowerCase();
  const scaled = unit === "k" ? base * 1_000 : unit === "m" ? base * 1_000_000 : base;
  return Math.round(scaled);
}

/* --------------------------------- 12. Bing Shopping (GERÇEK puan + hacim) */

/**
 * Bing Shopping — hattın EKSİK KALAN tek alanını kapatan kaynak: fiziksel
 * ürünün GERÇEK kullanıcı puanı ve değerlendirme sayısı.
 *
 * ÖLÇÜLDÜ (2026-09-27, bu sunucudan): `bing.com/shop/search?q=air+fryer`
 *   → HTTP 200, ~800 ms, ~1,7 MB, ANAHTARSIZ.
 * Her kart şu alanları DETERMİNİSTIK olarak taşıyor:
 *   • `br-offTtl > span[title]`  → tam ürün adı
 *   • `br-price`                 → fiyat
 *   • `br-offSlrTxt`             → satıcı (ör. "Walmart")
 *   • `sa_rating`                → `aria-label="Star Rating: 4.5 out of 5."`
 *   • `sa_rt_num`                → değerlendirme SAYISI (74)
 *   • `br-offSecLbl[title]`      → "More than 1K people from Bing viewed this
 *                                   product in the last 90 days" → 90 GÜNLÜK
 *                                   GERÇEK TALEP ÖLÇÜMÜ
 *
 * NEDEN BU KAYNAK KİTAPTIR: `itunes`/`openlibrary` gerçek puan verir ama
 * dijital ürünlerde; fiziksel nişte `matchesNiche()` onları doğru şekilde
 * eliyor ve sonuç "0 gerçek puan" oluyordu. Amazon bu boşluğu kapatamıyor
 * (ölçüldü: bestseller sayfası bir JS kabuğu, ürün kartı 0; arama 503).
 * Bing Shopping aynı veriyi anahtarsız veriyor.
 *
 * DÜRÜSTLÜK: `sa_rating` bloğu olmayan kartta puan `null` kalır. "4.5" gibi
 * bir sayıyı GÖRÜNTÜDEN tahmin etmeyiz; kart yazmıyorsa ölçemedik deriz.
 *
 * SAYFALAMA YOK — ÖLÇÜLDÜ (2026-09-28): `&first=1|17|33|49` AYNI 55 kartı
 * döndürüyor (sıra kayıyor, set aynı). Yani bu kaynaktan daha fazla ürün
 * almanın tek yolu SAYFADAKİ TÜM kartları kullanmaktır. Ölçüm: 55 karttan
 * 54'ü başlıklı, **43'ünde gerçek puan**, 31'inde fiyat, 23'ünde 90 günlük
 * görüntülenme var. Eski `slice(0, 16)` bu ölçülmüş kanıtın yarısından
 * fazlasını çöpe atıyordu ve ham havuz 44-60'ta takılıyordu.
 *
 * İKİNCİ SORGU (ÖLÇÜM 2026-09-28): sayfalamak yerine farklı bir ALICI
 * sorgusu (`best <niş>`) paralel koşulur. Ölçüm: varyant da 55 kart döndürüyor
 * ve bunların **34-47'si taban sorguda YOK** (standing desk 47, espresso 39,
 * air fryer 45). Aynı ayrıştırıcı, aynı kanıt kalitesi, iki kat ürün. İki
 * istek PARALEL olduğu için gecikme tek istek kadardır (ölçüldü ~700-950 ms).
 */
const BING_SHOPPING_LIMIT = 60;

/**
 * Bing Shopping'i kaç ALICI sorgusuyla tarar.
 *
 * İlki nişin kendisi, ikincisi "best <niş>"dir: ölçüldü ki ikinci sorgu
 * neredeyse tamamen farklı ürün kadrosu döndürüyor. Üçüncü bir varyant
 * (`cheap <niş>`) ölçüldü ama ek kazanç daha düşüktü ve gereksiz yük olurdu.
 */
function bingShoppingQueries(niche: string): string[] {
  const base = niche.slice(0, 60);
  return [base, `best ${base}`];
}

/**
 * Sorgu başına HTML kart bloklarını döner. İki sorgu PARALEL: gecikme tek
 * istek kadar kalır, kaynak tavanı (6 sn) korunur.
 *
 * FAIL-SOFT (kaynak içi): bir sorgu hata verirse diğeri tek başına yeter.
 * İKİSİ de boş/hatalıysa kaynak dürüstçe hata fırlatır — `runSources` bunu
 * `ok:false` diye raporlar, diğer kaynaklar etkilenmez.
 */
async function bingShoppingCards(niche: string): Promise<string[]> {
  const settled = await Promise.allSettled(
    bingShoppingQueries(niche).map((query) =>
      grab(`https://www.bing.com/shop/search?q=${encodeURIComponent(query)}&setlang=en`, 5_500),
    ),
  );
  const cards: string[] = [];
  let firstError = "";
  for (const result of settled) {
    if (result.status === "rejected") {
      firstError ||= result.reason instanceof Error ? result.reason.message : "unreachable";
      continue;
    }
    // Kart sınırları sunucu tarafında sabit: her ürün bir `br-gOffCard`.
    cards.push(...result.value.split(/(?=<div class="br-gOffCard)/).slice(1));
  }
  if (!cards.length) throw new Error(firstError || "no shopping cards in response");
  return cards;
}

/* --------------------------------------- 8b. Steam Store (oyun: fiyat + gerçek puan) */

/**
 * Steam Store — oyun nişi için GERÇEK fiyat ve GERÇEK kullanıcı puanı.
 *
 * NEDEN VAR (ölçüm, 2026-10-02): "gerçek ürün + gerçek sayı" isteğinde
 * fiziksel ürünler için anahtarsız kaynak yok — eBay 403, Hepsiburada 403,
 * Trendyol fiyatı HTML'de vermiyor, Bing Shopping sayfası JS ile çiziliyor.
 * Oyun nişinde Steam **anahtarsız** çalışıyor ve İKİ gerçek sayı veriyor:
 * `storesearch` fiyat, `appreviews` topluluk puanı + yorum sayısı.
 *
 * ÖLÇÜLEN GERÇEK — hangi sayı NEREDE:
 *   `storesearch`  → ad, app id, FİYAT (para birimi dahil), küçük görsel
 *   `appdetails`   → indirimli/ilk fiyat ayrımı, büyük görsel
 *   `appreviews`   → GERÇEK kullanıcı puanı (1-10) + kaç yorum
 *
 * `metascore` Steam tarafından **hiçbir uçta yayımlanmıyor** (ölçüldü:
 * hem `storesearch` hem `appdetails` alan listesinde yok). Yani yüzde puan
 * uydurulabilirdi; onun yerine `appreviews` kullanılıyor.
 *
 * DÜNSTÜRMEDİĞİMİZ TEK SAYI:
 *   - `review_score` 1-10 ölçeğindedir; 5'lik ölçeğe **bölerek** yazılır ve
 *     notlarda ham hali de korunur.
 *   - Puanı olmayan oyunda `rating` `null` kalır, `ratingCount` da `null`
 *     kalır (kimse oy vermemiştir).
 *   - Fiyat para birimi USD değilse `priceUsd` `null` bırakılır; fiyat kendi
 *     para biriminde nota yazılır. KUR ÇEVRİMİ UYDURULMAZ.
 */
export const steamSource: ProductSource = {
  name: "steam",
  timeoutMs: 7_000,
  async scrape(niche: string): Promise<RawProduct[]> {
    // Steam bir OYUN mağazasıdır. Niş oyun değilse HİÇ ÇAĞRILMAZ: aksi halde
    // "LED masa lambası" → "led desk lamp" çevirisi, Steam'deki "Desk Lamp
    // Deluxe" adlı bir oyunu gerçek fiziksel ürün sanar (ölçülen hata).
    if (!isGameNiche(niche)) return [];
    return scrapeWithQueryVariants(niche, 7_000, async (query) => {
      const json = await grabJson<{
        total?: number;
        items?: {
          name?: string;
          id?: number;
          price?: { currency?: string; final?: number };
          tiny_image?: string;
        }[];
      }>(
        `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(
          query.slice(0, 60),
        )}&cc=us&l=english`,
        3_500,
      );
      if (!json.items?.length) return [];

      // Adayları önce nişe göre süzeriz: Steam araması GEVŞEKTİR, "lamp"
      // için alakasız oyunlar da döner. Kapı burada, ağ çağrısından ÖNCE
      // çalışır — puan isteyeceğimiz oyun sayısını da böyle kısar.
      const candidates: { id: number; title: string; price: number; currency: string; image: string }[] = [];
      const seen = new Set<string>();
      for (const item of json.items) {
        const title = String(item.name ?? "").trim();
        if (!title || !item.id || seen.has(title.toLowerCase())) continue;
        if (!matchesNiche(title, query)) continue;
        seen.add(title.toLowerCase());
        candidates.push({
          id: item.id,
          title: title.slice(0, 180),
          price: Number(item.price?.final ?? 0),
          currency: String(item.price?.currency ?? ""),
          image: String(item.tiny_image ?? ""),
        });
        if (candidates.length >= 8) break;
      }
      if (!candidates.length) return [];

      // Puanlar paralel çekilir: 8 oyun sıraya beklenirse 8 × ~200 ms
      // dilim bütçesini yer; `Promise.all` toplamı en yavaşınki yapar.
      const summaries = await Promise.all(
        candidates.map((c) =>
          grabJson<{
            query_summary?: {
              review_score?: number;
              total_reviews?: number;
              total_positive?: number;
              total_negative?: number;
            };
          }>(
            `https://store.steampowered.com/appreviews/${c.id}?json=1&language=all&purchase_type=all&num_per_page=0`,
            2_500,
          ).catch(() => ({}) as { query_summary?: Record<string, number> }),
        ),
      );

      const out: RawProduct[] = [];
      for (const [i, c] of candidates.entries()) {
        const s = summaries[i]?.query_summary ?? {};
        // review_score 1-10 → 5'lik ölçek. 0/NaN = kimse oy vermemiş → null.
        const score = Number(s.review_score ?? 0);
        const reviews = Number(s.total_reviews ?? 0);
        const positive = Number(s.total_positive ?? 0);
        const negative = Number(s.total_negative ?? 0);

        const row: RawProduct = {
          title: c.title,
          // Steam mağaza adıdır, ürünün markası DEĞİLDİR. Marka uydurmuyoruz.
          brand: "",
          seller: "Steam Store",
          priceUsd: c.currency === "USD" && c.price > 0 ? c.price / 100 : null,
          rating: score > 0 ? Math.round((score / 2) * 10) / 10 : null,
          ratingCount: reviews > 0 ? reviews : null,
          inStock: null,
          source: "steam",
          url: `https://store.steampowered.com/app/${c.id}/`,
          imageUrl: c.image,
          notes: [
            c.price > 0 ? `fiyat ${c.currency} ${(c.price / 100).toFixed(2)}` : "",
            score > 0 ? `oy ${score}/10` : "",
            reviews > 0 ? `${reviews.toLocaleString("tr-TR")} değerlendirme` : "",
            positive + negative > 0
              ? `%${Math.round((positive / (positive + negative)) * 100)} olumlu`
              : "",
          ]
            .filter(Boolean)
            .join(" · ")
            .slice(0, 200),
        };
        // Gürültü kapısı: ne fiyatı ne puanı olan oyun kanıt değildir.
        if (!hasMeasuredField(row)) continue;
        out.push(row);
      }
      return out;
    });
  },
};

/* ------------------------------- 8c. Türk pazaryerleri (ScraperAPI, isteğe bağlı) */

/**
 * Türk pazaryeri kazıması — GERÇEK fiyat + GERÇEK puan, anahtarla.
 *
 * NEDEN VAR (ölçüm, 2026-10-02): anahtarsız denenen her yol kapalı çıktı —
 * eBay 403, Hepsiburada 403, Trendyol fiyatı HTML'de vermiyor, Bing Shopping
 * JS ile çiziliyor. Bu kaynak o boşluğu ScraperAPI ile kapatır ve oyun dışı
 * (gerçek fiziksel) ürünlerde puan getiren İKİNCİ kaynak olur.
 *
 * TASARIM — "ZORLAMA" YOK (kullanıcı talebi):
 *   1. Anahtar yoksa kaynak 0 ms'de boş döner; hiçbir ağ isteği yapılmaz.
 *      Kalan anahtarsız kaynaklar normal çalışmaya devam eder.
 *   2. Anahtar olsa bile bu kaynak YALNIZ kendi dilimini harcar ve hata
 *      yutmaz; pazar sayfası boş dönerse diğer kaynaklar zaten ürün vermiş
 *      olur. Yani bu kaynak hiçbir koşulda hattı düşüremez.
 *   3. Ücretsiz kredi KORUNUR (kullanıcı talebi: "1 ay kadar bitmesin"):
 *      - aynı niş 24 saat içinde tekrar aranırsa HİÇ kredi harcanmaz,
 *      - ayda en çok `SCRAPER_MONTHLY_LIMIT` (varsayılan 1200) kredi,
 *      - TEK aramada en çok `TR_MARKETPLACE_PROBES` kredi. Sorgu varyantı ile
 *        pazar denemeleri ÇARPILMAZ (ölçülen hata: 2 varyant × 2 pazar = 4
 *        kredi; bütçe ikisini birden sayarak tek sayıda tutulur).
 *      Ayrıntı ve sayaç mantığı: `scraper-quota.server.ts`.
 */
const TR_MARKETPLACES: readonly { name: string; search: (q: string) => string }[] = [
  { name: "Trendyol", search: (q) => `https://www.trendyol.com/sr?q=${encodeURIComponent(q)}` },
  { name: "Hepsiburada", search: (q) => `https://www.hepsiburada.com/search?q=${encodeURIComponent(q)}` },
];

/**
 * ÜLKEYE GÖRE YEREL PAZARYERLERİ — global SaaS'ın asıl eksik parçası.
 *
 * ÖLÇÜLEN HATA (2026-10-03): kaynak "Türk pazaryeri" olarak yazılmıştı ve
 * YALNIZ Trendyol + Hepsiburada'yı deniyordu. Kullanıcı "kedi tırmalama
 * tahtası" aradı, film önerisi gördü ve "her ülkede doğru çalışsın"
 * istediğini söyledi. Türkiye dışındaki bir kullanıcı için bu kaynak hiç
 * alakalı pazar sayfasına bakmıyordu demektir.
 *
 * KURAL: her ülke kendi YEREL pazaryerini arar. Neden yerel? Çünkü fiyat
 * para birimi, vergi ve stok yerel pazarınkiyle farklıdır; ABD fiyatıyla
 * bir Alman pazarına bakmak ölçülen bir gerçek vermez. Kur çevrimi zaten
 * `fx-rates.server.ts` ile anahtarsız ve gerçek.
 *
 * Kapsam bilinçli olarak genişletilebilir: `JSON-LD` ayrıştırıcısı
 * (`marketplace-jsonld.ts`) markadan bağımsızdır, yeni bir ülke eklemek
 * yalnızca buraya iki satır eklemektir.
 */
const MARKETPLACES_BY_COUNTRY: Record<string, readonly { name: string; search: (q: string) => string }[]> = {
  TR: TR_MARKETPLACES,
  US: [
    { name: "Walmart", search: (q) => `https://www.walmart.com/search?q=${encodeURIComponent(q)}` },
    { name: "eBay", search: (q) => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}` },
  ],
  GB: [
    { name: "Amazon UK", search: (q) => `https://www.amazon.co.uk/s?k=${encodeURIComponent(q)}` },
    { name: "eBay UK", search: (q) => `https://www.ebay.co.uk/sch/i.html?_nkw=${encodeURIComponent(q)}` },
  ],
  DE: [
    { name: "Amazon DE", search: (q) => `https://www.amazon.de/s?k=${encodeURIComponent(q)}` },
    { name: "Otto", search: (q) => `https://www.otto.de/suche/${encodeURIComponent(q)}/` },
  ],
  FR: [
    { name: "Amazon FR", search: (q) => `https://www.amazon.fr/s?k=${encodeURIComponent(q)}` },
    { name: "Cdiscount", search: (q) => `https://www.cdiscount.com/search/${encodeURIComponent(q)}/` },
  ],
  IT: [
    { name: "Amazon IT", search: (q) => `https://www.amazon.it/s?k=${encodeURIComponent(q)}` },
    { name: "eBay IT", search: (q) => `https://www.ebay.it/sch/i.html?_nkw=${encodeURIComponent(q)}` },
  ],
  ES: [
    { name: "Amazon ES", search: (q) => `https://www.amazon.es/s?k=${encodeURIComponent(q)}` },
    { name: "eBay ES", search: (q) => `https://www.ebay.es/sch/i.html?_nkw=${encodeURIComponent(q)}` },
  ],
  NL: [{ name: "Amazon NL", search: (q) => `https://www.amazon.nl/s?k=${encodeURIComponent(q)}` }],
  CA: [
    { name: "Amazon CA", search: (q) => `https://www.amazon.ca/s?k=${encodeURIComponent(q)}` },
    { name: "Walmart CA", search: (q) => `https://www.walmart.ca/search?q=${encodeURIComponent(q)}` },
  ],
  AU: [
    { name: "Amazon AU", search: (q) => `https://www.amazon.com.au/s?k=${encodeURIComponent(q)}` },
    { name: "eBay AU", search: (q) => `https://www.ebay.com.au/sch/i.html?_nkw=${encodeURIComponent(q)}` },
  ],
  PL: [{ name: "Amazon PL", search: (q) => `https://www.amazon.pl/s?k=${encodeURIComponent(q)}` }],
  SE: [{ name: "Amazon SE", search: (q) => `https://www.amazon.se/s?k=${encodeURIComponent(q)}` }],
  BR: [
    { name: "Mercado Livre", search: (q) => `https://lista.mercadolivre.com.br/${encodeURIComponent(q)}` },
  ],
  MX: [
    { name: "Mercado Libre MX", search: (q) => `https://listado.mercadolibre.com.mx/${encodeURIComponent(q)}` },
  ],
  IN: [{ name: "Amazon IN", search: (q) => `https://www.amazon.in/s?k=${encodeURIComponent(q)}` }],
  JP: [{ name: "Amazon JP", search: (q) => `https://www.amazon.co.jp/s?k=${encodeURIComponent(q)}` }],
};

/**
 * Hedef ülke için pazaryeri listesi.
 *
 * BİLEREK TAHMİN YOK: listede olmayan bir ülke için TR listesine düşülür
 * çünkü TR listesinin arama URL'i uluslararasıdır ve `url` sonucu yine
 * alakalı ürün verir. Yanlış ülkenin fiyatını göstermektense alakalı bir
 * pazarı denemek daha dürüsttür (ve `notes` hangi pazarın denendiğini yazar).
 */
export function marketplacesForCountry(country: string | undefined | null): {
  code: string;
  sites: readonly { name: string; search: (q: string) => string }[];
} {
  const code = String(country ?? "").trim().toUpperCase();
  if (code && MARKETPLACES_BY_COUNTRY[code]) return { code, sites: MARKETPLACES_BY_COUNTRY[code] };
  // GLOBAL / boş → en geniş yerel liste (ABD) ve TR sorgusu da denenir.
  return { code: code || "GLOBAL", sites: MARKETPLACES_BY_COUNTRY.US };
}

/**
 * TEK aramada harcancak AZAMAN kredi sayısı — her kazım isteği 1 kredidir.
 *
 * Bu bütçe sorgu varyantları arasında PAYLAŞILIR. Paylaşılmazsa nişe uymayan
 * ilk varyant tüm pazarları deneyip krediyi bitirir, ikinci varyant hiçbir
 * şeye kalamaz. Yerel sayaç bu yüzden varyant döngüsünün DIŞINDA durur.
 */
const TR_MARKETPLACE_PROBES = 2;

/** Aynı niş için kazınmış sonuç bu süre boyunca bedava döner. */
const TR_MARKETPLACE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Bu kaynağın sorgu sırası.
 *
 * DİKKAT — genel `productQueryVariants` BURADA KULLANILMAZ: o sıra önce
 * İngilizce karşılığı dener ("LED masa lambası" → "led desk lamp"). Türk
 * pazaryerlerinde yerel sorgu çok daha isabetli ("led masa lambasi" araması
 * gerçek masa lambası döner), dolayısıyla burada YEREL sorgu önce gelir —
 * hem daha çok ürün hem daha az kredi demektir.
 */
function trMarketplaceQueries(niche: string): string[] {
  const out: string[] = [];
  for (const candidate of [normalizeNiche(niche), String(niche ?? "").trim()]) {
    const value = candidate.trim();
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

export const trMarketplaceSource: ProductSource = {
  name: "tr-marketplace",
  timeoutMs: 9_000,
  /**
   * GLOBAL: hedef ülkeye göre yerel pazaryerlerini arar.
   *
   * `runSources` ülkeyi buraya geçirir; ülke verilmezse eski davranış (Türk
   * pazaryerleri) korunur, yani hiçbir mevcut çağırma bozulmaz.
   */
  async scrapeForCountry(niche: string, country: string): Promise<RawProduct[]> {
    return scrapeMarketplaceCountry(niche, country);
  },
  async scrape(niche: string): Promise<RawProduct[]> {
    return scrapeMarketplaceCountry(niche, "TR");
  },
};

/**
 * Hedef ÜLKENİN yerel pazaryerlerinden gerçek ürün satırı çeker.
 *
 * Tasarım kasıtlı olarak aynı krediyi, aynı önbelleği ve aynı gürültü kapılarını
 * kullanır; tek farkı pazar listesidir. Bkz. `MARKETPLACES_BY_COUNTRY`.
 */
async function scrapeMarketplaceCountry(niche: string, country: string): Promise<RawProduct[]> {
  const { code, sites } = marketplacesForCountry(country);
  const sourceLabel = code === "TR" ? "tr-marketplace" : "marketplace";
  const { scraperApiConfigured, fetchThroughScraperApi } = await import("./product-image.server");
  const { parseMarketplaceHtml } = await import("./marketplace-jsonld");
  const { toUsd } = await import("./fx-rates.server");
  // Anahtar yoksa AĞ ÇAĞRISI YAPILMAZ: ölçülen maliyet sıfır.
  if (!scraperApiConfigured()) return [];

  // KORUMA 1 — KALICI ÖNBELLEK: aynı niş + ülke 24 saat içinde tekrar
  // aranırsa kredi HARCANMAZ. Ülke anahtara GİRER: ABD pazarında bulunan
  // ürünü Alman pazarında göstermek yanlış olur.
  const { cacheGet, cacheKey, cacheSet } = await import("./ai-cache.server");
  const key = await cacheKey(`marketplace:${code}`, [niche]);
  const hit = await cacheGet<RawProduct[]>(key);
  if (hit) return hit;

  // KORUMA 2 — AYLIK BÜTÇE: kredi harcamadan önce sayaca bak.
  // Sayaç okunamazsa `null` döner ve fail-open davranılır.
  const { allowScraperCredit } = await import("./scraper-quota.server");
  if ((await allowScraperCredit()) === false) {
    console.log(
      `[discovery] ${sourceLabel}: aylık scraper kotası doldu, bu arama anahtarsız kaynaklardan yapılıyor`,
    );
    return [];
  }

    // Kredi bütçesi bu çağrı boyunca ORTAK: varyantlar çarpmaz.
    let probesLeft = TR_MARKETPLACE_PROBES;

    for (const query of trMarketplaceQueries(niche)) {
      const out: RawProduct[] = [];
      for (const site of sites) {
        // Kredi bitti: başka pazar/varyant DENEMEZ.
        if (probesLeft <= 0) break;
        probesLeft -= 1;

        let html: string | null = null;
        try {
          html = await fetchThroughScraperApi(site.search(query), {
            countryCode: code === "GLOBAL" ? "us" : code.toLowerCase(),
            timeoutMs: 4_000,
          });
        } catch (e) {
          // Servis düştü / kota doldu / 403 → SONRAKİ PAZARA GEÇ.
          console.log(
            `[discovery] ${sourceLabel} ${site.name} okunamadı: ${(e as Error).message.slice(0, 80)}`,
          );
          continue;
        }
        if (!html) continue;

        const rows = parseMarketplaceHtml(html, 12);
        for (const row of rows) {
          const title = row.title;
          if (!matchesNiche(title, query)) continue;
          // Fiyat TL'dir. Kur GERÇEK bir servisten çekilir (anahtarsız); kur
          // gelmezse fiyat ölçülmedi sayılır — TAHMİN EDİLMEZ.
          const usd = row.priceLocal !== null && row.currency ? await toUsd(row.priceLocal, row.currency) : null;
          const product: RawProduct = {
            title,
            brand: row.brand,
            seller: row.seller || site.name,
            priceUsd: usd,
            rating: row.rating,
            ratingCount: row.ratingCount,
            inStock: row.inStock,
            source: sourceLabel,
            url: row.url,
            imageUrl: row.imageUrl,
            notes: [
              site.name,
              row.priceLocal !== null && row.currency
                ? `${row.priceLocal.toLocaleString("tr-TR")} ${row.currency}` +
                  (usd !== null ? ` ≈ $${usd}` : " (kur alınamadı)")
                : "",
              row.rating !== null ? `puan ${row.rating}/5` : "",
              row.ratingCount !== null ? `${row.ratingCount} değerlendirme` : "",
            ]
              .filter(Boolean)
              .join(" · ")
              .slice(0, 200),
          };
          if (!hasMeasuredField(product)) continue;
          out.push(product);
        }
        // İlk pazar gerçek ürün döndürürse diğerlerine harcanmaz.
        if (out.length) break;
      }
      // YALNIZ BOŞ DÖNMEYEN SONUÇ ÖNBELLEĞE YAZILIR. Geçici bir pazar
      // engeli (403, kısa süreli hata) nişi bir gün boyunca boş
      // göstermesin; boş sonuç yeniden denenebilsin.
      if (out.length) {
        await cacheSet(key, `marketplace:${code}`, out, TR_MARKETPLACE_TTL_MS);
        return out;
      }
      if (probesLeft <= 0) break;
    }
    return [];
}

/* ------------------------------------------ Sorgu varyantlarıyla ürün kazıma */

/**
 * Ürün kaynakları için sorgu DİLİ çözümü.
 *
 * ÖLÇÜLEN GERÇEK (canlı ağ, 2026-10-02, niş = "LED masa lambası"): 14 kaynağın
 * 13'ü 0 satır döndürdü; `bing-shopping` 0, `marketplace-price` hata verdi.
 * Aynı kaynaklar İngilizce "led desk lamp" ile GERÇEK fiyat ve yıldız puanı
 * getiriyordu. Yani kaynaklar çalışıyordu, sorgu dili yanlıştı.
 *
 * Çözüm, kaynağı değiştirmeden **sorguyu** düzeltmek: önce İngilizce karşılık,
 * sonuç yoksa ASCII'ye inmiş özgün sorgu, o da yoksa özgün metin denenir.
 *
 * BÜTÇE KURALI: varyantlar kendi zaman tavanını PAYLAŞIR. İlk varyant
 * satır döndürürse diğerleri hiç denenmez — 10 sn'lik dilim bütçesi aşılmasın.
 */
async function scrapeWithQueryVariants(
  niche: string,
  budgetMs: number,
  scrapeWith: (query: string) => Promise<RawProduct[]>,
): Promise<RawProduct[]> {
  const startedAt = Date.now();
  const variants = productQueryVariants(niche);
  for (let i = 0; i < variants.length; i += 1) {
    const query = variants[i];
    // Son varyant için zaman kalmadıysa atlanır: hat dilimini aşmamak, bir
    // satır elde etmekten önce gelir.
    if (i > 0 && Date.now() - startedAt > budgetMs / 2) break;
    const rows = await scrapeWith(query);
    if (rows.length) {
      // Kullanılan sorgu notlara yazılır: hangi dilin veri getirdiği
      // üretimde görülebilir olsun (sessizce "başka bir şey denedim" demeyelim).
      if (i > 0) {
        const suffix = ` · sorgu: "${query}"`;
        return rows.map((row) => ({ ...row, notes: `${row.notes ?? ""}${suffix}` }));
      }
      return rows;
    }
  }
  return [];
}

export const bingShoppingSource: ProductSource = {
  name: "bing-shopping",
  timeoutMs: 6_000,
  async scrape(niche: string): Promise<RawProduct[]> {
    return scrapeWithQueryVariants(niche, 6_000, async (query) => {
      const cards = await bingShoppingCards(query);

    const out: RawProduct[] = [];
    const seen = new Set<string>();
    for (const card of cards) {
      const title = decode(
        /<span title="([^"]{10,200})"/.exec(card)?.[1] ??
          /<div class="br-offTtl[^"]*"[^>]*>([\s\S]{0,200}?)<\/div>/.exec(card)?.[1] ??
          "",
      );
      if (!title || title.length < 8) continue;
      if (!matchesNiche(title, query)) continue;

      const key = title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const price = priceFromText(
        /class="br-price"[^>]*>([\s\S]{0,40}?)<\/div>/.exec(card)?.[1] ?? "",
      );
      const starRaw = /aria-label="Star Rating:\s*([0-9.]+)\s*out of 5/i.exec(card)?.[1];
      const rating = starRaw !== undefined ? Number(starRaw) : NaN;
      const countRaw = /class="sa_rt_num"[^>]*>\s*([0-9][0-9,]*)/.exec(card)?.[1];
      const ratingCount = countRaw !== undefined ? Number(countRaw.replace(/,/g, "")) : NaN;
      // Kart yazdıysa ölçülmüş talep; yazmadıysa talep ÖLÇÜLELEMEDİ.
      //
      // DİKKAT: `br-offSecLbl` açılış etiketinde `style="top:150px;"` vardır;
      // HTML'i düz metin gibi tarayan geniş bir regex ilk `>`'da kesilip boş
      // bir dize yakalar ve "görüntülenme" iddiası SAYI ÜRETMEZ. Bu yüzden
      // yalnız `resp-one-line` kutusu okunur ve içinde RAKAM olması şartı
      // aranır — kanıtsız talep satışı yapmayız.
      const viewedRaw = /class="resp-one-line[^"]*"[^>]*>([^<]{1,24})</.exec(card)?.[1]?.trim();
      // "1K+ viewed" → "1K+": kaynak zaten "görüntülenme" kelimesini biz ekliyoruz.
      const viewed =
        viewedRaw && /\d/.test(viewedRaw) ? viewedRaw.replace(/\s*viewed\s*$/i, "").trim() : "";
      const href = /<a class="br-offLink"[^>]*href="([^"]+)"/.exec(card)?.[1];

      const row: RawProduct = {
        title: title.slice(0, 180),
        brand: brandFromTitle(title),
        seller: decode(/class="br-offSlrTxt"[^>]*>([^<]{2,40})</.exec(card)?.[1] ?? ""),
        priceUsd: price,
        rating: Number.isFinite(rating) && rating >= 0 && rating <= 5 ? rating : null,
        ratingCount: Number.isFinite(ratingCount) && ratingCount >= 0 ? ratingCount : null,
        // Kart stok durumu bildirmiyor → bilinmiyor (`null` = eleme yok).
        inStock: null,
        source: "bing-shopping",
        url: href ? bingRealUrl(decode(href)) : "",
        imageUrl: imageFromShoppingCard(card),
        viewed90d: parseViewed90d(viewed),
        notes: [
          viewed ? `${viewed.trim()} görüntülenme / 90g` : "",
          Number.isFinite(ratingCount) ? `${ratingCount} değerlendirme` : "",
        ]
          .filter(Boolean)
          .join(" · ")
          .slice(0, 200),
      };
      // Gürültü kapısı: ne fiyatı ne puanı olan kart kanıt değildir.
      if (!hasMeasuredField(row)) continue;
      out.push(row);
    }
    // Kart vardı ama hiçbiri ölçülebilir değildi → bu bir HATA değil, kaynağın
    // dürüst cevabı: "bu nişte bana ölçülebilir ürün yok". `ok:true, items:0`
    // döner (dosyanın gürültü kapısı sözleşmesi). Hata yalnız SAYFA yapısı
    // değişmiş / engellenmişse atılır.
    return out.slice(0, BING_SHOPPING_LIMIT);
    });
  },
};

/* -------------------------------------------------------- Kaynak kaydı */

/**
 * Tüm kaynaklar — sıra, eşzamanlılık ve rapor sırasını belirler.
 *
 * SIRA ÖNEMLİ DEĞİL, HEPSİ PARALEL koşar; ama liste "ürün getirenler önce"
 * okunabilirliği için korunur. `runSources` `Promise.all` kullandığı için
 * 11 kaynağın toplam süresi en yavaşınki kadardır (≈7 sn tavan), toplamı
 * değil — Vercel Hobby bütçesi için bu kritiktir.
 */
export const PRODUCT_SOURCES: readonly ProductSource[] = [
  // Ölçülmüş ticari alan getirenler (fiyat + puan): en yüksek değer.
  // (`itunes` YOK: dijital lisans kataloğu — nedeni dosyada belgeli.)
  openLibrarySource,
  marketplacePriceSource,
  webReviewSource,
  // Oyun nişi: gerçek fiyat + gerçek topluluk puanı (Steam, anahtarsız).
  steamSource,
  // Fiziksel ürün: gerçek fiyat + gerçek puan (Türk pazaryeri, anahtarla).
  // Anahtar yoksa hiç ağ çağrısı yapmaz.
  trMarketplaceSource,
  // Fiziksel ürünün GERÇEK kullanıcı puanı + değerlendirme sayısı (anahtarsız).
  bingShoppingSource,
  // Talep/hype ölçümü.
  // ÖNCE Google Trends, SONRA Wikipedia: momentum tek kaynaktan okunur, ikisi
  // birden kanıta girmez (bkz. `googleTrendsSource` çift sayım notu).
  googleTrendsSource,
  googleNewsSource,
  wikipediaSource,
  hackerNewsSource,
  redditArchiveSource,
  githubSource,
  // Kapsam ölçümü.
  openFoodFactsSource,
  wikidataSource,
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
  /**
   * TÜM kaynaklar için üst sınır (ms). Verilirse her kaynağın KENDİ tavanı
   * bununla kırpılır.
   *
   * NEDEN GEREKLİ: hat dilim dilim koşar (varsayılan dilim 10 sn). Kaynak
   * tavanları 3-8 sn arasındadır ve normalde dilime sığar; ama yavaş bir kaynak
   * (ağ, yavaş DNS) adımı dilimin ötesine taşırsa istek platform tarafından
   * kesilir ve o ana kadar yazılan hiçbir şey kullanıcıya ulaşmaz. Kırpma, bu
   * adımın HER ZAMAN kendi sınırında dönmesini garanti eder. Geç kalan kaynak
   * rapora "timeout" olarak yazılır — veri uydurulmaz, yalnız o kaynak kaybolur.
   */
  opts: { capMs?: number; country?: string } = {},
): Promise<{ products: RawProduct[]; reports: SourceReport[] }> {
  const products: RawProduct[] = [];
  const country = String(opts.country ?? "").trim();
  const cap = Number.isFinite(opts.capMs) && (opts.capMs as number) > 0
    ? Math.round(opts.capMs as number)
    : Number.POSITIVE_INFINITY;
  const reports: SourceReport[] = await Promise.all(
    sources.map(async (source): Promise<SourceReport> => {
      const startedAt = Date.now();
      const budgetMs = Math.max(1_000, Math.min(source.timeoutMs, cap));
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const rows = await Promise.race([
          // Ülke duyarlı kaynak varsa hedef pazarıyla çalışır.
          country && source.scrapeForCountry
            ? source.scrapeForCountry(niche, country)
            : source.scrape(niche),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`timeout>${budgetMs}ms`)),
              budgetMs,
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
