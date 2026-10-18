/**
 * DÖVİZ KURU — anahtarsız, önbellekli, hata durumunda sessiz.
 *
 * NEDEN VAR: Türk pazaryerleri fiyatı TL'de verir. Projenin ürün şeması
 * `priceUsd` alanı taşıyor. Bu alanı boş bırakmak gerçek bir fiyatı
 * kullanıcıya göstermemek demektir; uydurma bir kur ise daha kötüdür.
 * Bu yüzden GERÇEK kuru çekip dönüşümü açıkça not ediyoruz.
 *
 * $0 MALİYET: `open.er-api.com` anahtar istemez ve günlük kotaya takılmaz.
 * Kur 6 saatte bir tazelenir; süreç içi bir kez çekilir.
 *
 * DÜRÜSTLÜK: kur alınamazsa `null` döner ve fiyat YİNE de ölçülmedi sayılır.
 * Asla tahmin edilmez.
 */

const FX_URL = "https://open.er-api.com/v6/latest/USD";
/**
 * İKİNCİ ÜCRETSİZ KUR KAYNAĞI (Frankfurter / ECB, anahtarsız).
 *
 * NEDEN YEDEK VAR (rapor L4): `open.er-api.com` tek noktaydı; yavaşladığında ya
 * da hata döndüğünde TRY/EUR/INR/JPY fiyatlı tüm yerel pazaryeri satırları
 * (`tr-reader`, `otto-reader`, `flipkart-reader`, `rakuten-reader`) `toUsd`
 * `null` döndüğü için havuzdan düşüyordu. Frankfurter (ECB referans kurları,
 * `api.frankfurter.dev/v1/latest?base=USD`) anahtarsızdır, günlük kota
 * sınırı yoktur ve ~100 ms'de döner.
 */
const FRANKFURTER_URL = "https://api.frankfurter.dev/v1/latest?base=USD";
/** Kur 6 saatte bir tazelenir — günlük veriden fazlasına ihtiyaç yok. */
const FX_TTL_MS = 6 * 60 * 60 * 1000;

let cached: { rates: Record<string, number>; at: number } | null = null;
let inflight: Promise<Record<string, number> | null> | null = null;

/** Frankfurter yanıtını (`{ base: "USD", rates: { TRY: 49.52, EUR: 0.92, ... } }`) okur. */
export function parseFrankfurterRates(payload: unknown): Record<string, number> | null {
  const rec = (payload ?? {}) as { rates?: unknown };
  if (!rec.rates || typeof rec.rates !== "object" || Array.isArray(rec.rates)) return null;
  const out: Record<string, number> = { USD: 1 };
  for (const [k, v] of Object.entries(rec.rates as Record<string, unknown>)) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) out[k.toUpperCase()] = n;
  }
  return Object.keys(out).length > 1 ? out : null;
}

/** ISO kodu → 1 USD kaç para birimi. Erişilemezse `null`. */
async function loadRates(): Promise<Record<string, number> | null> {
  if (cached && Date.now() - cached.at < FX_TTL_MS) return cached.rates;
  // Aynı anda birden fazla kaynak isteyince tek istek atılır.
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch(FX_URL, { signal: AbortSignal.timeout(3_500) });
      if (res.ok) {
        const json = (await res.json()) as { result?: string; rates?: Record<string, number> };
        if (json.result === "success" && json.rates) {
          cached = { rates: json.rates, at: Date.now() };
          return cached.rates;
        }
      }
    } catch {
      // Birincil kaynak düştü; Frankfurter yedeği denenir.
    }
    try {
      const res2 = await fetch(FRANKFURTER_URL, { signal: AbortSignal.timeout(3_500) });
      if (!res2.ok) return null;
      const rates = parseFrankfurterRates(await res2.json().catch(() => null));
      if (!rates) return null;
      cached = { rates, at: Date.now() };
      return rates;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/**
 * Yerel tutarı USD'ye çevirir.
 *
 * @param amount yerel para birimindeki tutar
 * @param currency ISO kodu (örn. "TRY")
 * @returns USD tutarı veya kur alınamadıysa `null`
 */
export async function toUsd(amount: number, currency: string): Promise<number | null> {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const code = String(currency ?? "")
    .trim()
    .toUpperCase();
  if (!code) return null;
  // USD zaten döndürme gerektirmez; kur çekmeye gerek yok (hızlı yol).
  if (code === "USD") return amount;

  const rates = await loadRates();
  const rate: number | undefined = rates?.[code];
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return null;
  return Math.round((amount / rate) * 100) / 100;
}
