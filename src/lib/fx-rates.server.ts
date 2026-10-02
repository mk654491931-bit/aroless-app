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
/** Kur 6 saatte bir tazelenir — günlük veriden fazlasına ihtiyaç yok. */
const FX_TTL_MS = 6 * 60 * 60 * 1000;

let cached: { rates: Record<string, number>; at: number } | null = null;
let inflight: Promise<Record<string, number> | null> | null = null;

/** ISO kodu → 1 USD kaç para birimi. Erişilemezse `null`. */
async function loadRates(): Promise<Record<string, number> | null> {
  if (cached && Date.now() - cached.at < FX_TTL_MS) return cached.rates;
  // Aynı anda birden fazla kaynak isteyince tek istek atılır.
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch(FX_URL, { signal: AbortSignal.timeout(3_500) });
      if (!res.ok) return null;
      const json = (await res.json()) as { result?: string; rates?: Record<string, number> };
      if (json.result !== "success" || !json.rates) return null;
      cached = { rates: json.rates, at: Date.now() };
      return cached.rates;
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
  const code = String(currency ?? "").trim().toUpperCase();
  if (!code) return null;
  // USD zaten döndürme gerektirmez; kur çekmeye gerek yok (hızlı yol).
  if (code === "USD") return amount;

  const rates = await loadRates();
  const rate: number | undefined = rates?.[code];
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return null;
  return Math.round((amount / rate) * 100) / 100;
}