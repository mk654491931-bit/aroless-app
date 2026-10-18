// ============================================================================
// TEDARİK KANITI — ANAHTARSIZ TOPTAN KAYNAK: made-in-china.com (Çin toptan).
//
// NEDEN VAR (ölçülen boşluk, 2026-10-16):
//   Tek tedarik kaynağı AliExpress'ti ve üç yuvayı ASLA ölçemiyordu:
//     1. **MOQ** (minimum sipariş adedi) — "bu ürünü gerçekten atabilir miyim?"
//        sorusunun cevabı; perakende kartı MOQ taşımaz.
//     2. **Tedarikçi kimliği** — AliExpress kartında mağaza adı yalnız SPONSORLU
//        kartlarda var (ölçüldü: 60 kartın 10'u).
//     3. **FOB fiyat BANDI** — toptan ilanda fiyat miktar kademesine göre ARALIK
//        olarak yazılır; tek sayı göstermek gerçeği saklar.
//
// KAYNAK UYUMU (ölçüldü, 2026-10-16 — bu kaynağın yolu buna göre seçildi):
//   `https://www.made-in-china.com/robots.txt` genel bot grubunda **`/*.do?`**
//   yolunu YASAKLIYOR. İlk sürüm `productdirectory.do?word=…` çağırıyordu, yani
//   sitenin kendi kuralına aykırıydı. Şu an kullanılan yol robots'a UYGUN:
//     `https://www.made-in-china.com/products-search/hot-china-products/<Slug>.html`
//   (sorgu dizesi yok; `/*html?*` yasağı da kapsamıyor). AliExpress'in aksine
//   burada TANITICI bot UA'sı ile aynı veri geliyor, bu yüzden taklit yerine
//   dürüst UA gönderilir:
//     `Mozilla/5.0 (compatible; ArolessProductResearch/1.0; +https://aroless.app/bot)`
//   Aynı UA ile ölçüldü (tarayıcı UA'sıyla BİREBİR aynı sonuç: 41 kart / 31 MOQ).
//
// CANLI ÖLÇÜM (uyumlu yol, dürüst bot UA'sı, 2026-10-16):
//   niş                 | HTTP | boyut  | süre  | kart | fiyatlı | aralık | MOQ | tedarikçi
//   air fryer           | 200  | 817 KB | 0,8 s |  41  |   31    |   26   | 31  |   31
//   led desk lamp       | 200  | 788 KB | 0,5 s |  30  |   30    |   24   | 30  |   30
//   pet water fountain  | 200  | 753 KB | 0,5 s |  30  |   30    |   18   | 30  |   30
//   yoga mat            | 200  | 759 KB | 0,8 s |  30  |   29    |   19   | 30  |   30
//   → Uyumlu yol, yasaklı `.do` yolundan DAHA İYİ: `air fryer` için 37 kart /
//     23 MOQ / 22 tedarikçi yerine 41 kart / 31 MOQ / 31 tedarikçi.
//   Aynı gün ölçülüp ÇALIŞMAYAN yollar: `m.made-in-china.com` (mobil kart şeması
//   farklı), `/products-search/find-china-products/*-1.html` (robots'ta yasaklı).
//
// ÜÇ KART ŞEMASI VAR (üçü de bu dosyada ayrıştırılır — ölçüldü):
//   A) `<div class="list-node">` → `<h2 class="product-name" title="…">` +
//      `<div class="product-property">` içinde FOB aralığı ve
//      `1,200 Pieces<span class="price_hint"> (MOQ)`.
//   B) `<a class="prod-item">` bloğu → `<a class="prod-name" title="…">` +
//      `<a class="prod-price">`; vitrin şeridi.
//   C) `<div class="product-name-wrap">` → `<h2 class="product-name">` İÇİNDE
//      `<a title="…">` + `<span class="moq-text">(MOQ)` (uyumlu yolun şeması).
//   Şemaya göre dallanmak yerine kart SINIRINDA bölünür ve üç düzenin ortak
//   işaretleri aranır: MIC markup'ı sık değiştiği için tek şemaya bağlanmak, o
//   şema değiştiğinde kaynağı tümden sustururdu (ölçülen hata: yalnız B şemasına
//   bağlı sürüm iki sorguda 0 kart döndürdü).
//
// DÜRÜSTLÜK KURALLARI (dosyanın tamamı geçerli — `aliexpress-supplier.server.ts`
// ile aynı sözleşme):
//   • Yalnız SAYFADA YAZAN sayılar okunur; yoksa `null`'dur ve arayüz "—" yazar.
//   • Kargo ücreti, gümrük ve komisyon sayfada YOKTUR → ölçülmez, uydurulmaz.
//   • Fiyat ARALIĞI tek sayıya indirgenmez: alt uç `unitPriceUsd`, üst uç
//     `unitPriceHighUsd` olarak birlikte taşınır.
//   • MOQ, ARKASINDA `(MOQ)` ipucu olmadan kabul EDİLMEZ: aynı sayfa
//     "50000pieces/Year" gibi YILLIK KAPASİTE yazar; onu minimum sipariş
//     sanmak kullanıcıya yanlış sermaye rakamı gösterirdi.
//   • Bu kaynak ÜRÜN LİSTESİ üretmez (`RawProduct` DEĞİL, `MicOffer` döner) ve
//     `PRODUCT_SOURCES`'a GİRMEZ — toptan satır perakende ürün değildir.
// ============================================================================

import { measuredMoney } from "./economics-evidence";
import { englishProductQuery, productQueryVariants } from "./product-discovery-query";

/**
 * TANITICI bot User-Agent.
 *
 * Tarayıcı taklidi YAPILMAZ: bu kaynakta dürüst UA ile aynı veri geliyor
 * (ölçüldü), dolayısıyla kimliği gizlemenin bir faydası yok — ve sitenin
 * kurallarına uymak için tanıtıcı olmak doğru olan.
 */
const UA = "Mozilla/5.0 (compatible; ArolessProductResearch/1.0; +https://aroless.app/bot)";

/** Toptan teklif önbelleği: 24 saat (AliExpress kaynağıyla aynı politika). */
const MIC_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Tek kart bloğunun azami uzunluğu.
 *
 * ÖLÇÜLEN HATA (2026-10-16, canlı "air fryer"): kart bloğu 6 KB'da kesiliyordu ve
 * `list-node` kartları ~37 KB olduğu için KARTIN KUYRUĞU (FOB + MOQ + tedarikçi
 * firma bağlantısı) kesiliyordu. Ölçülen sonuç: 30 gerçek kartın yalnız 12'sinde
 * tedarikçi adı okunabiliyordu; sınır kaldırıldıktan sonra 30/30.
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
 * ANA KART ŞEMASINI SEÇER — "bu sayfada asıl ürün listesi hangi işaretle geliyor?".
 *
 * NEDEN SEÇİM ŞART (ölçülen iki hatanın ikisi de buradan çıktı):
 *   1. TÜM işaretler tek listede toplanırsa bir kartın İÇİNDEKİ vitrin şeridi
 *      (`prod-item`) bloğu ortadan böler ve kartın kuyruğu (MOQ + tedarikçi)
 *      kaybolur. Ölçülen sonuç: 30 kartın yalnız 12'sinde tedarikçi adı.
 *   2. Şemalar KARIŞTIRILIRSA bloklar örtüşür ve başlık YANLIŞ karta bağlanır
 *      (ölçülen hata: vitrin bloğu, kendisinden sonra gelen kartın başlığını
 *      aldı). Blokları yalnız TEK şema üretirse örtüşme imkânsız olur.
 *
 * SIRA ÖLÇÜME DAYANIR: `product-name-wrap` (şema C, uyumlu yol) ve `list-node`
 * (şema A) asıl listeyi taşır; `prod-item` ise her ölçülen sayfada VİTRİN
 * şeridiydi (fiyatsız, MOQ'suz görsel bağlantılar; ölçüldü: 41 kartın 10'u).
 * Bu yüzden yalnız hiçbiri yoksa `prod-item` şemasına düşülür.
 */
function primaryCardKind(html: string): "product-name-wrap" | "list-node" | "prod-item" | null {
  for (const kind of ["product-name-wrap", "list-node", "prod-item"] as const) {
    if (new RegExp(`class="${kind}(?![-\\w])`).test(html)) return kind;
  }
  return null;
}

/**
 * Kart SINIRLARI — seçilen şemanın işaretleri arasında bölünür.
 */
export function micCardBlocks(html: string): string[] {
  const kind = primaryCardKind(html);
  if (!kind) return [];
  const positions: number[] = [];
  const re = new RegExp(`class="${kind}(?![-\\w])`, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) positions.push(match.index);
  return positions.map((start, i) => {
    const next = positions[i + 1];
    const end =
      next === undefined ? start + MAX_CARD_CHARS : Math.min(next, start + MAX_CARD_CHARS);
    return html.slice(start, end);
  });
}

/**
 * Kart bloğundan başlığı okur.
 *
 * ÜÇ ŞEMANIN deseni de denenir ve **EN ERKEN KONUMDAKİ** eşleşme kazanır.
 * SABİT ÖNCELİK DEĞİL (ölçülen hata): blok, bir sonraki FARKLI şema kartını da
 * içerebiliyor; sabit öncelikte (ör. "önce şema A deseni") şema C kartının
 * başlığı, kendisinden SONRA gelen şema A kartının başlığıyla değişiyordu.
 */
function titleOf(block: string): string {
  const patterns = [
    /class="product-name"[^>]*title="([^"]+)"/, // şema A
    /class="prod-name[^"]*"[^>]*title="([^"]+)"/, // şema B
    /class="product-name"[^>]*>[\s\S]{0,160}?<a[^>]*title="([^"]+)"/, // şema C
  ];
  let best: { at: number; title: string } | null = null;
  for (const re of patterns) {
    const match = re.exec(block);
    if (!match) continue;
    if (!best || match.index < best.at) best = { at: match.index, title: stripTags(match[1]) };
  }
  if (best && best.title) return best.title;
  // Son çare: kartın görsel `alt` metni (aynı ürünü taşır).
  const alt = /class="prod-img[^"]*"[^>]*alt="([^"]*)"/.exec(block);
  return alt ? stripTags(alt[1]) : "";
}

/**
 * MOQ'yu okur. İKİ düzen vardır ve ikisi de `(MOQ)` ipucuyla BİTMEK ZORUNDADIR:
 *   A/B: `1,200 Pieces<span class="price_hint"> (MOQ)`
 *   C  : `<span>1,000 Pieces</span> <span class="moq-text">(MOQ)`
 */
function moqOf(block: string): { units: number; unit: string } | null {
  const match =
    />([\d,]+)\s*([A-Za-z]+)\s*<span class="price_hint">\s*\(MOQ\)/.exec(block) ??
    /<span>\s*([\d,]+)\s*([A-Za-z]+)\s*<\/span>[\s\S]{0,40}?<span class="moq-text">\s*\(MOQ\)/.exec(
      block,
    );
  if (!match) return null;
  const units = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(units) || units < 1 || units > 10_000_000) return null;
  return { units, unit: match[2].toLowerCase() };
}

/**
 * Tedarikçi firma adını okur.
 *
 * SINIF ADI İKİ YAZIMLA GELİYOR (ölçüldü): sitenin kendi yazım hatası olan
 * `compnay-name` (şema A/B/C kartlarının firma bağlantısı) ve `company-name`
 * (vitrin kutusu). Ayrıca sınıf değeri her zaman bu adla BAŞLAMIYOR
 * (`class="fc1 company-name J-focus-faw"`), o yüzden ad, sınıf listesinin
 * İÇİNDE aranır.
 */
function storeOf(block: string): string {
  const anchor =
    /<a[^>]*class="[^"]*\b(?:compnay-name|company-name)\b[^"]*"[^>]*>([\s\S]{0,200}?)<\/a>/.exec(
      block,
    );
  // Metin `<span>Firma A.Ş.</span>` içinde olabilir; `title` de yedek kaynaktır
  // (ölçülen örnek: `title="Foshan Oushine Technology Co., Ltd."`).
  const name = anchor
    ? stripTags(anchor[1])
    : stripTags(
        /title="([^"]{2,120})"[^>]*class="[^"]*\b(?:compnay-name|company-name)\b/.exec(
          block,
        )?.[1] ?? "",
      );
  // Çok uzun/gürültülü ad boş bırakılır: kırpılmış bir "ad" göstermek yanlış
  // tedarikçiyi tanıtmak olurdu.
  return name.length > 0 && name.length <= 120 ? name : "";
}

/** Bir teklifin KAÇ yuvası ölçüldü — tamlık karşılaştırması için. */
function measuredFields(offer: MicOffer): number {
  return [offer.unitPriceUsd, offer.unitPriceHighUsd, offer.moqUnits, offer.store || null].filter(
    (value) => value !== null && value !== "",
  ).length;
}

/**
 * Ham HTML → `MicOffer[]`. SAF fonksiyon (ağ YOK) — bu yüzden test edilebilir.
 *
 * Aynı ürün birden çok kartta görünürse (vitrin şeridi + arama listesi), DAHA
 * ÇOK YUVASI ÖLÇÜLMÜŞ olan kart kazanır. NEDEN: kart blokları şemaya göre
 * bölündüğü için zayıf bir blok ilk gelirse, tekilleştirme "ilk gelen kazanır"
 * olsaydı FOB'suz/ MOQ'suz sürüm kanıt sayılırdı — ölçülmüş veri kaybolurdu.
 */
export function extractMicOffers(html: string): MicOffer[] {
  // Uzunluk eşiği DEĞİL, kart işareti aranır: daraltılmış bir gövde (test
  // fixture'ı gibi) de ayrıştırılabilmeli, ama HTML olmayan kısa metin üzerinde
  // regex avına çıkılmamalı. Kart yoksa döngü zaten boş döner.
  if (!html || html.length < 200) return [];

  const best = new Map<string, MicOffer>();
  for (const block of micCardBlocks(html)) {
    const title = titleOf(block);
    const href = /href="([^"]*\/product\/[^"]+\.html)"/.exec(block);
    const url = href ? absoluteUrl(href[1]) : "";
    // Ürün adı veya bağlantısı yoksa kart ATLANIR; yarım karttan "teklif"
    // üretmek eşleştirmeye sahte kanıt sokardı.
    if (!title || !url) continue;

    const price =
      /<strong class="price">US\$<span>([\d.,]+)<\/span>(?:-<span>([\d.,]+)<\/span>)?/.exec(block);
    const moq = moqOf(block);
    const image =
      /class="prod-img[^"]*"[^>]*(?:src|lazy-src|data-src|data-original)="([^"]*)"/.exec(block);

    const offer: MicOffer = {
      title,
      unitPriceUsd: price ? measuredMoney(price[1]) : null,
      unitPriceHighUsd: price ? measuredMoney(price[2]) : null,
      moqUnits: moq ? moq.units : null,
      moqUnit: moq ? moq.unit : "",
      store: storeOf(block),
      shipFrom: "",
      url,
      imageUrl: image ? absoluteUrl(image[1]) : "",
    };

    const previous = best.get(url);
    if (!previous || measuredFields(offer) > measuredFields(previous)) best.set(url, offer);
  }

  return [...best.values()];
}

/* ------------------------------------------------------------------- Ağ katmanı */

/** Niş → MIC arama terimi (İngilizce; çeviri `product-discovery-query`den). */
export function micSearchQuery(niche: string): string {
  const base =
    englishProductQuery(niche) || productQueryVariants(niche)[0] || String(niche ?? "").trim();
  return base.replace(/\s+/g, " ").slice(0, 80);
}

/**
 * Uyumlu arama yolu: `products-search/hot-china-products/<Slug>.html`.
 *
 * Sorgu dizesi YOKTUR ve bu bilinçlidir: robots.txt `/*.do?` ile `/*html?*`
 * yollarını yasaklar. Slug ölçülen biçimdedir (kelimeler `_` ile birleşir):
 * `air_fryer.html`, `led_desk_lamp.html`.
 */
export function micSearchUrl(niche: string): string {
  const slug = micSearchQuery(niche)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!slug) return "";
  return `https://www.made-in-china.com/products-search/hot-china-products/${slug}.html`;
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
  const key = await cacheKey("mic-supplier-offers-v2", [niche]);
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
  if (offers.length) await cacheSet(key, "mic-supplier-offers-v2", offers, MIC_CACHE_TTL_MS);
  return offers;
}

/* ---------------- CJ DROPSHIPPING API v2 (`listV2`, isteğe bağlı, 50K puan/gün) */

/**
 * CJ Dropshipping API token'ı (`CJ_API_KEY` veya `CJ_ACCESS_TOKEN`).
 *
 * NEDEN VAR (v2 rapor L4 + P1 #9):
 *   CJ Dropshipping ücretsiz geliştirici katmanı günde 50.000 puan (00:00 UTC
 *   sıfırlamalı) sunar; `/product/listV2` 50 puan (günde 1.000 arama) harcar
 *   ve `sellPrice`, `nowPrice`, `directMinOrderNum` (MOQ) ve `warehouseInventoryNum`
 *   döner. Anahtar yoksa 0 ms'de `[]` döner (ağ çağrısı yapılmaz).
 */
export function cjApiKey(env: Record<string, string | undefined> = process.env): string {
  for (const name of ["CJ_API_KEY", "CJ_ACCESS_TOKEN", "CJDROPSHIPPING_API_KEY"]) {
    const v = (env[name] ?? "").trim();
    if (v) return v;
  }
  return "";
}

/**
 * CJ `listV2` yanıtını `MicOffer` sözleşmesine ayrıştırır (SAF, ağsız).
 *
 * Fiyat aralığı (`"12.50 -- 15.80"` veya `"12.50-15.80"`) varsa alt ve üst uç
 * ayrı ayrı okunur; tek fiyat varsa `unitPriceHighUsd` `null` kalır.
 */
export function parseCjOffers(payload: unknown): MicOffer[] {
  const data = (payload as { data?: { content?: unknown[]; list?: unknown[] } })?.data;
  const contentList = Array.isArray(data?.content)
    ? data.content.flatMap((c) => {
        const group = (c ?? {}) as { productList?: unknown[] };
        return Array.isArray(group.productList) ? group.productList : [c];
      })
    : Array.isArray(data?.list)
      ? data.list
      : [];

  const out: MicOffer[] = [];
  for (const raw of contentList) {
    const item = (raw ?? {}) as Record<string, unknown>;
    const title = String(item["nameEn"] ?? item["productNameEn"] ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const id = String(item["id"] ?? item["pid"] ?? "").trim();
    if (title.length < 4 || !id) continue;

    const rawSell = String(item["nowPrice"] ?? item["sellPrice"] ?? "").trim();
    const parts = rawSell.split(/\s*(?:--|-)\s*/);
    const low = measuredMoney(parts[0]);
    const high = parts.length > 1 ? measuredMoney(parts[1]) : null;
    if (low === null) continue;

    const moqRaw = Number(item["directMinOrderNum"] ?? item["minOrderQuantity"] ?? 0);
    const moqUnits = Number.isFinite(moqRaw) && moqRaw > 0 ? Math.round(moqRaw) : 1;
    const shipFrom = String(item["countryCode"] ?? "CN")
      .trim()
      .toUpperCase()
      .slice(0, 4);
    const imageUrl = String(item["bigImage"] ?? item["productImage"] ?? "").trim();

    out.push({
      title: title.slice(0, 180),
      unitPriceUsd: low,
      unitPriceHighUsd: high !== null && high > low ? high : null,
      moqUnits,
      moqUnit: "pieces",
      store: "CJ Dropshipping",
      shipFrom,
      url: `https://cjdropshipping.com/product/-p-${id}.html`,
      imageUrl,
    });
    if (out.length >= 25) break;
  }
  return out;
}

export async function fetchCjOffers(
  niche: string,
  opts: { timeoutMs?: number } = {},
): Promise<MicOffer[]> {
  const token = cjApiKey();
  if (!token) return [];
  const query = micSearchQuery(niche);
  if (!query) return [];

  const { cacheGet, cacheKey, cacheSet } = await import("./ai-cache.server");
  const key = await cacheKey("cj-supplier-offers-v1", [query]);
  const hit = await cacheGet<MicOffer[]>(key).catch(() => null);
  if (hit && hit.length) return hit;

  const url =
    `https://developers.cjdropshipping.com/api2.0/v1/product/listV2` +
    `?keyWord=${encodeURIComponent(query)}&page=1&size=20`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(opts.timeoutMs ?? 6_000),
    headers: {
      "CJ-Access-Token": token,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`CJ HTTP ${res.status}`);
  const offers = parseCjOffers(await res.json().catch(() => null));
  if (offers.length) {
    await cacheSet(key, "cj-supplier-offers-v1", offers, MIC_CACHE_TTL_MS).catch(() => {});
  }
  return offers;
}
