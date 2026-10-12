/**
 * ÜCRETSİZ PAZARYERİ OKUYUCU — Hepsiburada + n11 (Türkiye).
 *
 * NEDEN VAR (ölçülen gerçek, 2026-10-12, niş = "bardak", ülke = TR):
 *   16 kaynağın HİÇBİRİ gerçek ürün satırı döndürmedi. Türk pazaryerleri
 *   (Trendyol, Hepsiburada, n11, Akakçe, Cimri) veri merkezi IP'lerine 403
 *   veriyor; `tr-marketplace` ScraperAPI anahtarı yoksa hiç çalışmıyor. Havuz
 *   GitHub depoları, Hacker News başlıkları ve alakasız sayfalarla doluyordu —
 *   kullanıcının gördüğü "saçma rakamlar" buradan geliyordu.
 *
 * ÇÖZÜM: Jina Reader (`r.jina.ai`) sayfayı kendi altyapısından okuyup temiz
 *   Markdown döndürür. ANAHTARSIZ ücretsizdir (~20 istek/dk); `JINA_API_KEY`
 *   (jina.ai'den ücretsiz) eklenirse limit yükselir. Her satırda GERÇEK
 *   başlık, fiyat (TL), puan, değerlendirme sayısı, görsel ve ürün linki vardır.
 *
 * KURALLAR:
 *   • Uydurma yok — ölçülemeyen alan `null` kalır.
 *   • Sonuç 6 saat önbelleğe yazılır (aynı niş tekrar arandığında ücretsiz).
 *   • Fail-soft: bir site düşerse diğeri devam eder; hiçbiri düşerse [] döner.
 */
import type { RawProduct } from "./product-discovery.types";

const READER = "https://r.jina.ai/";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const PER_SITE_TIMEOUT_MS = 8_500;

export interface ReaderRow {
  title: string;
  url: string;
  imageUrl: string;
  priceTry: number | null;
  rating: number | null;
  ratingCount: number | null;
  site: "Hepsiburada" | "n11" | "AliExpress";
}

/**
 * GLOBAL PAZARYERİ SATIRI (AliExpress) — fiyat USD'dir, TL DEĞİL.
 *
 * NEDEN AYRI TİP: `ReaderRow` TL pazaryerleri için yazıldı ve `priceTry`
 * alanı adıyla "TL" der. AliExpress fiyatı USD gösterir; aynı alana yazmak
 * 84.99 USD'yi "84.99 TL" gibi okuturdu (uydurma kur). Bu yüzden ölçülen
 * para birimi açıkça taşınır.
 */
export interface GlobalReaderRow {
  title: string;
  url: string;
  imageUrl: string;
  /** Ölçülen fiyat (USD). `null` = sayfada `$` fiyatı yoktu (ölçülmedi). */
  priceUsd: number | null;
  rating: number | null;
  /** Listede ölçülen "N sold" — SATIŞ ADEDİ, değerlendirme sayısı DEĞİL. */
  sold: number | null;
  site: "AliExpress";
}

/** "1.359,15" → 1359.15 · "599" → 599 · "2.905" → 2905 */
export function parseTry(raw: string): number | null {
  const s = String(raw ?? "").trim().replace(/\s/g, "");
  if (!s) return null;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 && n < 5_000_000 ? Math.round(n * 100) / 100 : null;
}

const TL_RE = /(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)\s?(?:TL|₺)/g;

function cleanTitle(t: string): string {
  return t.replace(/\s+/g, " ").replace(/^Image \d+:\s*/i, "").trim().slice(0, 160);
}

/**
 * Hepsiburada arama sayfası (Jina Markdown).
 * Biçim: `*   [![Image n: BAŞLIK](görsel)](https://www.hepsiburada.com/...-p(m)-KOD "BAŞLIK") ...`
 * ardından gelen satırda: `Ürün puanı 4.6, 694 değerlendirme ... 249,99 TL`
 * Fiyat = satırdaki SON TL değeri (taksit/kupon tutarları önce gelir).
 */
export function parseHepsiburada(md: string): ReaderRow[] {
  const out: ReaderRow[] = [];
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const link = line.match(
      /\]\((https:\/\/www\.hepsiburada\.com\/[^\s)"]+-p[m]?-[A-Z0-9]+)(?:\s+"([^"]+)")?\)/,
    );
    if (!link || !line.trimStart().startsWith("*")) continue;
    const img = line.match(/!\[Image \d+:\s*([^\]]+)\]\((https:\/\/productimages\.hepsiburada\.net\/[^)\s]+)\)/);
    const title = cleanTitle(link[2] || img?.[1] || "");
    if (title.length < 6) continue;
    // Puan + fiyat bir-iki satır aşağıdadır; sonraki ürüne geçmeden ara.
    let meta = "";
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j += 1) {
      if (lines[j].trimStart().startsWith("*   [")) break;
      meta += " " + lines[j];
    }
    const rate = meta.match(/Ürün puanı\s*([\d.,]+),\s*(\d+)\s*değerlendirme/);
    const prices = [...meta.matchAll(TL_RE)].map((m) => parseTry(m[1])).filter((n): n is number => n !== null);
    out.push({
      title,
      url: link[1],
      imageUrl: (() => {
        const raw = img?.[2] ?? "";
        // ÖLÇÜLDÜ (2026-10-12): Hepsiburada listesi 300-400 (bazen 222-222)
        // boyutunu verir; 500-500 aynı dosyadan servis edilir ve kartta
        // bulanıklığı kaldırır. Yalnız boyut yol parçası değiştirilir.
        return raw.replace(/\/\d{2,4}-\d{2,4}\//, "/500-500/");
      })(),
      priceTry: prices.length ? prices[prices.length - 1] : null,
      rating: rate ? Math.min(5, Number(rate[1].replace(",", "."))) : null,
      ratingCount: rate ? Number(rate[2]) : null,
      site: "Hepsiburada",
    });
  }
  return out;
}

/**
 * n11 arama sayfası (Jina Markdown).
 * Biçim: `[![Image n: BAŞLIK](görsel) ### BAŞLIK ... 1.489 TL **1.400 TL**](https://www.n11.com/urun/...)`
 * Kalın (**) fiyat güncel satış fiyatıdır; yoksa son TL değeri alınır.
 */
export function parseN11(md: string): ReaderRow[] {
  const out: ReaderRow[] = [];
  const re =
    /\[!\[Image \d+:\s*([^\]]+)\]\((https:\/\/n11scdn\.akamaized\.net\/[^)\s]+)\)([^\n]*?)\]\((https:\/\/www\.n11\.com\/urun\/[^)\s"]+)/g;
  for (const m of md.matchAll(re)) {
    const title = cleanTitle(m[1]);
    if (title.length < 6 || /^SQUARE$/i.test(title)) continue;
    const body = m[3];
    const bold = body.match(/\*\*(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)\s?TL\*\*/);
    const all = [...body.matchAll(TL_RE)].map((x) => parseTry(x[1])).filter((n): n is number => n !== null);
    out.push({
      title,
      url: m[4].split("?")[0],
      imageUrl: m[2],
      priceTry: bold ? parseTry(bold[1]) : all.length ? all[all.length - 1] : null,
      rating: null,
      // n11 liste sayfası değerlendirme sayısını güvenilir vermez: ölçülmedi.
      ratingCount: null,
      site: "n11",
    });
  }
  return out;
}

/* ------------------------------------------- AliExpress (GLOBAL, anahtarsız) */

/** "$1,299.00" → 1299 · "$84.99" → 84.99 · "$" → null */
export function parseUsd(raw: string): number | null {
  const s = String(raw ?? "")
    .replace(/[$\s]/g, "")
    .replace(/,/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 && n < 500_000 ? Math.round(n * 100) / 100 : null;
}

/**
 * AliExpress görselini vitrin için büyütür.
 *
 * ÖLÇÜLDÜ (2026-10-12): 
 *   `…jpg_480x480q75.jpg_.avif` → 200 (avif, 21 KB)
 *   `…jpg_960x960q75.jpg`      → 200 (webp, 43 KB)
 *   `…jpg` (suffixsiz)         → 200 (webp, 453 KB — gereksiz büyük)
 * Bu yüzden kart için 960×960 webp tercih edilir: AVIF'i çözemeyen eski
 * tarayıcıda da görünür ve tam çözünürlüklü dosyayı indirmez.
 */
export function aliExpressImage(url: string): string {
  const raw = String(url ?? "").trim();
  if (!/^https:\/\/ae-pic-[a-z0-9]+\.aliexpress-media\.com\//i.test(raw)) return "";
  return raw.replace(/_\d+x\d+q\d+\.(?:jpg|png|webp)(?:_\.avif)?$/i, "_960x960q75.jpg");
}

/**
 * AliExpress arama sayfası (Jina Markdown) — GLOBAL gerçek ürün satırları.
 *
 * NEDEN VAR (ölçülen gerçek, 2026-10-12): TR dışı nişlerde (ör. "air fryer"/US)
 * havuzda satılabilir ürün satırı HİÇ yoktu; 28 ham satırın tamamı GitHub
 * deposu, Wikipedia maddesi ve haber snippet'iydi. Kapılar bunları haklı
 * olarak eledi ve kullanıcı ürün yerine tek bir "kapsam" satırı gördü.
 * Jina Reader üzerinden Amazon/Walmart/Etsy 403 dönerken **AliExpress
 * okunabiliyor** (ölçüldü: 29 KB gerçek liste); bu yüzden global pazaryeri
 * okuması buradan yapılır.
 *
 * Sayfa biçimi (tek satır = tek ürün):
 *   `[![Image 50: BAŞLIK](görsel) ![Image 51](…48x48.png) ### BAŞLIK
 *    $84.99 $242.47 -64% … 4.4 175 sold …](https://www.aliexpress.us/item/3256….html?…)`
 *
 * DÜRÜSTLÜK: `$` fiyatı yoksa satır fiyatsız kalır (`null`) — yerel para
 * birimini USD sanmayız. "N sold" varsa SATIŞ ADEDİ olarak taşınır; puan
 * yazılmamışsa `null` kalır (değerlendirme sayısı uydurulmaz).
 */
export function parseAliExpress(md: string): GlobalReaderRow[] {
  const out: GlobalReaderRow[] = [];
  const seen = new Set<string>();
  for (const line of String(md ?? "").split("\n")) {
    const img = /!\[Image \d+:\s*([^\]]{8,240})\]\((https:\/\/ae-pic-[^)\s]+)\)/.exec(line);
    if (!img) continue;
    const link = /\]\((https:\/\/www\.aliexpress\.[a-z.]+\/item\/\d+\.html[^)\s"]*)\)/.exec(line);
    if (!link) continue;
    const title = cleanTitle(img[1]).replace(/\]\s*\d*$/, "").trim();
    if (title.length < 10) continue;
    const url = link[1].split("?")[0];
    if (seen.has(url)) continue;
    seen.add(url);

    // Gövde: görselden ürün bağlantısına kadar olan kısım. Fiyat gövdenin
    // BAŞINDA güncel fiyattır; sonraki `$` değerleri etiket/taksit tutarıdır.
    const bodyStart = (img.index ?? 0) + img[0].length;
    const body = line.slice(bodyStart, link.index ?? line.length);
    const priceMatch = /\$\s*([0-9][0-9,]*\.?[0-9]{0,2})/.exec(body);
    const soldMatch = /([0-9][0-9,]*)\s*sold\b/i.exec(body);
    // Puan "4.4 175 sold" olarak bitişik gelir; satış adedinden önceki sayı puandır.
    const ratingMatch = /(?:^|\D)([0-5]\.\d)\s+[0-9][0-9,]*\s*sold\b/i.exec(body);
    out.push({
      title,
      url,
      imageUrl: aliExpressImage(img[2]),
      priceUsd: priceMatch ? parseUsd(priceMatch[1]) : null,
      rating: ratingMatch ? Math.min(5, Number(ratingMatch[1])) : null,
      sold: soldMatch ? Number(soldMatch[1].replace(/,/g, "")) : null,
      site: "AliExpress",
    });
  }
  return out;
}

async function readPage(url: string, timeoutMs: number): Promise<string> {
  const headers: Record<string, string> = {
    Accept: "text/plain",
    "X-Return-Format": "markdown",
    // "direct" motoru tarayıcı açmadan okur: ölçülen ~3,7 sn (varsayılan ~13 sn).
    "X-Engine": "direct",
  };
  const key = process.env.JINA_API_KEY?.trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(READER + url, { headers, signal: ctrl.signal });
    if (!res.ok) throw new Error(`reader ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Aynı ürünü (aynı link veya aynı normalize başlık) tek satıra indirir. */
export function dedupeRows(rows: ReaderRow[]): ReaderRow[] {
  const seen = new Set<string>();
  const out: ReaderRow[] = [];
  for (const r of rows) {
    const k1 = r.url;
    const k2 = r.title.toLocaleLowerCase("tr-TR").replace(/[^a-zçğıöşü0-9]+/g, "");
    if (seen.has(k1) || seen.has(k2)) continue;
    seen.add(k1);
    seen.add(k2);
    out.push(r);
  }
  return out;
}

export async function scrapeTrReader(niche: string): Promise<RawProduct[]> {
  const q = String(niche ?? "").trim().slice(0, 80);
  if (!q) return [];
  const { cacheGet, cacheKey, cacheSet } = await import("./ai-cache.server");
  const key = await cacheKey("tr-reader:v1", [q.toLocaleLowerCase("tr-TR")]);
  const hit = await cacheGet<RawProduct[]>(key).catch(() => null);
  if (hit && hit.length) return hit;

  const enc = encodeURIComponent(q);
  // N11 İSTEKLERİ KALDIRILDI — ÖLÇÜLDÜ (2026-10-12): `r.jina.ai` üzerinden
  // n11 Cloudflare tarafından 403 ile bloklanıyor ("Attention Required! |
  // Cloudflare", "This page maybe requiring CAPTCHA"). İki istek garantili
  // boş dönüyordu ve bütçeyi ürün ÜRETEN sayfalardan çalıyordu. `parseN11`
  // silinmedi: n11 bir gün okunabilir hâle gelirse tek satırlık bir iş.
  const jobs: Array<Promise<ReaderRow[]>> = [
    readPage(`https://www.hepsiburada.com/ara?q=${enc}`, PER_SITE_TIMEOUT_MS).then(parseHepsiburada),
    readPage(`https://www.hepsiburada.com/ara?q=${enc}&sayfa=2`, PER_SITE_TIMEOUT_MS).then(parseHepsiburada),
    readPage(`https://www.hepsiburada.com/ara?q=${enc}&sayfa=3`, PER_SITE_TIMEOUT_MS).then(parseHepsiburada),
    readPage(`https://www.hepsiburada.com/ara?q=${enc}&sayfa=4`, PER_SITE_TIMEOUT_MS).then(parseHepsiburada),
  ];
  const settled = await Promise.allSettled(jobs);
  const rows: ReaderRow[] = [];
  for (const s of settled) {
    if (s.status === "fulfilled") rows.push(...s.value);
    else console.warn(`[discovery] tr-reader sayfa okunamadı: ${String(s.reason).slice(0, 100)}`);
  }

  const { toUsd } = await import("./fx-rates.server");
  const products: RawProduct[] = [];
  for (const r of dedupeRows(rows)) {
    if (r.priceTry === null || !r.imageUrl) continue; // fiyatsız/görselsiz ürün havuza girmez
    const usd = await toUsd(r.priceTry, "TRY");
    products.push({
      title: r.title,
      brand: "",
      seller: r.site,
      priceUsd: usd,
      rating: r.rating,
      ratingCount: r.ratingCount,
      inStock: true,
      source: "tr-reader",
      url: r.url,
      imageUrl: r.imageUrl,
      notes: [
        r.site,
        `${r.priceTry.toLocaleString("tr-TR")} TL` + (usd !== null ? ` ≈ $${usd}` : ""),
        r.rating !== null ? `puan ${r.rating}/5` : "",
        r.ratingCount !== null ? `${r.ratingCount} değerlendirme` : "",
      ]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 200),
    });
  }
  if (products.length) await cacheSet(key, "tr-reader:v1", products, CACHE_TTL_MS).catch(() => {});
  return products;
}

/**
 * GLOBAL PAZARYERİ OKUYUCU (AliExpress) — ülkeden bağımsız, anahtarsız.
 *
 * NE VERİR: gerçek ürün başlığı, GERÇEK `$` fiyatı, gerçek "N sold" satış
 * adedi, gerçek puan (varsa), gerçek ürün fotoğrafı ve ürün bağlantısı.
 * Bu, "kazanan ürün" kararının dayandığı ticari kanıtın ta kendisidir.
 *
 * 6 saat önbelleğe yazılır; aynı niş tekrar arandığında Jina'ya istek gitmez.
 * Fail-soft: sayfa okunamazsa `[]` döner, hat devam eder.
 */
export async function scrapeAliExpress(niche: string): Promise<RawProduct[]> {
  const q = String(niche ?? "").trim().slice(0, 80);
  if (!q) return [];
  const { cacheGet, cacheKey, cacheSet } = await import("./ai-cache.server");
  const key = await cacheKey("ali-reader:v1", [q.toLocaleLowerCase("tr-TR")]);
  const hit = await cacheGet<RawProduct[]>(key).catch(() => null);
  if (hit && hit.length) return hit;

  const slug = encodeURIComponent(q.replace(/\s+/g, "-"));
  const pages = [
    `https://www.aliexpress.com/w/wholesale-${slug}.html`,
    `https://www.aliexpress.com/w/wholesale-${slug}.html?page=2`,
  ];
  const settled = await Promise.allSettled(
    pages.map((u) => readPage(u, PER_SITE_TIMEOUT_MS).then(parseAliExpress)),
  );
  const rows: GlobalReaderRow[] = [];
  for (const s of settled) {
    if (s.status === "fulfilled") rows.push(...s.value);
    else console.warn(`[discovery] ali-reader sayfa okunamadı: ${String(s.reason).slice(0, 100)}`);
  }

  const seen = new Set<string>();
  const products: RawProduct[] = [];
  for (const r of rows) {
    const dedupe = r.title.toLocaleLowerCase("tr-TR").replace(/[^a-z0-9]+/g, "");
    if (seen.has(r.url) || seen.has(dedupe)) continue;
    seen.add(r.url);
    seen.add(dedupe);
    // Fiyatsız satır "kazanan ürün" olamaz: marj hesaplanamaz. Görsel de
    // vitrinin şartı; ikisi de ölçülmüş alandır, uydurulmaz.
    if (r.priceUsd === null || !r.imageUrl) continue;
    products.push({
      title: r.title,
      brand: "",
      seller: r.site,
      priceUsd: r.priceUsd,
      rating: r.rating,
      // Değerlendirme SAYISI ölçülmedi (liste yalnız "N sold" verir);
      // satış adedi ayrı alanda taşınır ve karıştırılmaz.
      ratingCount: null,
      inStock: true,
      source: "aliexpress-reader",
      url: r.url,
      imageUrl: r.imageUrl,
      salesVolume: r.sold,
      notes: [
        r.site,
        `$${r.priceUsd}`,
        r.rating !== null ? `puan ${r.rating}/5` : "",
        r.sold !== null ? `${r.sold.toLocaleString("tr-TR")} adet satıldı` : "",
      ]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 200),
    });
  }
  if (products.length) await cacheSet(key, "ali-reader:v1", products, CACHE_TTL_MS).catch(() => {});
  return products;
}
