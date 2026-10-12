/**
 * ÜCRETSİZ PAZARYERİ OKUYUCU — Hepsiburada + n11 (Türkiye) ve
 * AliExpress + Newegg (global, `$` fiyatlı).
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

/**
 * OKUMA MOTORU — ÖLÇÜLMÜŞ FARK (2026-10-12, n11 arama sayfası):
 *
 *   `direct`  → n11 Cloudflare ile 403 ("Attention Required! | Cloudflare")
 *   `browser` → **200, 59 KB, 22 gerçek ürün satırı** (0,4–13 sn)
 *
 * Yani engel n11'de değil, motordaydı: n11 JS/çerez isteyen bir sayfa döndürüyor
 * ve hazır-HTML motoru kapanıyor. Tarayıcı motoru pahalı olduğu için VARSAYILAN
 * `direct` kalır; yalnız n11 `browser` ile okunur (ölçülen ek süre kabul edilebilir,
 * istekler paralel koştuğu için TR tarafının duvar süresi Hepsiburada'nın altında
 * kalır).
 */
type Engine = "direct" | "browser";

const READER = "https://r.jina.ai/";
/**
 * FİYAT TAZELİĞİ — 6 saatten 3 saate indirildi.
 *
 * NEDEN: "kazanan ürün" iddiası doğrudan fiyata dayanıyor (marj, rekabet,
 * arbitraj). 6 saatlik önbellek, fiyatı gün içinde kaymış bir ürünü "taze"
 * gösterebiliyordu; 3 saat aynı nişi tekrar arayan kullanıcıyı Jina'ya hiç
 * göndermezken sapmayı yarıya indirir. Ölçüm zamanı ayrıca ürün notuna yazılır
 * (bkz. `priceStamp`), böylece arayüz "hangi ana ait fiyat" sorusunu yanıtlar.
 */
const CACHE_TTL_MS = 3 * 60 * 60 * 1000;
const PER_SITE_TIMEOUT_MS = 8_500;
/** Tarayıcı motoru hazır-HTML motorundan yavaş: ölçülen 0,4–13 sn → 20 sn tavan. */
const PER_SITE_BROWSER_TIMEOUT_MS = 20_000;

export interface ReaderRow {
  title: string;
  url: string;
  imageUrl: string;
  priceTry: number | null;
  rating: number | null;
  ratingCount: number | null;
  /** Mağaza/satıcı adı — YALNIZ ölçüldüyse (n11 `?magaza=`, Newegg marka). */
  seller?: string;
  site: "Hepsiburada" | "n11" | "AliExpress" | "Newegg";
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
  /** Ölçülen DEĞERLENDİRME/YORUM sayısı (Newegg `(N)`), yoksa `null`. */
  ratingCount?: number | null;
  /** Ölçülen marka/mağaza adı (Newegg marka mağazası), yoksa `""`. */
  brand?: string;
  /**
   * ÖLÇÜLMÜŞ "son 90 günün en düşük fiyatı" bayrağı (AliExpress liste sayfası
   * açıkça yazıyorsa). Uydurulmaz: yazmıyorsa `false`.
   */
  lowest90d?: boolean;
  site: "AliExpress" | "Newegg";
}

/** "1.359,15" → 1359.15 · "599" → 599 · "2.905" → 2905 */
export function parseTry(raw: string): number | null {
  const s = String(raw ?? "")
    .trim()
    .replace(/\s/g, "");
  if (!s) return null;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 && n < 5_000_000 ? Math.round(n * 100) / 100 : null;
}

const TL_RE = /(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)\s?(?:TL|₺)/g;

function cleanTitle(t: string): string {
  return t
    .replace(/\s+/g, " ")
    .replace(/^Image \d+:\s*/i, "")
    .trim()
    .slice(0, 160);
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
    const img = line.match(
      /!\[Image \d+:\s*([^\]]+)\]\((https:\/\/productimages\.hepsiburada\.net\/[^)\s]+)\)/,
    );
    const title = cleanTitle(link[2] || img?.[1] || "");
    if (title.length < 6) continue;
    // Puan + fiyat bir-iki satır aşağıdadır; sonraki ürüne geçmeden ara.
    let meta = "";
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j += 1) {
      if (lines[j].trimStart().startsWith("*   [")) break;
      meta += " " + lines[j];
    }
    const rate = meta.match(/Ürün puanı\s*([\d.,]+),\s*(\d+)\s*değerlendirme/);
    const prices = [...meta.matchAll(TL_RE)]
      .map((m) => parseTry(m[1]))
      .filter((n): n is number => n !== null);
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
 * n11 görselini vitrin boyutuna çıkarır. ÖLÇÜLDÜ (2026-10-12, aynı dosya):
 *   `a1/216/…`      → 200, 11 KB (liste sayfasının varsayılanı, kart için küçük)
 *   `a1/320_480/…`  → 200, 23 KB (vitrin için yeterli, kart başına ağır değil)
 *   `a1/org/…`      → 200, 129 KB (gereksiz ağır; 15 kartta ~2 MB)
 * Bu yüzden TÜM n11 görselleri `a1/320_480/` boyutuna sabitlenir.
 */
export function n11Image(url: string): string {
  const raw = String(url ?? "").trim();
  if (!/^https:\/\/n11scdn\.akamaized\.net\/a1\//i.test(raw)) return "";
  return raw.replace(/\/a1\/[^/]+\//, "/a1/320_480/");
}

/**
 * n11 arama sayfası (Jina Markdown) — İKİ MOTORUN ÇIKTISI DA AYNI KURALLARDAN GEÇER.
 *
 * `direct` motoru 403 (Cloudflare), `browser` motoru 200 döner; biçim aynı
 * "kart = tek satır" düzenindedir:
 *   `[![Image 100: BAŞLIK](görsel) … ## BAŞLIK (17) SÜPER 1.199 TL SEPETTE ### 649 TL …](https://www.n11.com/urun/…?magaza=x)`
 *
 * KURALLAR (hepsi ölçümden):
 *   • Görsel = satırdaki SON ürün görseli; `SQUARE`/`add-icon` rozet görselleri
 *     ve `a1/` dışındaki ikonlar atılır (aksi hâlde ürünün adı "SQUARE" oluyordu).
 *   • Fiyat = bağlantıdan ÖNCEKİ kalın (**) TL değeri; yoksa SON TL değeri.
 *     (Liste fiyatı önce, güncel fiyat sonra yazılır.)
 *   • Değerlendirme sayısı `(17)` / `_(0)_` biçiminde ÖLÇÜLÜR — eskiden
 *     "n11 sayı vermez" deniyordu, bu yalnız eski motorda doğruydu.
 *   • Mağaza adı `?magaza=` parametresinden okunur (gerçek satıcı kanıtı).
 */
export function parseN11(md: string): ReaderRow[] {
  const out: ReaderRow[] = [];
  const seen = new Set<string>();
  const imgRe = /!\[Image \d+:\s*([^\]]{4,240})\]\((https:\/\/n11scdn\.akamaized\.net\/[^)\s]+)\)/g;
  const linkRe = /\]\((https:\/\/www\.n11\.com\/urun\/[^)\s"]+)\)/;
  for (const line of String(md ?? "").split("\n")) {
    const link = linkRe.exec(line);
    if (!link) continue;
    const url = link[1].split("?")[0];
    if (seen.has(url)) continue;

    // ÜRÜN görseli + başlığı: rozetler ve 48 px ikonlar bilerek atlanır.
    let title = "";
    let imageUrl = "";
    for (const m of line.matchAll(imgRe)) {
      const alt = cleanTitle(m[1]);
      const sized = n11Image(m[2]);
      if (!sized || /^(SQUARE|add-icon|icon)\b/i.test(alt)) continue;
      title = alt;
      imageUrl = sized;
    }
    if (!title) {
      const heading = /##\s+([^\n(]{6,200})/.exec(line);
      if (!heading) continue;
      title = cleanTitle(heading[1]);
    }
    if (title.length < 6) continue;
    seen.add(url);

    const body = line.slice(0, link.index);
    const bold = /\*\*(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)\s?TL\*\*/.exec(body);
    const all = [...body.matchAll(/(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)\s?(?:TL|₺)/g)]
      .map((x) => parseTry(x[1]))
      .filter((n): n is number => n !== null);
    const countMatch = /\((\d{1,6})\)/.exec(body);
    const sellerMatch = /[?&]magaza=([^&"'\s]+)/.exec(line);
    out.push({
      title,
      url,
      imageUrl,
      priceTry: bold ? parseTry(bold[1]) : all.length ? all[all.length - 1] : null,
      // Liste sayfası puan DEĞERİ vermez; değerlendirme SAYISI verir. İkisi
      // karıştırılmaz: puan `null` kalır (uydurulmaz).
      rating: null,
      ratingCount: countMatch ? Number(countMatch[1]) : null,
      seller: sellerMatch ? decodeURIComponent(sellerMatch[1]) : undefined,
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
    const title = cleanTitle(img[1])
      .replace(/\]\s*\d*$/, "")
      .trim();
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
      // Liste sayfası mağaza adı ve değerlendirme SAYISI vermez: `null` kalır,
      // uydurulmaz. (Ölçüldü: yalnız "N sold" + puan yazılır.)
      ratingCount: null,
      brand: "",
      // ÖLÇÜLMÜŞ kazanan sinyali: sayfa açıkça "Lowest price in 90 days"
      // yazıyorsa ürün son 90 günün dibinde. Yazmıyorsa `false`.
      lowest90d: /lowest price in 90 days/i.test(body),
      site: "AliExpress",
    });
  }
  return out;
}

/* ------------------------------------------------------- Newegg (GLOBAL, ABD) */

/**
 * Newegg görselini vitrin boyutuna çıkarır. ÖLÇÜLDÜ (2026-10-12, aynı ürün):
 *   `/productimage/nb300/…` → 200, 14 KB (kart için bulanık)
 *   `/productimage/nb640/…` → 200, 46 KB (vitrin için uygun, kart başına makul)
 */
export function neweggImage(url: string): string {
  const raw = String(url ?? "").trim();
  if (!/^https:\/\/c1\.neweggimages\.com\/productimage\/nb\d+\//i.test(raw)) return "";
  return raw.replace(/\/productimage\/nb\d+\//, "/productimage/nb640/");
}

/**
 * Newegg arama sayfası (Jina Markdown) — GLOBAL, anahtarsız ikinci gerçek ürün kaynağı.
 *
 * NEDEN EKLENDİ (ölçülen gerçek, 2026-10-12, niş = "air fryer"): Jina üzerinden
 * okunabilirlik taramasında yalnız AliExpress ve **Newegg** gerçek ürün satırı
 * döndürdü; Amazon/Walmart/Home Depot/eBay/Target ya 403 ya "Error Page" ya da
 * "Loading…" (istemci tarafı) döndürdü. Newegg tek sayfada 39–44 KB gerçek liste,
 * 20+ kart ve şu ÖLÇÜLMÜŞ alanları verir:
 *   • başlık + ürün linki (`/p/N82E…`)
 *   • fiyat — kalın işaretli: `$**69**.99` (liste fiyatı sonra gelir)
 *   • değerlendirme SAYISI — `[(2)](…#IsFeedbackTab)`
 *   • MARKA — marka mağazası görselinin alt metni (`brandimage/Brand2177`)
 *   • görsel — `productimage/nb300` (640'a büyütülür)
 *
 * DÜRÜSTLÜK: puan DEĞERİ listede sayı olarak yok (yıldızlar görsel) → `null`.
 * Promosyon satırları (`$15 off`, `Save: $30.00`) fiyat SAYILMAZ; yalnız kalın
 * (güncel) fiyat okunur, yoksa satır fiyatsız kalır (`null`).
 */
export function parseNewegg(md: string): GlobalReaderRow[] {
  const out: GlobalReaderRow[] = [];
  const seen = new Set<string>();
  const lines = String(md ?? "").split("\n");
  const cardImg =
    /!\[Image \d+:\s*([^\]\n]{8,240})\]\((https:\/\/c1\.neweggimages\.com\/productimage\/nb\d+\/[^)\s]+)\)/;
  const itemLink = /\]\((https:\/\/www\.newegg\.com\/[^)\s"]*\/p\/N82E\d+[^)\s"]*)\)/;
  for (let i = 0; i < lines.length; i += 1) {
    const head = cardImg.exec(lines[i]);
    if (!head) continue;
    const link = itemLink.exec(lines[i]);
    if (!link) continue;
    const url = link[1].split("?")[0].split("#")[0];
    if (seen.has(url)) continue;
    const title = cleanTitle(head[1]);
    if (title.length < 10) continue;
    seen.add(url);

    // Kart gövdesi: sonraki kart görseline kadar (ölçülen kart ≈ 20 satır).
    const body: string[] = [];
    for (let j = i; j < Math.min(lines.length, i + 24); j += 1) {
      if (j > i && cardImg.test(lines[j])) break;
      body.push(lines[j]);
    }
    const text = body.join("\n");
    const bold = /\$\*\*\s*([0-9][0-9,]*)\*\*\.([0-9]{2})/.exec(text);
    // Yedek: indirim/taksit satırları DIŞLANIR ("$15 off", "Save: $30.00").
    const plain = bold
      ? null
      : body
          .filter((l) => !/\boff\b|save:|shipping|promo|coupon/i.test(l))
          .map((l) => /\$\s?([0-9][0-9,]*(?:\.[0-9]{2})?)/.exec(l))
          .find((m) => m !== null);
    const priceUsd = bold ? parseUsd(`${bold[1]}.${bold[2]}`) : plain ? parseUsd(plain[1]) : null;
    const brand =
      /!\[Image \d+:\s*([^\]]{2,60})\]\(https:\/\/c1\.neweggimages\.com\/brandimage\//.exec(text);
    const count = /\((\d{1,7})\)\]\([^)]*#IsFeedbackTab/.exec(text);
    out.push({
      title,
      url,
      imageUrl: neweggImage(head[2]),
      priceUsd,
      // Puan DEĞERİ listede sayı olarak yok → null (yıldızlar görseldir).
      rating: null,
      sold: null,
      ratingCount: count ? Number(count[1]) : null,
      brand: brand ? cleanTitle(brand[1]) : "",
      lowest90d: false,
      site: "Newegg",
    });
  }
  return out;
}

async function readPage(
  url: string,
  timeoutMs: number,
  engine: Engine = "direct",
): Promise<string> {
  const headers: Record<string, string> = {
    Accept: "text/plain",
    "X-Return-Format": "markdown",
    // "direct" motoru tarayıcı açmadan okur: ölçülen ~3,7 sn (varsayılan ~13 sn).
    // n11 ise yalnız tarayıcı motoruyla okunabiliyor (ölçüldü: direct 403).
    "X-Engine": engine,
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

/**
 * FİYAT ÖLÇÜM ZAMANI — ürün notuna yazılır.
 *
 * NEDEN: ürün kaydı önbellekten gelir (3 saat) ve "kazanan" iddiası fiyata
 * dayanır. Notunda ölçüm anı yazmayan bir fiyat, arayüzde TAZE gibi görünür.
 * Bu damga uydurma bir alan değil, kaydın üretildiği anın kendisidir.
 */
function priceStamp(at: number = Date.now()): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `fiyat ${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())} itibarıyla`;
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
  const q = String(niche ?? "")
    .trim()
    .slice(0, 80);
  if (!q) return [];
  const { cacheGet, cacheKey, cacheSet } = await import("./ai-cache.server");
  // v2: n11 satırları geri geldi (browser motoru). v1 kayıtları yalnız
  // Hepsiburada taşıyordu; anahtar sürümü artırılmazsa 3 saat boyunca eski,
  // eksik havuz servis edilirdi.
  const key = await cacheKey("tr-reader:v2", [q.toLocaleLowerCase("tr-TR")]);
  const hit = await cacheGet<RawProduct[]>(key).catch(() => null);
  if (hit && hit.length) return hit;

  const enc = encodeURIComponent(q);
  // N11 GERİ GELDİ — ÖLÇÜLDÜ (2026-10-12, aynı gün düzeltilmiş ölçüm):
  //   `X-Engine: direct`  → 403 "Attention Required! | Cloudflare"
  //   `X-Engine: browser` → **200, 59 KB, 22 gerçek ürün satırı**
  // Engel kaynakta değil MOTORDAYDI. Bu yüzden n11 tarayıcı motoruyla,
  // uzun zaman aşımıyla okunur; HB istekleriyle PARALEL koşar (TR tarafının
  // duvar süresi Hepsiburada'nın altında kalır: ölçülen 4,9 sn vs 0,4–13 sn).
  const jobs: Array<Promise<ReaderRow[]>> = [
    readPage(`https://www.hepsiburada.com/ara?q=${enc}`, PER_SITE_TIMEOUT_MS).then(
      parseHepsiburada,
    ),
    readPage(`https://www.hepsiburada.com/ara?q=${enc}&sayfa=2`, PER_SITE_TIMEOUT_MS).then(
      parseHepsiburada,
    ),
    readPage(`https://www.hepsiburada.com/ara?q=${enc}&sayfa=3`, PER_SITE_TIMEOUT_MS).then(
      parseHepsiburada,
    ),
    readPage(`https://www.hepsiburada.com/ara?q=${enc}&sayfa=4`, PER_SITE_TIMEOUT_MS).then(
      parseHepsiburada,
    ),
    readPage(`https://www.n11.com/arama?q=${enc}`, PER_SITE_BROWSER_TIMEOUT_MS, "browser").then(
      parseN11,
    ),
  ];
  const settled = await Promise.allSettled(jobs);
  const rows: ReaderRow[] = [];
  for (const s of settled) {
    if (s.status === "fulfilled") rows.push(...s.value);
    else console.warn(`[discovery] tr-reader sayfa okunamadı: ${String(s.reason).slice(0, 100)}`);
  }

  const { toUsd } = await import("./fx-rates.server");
  const stamp = priceStamp();
  const products: RawProduct[] = [];
  for (const r of dedupeRows(rows)) {
    if (r.priceTry === null || !r.imageUrl) continue; // fiyatsız/görselsiz ürün havuza girmez
    const usd = await toUsd(r.priceTry, "TRY");
    products.push({
      title: r.title,
      brand: "",
      // Ölçülen mağaza adı varsa (n11 `?magaza=`) o taşınır; yoksa kaynak adı.
      seller: r.seller || r.site,
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
        stamp,
      ]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 200),
    });
  }
  if (products.length) await cacheSet(key, "tr-reader:v2", products, CACHE_TTL_MS).catch(() => {});
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
  const q = String(niche ?? "")
    .trim()
    .slice(0, 80);
  if (!q) return [];
  const { cacheGet, cacheKey, cacheSet } = await import("./ai-cache.server");
  // v2: satır notuna fiyat ÖLÇÜM ZAMANI eklendi ve "son 90 günün en düşük
  // fiyatı" bayrağı taşınıyor; v1 kayıtları bu kanıtı taşımıyor.
  const key = await cacheKey("ali-reader:v2", [q.toLocaleLowerCase("tr-TR")]);
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

  const stamp = priceStamp();
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
        r.lowest90d ? "son 90 günün en düşük fiyatı" : "",
        stamp,
      ]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 200),
    });
  }
  if (products.length) await cacheSet(key, "ali-reader:v2", products, CACHE_TTL_MS).catch(() => {});
  return products;
}

/**
 * GLOBAL İKİNCİ GERÇEK ÜRÜN KAYNAĞI (Newegg) — anahtarsız, ülkeye göre çağrılır.
 *
 * Ölçülen okunabilirlik (2026-10-12, Jina Reader): Newegg 200 / 39–44 KB / 20+
 * kart; Amazon, Walmart, Home Depot, eBay, Target ya 403 ya boş iskelet döndü.
 * Bu yüzden global havuz AliExpress'e bağımlıydı; bu kaynak o bağımlılığı kırar
 * ve AE'nin vermediği iki kanıtı ekler: MARKA ve DEĞERLENDİRME SAYISI.
 *
 * 3 saat önbellek. Fail-soft: sayfa okunamazsa `[]` döner, hat devam eder.
 */
export async function scrapeNewegg(niche: string): Promise<RawProduct[]> {
  const q = String(niche ?? "")
    .trim()
    .slice(0, 80);
  if (!q) return [];
  const { cacheGet, cacheKey, cacheSet } = await import("./ai-cache.server");
  const key = await cacheKey("newegg-reader:v1", [q.toLocaleLowerCase("tr-TR")]);
  const hit = await cacheGet<RawProduct[]>(key).catch(() => null);
  if (hit && hit.length) return hit;

  const slug = encodeURIComponent(q.replace(/\s+/g, "+"));
  const pages = [
    `https://www.newegg.com/p/pl?d=${slug}`,
    `https://www.newegg.com/p/pl?d=${slug}&page=2`,
  ];
  const settled = await Promise.allSettled(
    pages.map((u) => readPage(u, PER_SITE_TIMEOUT_MS).then(parseNewegg)),
  );
  const rows: GlobalReaderRow[] = [];
  for (const s of settled) {
    if (s.status === "fulfilled") rows.push(...s.value);
    else
      console.warn(`[discovery] newegg-reader sayfa okunamadı: ${String(s.reason).slice(0, 100)}`);
  }

  const stamp = priceStamp();
  const seen = new Set<string>();
  const products: RawProduct[] = [];
  for (const r of rows) {
    const dedupe = r.title.toLocaleLowerCase("tr-TR").replace(/[^a-z0-9]+/g, "");
    if (seen.has(r.url) || seen.has(dedupe)) continue;
    seen.add(r.url);
    seen.add(dedupe);
    // Fiyatsız satır "kazanan" olamaz (marj hesaplanamaz); görselsiz satır
    // vitrine giremez. İkisi de ölçülmüş alan — uydurulmaz.
    if (r.priceUsd === null || !r.imageUrl) continue;
    products.push({
      title: r.title,
      brand: r.brand ?? "",
      seller: r.site,
      priceUsd: r.priceUsd,
      // Puan DEĞERİ listede sayı olarak yok → null (yıldızlar görseldir).
      rating: r.rating,
      ratingCount: r.ratingCount ?? null,
      inStock: true,
      source: "newegg-reader",
      url: r.url,
      imageUrl: r.imageUrl,
      salesVolume: null,
      notes: [
        r.site,
        `$${r.priceUsd}`,
        r.brand ? r.brand : "",
        r.ratingCount !== null && r.ratingCount !== undefined
          ? `${r.ratingCount} değerlendirme`
          : "",
        stamp,
      ]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 200),
    });
  }
  if (products.length)
    await cacheSet(key, "newegg-reader:v1", products, CACHE_TTL_MS).catch(() => {});
  return products;
}
