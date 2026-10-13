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
 *   Markdown döndürür. ANAHTARSIZ ücretsizdir (~20 istek/dk); `JINA_API_KEY_1.._8`
 *   (jina.ai'den ücretsiz, HER ANAHTAR 10M token) eklenirse anahtarlar arasında
 *   yük paylaşılır ve kota dolan anahtar soğumaya alınır. Her satırda GERÇEK
 *   başlık, fiyat (TL), puan, değerlendirme sayısı, görsel ve ürün linki vardır.
 *
 * BÜTÇE GERÇEĞİ (ölçüm 2026-10-12, gerçek gövdeler): HB sayfası 85.266 karakter
 *   ≈ 21.300 token, n11 sayfası 58.025 karakter ≈ 14.500 token → TR araması
 *   ≈ 57K token. Bu yüzden okuma tarafı ÖLÇÜLEREK kısıldı:
 *   • `DISCOVERY_READER_PAGES` (varsayılan 2) — eskiden 4 HB sayfası okunuyordu.
 *   • Motor yükseltmesi yalnız GEREKTİĞİNDE (`readPageWithEscalation`).
 *   • Ücretsiz katman sayfa başına 429 döndüğünde satır kaybolmasın diye
 *     devre kesici ölü host'u atlar, anahtar havuzu sıradaki anahtara geçer.
 *   • Kaç satırın neden düştüğü SAYILIR (`readerHealth().sources`).
 *
 * KURALLAR:
 *   • Uydurma yok — ölçülemeyen alan `null` kalır.
 *   • Sonuç 3 saat önbelleğe yazılır (aynı niş tekrar arandığında ücretsiz).
 *   • Fail-soft: bir site düşerse diğeri devam eder; hiçbiri düşerse [] döner.
 */
import type { RawProduct } from "./product-discovery.types";
import { jinaEnvKeys } from "./ai-keys.server";

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

/* ══════════════════════════════ GENEL PARA BİRİMİ (P0-2) ══════════════════════
 *
 * NEDEN: ayrıştırıcılar yalnız `parseTry` (TL) ve `parseUsd` ($) biliyordu.
 * Global ölçekte her ülkenin KENDİ biçimi var ve tek yanlış varsayım fiyatı
 * uydurur:
 *   • DE  „ab 27,99 €“   → virgül ONDALIK (27.99)
 *   • US  „$1,299.00“    → nokta ONDALIK
 *   • IN  „₹1,299“ / „₹12,34,567“ → Hint gruplaması (binlik ayırıcı)
 *   • JP  „4,180 円“      → binlik ayırıcı, ondalık YOK
 *   • PL  „1 299,00 zł“   → boşluk gruplama + virgül ondalık
 * Bu yüzden sayı çözümü TEK bir yerde (burada) ve ayırıcının ANLAMINI konumdan
 * çıkarır; hiçbir ülkeye özel varsayım yapmaz.
 */

/**
 * Sembol → ISO kodu.
 *
 * SIRA ÖNEMLİ: `R$` `$`dan, `zł` tek başına `ł`den ÖNCE denenir (aksi hâlde
 * BRL `$` = USD, PLN tek harfe düşerdi). `TL` de burada: TR sayfaları tutarı
 * hem `₺` hem `TL` ile yazar (eski hat `parseTry` ile aynı sonucu vermeli).
 */
export const CURRENCY_BY_SYMBOL: Readonly<Record<string, string>> = {
  "R$": "BRL",
  "zł": "PLN",
  "TL": "TRY",
  "₺": "TRY",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
  "円": "JPY",
  "₹": "INR",
  "₩": "KRW",
  "$": "USD",
};

const MONEY_SYMBOLS = Object.keys(CURRENCY_BY_SYMBOL);

/** Sayı ayırıcılarının ANLAMINI konumdan çıkarır; bilinmeyeni `null` yapar. */
export function parseAmount(raw: string): number | null {
  const cleaned = String(raw ?? "")
    .replace(/[\s\u00A0\u202F]/g, "")
    .replace(/[^\d.,]/g, "");
  if (!cleaned) return null;
  const separators = (cleaned.match(/[.,]/g) ?? []).length;
  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");
  let normalized: string;
  if (separators === 0) {
    normalized = cleaned;
  } else if (lastDot >= 0 && lastComma >= 0) {
    // İKİ ayırıcı varsa SONUNCUSU ondalıktır (uluslararası kural).
    normalized =
      lastComma > lastDot
        ? cleaned.replace(/\./g, "").replace(",", ".")
        : cleaned.replace(/,/g, "");
  } else {
    const separator = lastDot >= 0 ? "." : ",";
    const parts = cleaned.split(separator);
    const tail = parts[parts.length - 1] ?? "";
    // Tek ayırıcı + 1-2 hane = ondalık („27,99“) · 3+ hane/çoklu ayırıcı = binlik
    // („4,180“ JPY, „12,34,567“ INR, „1.299“ TR). Yanlış tarafa düşmek fiyatı
    // 100 katına çıkarırdı, bu yüzden kural açıkça burada.
    if (parts.length === 2 && tail.length > 0 && tail.length <= 2) {
      normalized = separator === "." ? cleaned : cleaned.replace(",", ".");
    } else {
      normalized = parts.join("");
    }
  }
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0 || value >= 100_000_000) return null;
  return Math.round(value * 100) / 100;
}

/**
 * Metinden ÖLÇÜLMÜŞ tutar + para birimi. Sembol sayının önünde de arkasında da
 * olabilir (`€ 27,99` / `27,99 €`). Bulunamazsa `null` — tahmin YOK.
 */
export function parseMoney(text: string): { amount: number; currency: string } | null {
  const src = String(text ?? "");
  let best: { at: number; amount: number; currency: string } | null = null;
  for (const symbol of MONEY_SYMBOLS) {
    const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const after = new RegExp(`${escaped}\\s*([0-9][0-9.,\\u00A0 ]{0,15})`);
    const before = new RegExp(`([0-9][0-9.,\\u00A0 ]{0,15})\\s*${escaped}`);
    const mAfter = after.exec(src);
    const mBefore = before.exec(src);
    const candidates: { match: RegExpExecArray; at: number }[] = [];
    if (mAfter) candidates.push({ match: mAfter, at: mAfter.index });
    if (mBefore) candidates.push({ match: mBefore, at: mBefore.index });
    for (const { match, at } of candidates) {
      const amount = parseAmount(match[1]);
      const currency = CURRENCY_BY_SYMBOL[symbol];
      if (amount === null || !currency) continue;
      // METİNDEKİ EN ERKEN tutar kazanır: Flipkart'ta „₹579 ₹809“ yazıyor ve
      // güncel fiyat İLK olandır; sembol tablosu sırasına göre seçmek yanlış
      // tutarı (liste fiyatını) fiyat sayardı.
      if (!best || at < best.at) best = { at, amount, currency };
    }
  }
  return best ? { amount: best.amount, currency: best.currency } : null;
}

/* ══════════════ YEREL PAZARYERİ SATIRI (DE / IN / JP) (P0-1) ══════════════════
 *
 * NEDEN AYRI TİP: `ReaderRow` (TL) ve `GlobalReaderRow` (USD) alan adlarıyla
 * para birimini söyler; DE/IN/JP satırlarının fiyatı EUR/INR/JPY'dir. Aynı alana
 * yazmak „65,00“ rakamını USD gibi okuturdu (uydurma kur).
 *
 * ÖLÇÜM (2026-10-12, gerçek Jina gövdeleri, `X-Engine: direct`):
 *   • Otto    65.330 karakter / 115 ürün linki / 30 fiyat  → okunur
 *   • Flipkart 91.000 karakter / 45 ürün linki / 85 fiyat  → okunur
 *   • Rakuten 62.432 karakter / 45 ürün linki / 156 fiyat  → okunur
 * (Trendyol, Amazon, Walmart, eBay, Etsy, Argos, Cdiscount, Mercado Livre,
 *  Allegro, Bol aynı ölçümde 82-1.428 karakter döndü: engelli.)
 */
export interface LocalReaderRow {
  title: string;
  url: string;
  imageUrl: string;
  /** Ölçülen YEREL fiyat. `null` = listede fiyat bulunamadı (uydurulmaz). */
  price: number | null;
  /** Ölçülen fiyatın ISO para birimi (EUR / INR / JPY). */
  currency: string;
  /** Puan DEĞERİ listede sayı olarak varsa; yoksa `null` (yıldızlar görsel). */
  rating: number | null;
  /** Değerlendirme SAYISI (varsa). */
  ratingCount: number | null;
  site: "Otto" | "Flipkart" | "Rakuten";
}

/**
 * OTTO (DE) arama sayfası (Jina Markdown).
 *
 * Ölçülen kart düzeni (tek ürün = ardışık satır bloğu):
 *   `[](https://www.otto.de/p/<slug>-S08AV0LJ/)`
 *   `![Image 6: Vinsun Isolierflasche …](https://i.otto.de/i/otto/…?$responsive_ft2$)`
 *   `Vinsun Isolierflasche …`   ← görünür başlık
 *   `(24)`                       ← değerlendirme SAYISI
 *   `ab 27,99 €`                  ← „ab“ = en düşük varyant fiyatı
 * Başlık görselin `alt` metnindedir (link metni BOŞTUR — ölçüldü). Puan DEĞERİ
 * listede sayı olarak yoktur: `rating` `null` kalır (yıldızlar görseldir).
 */
export function parseOtto(md: string): LocalReaderRow[] {
  const out: LocalReaderRow[] = [];
  const seen = new Set<string>();
  const lines = String(md ?? "").split("\n");
  const cardLink = /\]\((https:\/\/www\.otto\.de\/p\/[^)\s"]+)\)/;
  for (let i = 0; i < lines.length; i += 1) {
    const link = cardLink.exec(lines[i]);
    if (!link || !lines[i].trimStart().startsWith("[")) continue;
    const url = link[1];
    if (seen.has(url)) continue;
    const body: string[] = [lines[i]];
    for (let j = i + 1; j < Math.min(lines.length, i + 18); j += 1) {
      if (cardLink.test(lines[j])) break;
      body.push(lines[j]);
    }
    const text = body.join("\n");
    const img = /!\[Image \d+:\s*([^\]]{6,240})\]\((https:\/\/i\.otto\.de\/[^)\s]+)\)/.exec(text);
    const title = cleanTitle(img?.[1] ?? "");
    if (title.length < 6) continue;
    const price = /(?:ab\s*)?([0-9][0-9.,]*)\s*€/.exec(text);
    const count = /\((\d{1,6})\)/.exec(text);
    seen.add(url);
    out.push({
      title,
      url,
      imageUrl: img?.[2] ?? "",
      price: price ? parseAmount(price[1]) : null,
      currency: "EUR",
      rating: null,
      ratingCount: count ? Number(count[1]) : null,
      site: "Otto",
    });
  }
  return out;
}

/**
 * FLIPKART (IN) arama sayfası (Jina Markdown).
 *
 * Ölçülen kart düzeni (tek satırda kart başlığı, ardından ayrı satırlarda meta):
 *   `[![Image 4: cello Lifestyle …](https://rukminim2.flixcart.com/image/…)]
 *     (https://www.flipkart.com/<slug>/p/itmd7cfe73d848b1?pid=…)`
 *   `4.2![Image 5](blob:…)`  ← puan
 *   `(59,871)`                ← değerlendirme sayısı
 *   `[₹579 ₹809 28% off](url)` ← BAŞTAKİ ₹ GÜNCEL fiyat, sonraki liste fiyatı
 *
 * DÜRÜSTLÜK: yalnız teklif fiyatı (ilk `₹`) alınır; liste/indirim tutarı fiyat
 * sayılmaz. Görsel `blob:` adresleri (tarayıcı içi) ATILIR.
 */
export function parseFlipkart(md: string): LocalReaderRow[] {
  const out: LocalReaderRow[] = [];
  const seen = new Set<string>();
  const lines = String(md ?? "").split("\n");
  const card =
    /\[\s*!\[Image \d+:\s*([^\]]{6,240})\]\((https:\/\/rukminim[0-9]*\.flixcart\.com\/[^)\s]+)\)\]\((https:\/\/www\.flipkart\.com\/[^)\s"]+\/p\/itm[A-Za-z0-9]+[^)\s"]*)\)/;
  for (let i = 0; i < lines.length; i += 1) {
    const match = card.exec(lines[i]);
    if (!match) continue;
    const url = match[3].split("?")[0];
    if (seen.has(url)) continue;
    const title = cleanTitle(match[1]).replace(/[.…]+$/, "").trim();
    if (title.length < 6) continue;
    const body: string[] = [];
    for (let j = i + 1; j < Math.min(lines.length, i + 22); j += 1) {
      if (card.test(lines[j])) break;
      body.push(lines[j]);
    }
    const text = body.join("\n");
    const offer = /\[₹\s?([0-9][0-9,]*)/.exec(text);
    const rating = /(?:^|\n)\s*([0-5]\.[0-9])\s*(?:!|\[Image)/.exec(text);
    const count = /\(([0-9][0-9,]{0,12})\)/.exec(text);
    seen.add(url);
    out.push({
      title,
      url,
      imageUrl: match[2],
      price: offer ? parseAmount(offer[1]) : null,
      currency: "INR",
      rating: rating ? Math.min(5, Number(rating[1])) : null,
      ratingCount: count ? Number(count[1].replace(/,/g, "")) : null,
      site: "Flipkart",
    });
  }
  return out;
}

/**
 * RAKUTEN ICHIBA (JP) arama sayfası (Jina Markdown).
 *
 * Ölçülen kart düzeni:
 *   `[![Image 13: TERMOS サーモス …](https://tshop.r10s.jp/…)](https://item.rakuten.co.jp/<shop>/<item>/)`
 *   … (kısa boşluk) …
 *   `## [TERMOS サーモス …](https://item.rakuten.co.jp/<shop>/<item>/ "TERMOS …")`
 *   `4,180 円`
 *
 * DÜRÜSTLÜK: `もっと見る`/お気に入り satırları metin sayılır ama fiyat olarak
 * OKUNMAZ (`円` aranır). Puan listede sayı olarak gelmediği için `null` kalır.
 * Aynı ürün `item.rakuten.co.jp/<shop>/<item>` adresiyle tekilleştirilir.
 */
export function parseRakuten(md: string): LocalReaderRow[] {
  const out: LocalReaderRow[] = [];
  const seen = new Set<string>();
  const lines = String(md ?? "").split("\n");
  const card =
    /\[\s*!\[Image \d+:\s*([^\]]{4,240})\]\((https:\/\/tshop\.r10s\.jp\/[^)\s]+)\)\]\((https:\/\/item\.rakuten\.co\.jp\/[^)\s"]+)\)/;
  for (let i = 0; i < lines.length; i += 1) {
    const match = card.exec(lines[i]);
    if (!match) continue;
    const url = match[3];
    if (seen.has(url)) continue;
    const title = cleanTitle(match[1]);
    if (title.length < 4) continue;
    const body: string[] = [];
    for (let j = i + 1; j < Math.min(lines.length, i + 30); j += 1) {
      if (card.test(lines[j])) break;
      body.push(lines[j]);
    }
    const text = body.join("\n");
    const price = /([0-9][0-9,]*)\s*円/.exec(text);
    const ratingCount = /([0-9][0-9,]*)\s*件のレビュー/.exec(text);
    seen.add(url);
    out.push({
      title,
      url,
      imageUrl: match[2],
      price: price ? parseAmount(price[1]) : null,
      currency: "JPY",
      rating: null,
      ratingCount: ratingCount ? Number(ratingCount[1].replace(/,/g, "")) : null,
      site: "Rakuten",
    });
  }
  return out;
}

/* ------------------------------------------------- OKUMA GÜVENİLİRLİĞİ VE KOTA */

/**
 * OKUMA ANAHTAR HAVUZU — anahtar başına 10M token, yük paylaşımlı.
 *
 * ÖLÇÜLEN SORUN: anahtarsız ücretsiz katman ~20 istek/dk. Bir arama 6 sayfa
 * okuyor (4× Hepsiburada + 1 n11 + 2 AliExpress/Newegg); 429 gelince O SAYFA
 * boş dönüyordu — yani ürün satırı ve görseli sessizce kayboluyordu.
 *
 * ÇÖZÜM: anahtarlar round-robin dağıtılır, 401/402/403/429 alan anahtar
 * ATLANIR ve sıradaki denenir. Hepsi biterse anahtarsız son bir deneme yapılır
 * (fail-soft: eski davranış korunur, tek anahtar yanlış yazıldı diye hat
 * durmaz).
 */
class ReaderHttpError extends Error {
  constructor(readonly status: number) {
    super(`reader ${status}`);
  }
}

/** Yalnız ek zaman aşımı/soket hataları "anahtar hatası" sayılmaz. */
function statusOf(err: unknown): number | null {
  return err instanceof ReaderHttpError ? err.status : null;
}

type KeyHealth = {
  ok: number;
  failed: number;
  lastStatus: number | null;
  /**
   * Bu anahtarla OKUNAN toplam karakter. Jina yanıtı markdown'dır ve kota
   * TOKEN üzerinden işler; karakter sayısı elimizdeki tek ölçümdür
   * (tahmini token = karakter / `CHARS_PER_TOKEN`).
   */
  chars: number;
  /** Kota/anahtar hatasından sonra bu anahtarın ATLANDIĞI an (ms). */
  cooldownUntil: number;
};

const keyHealth = new Map<number, KeyHealth>();
let jinaCursor = 0;

/**
 * ANAHTARSIZ (ücretsiz katman) OKUMALAR — panoda GÖRÜNMESİ gerekir.
 *
 * NEDEN: anahtar havuzu devredeyken bile `readPage` anahtarsız son bir deneme
 * yapar (hepsi 429/401 alırsa). Ayrıca kullanıcı anahtarı YANLIŞ ADLA eklerse
 * (ör. `JINA_KEY_API`) okumalar sessizce anahtarsız devam eder. Bu sayaç olmadan
 * "2 anahtarım var ama kota hiç harcanmıyor" durumu görünmez kalırdı.
 */
const anonymous = { reads: 0, failed: 0, chars: 0 };

/**
 * KOTA HATASI ALAN ANAHTARI KISA SÜRE ATLA (ölçülen sorun).
 *
 * 429 alan bir anahtara bir sonraki sayfada hemen tekrar gitmek, her seferinde
 * boşa giden bir tur + ~1 sn demekti. Anahtar 60 sn soğumaya alınır; sıradaki
 * anahtar devralır. Soğuma sonrası tekrar denenir (kalıcı karantina değil).
 */
export const KEY_COOLDOWN_MS = 60_000;

/**
 * KARAKTER→TOKEN KATSAYISI (yaklaşık).
 *
 * ÖLÇÜM (2026-10-12): bir HB arama sayfası 85.266 karakter, bir n11 sayfası
 * 58.025 karakter. Markdown gövdesinde (Türkçe + fiyat/etiket tekrarları)
 * ölçülen oran ≈ 4 karakter/token; bu yüzden kota takibi için 4 kullanılır ve
 * arayüzde "tahmini" diye etiketlenir — kesin token sayacı Jina panelindedir.
 */
export const CHARS_PER_TOKEN = 4;

/** Anahtar başına VARSAYILAN bütçe: ücretsiz Jina hesabı 10M token verir. */
export const DEFAULT_KEY_TOKEN_BUDGET = 10_000_000;

/**
 * ARAMA BAŞINA TAHMİNİ TOKEN MALİYETİ — bütçenin kaç aramaya yettiğini söyler.
 *
 * ÖLÇÜLEN (2026-10-12, aynı gün Jina'dan okunan gerçek gövdeler):
 *   • HB arama sayfası 85.266 karakter ≈ 21.300 token × 2 sayfa = 42.600
 *   • n11 arama sayfası 58.025 karakter ≈ 14.500 token × 1 sayfa = 14.500
 *   → TR araması ≈ 57.100 token (bu yüzden aşağıdaki sabit 57.000).
 * Global aramada AliExpress (~8.500) + Newegg (~20.000) sayfaları da eklenir;
 * sabit TR tabanını kullanır, yani "kalan arama" sayısı İYİMSER DEĞİL, kaba bir
 * ALT SINIR gibi okunmalıdır (panelde "tahmini" diye etiketlenir).
 */
export const TOKENS_PER_SEARCH_ESTIMATE = 57_000;

/** Anahtar başına token bütçesi (`JINA_KEY_TOKEN_BUDGET` ile değiştirilebilir). */
export function keyTokenBudget(env: Record<string, string | undefined> = process.env): number {
  const raw = Number((env["JINA_KEY_TOKEN_BUDGET"] ?? "").trim());
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_KEY_TOKEN_BUDGET;
}

/**
 * ANAHTAR SIRASI — "en az kullanılan önce", soğumadakiler en sona.
 *
 * NEDEN round-robin'e ek olarak kullanım sayısı: iki anahtarın her birinde 10M
 * token var ve arama başına maliyet ~75-100K token. Saf round-robin'de bir
 * anahtar diğerinden daha çok kota harcıyor olamaz ama YENİDEN BAŞLATMA
 * sonrası imleç sıfırlanır; kullanım sayacı başarısız (429) anahtarı da
 * geriye atarak toplam kapasiteyi korur. Kullanım eşitse imleç sırası korunur
 * (davranış değişmez, eski test geçerli kalır).
 */
export function jinaKeyOrder(
  keys: readonly string[],
  cursor: number,
  now: number = Date.now(),
): { key: string; index: number }[] {
  if (keys.length === 0) return [{ key: "", index: -1 }];
  const rotation: number[] = [];
  for (let i = 0; i < keys.length; i += 1) {
    rotation.push((((cursor + i) % keys.length) + keys.length) % keys.length);
  }
  const usage = (index: number): number => {
    const h = keyHealth.get(index);
    return h ? h.ok + h.failed : 0;
  };
  const cooling = (index: number): number => {
    const h = keyHealth.get(index);
    return h && h.cooldownUntil > now ? 1 : 0;
  };
  const position = new Map(rotation.map((index, order) => [index, order]));
  const sorted = [...rotation].sort((a, b) => {
    const ca = cooling(a);
    const cb = cooling(b);
    if (ca !== cb) return ca - cb;
    const ua = usage(a);
    const ub = usage(b);
    if (ua !== ub) return ua - ub;
    return (position.get(a) ?? 0) - (position.get(b) ?? 0);
  });
  return sorted.map((index) => ({ key: keys[index] ?? "", index }));
}

/**
 * ANAHTAR SONUCU — sayaçlar + soğuma.
 *
 * `chars`: bu denemede okunan gövde uzunluğu (başarısızda 0). Ölçüm yalnız
 * BAŞARILI okumada bütçeye yazılır; hata yanıtı kota harcamaz (gövde yoktur).
 */
function noteKeyResult(
  index: number,
  ok: boolean,
  status: number | null,
  chars = 0,
  now: number = Date.now(),
): void {
  if (index < 0) {
    if (ok) {
      anonymous.reads += 1;
      anonymous.chars += Math.max(0, chars);
    } else {
      anonymous.failed += 1;
    }
    return;
  }
  const cur = keyHealth.get(index) ?? {
    ok: 0,
    failed: 0,
    lastStatus: null,
    chars: 0,
    cooldownUntil: 0,
  };
  if (ok) {
    cur.ok += 1;
    cur.chars += Math.max(0, chars);
    cur.cooldownUntil = 0;
  } else {
    cur.failed += 1;
    cur.lastStatus = status;
    // Kota/anahtar hatalarında kısa soğuma; 404/5xx anahtar sorunu değildir.
    if (status === 401 || status === 402 || status === 403 || status === 429) {
      cur.cooldownUntil = now + KEY_COOLDOWN_MS;
    }
  }
  keyHealth.set(index, cur);
}

/**
 * KAYNAK SAYAÇLARI — "kaç sayfa okundu, kaç satır çıktı, kaçı neden düştü".
 *
 * NEDEN: fiyatsız/görselsiz satırlar havuza alınmaz (`continue`), bu YERİNDE bir
 * karar; ama sessiz kaldığında operatör "kaynak bozuk" ile "sayfa engellendi"
 * ayrımını yapamıyordu. Ölçülen örnek: HB sayfası 37 kart döndürürken yalnız
 * 12 kartta ürün görseli var — yani satırların ~%68'i görselsiz düşüyor ve bu
 * Jina katmanında değil KAYNAK sayfasında böyle.
 */
type SourceStat = {
  pages: number;
  rows: number;
  kept: number;
  droppedNoPrice: number;
  droppedNoImage: number;
  emptyPages: number;
};

const sourceStats = new Map<string, SourceStat>();

function sourceStat(site: string): SourceStat {
  const cur = sourceStats.get(site) ?? {
    pages: 0,
    rows: 0,
    kept: 0,
    droppedNoPrice: 0,
    droppedNoImage: 0,
    emptyPages: 0,
  };
  sourceStats.set(site, cur);
  return cur;
}

/** Bir sayfa okundu: kaç satır parse edildi (0 = engellendi ya da sonuç yok). */
export function noteSourcePage(site: string, rows: number): void {
  const s = sourceStat(site);
  s.pages += 1;
  s.rows += rows;
  if (rows === 0) s.emptyPages += 1;
}

/** Havuza giren (aranabilir) satır sayısı. */
export function noteSourceKept(site: string, kept: number): void {
  sourceStat(site).kept += kept;
}

/** Havuza ALINMAYAN satır — sebebiyle birlikte sayılır. */
export function noteSourceDrop(site: string, reason: "no_price" | "no_image", n = 1): void {
  const s = sourceStat(site);
  if (reason === "no_price") s.droppedNoPrice += n;
  else s.droppedNoImage += n;
}

/**
 * DEVRE KESİCİ (host başına): aynı host art arda 3 kez başarısız olursa 5 dk
 * boyunca ATLANIR. NEDEN: bir site engellediğinde (Cloudflare 403, DNS hatası)
 * her arama aynı ölü isteği tekrar tekrar deniyordu ve hattın süre bütçesini
 * ürün ÜRETEN sayfalardan çalıyordu. Kayıt yalnız süreç içindedir (sıcak
 * başlatmada sıfırlanır) — kalıcı durum gerektirmez, yanlış açık kalma riski yok.
 */
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 5 * 60_000;
const hostBreakers = new Map<string, { failures: number; openedAt: number | null }>();

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return String(url).slice(0, 40);
  }
}

export function circuitAllow(url: string, now: number = Date.now()): boolean {
  const b = hostBreakers.get(hostOf(url));
  if (!b || b.openedAt === null) return true;
  if (now - b.openedAt >= BREAKER_COOLDOWN_MS) {
    // Soğuma bitti: yarı-açık durum, tek deneme hakkı verilir.
    hostBreakers.set(hostOf(url), { failures: 0, openedAt: null });
    return true;
  }
  return false;
}

export function circuitRecord(url: string, ok: boolean, now: number = Date.now()): void {
  const host = hostOf(url);
  const b = hostBreakers.get(host) ?? { failures: 0, openedAt: null };
  if (ok) {
    hostBreakers.set(host, { failures: 0, openedAt: null });
    return;
  }
  b.failures += 1;
  if (b.failures >= BREAKER_THRESHOLD) b.openedAt = now;
  hostBreakers.set(host, b);
}

/**
 * OKUYUCU SAĞLIĞI — `/health` ve ön kontrol paneli için (yalnız sayaç; SIR YOK).
 *
 * `keys`        = bu dağıtımda kaç okuma anahtarı tanımlı (0 = anahtarsız katman).
 * `tokensEstimated` = anahtarlarla okunan TOPLAM karakter / 4 (tahmini token).
 * `searchesLeft`    = bütçe ÷ ölçülen arama başına maliyet (kaba kapasite).
 * `sources`/`drops` = kaynak başına sayfa, satır, havuza giren ve düşen satır.
 */
export function readerHealth(now: number = Date.now()): {
  keys: number;
  keysOk: number;
  keysFailed: number;
  openCircuits: string[];
  cooldownMs: number;
  tokensEstimated: number;
  budgetPerKeyTokens: number;
  budgetUsedPct: number;
  /** Tahmini kalan arama sayısı (bütçe − kullanım, arama başına ~57K token). */
  searchesLeftEstimated: number;
  /** Anahtarsız (ücretsiz katman) okumalar — anahtar yanlış adla eklenmişse buradan anlaşılır. */
  anonymous: { reads: number; failed: number; tokensEstimated: number };
  /** Jina engellediğinde devreye giren alternatif okuma sağlayıcıları. */
  alternates: { id: AltProvider; configured: boolean; reads: number; failed: number }[];
  /** Ülke başına arama maliyeti (ölçülmüş sayfa boyutlarından). */
  plan: { country: string; tokensPerSearch: number; sources: string[] }[];
  perKey: { slot: number; ok: number; failed: number; tokensEstimated: number; cooling: boolean }[];
  sources: Record<string, SourceStat>;
} {
  const keys = jinaEnvKeys().length;
  let keysOk = 0;
  let keysFailed = 0;
  let chars = 0;
  const perKey: { slot: number; ok: number; failed: number; tokensEstimated: number; cooling: boolean }[] =
    [];
  for (const [slot, h] of [...keyHealth.entries()].sort((a, b) => a[0] - b[0])) {
    keysOk += h.ok;
    keysFailed += h.failed;
    chars += h.chars;
    perKey.push({
      slot: slot + 1,
      ok: h.ok,
      failed: h.failed,
      tokensEstimated: Math.round(h.chars / CHARS_PER_TOKEN),
      cooling: h.cooldownUntil > now,
    });
  }
  const openCircuits: string[] = [];
  for (const [host, b] of hostBreakers) {
    if (b.openedAt !== null && now - b.openedAt < BREAKER_COOLDOWN_MS) openCircuits.push(host);
  }
  const budget = keyTokenBudget();
  const tokensEstimated = Math.round(chars / CHARS_PER_TOKEN);
  const totalBudget = budget * Math.max(1, keys);
  return {
    keys,
    keysOk,
    keysFailed,
    openCircuits,
    cooldownMs: BREAKER_COOLDOWN_MS,
    tokensEstimated,
    budgetPerKeyTokens: budget,
    // İki ondalık: bütçe 10M token olduğu için tek ondalıkta küçük kullanım
    // (ör. 2.500 token = %0,01) `0` görünürdü ve sayaç "çalışmıyor" sanılırdı.
    budgetUsedPct: totalBudget > 0 ? Math.round((tokensEstimated / totalBudget) * 10_000) / 100 : 0,
    searchesLeftEstimated: Math.max(
      0,
      Math.floor((totalBudget - tokensEstimated) / TOKENS_PER_SEARCH_ESTIMATE),
    ),
    anonymous: {
      reads: anonymous.reads,
      failed: anonymous.failed,
      tokensEstimated: Math.round(anonymous.chars / CHARS_PER_TOKEN),
    },
    alternates: (["firecrawl", "scrapingbee"] as const).map((id) => ({
      id,
      configured: altReaderKeys().some((entry) => entry.id === id),
      reads: altStats[id].reads,
      failed: altStats[id].failed,
    })),
    // ÜLKE-KAYNAK MATRİSİ: "bu ülkede bir arama kaç token?" — kotayı ülkeye göre
    // planlamanın tek kaynağı (rapor P0-4).
    plan: GLOBAL_SEARCH_COUNTRIES.map((country) => ({
      country,
      tokensPerSearch: readerTokensPerSearch(country),
      sources: readerPlanFor(country).map((source) => source.id),
    })),
    perKey,
    sources: Object.fromEntries(sourceStats),
  };
}

/** Testler için durum sıfırlama (üretimde çağrılmaz). */
export function resetReaderHealth(): void {
  keyHealth.clear();
  hostBreakers.clear();
  sourceStats.clear();
  anonymous.reads = 0;
  anonymous.failed = 0;
  anonymous.chars = 0;
  altStats.firecrawl = { reads: 0, failed: 0 };
  altStats.scrapingbee = { reads: 0, failed: 0 };
  jinaCursor = 0;
}

/**
 * ENGELLENMİŞ GÖVDE TESPİTİ (ölçülen hata).
 *
 * n11 taze bir aramada `direct` motoruyla **200 + 1.041 karakter** döndü ve
 * gövdesi "Attention Required! | Cloudflare" idi. Yalnız HTTP durumuna bakan
 * okuyucu bunu BAŞARILI sayıp boş bir liste üretiyordu (sessiz kayıp). Bu
 * yüzden "engelli" hem engel metninden hem de ANORMAL KISA gövdeden anlaşılır.
 */
export function looksBlocked(text: string): boolean {
  if (/Attention Required|Just a moment|Cloudflare Ray ID|Enable JavaScript and cookies/i.test(text)) {
    return true;
  }
  return text.trim().length < 2_000;
}

/** Engelli gövde de anahtar/kota hatası gibi ele alınır (sıradaki deneme). */
class ReaderBlockedError extends ReaderHttpError {
  constructor() {
    super(403);
  }
}

/* ══════════════ ALTERNATİF OKUMA SAĞLAYICILARI (ücretsiz katman) ══════════════
 *
 * NEDEN (rapor P1-8 / P2-13): bütün ürün okuması Jina'ya bağlıydı; kotası dolarsa
 * ya da bir site Jina üzerinden engellenirse hat ürün satırı üretemez. Bu blok
 * ikinci ve üçüncü bir OKUMA yolunu devreye alır — ikisi de ücretsiz katmanı olan
 * servisler ve ANAHTAR YOKSA hiç çağrılmaz (davranış değişmez):
 *   • Firecrawl   → `POST https://api.firecrawl.dev/v2/scrape` (markdown)
 *   • ScrapingBee → `GET  https://app.scrapingbee.com/api/v1/?url=…&return_page_markdown=true`
 *
 * SIRA: önce Jina (anahtarlı, sonra anahtarsız) → sonra bu sağlayıcılar. Böylece
 * ücretsiz kota ilk sırada harcanır; ağır yol yalnız GEREKTİĞİNDE çalışır.
 */
export type AltProvider = "firecrawl" | "scrapingbee";

const ALT_KEY_NAMES: Readonly<Record<AltProvider, readonly string[]>> = {
  firecrawl: ["FIRECRAWL_API_KEY", "FIRECRAWL_KEY"],
  scrapingbee: ["SCRAPINGBEE_API_KEY", "SCRAPING_BEE_API_KEY"],
};

const altStats: Record<AltProvider, { reads: number; failed: number }> = {
  firecrawl: { reads: 0, failed: 0 },
  scrapingbee: { reads: 0, failed: 0 },
};

/** Hangi alternatif sağlayıcılar TANIMLI (anahtar değeri dışarı verilmez). */
export function altReaderKeys(
  env: Record<string, string | undefined> = process.env,
): { id: AltProvider; key: string }[] {
  const out: { id: AltProvider; key: string }[] = [];
  for (const id of ["firecrawl", "scrapingbee"] as const) {
    for (const name of ALT_KEY_NAMES[id]) {
      const value = (env[name] ?? "").trim();
      if (value) {
        out.push({ id, key: value });
        break;
      }
    }
  }
  return out;
}

async function viaFirecrawl(url: string, key: string, timeoutMs: number): Promise<string> {
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: false }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new ReaderHttpError(res.status);
  const json = (await res.json().catch(() => null)) as {
    data?: { markdown?: unknown; content?: unknown };
    markdown?: unknown;
  } | null;
  const markdown = json?.data?.markdown ?? json?.markdown ?? json?.data?.content;
  if (typeof markdown !== "string" || looksBlocked(markdown)) throw new ReaderBlockedError();
  return markdown;
}

async function viaScrapingBee(url: string, key: string, timeoutMs: number): Promise<string> {
  const target = new URL("https://app.scrapingbee.com/api/v1/");
  target.searchParams.set("api_key", key);
  target.searchParams.set("url", url);
  target.searchParams.set("return_page_markdown", "true");
  const res = await fetch(target.toString(), { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new ReaderHttpError(res.status);
  const text = await res.text();
  if (looksBlocked(text)) throw new ReaderBlockedError();
  return text;
}

/**
 * SON SAVUNMA: alternatif sağlayıcılarla okuma. Anahtar yoksa `null` döner ve
 * HİÇ AĞ ÇAĞRISI yapılmaz — davranış eski hâline döner.
 */
async function readViaAlternates(
  url: string,
  timeoutMs: number,
): Promise<{ text: string; provider: AltProvider } | null> {
  for (const { id, key } of altReaderKeys()) {
    try {
      const text =
        id === "firecrawl"
          ? await viaFirecrawl(url, key, timeoutMs)
          : await viaScrapingBee(url, key, timeoutMs);
      altStats[id].reads += 1;
      circuitRecord(url, true);
      console.warn(`[discovery] ${hostOf(url)} Jina'dan okunamadı; ${id} ile okundu`);
      return { text, provider: id };
    } catch (err) {
      altStats[id].failed += 1;
      console.warn(
        `[discovery] ${id} okuması başarısız: ${String(err instanceof Error ? err.message : err).slice(0, 80)}`,
      );
    }
  }
  return null;
}

/**
 * SAYFA OKUMA — anahtar havuzu + yedekleme + devre kesici.
 *
 * DIŞA AÇIK: anahtar yedeği ve devre kesici davranışı yalnız burada yaşar;
 * ikisi de "ürün satırı kaybolmasın" sözleşmesinin parçasıdır ve doğrudan
 * ölçülebilir olmalıdır (bkz. `product-discovery-reader.keys.test.ts`).
 */
async function fetchRead(
  url: string,
  timeoutMs: number,
  engine: Engine,
  key: string,
): Promise<string> {
  const headers: Record<string, string> = {
    Accept: "text/plain",
    "X-Return-Format": "markdown",
    // "direct" motoru tarayıcı açmadan okur: ölçülen ~3,7 sn (varsayılan ~13 sn).
    // Engellenirse `readPageWithEscalation` tarayıcı motoruyla tekrar dener.
    "X-Engine": engine,
  };
  if (key) headers.Authorization = `Bearer ${key}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(READER + url, { headers, signal: ctrl.signal });
    if (!res.ok) throw new ReaderHttpError(res.status);
    const text = await res.text();
    if (looksBlocked(text)) throw new ReaderBlockedError();
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * SAYFA OKUMA — anahtar havuzu + yedekleme + devre kesici.
 *
 * DIŞA AÇIK: anahtar yedeği ve devre kesici davranışı yalnız burada yaşar;
 * ikisi de "ürün satırı kaybolmasın" sözleşmesinin parçasıdır ve doğrudan
 * ölçülebilir olmalıdır (bkz. `product-discovery-reader.keys.test.ts`).
 */
export async function readPage(
  url: string,
  timeoutMs: number,
  engine: Engine = "direct",
): Promise<string> {
  if (!circuitAllow(url)) {
    console.warn(`[discovery] okuyucu devre kesici açık: ${hostOf(url)} — bu koşuda atlandı`);
    throw new Error(`reader circuit open: ${hostOf(url)}`);
  }
  const keys = jinaEnvKeys();
  const order = jinaKeyOrder(keys, jinaCursor);
  if (keys.length > 0) jinaCursor = (jinaCursor + 1) % keys.length;

  let lastError: unknown = null;
  let sawAuthFailure = false;
  for (const { key, index } of order) {
    try {
      const text = await fetchRead(url, timeoutMs, engine, key);
      // Kota ölçümü: okunan gövde bu anahtarın bütçesine yazılır.
      noteKeyResult(index, true, null, text.length);
      circuitRecord(url, true);
      return text;
    } catch (err) {
      lastError = err;
      const status = statusOf(err);
      noteKeyResult(index, false, status);
      // YALNIZ anahtar/kota hatalarında sıradaki anahtar denenir
      // (401/402/403/429). 404/5xx ve ağ hataları anahtar sorunu DEĞİLDİR:
      // aynı isteği başka anahtarla tekrarlamak bütçeyi boşa harcar.
      if (status === 401 || status === 402 || status === 403 || status === 429) {
        sawAuthFailure = true;
        continue;
      }
      break;
    }
  }
  // SON SAVUNMA: anahtarsız istek (ücretsiz katman) — YALNIZ anahtar/kota
  // hatası görüldüğünde. Sayfa yoksa (404) veya sunucu hatasıysa (5xx) bu
  // deneme anlamsızdır: aynı yanıtı alır ve boşa istek olur.
  if (keys.length > 0 && sawAuthFailure) {
    try {
      const text = await fetchRead(url, timeoutMs, engine, "");
      noteKeyResult(-1, true, null, text.length);
      circuitRecord(url, true);
      return text;
    } catch (err) {
      lastError = err;
      noteKeyResult(-1, false, statusOf(err));
    }
  }
  // SON SAVUNMA 2: alternatif sağlayıcı (Firecrawl/ScrapingBee). ÜRÜN SATIRI
  // KAYBETMEMEK için: buraya düşen istek "kaynak bozuk" değil, "Jina bu sayfayı
  // ver(e)medi" demektir ve o sayfanın satırları sessizce yok olurdu.
  const alternate = await readViaAlternates(url, timeoutMs);
  if (alternate) return alternate.text;
  circuitRecord(url, false);
  throw lastError instanceof Error ? lastError : new Error("reader failed");
}

/**
 * SAYFA BÜTÇESİ — `direct` motor n11'de engellenirse tarayıcı motoruna yükselt.
 *
 * ÖLÇÜM (2026-10-12, niş = "termos", TAZE sayfa):
 *   `direct`  → engellendi: 1.041 karakter + "Attention Required! | Cloudflare"
 *   `browser` → 200, 62.596 karakter, 40 gerçek ürün bağlantısı
 * Aynı gün önbellekteki sayfada direct 200/58.025 karakter döndüğü için
 * "direct her zaman çalışır" varsayımı yanlıştı. Bu yüzden SIRA ŞUDUR: önce
 * ucuz motor, engellenirse pahalı motor — ve yalnız TEK yükseltme yapılır.
 */
export async function readPageWithEscalation(
  url: string,
  timeoutMs: number,
  primary: Engine = "direct",
): Promise<{ text: string; engine: Engine }> {
  try {
    return { text: await readPage(url, timeoutMs, primary), engine: primary };
  } catch (err) {
    if (primary !== "direct") throw err;
    console.warn(
      `[discovery] okuyucu ${hostOf(url)} ${primary} motorunda okunamadı (${String(
        err instanceof Error ? err.message : err,
      ).slice(0, 60)}) — tarayıcı motoruna yükseltiliyor`,
    );
    const text = await readPage(url, PER_SITE_BROWSER_TIMEOUT_MS, "browser");
    return { text, engine: "browser" };
  }
}

/**
 * SAYFA BÜTÇESİ — bir aramada kaç HB sayfası okunacak.
 *
 * NEDEN 4 YERİNE 2 (ölçüm, 2026-10-12, niş = "bardak"):
 *   • Her HB sayfası 85.266 karakter ≈ 21.300 token.
 *   • 4 sayfa = ~85.000 token/arama; 10M token bütçeli BİR anahtarla
 *     yalnız ~117 arama yapılabiliyordu.
 *   • 4 sayfa 144 benzersiz ürün verirken 2 sayfa 74 ürün veriyor — ama vitrine
 *     giren GERÇEK sayı görsel kapısından geçen satırlardır (ölçülen: 37
 *     kartın 12'si) ve ilk 2 sayfa havuzun tamamını doldurmaya yetiyor.
 * Yani ürün kaybı ölçülemezken token tasarrufu kesin: arama başına ~%50.
 * İstenirse `DISCOVERY_READER_PAGES=4` ile eski davranışa dönülür (1..6).
 */
export const DEFAULT_TR_PAGES = 2;

export function readerPageBudget(env: Record<string, string | undefined> = process.env): number {
  const value = (env["DISCOVERY_READER_PAGES"] ?? "").trim();
  // BOŞ/BOZUK DEĞER = "AYARLANMADI". Tanımsız env boş dize verir ve `Number("")`
  // 0'dır; doğrudan aralığa kırpılırsa bütçe sessizce 1 sayfaya düşerdi
  // (varsayılan 2 yerine) — yani bir yazım hatası havuzu yarıya indirirdi.
  if (!value) return DEFAULT_TR_PAGES;
  const raw = Number(value);
  if (!Number.isFinite(raw)) return DEFAULT_TR_PAGES;
  return Math.min(6, Math.max(1, Math.round(raw)));
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
  // MOTOR SEÇİMİ — ÖLÇÜLDÜ (2026-10-12, iki ayrı gün):
  //   n11 önbellekli sayfa: `direct` 200 / 58.025 karakter (tarayıcı ile AYNI)
  //   n11 taze sayfa:       `direct` 1.041 karakter + Cloudflare engeli
  //                         `browser` 200 / 62.596 karakter / 40 ürün linki
  // Yani "direct" ne her zaman çalışır ne her zaman düşer: ÖNCE ucuz motor,
  // engellenirse tarayıcı motoru (`readPageWithEscalation`). Böylece çalışan
  // durumda 20 sn'lik tarayıcı tavanına hiç girilmez.
  const pages = Math.max(1, readerPageBudget());
  const hbJobs: Array<Promise<ReaderRow[]>> = [];
  for (let page = 1; page <= pages; page += 1) {
    const url = `https://www.hepsiburada.com/ara?q=${enc}${page > 1 ? `&sayfa=${page}` : ""}`;
    hbJobs.push(
      readPage(url, PER_SITE_TIMEOUT_MS).then((md) => {
        const parsed = parseHepsiburada(md);
        noteSourcePage("Hepsiburada", parsed.length);
        if (parsed.length === 0) {
          console.warn(`[discovery] tr-reader HB sayfa ${page}: 0 satır (engellendi ya da sonuç yok)`);
        }
        return parsed;
      }),
    );
  }
  const jobs: Array<Promise<ReaderRow[]>> = [
    ...hbJobs,
    readPageWithEscalation(`https://www.n11.com/arama?q=${enc}`, PER_SITE_TIMEOUT_MS)
      .then(({ text }) => {
        const parsed = parseN11(text);
        noteSourcePage("n11", parsed.length);
        if (parsed.length === 0) {
          console.warn("[discovery] tr-reader n11: 0 satır (engellendi ya da sonuç yok)");
        }
        return parsed;
      })
      .catch((err) => {
        console.warn(`[discovery] tr-reader n11 okunamadı: ${String(err).slice(0, 100)}`);
        return [] as ReaderRow[];
      }),
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
    // Fiyatsız/görselsiz satır "kazanan ürün" olamaz (marj ve vitrin görseli
    // ölçülemez) — bu karar korunur, ama NEDEN düştüğü artık SAYILIR.
    // Ölçülen olgu: HB sayfası 37 kart döndürürken yalnız 12'sinde ürün görseli
    // var; satır kaybının %68'i görsel kapısında. Sessiz kalırsa operatör
    // "kaynak bozuk" ile "sayfa engellendi" ayrımını yapamıyordu.
    if (r.priceTry === null) {
      noteSourceDrop(r.site, "no_price");
      continue;
    }
    if (!r.imageUrl) {
      noteSourceDrop(r.site, "no_image");
      continue;
    }
    noteSourceKept(r.site, 1);
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
    pages.map((u) =>
      readPage(u, PER_SITE_TIMEOUT_MS).then((md) => {
        const parsed = parseAliExpress(md);
        noteSourcePage("AliExpress", parsed.length);
        if (parsed.length === 0) {
          console.warn(`[discovery] ali-reader boş sayfa: ${u.slice(0, 70)}`);
        }
        return parsed;
      }),
    ),
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
    // vitrinin şartı; ikisi de ölçülmüş alandır, uydurulmaz. Sebep sayılır.
    if (r.priceUsd === null) {
      noteSourceDrop(r.site, "no_price");
      continue;
    }
    if (!r.imageUrl) {
      noteSourceDrop(r.site, "no_image");
      continue;
    }
    noteSourceKept(r.site, 1);
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
    pages.map((u) =>
      readPage(u, PER_SITE_TIMEOUT_MS).then((md) => {
        const parsed = parseNewegg(md);
        // ÖLÇÜLEN ayrım: "ssd" araması 45 kart verirken "bardak" araması
        // 16.598 karakterlik SONUÇSUZ sayfa döndü. İkisi de 0 satır üretir ama
        // biri hata değildir; uyarı metni bunu "sonuç yok" diye açıkça söyler.
        noteSourcePage("Newegg", parsed.length);
        if (parsed.length === 0) {
          console.warn(`[discovery] newegg-reader boş sayfa: ${u.slice(0, 70)}`);
        }
        return parsed;
      }),
    ),
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
    // vitrine giremez. İkisi de ölçülmüş alan — uydurulmaz. Sebep sayılır.
    if (r.priceUsd === null) {
      noteSourceDrop(r.site, "no_price");
      continue;
    }
    if (!r.imageUrl) {
      noteSourceDrop(r.site, "no_image");
      continue;
    }
    noteSourceKept(r.site, 1);
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

/* ══════════════ YEREL GLOBAL OKUYUCULAR (Otto / Flipkart / Rakuten) ══════════
 *
 * NEDEN (ölçülen gerçek, 2026-10-12, hepsi Jina `direct` motoru):
 *   • Otto (DE)     65.330 karakter / 115 ürün linki / 30 fiyat  → okunabilir
 *   • Flipkart (IN) 91.000 karakter /  45 ürün linki / 85 fiyat  → okunabilir
 *   • Rakuten (JP)  62.432 karakter /  45 ürün linki / 156 fiyat → okunabilir
 * Buna karşılık Amazon (US/DE), Walmart, eBay, Etsy, Trendyol, Argos, Cdiscount,
 * Mercado Livre, Allegro ve Bol AYNI ölçümde 82-1.428 karakter döndürdü: engelli.
 * Yani "global" hedefinde bugün okunabilen üç pazar yeri bunlardır ve her biri
 * ÜLKE KAPISIYLA çağrılır (Fransa aramasında Otto okumak kotayı boşa harcar).
 *
 * SAYFA BAŞINA TOKEN (ölçülen karakter/4): Otto ~16.300 · Flipkart ~22.800 ·
 * Rakuten ~15.600. Her sitede TEK sayfa okunur — çok sayfa yerine çok ülke.
 */
export type LocalSite = "otto" | "flipkart" | "rakuten";

type LocalSiteConfig = {
  label: LocalReaderRow["site"];
  source: string;
  /** Bu okumanın ANLAMLI olduğu ülkeler (ISO). */
  countries: readonly string[];
  /** Ölçülen arama başına token (karakter/4). */
  tokensPerSearch: number;
  pageUrl: (encodedNiche: string) => string;
  parse: (markdown: string) => LocalReaderRow[];
};

export const LOCAL_SITES: Readonly<Record<LocalSite, LocalSiteConfig>> = {
  otto: {
    label: "Otto",
    source: "otto-reader",
    countries: ["DE", "AT", "CH"],
    tokensPerSearch: 16_300,
    pageUrl: (q) => `https://www.otto.de/suche/${q}/`,
    parse: parseOtto,
  },
  flipkart: {
    label: "Flipkart",
    source: "flipkart-reader",
    countries: ["IN"],
    tokensPerSearch: 22_800,
    pageUrl: (q) => `https://www.flipkart.com/search?q=${q}`,
    parse: parseFlipkart,
  },
  rakuten: {
    label: "Rakuten",
    source: "rakuten-reader",
    countries: ["JP"],
    tokensPerSearch: 15_600,
    pageUrl: (q) => `https://search.rakuten.co.jp/search/mall/${q}/`,
    parse: parseRakuten,
  },
};

/**
 * Bir yerel pazaryerini okur ve ÖLÇÜLMÜŞ alanları ham ürün satırına çevirir.
 *
 * KURALLAR (diğer okuyucularla aynı): fiyatsız/görselsiz satır havuza girmez,
 * sebep sayılır; fiyat GERÇEK kurla USD'ye çevrilir (`toUsd`); kur alınamazsa
 * `priceUsd` `null` olur ve satır bu yüzden düşer (uydurma kur YOK).
 */
export async function scrapeLocalMarketplace(
  site: LocalSite,
  niche: string,
): Promise<RawProduct[]> {
  const config = LOCAL_SITES[site];
  const q = String(niche ?? "")
    .trim()
    .slice(0, 80);
  if (!q) return [];
  const { cacheGet, cacheKey, cacheSet } = await import("./ai-cache.server");
  const key = await cacheKey(`${config.source}:v1`, [q.toLocaleLowerCase("tr-TR")]);
  const hit = await cacheGet<RawProduct[]>(key).catch(() => null);
  if (hit && hit.length) return hit;

  const url = config.pageUrl(encodeURIComponent(q));
  const settled = await readPageWithEscalation(url, PER_SITE_TIMEOUT_MS)
    .then(({ text }) => config.parse(text))
    .catch((err) => {
      console.warn(`[discovery] ${config.source} okunamadı: ${String(err).slice(0, 100)}`);
      return [] as LocalReaderRow[];
    });
  noteSourcePage(config.label, settled.length);
  if (settled.length === 0) {
    console.warn(`[discovery] ${config.source} boş sayfa: ${url.slice(0, 70)}`);
  }

  const { toUsd } = await import("./fx-rates.server");
  const stamp = priceStamp();
  const products: RawProduct[] = [];
  for (const row of settled) {
    if (row.price === null) {
      noteSourceDrop(config.label, "no_price");
      continue;
    }
    if (!row.imageUrl) {
      noteSourceDrop(config.label, "no_image");
      continue;
    }
    const usd = await toUsd(row.price, row.currency);
    if (usd === null) {
      // Kur alınamadı: fiyatı USD sanmak uydurma olurdu, satır havuza girmez.
      noteSourceDrop(config.label, "no_price");
      continue;
    }
    noteSourceKept(config.label, 1);
    products.push({
      title: row.title,
      brand: "",
      seller: config.label,
      priceUsd: usd,
      rating: row.rating,
      ratingCount: row.ratingCount,
      inStock: true,
      source: config.source,
      url: row.url,
      imageUrl: row.imageUrl,
      salesVolume: null,
      notes: [
        config.label,
        `${row.price.toLocaleString("tr-TR")} ${row.currency}` + ` ≈ $${usd}`,
        row.rating !== null ? `puan ${row.rating}/5` : "",
        row.ratingCount !== null && row.ratingCount > 0
          ? `${row.ratingCount.toLocaleString("tr-TR")} değerlendirme`
          : "",
        stamp,
      ]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 200),
    });
  }
  if (products.length) {
    await cacheSet(key, `${config.source}:v1`, products, CACHE_TTL_MS).catch(() => {});
  }
  return products;
}

/* ══════════════ ÜLKE-KAYNAK MATRİSİ VE TOKEN BÜTÇESİ (P0-4) ══════════════
 *
 * NEDEN: "global site" demek her aramada TÜM okuyucuları koşmak değildir. Ölçülen
 * sayfa boyutlarıyla arama maliyeti şöyle: TR 57K · US 57K (AE+Newegg) ·
 * DE 33K (AE+Otto) · IN 40K (AE+Flipkart) · JP 33K (AE+Rakuten) token. Yani
 * ülkeye göre okuma yapmak, aynı bütçeyle 2-3 KAT fazla arama demektir.
 * Bu tablo hem kaynak seçimini kapılar hem de /health'te bütçeyi görünür kılar.
 */
export const READER_SOURCES: readonly {
  id: string;
  label: string;
  /** `*` = ülkeden bağımsız. */
  countries: readonly string[];
  /** Ölçülen arama başına token. */
  tokensPerSearch: number;
}[] = [
  { id: "tr-reader", label: "Hepsiburada + n11", countries: ["TR"], tokensPerSearch: 57_000 },
  { id: "aliexpress-reader", label: "AliExpress", countries: ["*"], tokensPerSearch: 17_000 },
  {
    id: "newegg-reader",
    label: "Newegg",
    countries: ["US", "CA", "GB", "AU", "NZ", "IE"],
    tokensPerSearch: 40_000,
  },
  { id: "otto-reader", label: "Otto", countries: ["DE", "AT", "CH"], tokensPerSearch: 16_300 },
  { id: "flipkart-reader", label: "Flipkart", countries: ["IN"], tokensPerSearch: 22_800 },
  { id: "rakuten-reader", label: "Rakuten", countries: ["JP"], tokensPerSearch: 15_600 },
];

/** Ülke kodunu normalize eder (boş/„global“ → ""). */
export function normalizeCountry(country: string): string {
  return String(country ?? "")
    .trim()
    .toUpperCase();
}

/** Bu ülke için KOŞACAK okuyucular. Ülke bilinmiyorsa yalnız `*` kaynakları. */
export function readerPlanFor(country: string): {
  id: string;
  label: string;
  tokensPerSearch: number;
}[] {
  const code = normalizeCountry(country);
  return READER_SOURCES.filter((source) =>
    code ? source.countries.includes("*") || source.countries.includes(code) : source.countries.includes("*"),
  ).map(({ id, label, tokensPerSearch }) => ({ id, label, tokensPerSearch }));
}

/** Bu ülkedeki bir aramanın TAHMİNİ token maliyeti (ölçülmüş sayfa boyutlarından). */
export function readerTokensPerSearch(country: string): number {
  return readerPlanFor(country).reduce((total, source) => total + source.tokensPerSearch, 0);
}

/** `GLOBAL` seçildiğinde (ülke kodları dışı) koşan kaynakların ortak zemini. */
export const GLOBAL_SEARCH_COUNTRIES = ["US", "TR", "DE", "IN", "JP", "GB", "FR", "BR"] as const;
