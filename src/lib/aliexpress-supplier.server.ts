// ============================================================================
// TEDARİK (SUPPLIER) KANITI — anahtarsız toptan fiyat kaynağı.
//
// NEDEN VAR (ölçülen boşluk, 2026-10-03):
//   Ürün kartlarında "Supplier" ve "Marj" alanları kalıcı olarak BOŞTU. Ölçülen
//   sebep: kazınan kaynakların HİÇBİRİ toptan fiyat ölçmüyor. `bing-shopping`,
//   `serpapi-shopping` ve pazar yerleri PERAKENDE fiyat veriyor; `wikipedia`,
//   `github`, `steam` ise ürün bile değil. `toWinningProducts` bu yüzden
//   `supplier_price_usd: ""` + `cost_breakdown: { net_margin_pct: 0 }` yazıyor,
//   yani "bilinmiyor" ile "0" aynı kalıbı taşıyordu.
//
// NEDEN ALIEXPRESS (canlı ölçüm, bu sandbox, 2026-10-03):
//   `aliexpress.com/w/wholesale-<sorgu>.html` → HTTP 200, ~820 KB, ~2 sn.
//   Sayfa içinde `itemList.content[]` gömülü ve HER KART GERÇEK:
//     • `prices.salePrice.minPrice` / `prices.originalPrice.minPrice` → USD fiyat
//     • `prices.salePrice.discount`                             → ÖLÇÜLEN indirim
//     • `trace.utLogMap.real_trade_count`                       → ÖLÇÜLEN satış adedi
//     • `evaluation.starRating`                                 → ÖLÇÜLEN puan
//     • `trace.pdpParams.shipFrom`                              → ÖLÇÜLEN kargo çıkışı
//     • `custom.p4pExtendParam` → `store_name`                  → ÖLÇÜLEN tedarik mağazası
//   Aynı anda ölçülen ve ÇALIŞMAYAN adaylar: dhgate 403, made-in-china 404,
//   etsy-ajax 404, `s.alibaba.com` JSON boş (1.4 KB).
//
// AYRıştırma notu (ölçülen iki çıkmaz nokta):
//   1. Gömülü JSON, `itemList` → `{"content":[…]}` sarmalayıcısıdır. Açılış
//      süslüsü `content`den ÖNCE gelir; ilk kartın `{`ünden başlanırsa yalnız
//      TEK kart okunur (ölçülen sonuç: 60 kart yerine 1).
//   2. Metin KAÇIŞSIZ gelir. Körlemesine `\\"` → `"` dönüşümü YAPILMAZ: iç içe
//      `p4pExtendParam` dizesinin kendi tırnak kaçışları bozulur ve 24589.
//      karakterde `JSON.parse` çöker (ölçüldü: 820 KB HTML → 0 teklif).
//
// DÜRÜSTLÜK KURALI (dosyanın tamamı geçerli):
//   • Yalnız SAYFA ÜZERİNDE yazan sayılar kullanılır. Yoksa `null`.
//   • Kargo ücreti, gümrük vergisi ve komisyon SAYFADA YOKTUR → ölçülmedi,
//     `null` kalır; uydurulmaz. `supplier-economics.ts` bu yüzden yalnız
//     "kargo + komisyon ÖNCESİ brüt marj" ve "kargoya kalan pay" hesaplar.
//   • Bu kaynak ürün LİSTESİ üretmez. `RawProduct` DEĞİL `SupplierOffer`
//     döndürür ve `PRODUCT_SOURCES`'a GİRMEZ — ayrı bir adım olarak retail
//     satırlarıyla eşleştirilir (`product-discovery-pipeline.server.ts`).
// ============================================================================

import { measuredMoney } from "./economics-evidence";
import { englishProductQuery, productQueryVariants } from "./product-discovery-query";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

/** Toptan teklif önbelleği: 24 saat. Aynı niş tekrar aranırsa ağa gidilmez. */
const SUPPLIER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * ÖLÇÜLMÜŞ toptan teklif. Her sayı ya sayfadan birebir okunmuştur ya `null`dur.
 *
 * `unitPriceUsd` indirimli fiyat, `listPriceUsd` etiket fiyatıdır. Aradaki fark
 * `discountPct` ile ölçülür; kartta "liste $X → ölçülen $Y" olarak gösterilir.
 * Tek fiyat göstermek indirimi saklardı.
 */
export type SupplierOffer = {
  title: string;
  /** Ölçülen indirimli birim fiyat (USD). `null` = okunamadı. */
  unitPriceUsd: number | null;
  /** Ölçülen etiket/liste fiyatı (USD). `null` = yok. */
  listPriceUsd: number | null;
  /** Ölçülen indirim (%). `null` = yok. */
  discountPct: number | null;
  /** ÖLÇÜLEN toplam satış adedi. `null` = bilinmiyor (`-1` de bilinmiyordur). */
  sold: number | null;
  /** Ölçülen mağaza puanı (0-5). `null` = yok. */
  rating: number | null;
  /** Ölçülen tedarik mağazası adı. Boş olabilir. */
  store: string;
  /** Ölçülen kargo çıkış ülkesi kodu (örn. "CN", "US"). Boş olabilir. */
  shipFrom: string;
  url: string;
  imageUrl: string;
};

type AeCard = Record<string, unknown>;

const str = (value: unknown): string => String(value ?? "").trim();
const obj = (value: unknown): AeCard =>
  value && typeof value === "object" ? (value as AeCard) : {};
const num = (value: unknown): number | null => {
  const n = Number(value);
  return typeof value === "number" || (typeof value === "string" && value.trim() !== "")
    ? Number.isFinite(n)
      ? n
      : null
    : null;
};

/**
 * `trace.pdpParams.pdp_cdi` (URL-kodlanmış JSON) içinden `shipFrom` okur.
 *
 * Ölçülen örnek: `…%22shipFrom%22%3A%22CN%22…`. Kargo çıkış ülkesi, marj
 * hesabında "ithalat mı, yerel stok mu" ayrımı için gereklidir.
 */
function shipFromOf(card: AeCard): string {
  const trace = obj(card.trace);
  const direct = str(obj(trace.pdpParams).shipFrom);
  if (direct) return direct;
  const encoded = str(obj(trace.pdpParams).pdp_cdi);
  if (!encoded) return "";
  try {
    const parsed = JSON.parse(decodeURIComponent(encoded.replace(/\+/g, " "))) as Record<
      string,
      unknown
    >;
    return str(parsed.shipFrom);
  } catch {
    return "";
  }
}

/**
 * `trace.custom.p4pExtendParam` (JSON DİZESİ) içinden tedarik mağazası adı.
 * Ölçülen örnek: `{"company_name":"易遠達貿易有限公司","store_name":"PETRAEL Local Store"}`
 *
 * DİKKAT: `p4pExtendParam` yalnız SPONSORLU (p4p) kartlarda vardır; organik
 * kartlarda mağaza adı sayfada YOKTUR ve boş döner — uydurulmaz.
 */
function storeOf(card: AeCard): string {
  const raw = str(obj(obj(card.trace).custom).p4pExtendParam);
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return str(parsed.store_name ?? parsed.company_name);
  } catch {
    return "";
  }
}

/** `tradeDesc` ("600+ sold", "10,000+ sold") → sayı; okunamazsa `null`. */
function soldFromText(value: unknown): number | null {
  const n = Number(str(value).replace(/[^\d]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Bir `itemList.content` kartını `SupplierOffer`'a indirger.
 *
 * `null`, kart gerçekten ölçülebilir başlık/fiyat taşımıyorsa döner; kart
 * atlanır — sahte teklif üretilmez.
 */
function toOffer(card: unknown): SupplierOffer | null {
  const row = obj(card);
  const title = str(obj(row.title).displayTitle);
  const productId = str(row.productId);
  if (!title || !/^\d{6,}$/.test(productId)) return null;

  const prices = obj(row.prices);
  const sale = obj(prices.salePrice);
  const list = obj(prices.originalPrice);
  // Para birimi yalnız USD ise ölçüm kabul edilir; aksi hâlde `null`.
  const saleCurrency = str(sale.currencyCode ?? prices.currencyCode);
  const listCurrency = str(list.currencyCode ?? prices.currencyCode);

  const soldExact = num(obj(obj(row.trace).utLogMap).real_trade_count);
  const discount = num(sale.discount);
  const rating = num(obj(row.evaluation).starRating);
  const img = str(obj(row.image).imgUrl);

  return {
    title,
    unitPriceUsd: saleCurrency === "USD" || saleCurrency === "" ? measuredMoney(sale.minPrice) : null,
    listPriceUsd: listCurrency === "USD" || listCurrency === "" ? measuredMoney(list.minPrice) : null,
    discountPct: discount !== null && discount > 0 ? Math.round(discount) : null,
    sold: soldExact !== null && soldExact >= 0 ? soldExact : soldFromText(obj(row.trade).tradeDesc),
    rating: rating !== null && rating > 0 && rating <= 5 ? rating : null,
    store: storeOf(row),
    shipFrom: shipFromOf(row),
    url: `https://www.aliexpress.com/item/${productId}.html`,
    imageUrl: img.startsWith("//") ? `https:${img}` : img,
  };
}

/** `itemList` → `{"content":[…]}` sarmalayıcısının ham metnini döndürür. */
function embeddedContent(html: string): string {
  const itemList = html.indexOf("itemList");
  if (itemList === -1) return "";
  const contentKey = html.indexOf("content", itemList);
  if (contentKey === -1) return "";
  // Açılış süslüsü `content`den ÖNCE gelir; ilk kartın `{`ünden başlanırsa
  // yalnız TEK kart okunur (ölçülen hata: 60 kart yerine 1).
  const open = html.lastIndexOf("{", contentKey);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < html.length; i++) {
    const c = html[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return html.slice(open, i + 1);
    }
  }
  return "";
}

/**
 * Ham HTML → `SupplierOffer[]`. SAF fonksiyon (ağ YOK) — test edilebilir.
 *
 * Canlı ölçüm: 820 KB HTML → 60 kart → 60 teklif (10/60 `store`, 60/60 `sold`,
 * 60/60 `shipFrom` dolu).
 */
export function extractSupplierOffers(html: string): SupplierOffer[] {
  if (!html || html.length < 200) return [];
  const content = embeddedContent(html);
  if (!content) return [];
  let parsed: { content?: unknown };
  try {
    parsed = JSON.parse(content) as { content?: unknown };
  } catch {
    // Sayfa yapısı değişirse kart üretmek yerine ÖLÇÜLEMEDİĞİMİZİ söyleriz.
    return [];
  }
  if (!Array.isArray(parsed.content)) return [];
  const offers: SupplierOffer[] = [];
  for (const card of parsed.content) {
    const offer = toOffer(card);
    if (offer) offers.push(offer);
  }
  return offers;
}

/* ------------------------------------------------------------------- Ağ katmanı */

/** Niche → AliExpress arama slug'ı (`kedi tırmalama tahtası` → `cat-scratching-board`). */
export function supplierSearchQuery(niche: string): string {
  const variants = productQueryVariants(niche);
  const base = englishProductQuery(niche) || variants[0] || String(niche ?? "").trim();
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * @param country `US`, `DE`, `TR`… Boşsa küresel arama (`glo=y`).
 */
export function supplierSearchUrl(niche: string, country = ""): string {
  const slug = supplierSearchQuery(niche);
  if (!slug) return "";
  const region = country ? country.toUpperCase() : "US";
  const locale = country ? country.toLowerCase() : "en";
  return `https://www.aliexpress.com/w/wholesale-${slug}.html?glo=y&region=${region}&locale=${locale}`;
}

/**
 * Canlı toptan teklifleri getirir. Hata fırlatır (hat fail-soft olarak yakalar).
 *
 * 24 saat önbellek: aynı niş tekrar aranırsa ağa hiç gidilmez (hem hız hem
 * AliExpress'e saygı). Kota sayacı da aynı kova mantığıyla korur.
 */
export async function fetchSupplierOffers(
  niche: string,
  opts: { country?: string; timeoutMs?: number } = {},
): Promise<SupplierOffer[]> {
  const url = supplierSearchUrl(niche, opts.country ?? "");
  if (!url) return [];

  const { cacheGet, cacheKey, cacheSet } = await import("./ai-cache.server");
  const key = await cacheKey("supplier-offers-v1", [niche, opts.country ?? ""]);
  const hit = await cacheGet<SupplierOffer[]>(key);
  if (hit) return hit;

  const { allowSupplierCredit } = await import("./scraper-quota.server");
  if ((await allowSupplierCredit()) === false) {
    console.log(`[supplier] aylık kota doldu (${niche})`);
    return [];
  }

  const res = await fetch(url, {
    signal: AbortSignal.timeout(opts.timeoutMs ?? 8_000),
    headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const offers = extractSupplierOffers(await res.text());
  if (offers.length) await cacheSet(key, "supplier-offers-v1", offers, SUPPLIER_CACHE_TTL_MS);
  return offers;
}