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
  isTurkishQuery,
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
/**
 * Apple'ın medya türleri — bunlar fiziksel ürün nişinde ürün DEĞİLDİR.
 *
 * ÖNEMLİ: tam liste DEĞİL, ÖN EK deseni. iTunes Search API varlık adlarını
 * döndürüyor: `feature-movie`, `tv-episode`, `tv-season`, `music-song`,
 * `podcast`, `audiobook`… İlk denemede sabit bir `Set` ile eşleştirdim ve
 * canlı koşuda filmler yine sızdı (tesadüf değil, VEYA çünkü listede
 * `movie` vardı ama API `feature-movie` döndürüyor). Yeni bir medya türü
 * çıksa bile yakalanır.
 */
const MEDIA_KIND = /^(feature-movie|short-film|movie|tv-|music-|song|podcast|audiobook)/;

/** Nişin kendisi medya mı? (o zaman medya kayıtları üründür) */
const MEDIA_NICHE_WORDS = [
  "film",
  "movie",
  "dizi",
  "series",
  "music",
  "müzik",
  "şarkı",
  "sarki",
  "song",
  "album",
  "albüm",
  "kitap",
  "book",
  "novel",
  "roman",
  "oyun",
  "game",
  "app",
  "uygulama",
  "podcast",
  " audiobook",
  "sesli",
];

function isMediaNiche(niche: string): boolean {
  const lower = String(niche ?? "").toLowerCase();
  return MEDIA_NICHE_WORDS.some((w) => w.trim() !== "" && lower.includes(w.trim()));
}

export const itunesSource: ProductSource = {
  name: "itunes",
  timeoutMs: 4_000,
  async scrape(niche: string): Promise<RawProduct[]> {
    // ÖLÇÜM (2026-10-02): bu kaynak `country=US` sabit olduğu için Türkçe
    // sorgularda 0 satır dönüyordu. iTunes Search API `country` parametresiyle
    // mağazayı seçiyor: Türkçe bir nişte `country=TR` hem Türkçe ürünleri hem
    // TÜRKÇE KULLANICI PUANLARINI getiriyor. `averageUserRating` zaten
    // okunuyordu; sadece doğru mağazaya sorulmuyordu.
    const country = isTurkishQuery(niche) ? "TR" : "US";
    return scrapeWithQueryVariants(niche, 4_000, async (query) => {
    const q = encodeURIComponent(query.slice(0, 60));
    const json = await grabJson<{
      resultCount?: number;
      results?: {
        kind?: string;
        trackName?: string | null;
        collectionName?: string | null;
        artistName?: string | null;
        trackPrice?: number | null;
        collectionPrice?: number | null;
        currency?: string | null;
        primaryGenreName?: string | null;
        trackViewUrl?: string | null;
        collectionViewUrl?: string | null;
        averageUserRating?: number | null;
        userRatingCount?: number | null;
        /**
         * Kapak görseli. iTunes Search API her sonuçta DÖNDÜRÜR; bu dosya
         * yıllardır bu alanı hiç okumadığı için kısa listede her iTunes ürünü
         * görselsiz çıkıyordu. Artık okunuyor.
         */
        artworkUrl100?: string | null;
      }[];
    }>(`https://itunes.apple.com/search?term=${q}&limit=25&country=${country}`, 3_500);

    const out: RawProduct[] = [];
    const seen = new Set<string>();
    for (const item of json.results ?? []) {
      const title = String(item.trackName ?? item.collectionName ?? "").trim();
      if (!title) continue;
      // MEDYA KAPISI — canlı ölçümle bulundu (2026-09-27, "espresso machine"):
      // iTunes "Terminator: Rise of the Espresso Machines" ($9.99) ve
      // "Politics @ Coffee Machine" ($9.99) döndürdü. İkisi de SESLİ KİTAP;
      // nişte "espresso" kelimesi geçtiği için `matchesNiche` geçiriyordu ve
      // 5'li nihai listeye girdiler — kullanıcıya ürün olmayan kayıt gitti.
      //
      // AYIRT EDİCİ İKİ ALAN VAR, ikisi de gerekiyor (ölçümle öğrenildi):
      //   • `kind` — filmler için `feature-movie`, diziler için `tv-episode`.
      //   • URL   — SESLİ KİTAPLARDA `kind` YOKTUR; ayrım yalnız
      //     `books.apple.com/.../audiobook/...` adresinden anlaşılıyor.
      // İlk denemede yalnız `kind`'a bakıldı ve sesli kitaplar sızdı.
      //
      // Medya türleri YALNIZ niş kendisi medya ise kabul edilir ("müzik albümü"
      // arayan şarkı görmek ister, "espresso machine" arayan görmez). Böylece
      // dijital nişler kaynağı kaybetmez, fiziksel nişler kirlenmez.
      const viewUrl = String(item.trackViewUrl ?? item.collectionViewUrl ?? "");
      const isMedia =
        MEDIA_KIND.test(String(item.kind ?? "")) ||
        /books\.apple\.com|\/audiobook\//i.test(viewUrl);
      if (isMedia && !isMediaNiche(query)) continue;
      const key = title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const currency = String(item.currency ?? "USD").toUpperCase();
      const raw = Number(item.trackPrice ?? item.collectionPrice);
      const priceUsd = Number.isFinite(raw) && raw > 0 && currency === "USD" ? raw : null;
      const rating =
        Number.isFinite(Number(item.averageUserRating)) &&
        Number(item.averageUserRating) > 0 &&
        Number(item.userRatingCount) >= 3
          ? Number(item.averageUserRating)
          : null;
      const ratingCount =
        Number.isFinite(Number(item.userRatingCount)) && Number(item.userRatingCount) > 0
          ? Number(item.userRatingCount)
          : null;

      const notesParts: string[] = [];
      if (item.primaryGenreName) notesParts.push(String(item.primaryGenreName));
      if (priceUsd === null && raw > 0) notesParts.push(`fiyat ${currency} ${raw}`);
      if (ratingCount) notesParts.push(`${ratingCount} kullanıcı puanı`);

      const row: RawProduct = {
        title: title.slice(0, 180),
        brand: String(item.artistName ?? "").slice(0, 60),
        seller: "Apple",
        priceUsd,
        rating,
        ratingCount,
        inStock: null,
        source: "itunes",
        url: String(item.trackViewUrl ?? item.collectionViewUrl ?? ""),
        imageUrl: itunesArtwork(String(item.artworkUrl100 ?? "")),
        notes: notesParts.join(" · ").slice(0, 200),
      };
      // Kapı 1: alakalılık. Kapı 2: en az bir ölçülebilir alan.
      if (!matchesNiche(row.title, query)) continue;
      if (!hasMeasuredField(row)) continue;
      out.push(row);
    }
    return out.slice(0, 20);
    });
  },
};

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
  itunesSource,
  openLibrarySource,
  marketplacePriceSource,
  webReviewSource,
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
  opts: { capMs?: number } = {},
): Promise<{ products: RawProduct[]; reports: SourceReport[] }> {
  const products: RawProduct[] = [];
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
          source.scrape(niche),
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
