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
  return `Scraper kotası ayda ${monthlyLimit().toLocaleString("tr-TR")} istekle sınırlı ve bu ay doldu; ` +
    `bu arama anahtarsız kaynaklardan yapıldı.`;
}