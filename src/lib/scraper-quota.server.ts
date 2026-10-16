/**
 * SCRAPERAPI KOTA BÜTÇESİ — ücretsiz planı ayda tüketmemek için.
 *
 * SORUN: ScraperAPI ücretsiz planı AYLIK kredi sınırıdır. Her ürün araması
 * birkaç kredi yaktığı için "her aramayı kazı" yaklaşımı ayı 1-2 haftada
 * bitirir ve ücretsiz plan tükenince o kaynak bir daha hiç veri getiremez.
 *
 * ÜÇ KORUMA KATMANI (ölçüm ve akıl yürütmesiyle eklendi):
 *
 *  1. KALICI ÖNBELLEK (en büyük kazanç). Aynı niş 24 saat içinde tekrar
 *     aranırsa HİÇ kredi harcanmaz. Kullanıcı aynı nişi tekrar ederek
 *     denemekte haklıdır — o denemeler bedava olmalıdır.
 *
 *  2. GÜNLÜK/AYLIK SAYAÇ (güvenlik ağı). Sayaç veritabanında tutulur ki
 *     Vercel'in her istekte sıfırlanan süreçleri sayacı sıfırlayamasın.
 *     Var olan `public.bump_rate_limit` RPC'si ATOMİK artırır; yeni tablo
 *     veya migration gerekmez (RPC canlı DB'de zaten çalışıyor).
 *
 *  3. AZ PAZAR DENE. Bir aramada 4 pazar sırayla kazınmak, ilki veri
 *     vermese bile 4 kredi demektir. 2 pazarla sınırlıdır.
 *
 * FAIL-OPEN İLKESİ: sayaç okunamazsa (RPC yok, ağ yok) ürün akışı DURMAZ.
 * Çünkü kotayı korumak için ürün göstermemek, kotanın birkaç hafta sonra
 * tükeneceğinden daha kötüdür. Önbellek zaten ana korumadır.
 */

/** Aylık kredi tavanı. Ortam değişkeniyle düşürülebilir. */
function monthlyLimit(): number {
  const raw = Number(process.env.SCRAPER_MONTHLY_LIMIT ?? "");
  // 1200 kredi ≈ ücretsiz planın önemli bir kısmı; günlük ortalama ~40.
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1200;
}

/** "2026-10" — kova ay bazlıdır, böylece sayaç aylar arası taşınmaz. */
function monthBucket(): string {
  return `scraper-credits-${new Date().toISOString().slice(0, 7)}`;
}

/**
 * Kredi harcanmadan önce bütçede yer var mı?
 *
 * @returns `true` → kazım yapılabilir, `false` → kota doldu, `null` → sayaç
 *   okunamadı (fail-open: yine de dene).
 */
export async function allowScraperCredit(): Promise<boolean | null> {
  const limit = monthlyLimit();
  const bucket = monthBucket();
  // Pencere 400 gün: sayaç zaten ay bazlı kovalı, pencere yalnız "satır
  // temizleme" davranışını belirliyor.
  const windowSeconds = 400 * 24 * 60 * 60;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("bump_rate_limit", {
      _bucket: bucket,
      _limit: limit,
      _window_seconds: windowSeconds,
    });
    if (error) {
      console.log(`[scraper] kota sayacı okunamadı (${error.message.slice(0, 80)}); fail-open`);
      return null;
    }
    return data !== false;
  } catch (e) {
    console.log(
      `[scraper] kota sayacı çağrılamadı (${(e as Error).message.slice(0, 80)}); fail-open`,
    );
    return null;
  }
}

/** Kota tükendiğinde kullanıcıya gösterilecek dürüst mesaj. */
export function scraperQuotaMessage(): string {
  return (
    `Scraper kotası ayda ${monthlyLimit().toLocaleString("tr-TR")} istekle sınırlı ve bu ay doldu; ` +
    `bu arama anahtarsız kaynaklardan yapıldı.`
  );
}

/* ------------------------------------------------------------- SerpAPI kotası */

/**
 * SerpAPI ÜCRETSİZ PLANI: ayda ~100 arama. ScraperAPI'den ÇOK daha küçük bir
 * bütçedir, o yüzden KENDİ kovası vardır — ikisi aynı sayacı paylaşırsa
 * SerpAPI birkaç günde ScraperAPI'nin bütün ayını tüketirdi.
 *
 * Aynı fail-open ilkesi geçerli: sayaç okunamazsa arama yapılır.
 */
function serpMonthlyLimit(): number {
  const raw = Number(process.env.SERPAPI_MONTHLY_LIMIT ?? "");
  // 100 = ücretsiz planın tamamı; varsayılan olarak ona dokunmadan 80'e
  // çekiliyor ki bir hat hatası ayı bitirmesin.
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 80;
}

/* ------------------------------------------------- Anahtarsız tedarik kotası */

/**
 * ALIEXPRESS TEDARİK KAZIMASI — anahtarsız olduğu için kredi HARCANMAZ, ama
 * yine de sınırsız kazım yapmak dürüst değildir (servis kapatır, ürün hattını
 * kırar). Bu yüzden kendi aylık kovası var ve ScraperAPI/SerpAPI ile PAYLAŞMAZ
 * — toptan fiyat, diğer kaynaklardan bağımsız bir kanıttır.
 *
 * Aynı fail-open ilkesi: sayaç okunamazsa kazım yapılır.
 */
function supplierMonthlyLimit(): number {
  const raw = Number(process.env.SUPPLIER_MONTHLY_LIMIT ?? "");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 400;
}

/** Toptan teklif kazımı yapmadan önce bütçede yer var mı? */
export async function allowSupplierCredit(): Promise<boolean | null> {
  const bucket = `supplier-scrapes-${new Date().toISOString().slice(0, 7)}`;
  const windowSeconds = 400 * 24 * 60 * 60;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("bump_rate_limit", {
      _bucket: bucket,
      _limit: supplierMonthlyLimit(),
      _window_seconds: windowSeconds,
    });
    if (error) {
      console.log(`[supplier] kota sayacı okunamadı (${error.message.slice(0, 80)}); fail-open`);
      return null;
    }
    return data !== false;
  } catch (e) {
    console.log(
      `[supplier] kota sayacı çağrılamadı (${(e as Error).message.slice(0, 80)}); fail-open`,
    );
    return null;
  }
}

/* --------------------------------------------- Ürün kataloğu (UPCitemdb) */

/**
 * ÜRÜN KATALOĞU ARAMASI — GÜNLÜK kova.
 *
 * ÖLÇÜLEN SINIR (2026-10-15, UPCitemdb ücretsiz planı): günde toplam 100 istek
 * ve bunun en fazla 20'si ARAMA olabilir (kalanı barkod sorgusu). Aylık bir
 * kovaya koymak yanlış olurdu: 20 arama/gün × 30 = 600 arama, yani bir günde
 * 20 aramayı tüketen bir kullanıcı ertesi gün hakkını kaybederdi.
 *
 * VARSAYILAN 16, TAVANI 20: ücretsiz planın tamamını harcamamak için bilinçli
 * bir pay bırakılır (aynı ilke `serpMonthlyLimit`te de var). `CATALOG_DAILY_LIMIT`
 * ile artırılabilir.
 *
 * FAIL-OPEN: sayaç okunamazsa arama yapılır (kotayı korumak için ürün
 * göstermemek daha kötüdür).
 */
function catalogDailyLimit(): number {
  const raw = Number(process.env.CATALOG_DAILY_LIMIT ?? "");
  return Number.isFinite(raw) && raw > 0 ? Math.min(20, Math.floor(raw)) : 16;
}

/** Gün kovası: `catalog-searches-2026-10-15`. UTC gün sınırı. */
function dayBucket(prefix: string): string {
  return `${prefix}-${new Date().toISOString().slice(0, 10)}`;
}

/** Ürün kataloğu araması yapmadan önce günlük bütçede yer var mı? */
export async function allowCatalogCredit(): Promise<boolean | null> {
  const bucket = dayBucket("catalog-searches");
  const windowSeconds = 3 * 24 * 60 * 60;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("bump_rate_limit", {
      _bucket: bucket,
      _limit: catalogDailyLimit(),
      _window_seconds: windowSeconds,
    });
    if (error) {
      console.log(`[catalog] kota sayacı okunamadı (${error.message.slice(0, 80)}); fail-open`);
      return null;
    }
    return data !== false;
  } catch (e) {
    console.log(
      `[catalog] kota sayacı çağrılamadı (${(e as Error).message.slice(0, 80)}); fail-open`,
    );
    return null;
  }
}

/** Katalog kotası tükendiğinde kullanıcıya gösterilecek dürüst mesaj. */
export function catalogQuotaMessage(): string {
  return (
    `Ürün kataloğu kotası günde ${catalogDailyLimit()} aramayla sınırlı ve bugün doldu; ` +
    `bu arama marka/model zenginleştirmesi olmadan yapıldı.`
  );
}

/** SerpAPI araması yapmadan önce bütçede yer var mı? */
export async function allowSerpApiCredit(): Promise<boolean | null> {
  const bucket = `serpapi-searches-${new Date().toISOString().slice(0, 7)}`;
  const windowSeconds = 400 * 24 * 60 * 60;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("bump_rate_limit", {
      _bucket: bucket,
      _limit: serpMonthlyLimit(),
      _window_seconds: windowSeconds,
    });
    if (error) {
      console.log(`[serpapi] kota sayacı okunamadı (${error.message.slice(0, 80)}); fail-open`);
      return null;
    }
    return data !== false;
  } catch (e) {
    console.log(
      `[serpapi] kota sayacı çağrılamadı (${(e as Error).message.slice(0, 80)}); fail-open`,
    );
    return null;
  }
}
