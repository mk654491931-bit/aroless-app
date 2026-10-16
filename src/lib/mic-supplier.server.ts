// ============================================================================
// TEDARİK KANITI — İKİNCİ ANAHTARSIZ KAYNAK: made-in-china.com (Çin toptan).
//
// NEDEN VAR (ölçülen boşluk, 2026-10-16):
//   Tek tedarik kaynağı AliExpress'ti ve üç yuvayı ASLA ölçemiyordu:
//     1. **MOQ** (minimum sipariş adedi) — "bu ürünü gerçekten atabilir miyim?"
//        sorusunun cevabı; AliExpress perakende kartı MOQ taşımaz.
//     2. **Tedarikçi kimliği** — AliExpress kartında mağaza adı yalnız SPONSORLU
//        kartlarda var (ölçüldü: 60 kartın 10'u).
//     3. **FOB fiyat BANDI** — Alibaba/AliExpress kartında tek fiyat var;
//        toptan ilanda fiyat miktara göre ARALIK olarak yazılır.
//
// CANLI ÖLÇÜM (bu sandbox, 2026-10-16, sıcak sayfa başına tek istek):
//   niş                 | HTTP | boyut   | süre  | kart | fiyatlı | MOQ | tedarikçi
//   air fryer           | 200  | 1346 KB | 0.85s |  37  |   37    | 22  |   22
//   led desk lamp       | 200  | 1189 KB | 0.42s |  30  |   30    | 30  |   29
//   wireless earbuds    | 200  | 1139 KB | 0.85s |  25  |   25    | 25  |   25
//   cat scratching board| 200  | 1339 KB | 0.89s |  41  |   41    | 30  |   30
//   yoga mat            | 200  | 1191 KB | 1.24s |  24  |   22    | 24  |   23
//   pet water fountain  | 200  | 1155 KB | 0.76s |  30  |   30    | 30  |   30
//   → 6/6 nişte ürün döndü; MOQ %81-100, tedarikçi adı %80-100 oranında ölçüldü.
//   Aynı gün ölçülen ve ÇALIŞMAYAN yollar: `m.made-in-china.com` (mobil arama
//   kartları farklı şema), `products-search/hot-china-products` (kart şeması
//   sürümden sürüme değişiyor). Seçilen URL `productdirectory.do` aramasıdır.
//
// İKİ KART ŞEMASI VAR (ikisi de bu dosyada ayrıştırılır — ölçüldü):
//   A) `<div class="list-node">` → `<h2 class="product-name" title="…">` +
//      `<a class="product-detail" href="…/product/ID/Slug.html">` +
//      `<div class="product-property">` içinde FOB aralığı ve `(MOQ)`.
//   B) `<a class="prod-item" …>` bloğu → `<a class="prod-name" title="…">` +
//      `<a class="prod-price" title="…">`; MOQ aynı `(MOQ)` ipucuyla gelir.
//   Şemaya göre dallanmak yerine KART SINIRINDA bölünür ve iki düzenin ortak
//   işaretleri (fiyat/MOQ/şirket) aranır: MIC markup'ı sık değiştiği için
//   tek şemaya bağlanmak, o şema değiştiğinde kaynağı tümden sustururdu.
//
// DÜRÜSTLÜK KURALLARI (dosyanın tamamı geçerli — `aliexpress-supplier.server.ts`
// ile aynı sözleşme):
//   • Yalnız SAYFADA YAZAN sayılar okunur; yoksa `null`'dur ve arayüz "—" yazar.
//   • Kargo ücreti, gümrük ve komisyon sayfada YOKTUR → ölçülmez, uydurulmaz.
//   • Fiyat ARALIĞI tek sayıya indirgenmez: alt uç `unitPriceUsd`, üst uç
//     `unitPriceHighUsd` olarak birlikte taşınır. Tek uç göstermek, sipariş
//     adedine göre değişen FOB fiyatını "tek gerçek" gibi sunmak olurdu.
//   • MOQ, ARKASINDA `(MOQ)` ipucu olmadan kabul EDİLMEZ: aynı sayfa
//     "50000pieces/Year" gibi YILLIK KAPASİTE yazar; onu minimum sipariş
//     sanmak kullanıcıya yanlış sermaye rakamı gösterirdi.
//   • Bu kaynak ÜRÜN LİSTESİ üretmez (`RawProduct` DEĞİL, `MicOffer` döner) ve
//     `PRODUCT_SOURCES`'a GİRMEZ — toptan satır perakende ürün değildir.
// ============================================================================

import { measuredMoney } from "./economics-evidence";
import { englishProductQuery, productQueryVariants } from "./product-discovery-query";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

/** Toptan teklif önbelleği: 24 saat (AliExpress kaynağıyla aynı politika). */
const MIC_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Tek kart bloğunun azami uzunluğu.
 *
 * ÖLÇÜLEN HATA (2026-10-16, canlı "air fryer"): kart bloğu 6 KB'da kesiliyordu ve
 * list-node kartları ~37 KB olduğu için KARTIN KUYRUĞU (FOB + MOQ + tedarikçi
 * firma bağlantısı) kesiliyordu. Ölçülen sonuç: 30 gerçek kartın yalnız 12'sinde
 * tedarikçi adı okunabiliyordu; sınır kaldırıldıktan sonra 29/30.
 * Sınır yine de vardır: sonsuz/bozuk bir gövdede belleği korumak için.
 */
const MAX_CARD_CHARS = 60_000;

/**
 * ÖLÇÜLMÜŞ toptan teklif (made-in-china.com kartı).
 *
 * `unitPriceUsd` FOB bandının ALT ucu, `unitPriceHighUsd` ÜST ucudur (aralık
 * yoksa `null`). `moqUnits`/`moqUnit` yalnız sayfada `(MOQ)` ipucu bulunan
 * satırlardan gelir; okunamazsa `null`/`""` olur.
 */
export type MicOffer = {
  title: string;
  unitPriceUsd: number | null;
  unitPriceHighUsd: number | null;
  /** Ölçülen minimum sipariş adedi. `null` = sayfada yok. */
  moqUnits: number | null;
  /** MOQ birimi ("pieces", "sets"…). Boş olabilir. */
  moqUnit: string;
  /** Ölçülen tedarikçi firma adı (kartın kendi şirket bağlantısı). */
  store: string;
  /**
   * Kargo çıkış ülkesi — MIC arama kartı bunu YAZMAZ. Alan tip uyumu için
   * vardır ve bu kaynağın ölçmediği açıkça boş bırakılır (uydurulmaz).
   */
  shipFrom: string;
  url: string;
  imageUrl: string;
};

const stripTags = (value: string): string =>
  String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();

/** Protokolsüz (`//…`) ve sorgu parametreli adresleri tek biçime indirger. */
const absoluteUrl = (value: string): string => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const withProto = raw.startsWith("//") ? `https:${raw}` : raw;
  return withProto.split("?")[0];
};

/**
 * Kart sınırlarını bulur: `list-node` (şema A) ve `prod-item` (şema B).
 *
 * ÖLÇÜLEN SEBEP: ilk sürüm yalnız `prod-item` sınırında bölüyordu ve
 * `led desk lamp`/`wireless earbuds` sorgularında **0 kart** döndürdü — sayfa
 * şema A (`list-node`) ile gelmişti. Her iki sınır da taranır.
 */
export function micCardBlocks(html: string): string[] {
  const marks: number[] = [];
  // `list-node` sınırı İÇ KAP `list-node-content` ile KARIŞTIRILMAMALI:
  // `\b` ikisini de yakalar (`-` kelime sınırıdır) ve ölçüldü: 2 kartlık sayfa
  // 3 blok üretiyordu, yani kartlar ORTADAN bölünüyordu.
  const re = /class="(?:list-node|prod-item)(?![-\w])/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) marks.push(match.index);
  return marks.map((start, i) =>
    html.slice(
      start,
      i + 1 < marks.length
        ? Math.min(marks[i + 1], start + MAX_CARD_CHARS)
        : start + MAX_CARD_CHARS,
    ),
  );
}

/**
 * Ham HTML → `MicOffer[]`. SAF fonksiyon (ağ YOK) — bu yüzden test edilebilir.
 *
 * Kart, ürün ADI veya ürün BAĞLANTISI taşımıyorsa ATLANIR; yarım karttan
 * "teklif" üretmek eşleştirmeye sahte kanıt sokardı.
 */
export function extractMicOffers(html: string): MicOffer[] {
  // Uzunluk eşiği DEĞİL, kart işareti aranır: kaydırılmış/daraltılmış bir gövde
  // (test fixture'ı gibi) de ayrıştırılabilmeli, ama HTML olmayan kısa metin
  // üzerinde regex avına çıkılmamalı. Kart yoksa döngü zaten boş döner.
  if (!html || html.length < 200) return [];
  const offers: MicOffer[] = [];
  const seen = new Set<string>();

  for (const block of micCardBlocks(html)) {
    const titleMatch =
      /class="product-name"[^>]*title="([^"]+)"/.exec(block) ??
      /class="prod-name[^"]*"[^>]*title="([^"]+)"/.exec(block);
    let title = titleMatch ? stripTags(titleMatch[1]) : "";
    if (!title) {
      // Son çare: kartın görsel `alt` metni (şema A'da başlık `title`
      // özniteliğinde de olur; şema değişirse alt metin aynı ürünü taşır).
      const alt = /class="prod-img"[^>]*alt="([^"]*)"/.exec(block);
      title = alt ? stripTags(alt[1]) : "";
    }

    const href = /href="([^"]*\/product\/[^"]+\.html)"/.exec(block);
    const url = href ? absoluteUrl(href[1]) : "";
    if (!title || !url) continue;
    if (seen.has(url)) continue;
    seen.add(url);

    const price =
      /<strong class="price">US\$<span>([\d.,]+)<\/span>(?:-<span>([\d.,]+)<\/span>)?/.exec(block);
    // MOQ: sayının ARKASINDA `(MOQ)` ipucu ŞART (yıllık kapasite satırı aynı
    // biçimde yazılıyor: "50000pieces/Year").
    const moq = />([\d,]+)\s*([A-Za-z]+)\s*<span class="price_hint">\s*\(MOQ\)/.exec(block);
    const store = /class="compnay-name[^"]*"[^>]*>([\s\S]{0,200}?)<\/a>/.exec(block);
    const img = /class="prod-img"[^>]*(?:src|lazy-src|data-original)="([^"]*)"/.exec(block);

    const moqUnits = moq ? Number(moq[1].replace(/,/g, "")) : null;
    const storeName = store ? stripTags(store[1]) : "";
    const imageUrl = img ? absoluteUrl(img[1]) : "";

    offers.push({
      title,
      unitPriceUsd: price ? measuredMoney(price[1]) : null,
      unitPriceHighUsd: price ? measuredMoney(price[2]) : null,
      // Şağma denetimi: 1..10.000.000 dışındaki "MOQ" bir yazım hatasıdır ve
      // sermaye hesabını çöpe çevirirdi; okunamamış sayılır.
      moqUnits:
        moqUnits !== null && Number.isFinite(moqUnits) && moqUnits >= 1 && moqUnits <= 10_000_000
          ? moqUnits
          : null,
      moqUnit: moq ? moq[2].toLowerCase() : "",
      // Şirket adı çok uzun/gürültülü geldiyse boş bırakılır: kırpılmış bir
      // "ad" göstermek yanlış tedarikçiyi tanıtmak olurdu.
      store: storeName.length > 0 && storeName.length <= 120 ? storeName : "",
      shipFrom: "",
      url,
      imageUrl,
    });
  }

  return offers;
}

/* ------------------------------------------------------------------- Ağ katmanı */

/** Niş → MIC arama terimi (İngilizce; çeviri `product-discovery-query`den). */
export function micSearchQuery(niche: string): string {
  const base =
    englishProductQuery(niche) || productQueryVariants(niche)[0] || String(niche ?? "").trim();
  return base.replace(/\s+/g, " ").slice(0, 80);
}

export function micSearchUrl(niche: string): string {
  const word = micSearchQuery(niche);
  if (!word) return "";
  const encoded = encodeURIComponent(word).replace(/%20/g, "+");
  return `https://www.made-in-china.com/productdirectory.do?word=${encoded}&subaction=hunt&style=b&mode=and&code=0&order=0&isOpenCorrection=1`;
}

/**
 * Canlı toptan teklifleri getirir. Hata fırlatır (hat fail-soft yakalar).
 *
 * Kota: AliExpress kaynağıyla AYNI aylık kovayı (`allowSupplierCredit`) paylaşır
 * — ikisi de "tedarik kazıması"dır ve tek bütçeyi iki kaynağa bölmek, bir
 * kaynağın diğerini sessizce aç bırakmasına izin verirdi.
 */
export async function fetchMicOffers(
  niche: string,
  opts: { timeoutMs?: number } = {},
): Promise<MicOffer[]> {
  const url = micSearchUrl(niche);
  if (!url) return [];

  const { cacheGet, cacheKey, cacheSet } = await import("./ai-cache.server");
  const key = await cacheKey("mic-supplier-offers-v1", [niche]);
  const hit = await cacheGet<MicOffer[]>(key);
  if (hit) return hit;

  const { allowSupplierCredit } = await import("./scraper-quota.server");
  if ((await allowSupplierCredit()) === false) {
    console.log(`[supplier] aylık kota doldu, MIC atlandı (${niche})`);
    return [];
  }

  const res = await fetch(url, {
    signal: AbortSignal.timeout(opts.timeoutMs ?? 8_000),
    headers: {
      "user-agent": UA,
      accept: "text/html,application/xhtml+xml",
      "accept-language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const offers = extractMicOffers(await res.text());
  if (offers.length) await cacheSet(key, "mic-supplier-offers-v1", offers, MIC_CACHE_TTL_MS);
  return offers;
}
