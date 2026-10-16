// ============================================================================
// ÜRÜN KATALOĞU ZENGİNLEŞTİRMESİ — ÜCRETSİZ, ANAHTARSIZ (UPCitemdb).
//
// NEDEN VAR (ölçülen boşluk, 2026-10-15 canlı koşu "air fryer"/US):
//   120 ham satır → 75 aday ve **0/75 üründe marka**; kategori de boştu.
//   Ölçülen sebep: pazaryeri LİSTE sayfaları marka/kategori alanı sunmuyor
//   (AliExpress kart şeması 60 kartta `brand` alanı içermiyor).
//
// ÖLÇÜLEN KAYNAK (2026-10-15, bu sandbox, canlı):
//   GET https://api.upcitemdb.com/prod/trial/search?s=air%20fryer
//   → HTTP 200, 33 KB, 5 kayıt; HER kayıtta: `brand`, `model`, `category`
//     (Google ürün taksonomisi), `ean`/`upc`, `images[]`, `lowest_recorded_price`.
//   Aynı uç "robot vacuum" için 80.453 sonuç, "air fryer" için 91.319 sonuç
//   raporladı — yani katalog gerçek ve geniş.
//
// ÜCRETSİZ PLAN SINIRI (ölçüldü + resmî plan sayfası): günde 100 istek, en
// fazla **20 ARAMA**; patlama sınırı 30 saniyede 2 arama. Kota bu yüzden
// GÜNLÜK kovayla korunur (`allowCatalogCredit`) ve yanıt 24 saat önbelleğe
// alınır: aynı niş tekrar arandığında ağa hiç gidilmez.
//
// DÜRÜSTLÜK:
//   • Bu kaynak ÜRÜN LİSTESİ üretmez; mevcut perakende satırlarını
//     ZENGİNLEŞTİRİR (marka/model/kategori). `PRODUCT_SOURCES`a girmez —
//     girseydi katalog satırları "kendi bulduğu ürün" gibi listelenir ve
//     perakende fiyatı olmayan kayıtlar vitrini doldururdu.
//   • Eşleşme ÖLÇÜLÜR: katalog başlığı ile aday başlığı token örtüşmesi +
//     model kodu + fiyat yakınlığı. Zayıf eşleşme KULLANILMAZ; alan boş kalır.
//   • Kayıt fiyatı PERAKENDE FİYAT DEĞİLDİR (kayıtlı en düşük/en yüksek
//     fiyat): adayın fiyatı varsa ASLA ezilmez, yalnız fiyatı olmayan adaya
//     ve o zaman bile "kayıtlı fiyat" olarak işaretlenerek yazılır.
// ============================================================================

import type { RawProduct } from "./product-discovery.types";
import { brandFromTitle, plausibleBrand, titleMentionsBrand } from "./product-brand";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

/** Katalog yanıtı 24 saat önbellekte: aynı niş tekrar aramada ağa gidilmez. */
const CATALOG_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Ölçülmüş katalog kaydı — yalnız okunabilen alanlar. */
export type CatalogRecord = {
  title: string;
  /** Katalogdaki marka adı (boş olabilir). */
  brand: string;
  /** Üretici model kodu (boş olabilir). */
  model: string;
  /** Google ürün taksonomisi kategorisi (boş olabilir). */
  category: string;
  /** GTIN/EAN/UPC — ürünün küresel kimliği. */
  gtin: string;
  /** Katalogdaki en düşük kayıtlı fiyat (USD). `null` = yok. */
  lowestUsd: number | null;
  /** En yüksek kayıtlı fiyat (USD). `null` = yok. */
  highestUsd: number | null;
  /** Kayıtlı ürün görseli (boş olabilir). */
  imageUrl: string;
};

const str = (value: unknown): string => String(value ?? "").trim();

/** USD sayı — geçersizse `null` (0 uydurulmaz). */
function usd(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

/**
 * UPCitemdb yanıtını kayıtlara çevirir — SAF, ağ YOK (test edilebilir).
 *
 * Ölçülen alan adları: `title`, `brand`, `model`, `category`, `ean`, `upc`,
 * `gtin`, `lowest_recorded_price`, `highest_recorded_price`, `images[]`.
 */
export function parseCatalogItems(payload: unknown): CatalogRecord[] {
  const items = (payload as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];
  const out: CatalogRecord[] = [];
  for (const raw of items) {
    const row = raw as Record<string, unknown>;
    const title = str(row.title);
    if (!title || title.length < 3) continue;
    const images = Array.isArray(row.images) ? row.images : [];
    const image = images.map((i) => str(i)).find((u) => /^https?:\/\//i.test(u)) ?? "";
    out.push({
      title,
      brand: str(row.brand).slice(0, 40),
      model: str(row.model).slice(0, 40),
      category: str(row.category).slice(0, 120),
      gtin: str(row.ean) || str(row.upc) || str(row.gtin),
      lowestUsd: usd(row.lowest_recorded_price),
      highestUsd: usd(row.highest_recorded_price),
      imageUrl: image,
    });
  }
  return out;
}

/** Katalog arama URL'i (niş → ücretsiz `search` ucu). */
export function catalogSearchUrl(query: string): string {
  const q = String(query ?? "")
    .trim()
    .slice(0, 80);
  if (!q) return "";
  return `https://api.upcitemdb.com/prod/trial/search?s=${encodeURIComponent(q)}&match_mode=0&type=product`;
}

/**
 * BİR KOŞUDA EN FAZLA KAÇ KATALOG ARAMASI?
 *
 * ÖLÇÜLEN SINIR (2026-10-15, bu sandbox, canlı): ücretsiz `trial` ucu
 * art arda iki aramadan sonra **HTTP 429** döndürüyor (`offset=5` denemesi ilk
 * istekten hemen sonra 429 aldı). Yani darboğaz GÜNLÜK kota değil, PATLAMA
 * (burst) sınırıdır: 2 arama / 30 sn.
 *
 * Bu yüzden koşu başına arama sayısı 2 ile sınırlanır. Sınır aşılırsa üçüncü
 * istek 429 alır ve ASIL kazanç (marka doğrulaması) kaybolur; iki isteği
 * bilinçli seçmek, dördü deneyip ikisini kaybetmekten iyidir.
 */
export const CATALOG_MAX_SEARCHES_PER_RUN = 2;

/**
 * Katalog sorguları: marka ağırlıklı.
 *
 * NEDEN MARKA SORGU (ölçülen verim farkı, 2026-10-15 "air fryer"/US): niş
 * sorgusu (`s=air fryer`) 5 kayıt döndürdü ama markaları adaylarla
 * örtüşmedi → **0 eşleşme**. Marka sorgusu (`s=Ninja air fryer`) ise dönen HER
 * kaydı adayın markasıyla ve ürün cinsiyle hizalar: eşleşme kimlik çapası
 * kazanır (`titleMentionsBrand`), yani damping uygulanmaz.
 *
 * SIRA ölçülen sıklıktır: en çok aday hangi markada ise o marka en çok satırı
 * doğrular. Marka yoksa niş sorgusuna düşülür (eski davranış).
 */
export function catalogQueriesForRun(
  brands: readonly string[],
  kindQuery: string,
  limit = CATALOG_MAX_SEARCHES_PER_RUN,
): string[] {
  const kind = String(kindQuery ?? "").trim();
  const out: string[] = [];
  for (const brand of brands) {
    const name = String(brand ?? "").trim();
    if (!name || name.length < 2) continue;
    const query = `${name} ${kind}`.trim().slice(0, 80);
    if (!out.includes(query)) out.push(query);
    if (out.length >= Math.max(1, limit)) break;
  }
  if (!out.length && kind) out.push(kind.slice(0, 80));
  return out;
}

/**
 * Canlı katalog kayıtlarını getirir. FAIL-SOFT: hata/anahtar/kota durumunda
 * `[]` döner (çağıran taraf hattı düşürmez).
 *
 * Anahtar GEREKMEZ (ücretsiz `trial` ucu). Kota günlük kovayla korunur; yanıt
 * 24 saat önbelleğe alınır (aynı sorgu ikinci kez ağa çıkmaz).
 */
export async function fetchCatalogRecords(
  query: string,
  opts: { timeoutMs?: number } = {},
): Promise<CatalogRecord[]> {
  const q = String(query ?? "").trim();
  const url = catalogSearchUrl(q);
  if (!url) return [];

  const { cacheGet, cacheKey, cacheSet } = await import("./ai-cache.server");
  const key = await cacheKey("catalog-upcitemdb-v1", [q.toLocaleLowerCase("tr-TR")]);
  const hit = await cacheGet<CatalogRecord[]>(key).catch(() => null);
  if (hit && hit.length) return hit;

  const { allowCatalogCredit } = await import("./scraper-quota.server");
  if ((await allowCatalogCredit()) === false) {
    console.log(`[catalog] günlük kota doldu (${q}); zenginleştirme atlandı`);
    return [];
  }

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8_000),
      headers: { "user-agent": UA, accept: "application/json" },
    });
    if (!res.ok) {
      console.log(`[catalog] HTTP ${res.status} (${q})`);
      return [];
    }
    const records = parseCatalogItems(await res.json().catch(() => null));
    if (records.length) {
      await cacheSet(key, "catalog-upcitemdb-v1", records, CATALOG_CACHE_TTL_MS).catch(() => {});
    }
    return records;
  } catch (e) {
    console.log(`[catalog] istek başarısız: ${(e as Error).message.slice(0, 80)}`);
    return [];
  }
}

/**
 * Bir koşunun katalog kayıtları: verilen sorgular sırayla denenir (en fazla
 * `CATALOG_MAX_SEARCHES_PER_RUN`).
 *
 * SIRA KORUNUR ve erken çıkış YOKTUR: her sorgu farklı bir markayı doğrular;
 * ilk sorgu kayıt döndürdü diye ikincisini atlamak, doğrulanabilecek marka
 * sayısını yarıya indirirdi.
 */
export async function fetchCatalogRecordsForQueries(
  queries: readonly string[],
  opts: { timeoutMs?: number; limit?: number } = {},
): Promise<{ records: CatalogRecord[]; queries: string[] }> {
  const limit = Math.max(1, Math.min(opts.limit ?? CATALOG_MAX_SEARCHES_PER_RUN, 5));
  const used: string[] = [];
  const records: CatalogRecord[] = [];
  for (const query of queries.slice(0, limit)) {
    used.push(query);
    records.push(...(await fetchCatalogRecords(query, opts)));
  }
  return { records, queries: used };
}

/**
 * Katalogun BU KOŞUDA döndürdüğü marka adları (küçük harf) — BAĞIMSIZ
 * DOĞRULAMA kümesi.
 *
 * NEDEN: marka sorgusu (`Ninja air fryer`) kayıt döndürdüyse "Ninja" bu nişte
 * GERÇEK bir markadır; aynı markayı başlıktan çıkaran satırın markası artık
 * iki bağımsız kaynak tarafından söylenmiş olur ve `brandMeasured` yazılabilir.
 * Uzunluk süzgeci (3+) kısa/bozuk adların yanlış eşleşmesini engeller.
 */
export function confirmedBrandsFromRecords(records: readonly CatalogRecord[]): Set<string> {
  const brands = new Set<string>();
  for (const record of records) {
    const raw = String(record.brand ?? "").trim();
    // MAKULLÜK SÜZGECİ: katalog marka alanı bozuk olabiliyor ("Air",
    // "Air fryer XL"). Makul olmayan ad doğrulama kümesine GİREMEZ.
    if (raw.length < 3 || !plausibleBrand(raw)) continue;
    brands.add(raw.toLocaleLowerCase("tr-TR"));
  }
  return brands;
}

/* ------------------------------------------------------------- Eşleştirme */

/** Aday başlığından AYIRT EDİCİ kelimeler (jenerikler atılır). */
const GENERIC = new Set([
  "with",
  "for",
  "and",
  "the",
  "from",
  "your",
  "our",
  "pack",
  "set",
  "pcs",
  "piece",
  "pieces",
  "count",
  "size",
  "inch",
  "inches",
  "large",
  "small",
  "medium",
  "premium",
  "ultra",
  "super",
  "multi",
  "portable",
  "indoor",
  "outdoor",
  "color",
  "new",
  "high",
  "low",
  "top",
  "best",
  "type",
  "style",
  "free",
  "shipping",
  "sale",
  "hot",
]);

function tokens(value: string): string[] {
  return String(value ?? "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !GENERIC.has(t));
}

/**
 * Katalog kaydı bu adayla eşleşiyor mu — ÖLÇÜLMÜŞ benzerlik (0-1).
 *
 * ÜÇ BAĞIMSIZ KANIT, en güçlü olan kazanır:
 *   1. GTIN/model kodu başlıkta geçiyor → 1.0 (küresel kimlik eşleşmesi).
 *   2. Ayırt edici kelime örtüşmesi → oran.
 *   3. KAYDIN markası başlıkta geçiyor → +0.2 katkı.
 *
 * KİMLİK ÇAPASI ZORUNLU (ölçülen yanlış-pozitif): yalnız kelime örtüşmesine
 * bakmak "Air Fryer 5.5L" (markasız, tümü jenerik) satırını "Ninja AF101 Air
 * Fryer" kaydıyla 1.0 benzerlikle eşleştiriyordu — yani BAŞKA bir ürünün
 * markası adayın üzerine yazılıyordu. Yanlış marka, marka yokluğundan kötüdür
 * (`productModelKey` iki FARKLI ürünü birleştirir). Bu yüzden model/GTIN
 * eşleşmesi YOKSA ve KAYDIN markası başlıkta GEÇMİYORSA benzerlik yarıya
 * indirilir: jenerik kelime örtüşmesi tek başına eşiği geçemez.
 *
 * ÇAPA KAYDIN markasından okunur, adayın kendi markasından DEĞİL: aday
 * "Cosori Air Fryer 5.5L" ise ve kayıt "Ninja" ise kaydın markası adayın
 * başlığında geçmez → çapa yok → eşleşme reddedilir (aksi hâlde Ninja markası
 * Cosori ürününe yazılırdı).
 */
export function catalogMatchScore(
  candidate: { title: string; brand?: string },
  record: CatalogRecord,
): number {
  const title = String(candidate.title ?? "");
  const lower = title.toLocaleLowerCase("tr-TR");
  if (!lower) return 0;

  // 1) Kimlik eşleşmesi: model kodu ya da GTIN başlıkta geçiyor.
  const model = String(record.model ?? "").trim();
  if (model.length >= 4 && lower.includes(model.toLocaleLowerCase("tr-TR"))) return 1;
  const gtin = String(record.gtin ?? "").replace(/\D/g, "");
  if (gtin.length >= 8 && lower.replace(/\D/g, "").includes(gtin)) return 1;

  // 2) Ayırt edici kelime örtüşmesi.
  const a = tokens(title);
  const b = new Set(tokens(record.title));
  if (!a.length || !b.size) return 0;
  const hit = a.filter((t) => b.has(t) || (t.length >= 6 && [...b].some((w) => w.startsWith(t.slice(0, 6)))));
  let score = hit.length / Math.min(a.length, 6);

  // 3) KİMLİK ÇAPASI: kaydın markası BAŞLIKTA geçiyor mu? Geçiyorsa güven
  // artar; geçmiyorsa (ve model/GTIN de yoksa) benzerlik yarıya iner —
  // jenerik kelime örtüşmesi tek başına "aynı ürün" kanıtı değildir.
  // Marka YALNIZ makulse çapa olabilir: katalog marka alanı bozuk olabiliyor
  // (ölçüldü: `brand: "Air"`) ve "Air" her başlıkta geçtiği için 17 adaya
  // yanlış marka yazdırıyordu.
  const recordBrand = String(record.brand ?? "").trim();
  if (recordBrand && plausibleBrand(recordBrand) && titleMentionsBrand(title, recordBrand)) {
    score += 0.2;
  } else {
    score *= 0.5;
  }
  return Math.min(1, Math.round(score * 100) / 100);
}

/** Eşleşme için gereken en az benzerlik — altındaki kayıt KULLANILMAZ. */
export const CATALOG_MIN_MATCH = 0.6;

/** Bir adaya yazılacak, ÖLÇÜLMÜŞ katalog kanıtı. */
export type CatalogEnrichment = {
  brand: string;
  category: string;
  /** Model kodu (kayıtta varsa) — marka/model anahtarı için kanıt. */
  model: string;
  /** GTIN/EAN — ürünün küresel kimliği (varsa). */
  gtin: string;
  /** Kayıtlı ürün görseli (kaydın kendisinden; uydurulmaz). */
  imageUrl: string;
  /**
   * Marka KATALOG kaydının kendi alanından mı geldi?
   *
   * NEDEN AYRI BAYRAK: kayıt markası boşken `bestCatalogMatch` markayı AD
   * başlığından çıkarır (kayıt "Air Fryer XL 5.3 QT Black Deluxe" olabilir).
   * O çıkarım TÜREVDİR, ölçüm değil; `brandMeasured` yalnız kaydın kendi
   * marka alanı doluyken `true` olur ki kanıt yuvası şişmesin.
   */
  brandMeasured: boolean;
  /** Katalogdaki kayıtlı en düşük fiyat (USD) — PERAKENDE FİYAT DEĞİL. */
  lowestUsd: number | null;
  /** Eşleşme skoru (0-1) — kanıtın gücü. */
  match: number;
};

/**
 * Bir aday için EN İYİ katalog eşleşmesini bulur.
 *
 * `CATALOG_MIN_MATCH` altındaki kayıtlar elenir: yanlış marka yazmak, marka
 * yazmamaktan kötüdür (yanlış marka `productModelKey`i çökertir ve iki FARKLI
 * ürünü birleştirir).
 */
export function bestCatalogMatch(
  candidate: { title: string; brand?: string },
  records: readonly CatalogRecord[],
): CatalogEnrichment | null {
  let best: { record: CatalogRecord; score: number } | null = null;
  for (const record of records) {
    const score = catalogMatchScore(candidate, record);
    if (score < CATALOG_MIN_MATCH) continue;
    if (!best || score > best.score) best = { record, score };
  }
  if (!best) return null;
  const { record, score } = best;
  return {
    // YALNIZ kaydın KENDİ marka alanı yazılır ve YALNIZ makulse. Kayıt
    // markası boş/bozuksa marka BOŞ kalır: adayın başlığından çıkarım zaten
    // `normalizeRaw` içinde yapılır ve orada TÜREV sayılır
    // (`brandMeasured: false`).
    brand: plausibleBrand(record.brand) ? record.brand : "",
    brandMeasured: plausibleBrand(record.brand) && record.brand !== "",
    category: record.category,
    model: record.model,
    gtin: record.gtin,
    imageUrl: record.imageUrl,
    lowestUsd: record.lowestUsd,
    match: score,
  };
}

/**
 * Ham perakende satırlarını katalog kanıtıyla ZENGİNLEŞTİRİR.
 *
 * YALNIZ BOŞ alanlar doldurulur (ölçülmüş veri ezilmez) ve yalnız eşleşme
 * eşiğini geçen kayıtlar kullanılır. Kayıt bulunamazsa satır DEĞİŞMEZ.
 *
 * İKİNCİ YOL — MARKA DOĞRULAMASI (kayıt eşleşmese bile): katalog bu nişte
 * adayın markasını ÖLÇTÜYSE (marka sorgusu kayıt döndürdüyse), başlıktan
 * çıkarılan marka artık İKİ BAĞIMSIZ kaynağın söylediği şeydir ve
 * `brandMeasured: true` yazılabilir. Uydurma yok: marka başlıktan geliyor,
 * katalog yalnız "bu marka bu nişte GERÇEKTEN var" diyor (bkz.
 * `confirmedBrandsFromRecords`).
 */
export function enrichRowsWithCatalog(
  rows: readonly RawProduct[],
  records: readonly CatalogRecord[],
): { rows: RawProduct[]; enriched: number; brands: number; categories: number; confirmed: number } {
  if (!records.length) {
    return { rows: [...rows], enriched: 0, brands: 0, categories: 0, confirmed: 0 };
  }
  const confirmedBrands = confirmedBrandsFromRecords(records);
  let enriched = 0;
  let brands = 0;
  let categories = 0;
  let confirmed = 0;
  const out = rows.map((row) => {
    const title = String(row.title ?? "");
    if (!title) return row;
    const declared = String(row.brand ?? "").trim();
    const match = bestCatalogMatch({ title, brand: row.brand }, records);
    if (!match) {
      // Kayıt eşleşmedi; yalnız MARKA DOĞRULAMASI mümkünse satıra yazılır.
      if (declared !== "") return row;
      const inferred = brandFromTitle(title);
      if (!inferred || !confirmedBrands.has(inferred.toLocaleLowerCase("tr-TR"))) return row;
      confirmed += 1;
      return {
        ...row,
        brand: inferred.slice(0, 60),
        brandMeasured: true,
        notes: [String(row.notes ?? ""), "marka katalogda doğrulandı"]
          .filter(Boolean)
          .join(" · ")
          .slice(0, 200),
      } satisfies RawProduct;
    }
    enriched += 1;
    const brand = declared || match.brand;
    // MARKA ÖLÇÜMÜ: marka kaynağın kendi alanından ya da KATALOG kaydının
    // kendi marka alanından geldiyse BAĞIMSIZ kanıttır. Başlıktan çıkarılan
    // marka (`brandMeasured: false`) kanıt yuvasını DOLDURMAZ.
    const brandMeasured = declared !== "" || match.brandMeasured;
    if (declared === "" && brand) brands += 1;
    const category = String(row.category ?? "").trim() || match.category;
    if (!String(row.category ?? "").trim() && category) categories += 1;
    const imageUrl = String(row.imageUrl ?? "").trim() || match.imageUrl;
    // Kayıtlı fiyat YALNIZ adayın fiyatı YOKSA ve "kayıtlı" diye işaretlenerek
    // yazılır — perakende fiyat sanılmasın.
    const useCatalogPrice = row.priceUsd === null && match.lowestUsd !== null;
    return {
      ...row,
      brand: brand.slice(0, 60),
      brandMeasured,
      category: category.slice(0, 80),
      imageUrl,
      priceUsd: useCatalogPrice ? match.lowestUsd : row.priceUsd,
      notes: [
        String(row.notes ?? ""),
        useCatalogPrice ? `katalog kayıtlı fiyat $${match.lowestUsd}` : "",
        match.gtin ? `GTIN ${match.gtin}` : "",
        match.model ? `model ${match.model}` : "",
        `katalog eşleşmesi ${Math.round(match.match * 100)}%`,
      ]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 200),
    } satisfies RawProduct;
  });
  return { rows: out, enriched, brands, categories, confirmed };
}
