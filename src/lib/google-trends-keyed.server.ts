// ============================================================================
// GOOGLE TRENDS — ANAHTARLI YEDEK YOL (SearchAPI / SerpAPI).
//
// NEDEN VAR (ölçülen boşluk): anahtarsız Trends kazıması datacenter IP'lerinde
// KALICI olarak 429 dönüyor (bu repoda da 429 ölçüldü — bkz.
// `market-data.server.ts` yorumu). O durumda `google-trends` kaynağı bilerek 0
// satır döner ve niş momentumu Wikipedia'ya düşer; Wikipedia maddesi olmayan
// nişlerde (yeni ürün kategorileri) talep sinyali tamamen kör kalır.
//
// SearchAPI ve SerpAPI `engine=google_trends` ile AYNI zaman serisini JSON
// olarak verir; ikisi de bu projede zaten tanımlı olan anahtarlarla çalışır
// (`SEARCHAPI_KEY`, `SERPAPI_KEY`). Anahtar yoksa 0 ms'de `null` döner.
//
// DÜRÜSTLÜK:
//   • Momentum YALNIZ gerçek `interest_over_time` noktalarından hesaplanır;
//     nokta yoksa `null` (0 ÜRETİLMEZ — 0 "ölçtüm, sıfır buldum" demektir).
//   • İlk yarı ortalaması 0 ise oran tanımsızdır → `null`.
//   • Seri 4 noktadan kısaysa iki yarı karşılaştırması anlamsız → `null`.
//   • `±100%` bandı korunur (pipeline bu bandı bekliyor).
// ============================================================================

/** SearchAPI anahtarı (kaynak modülüyle aynı adlar). */
export function trendsSearchApiKey(env: Record<string, string | undefined> = process.env): string {
  for (const name of ["SEARCHAPI_KEY", "SEARCHAPI_API_KEY", "SEARCHAPI_IO_KEY"]) {
    const v = (env[name] ?? "").trim();
    if (v) return v;
  }
  return "";
}

/** SerpAPI anahtarı (kaynak modülüyle aynı adlar). */
export function trendsSerpApiKey(env: Record<string, string | undefined> = process.env): string {
  for (const name of ["SERPAPI_KEY", "SERP_API_KEY", "SERPAPI_API_KEY"]) {
    const v = (env[name] ?? "").trim();
    if (v) return v;
  }
  return "";
}

/** En az bir anahtarlı Trends yolu var mı? (Ön kontrol paneli için.) */
export function trendsKeyConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(trendsSearchApiKey(env) || trendsSerpApiKey(env));
}

export type KeyedTrends = {
  /** Ölçülen zaman serisi noktaları (0-100 indeks). */
  points: number[];
  /** İki yarı karşılaştırması (%). `±100` ile sınırlı. */
  momentumPct: number;
  /** Serinin ortalaması (0-100) — "ilgi seviyesi" göstergesi. */
  avgIndex: number;
  /** Veriyi hangi servis verdi: `searchapi` | `serpapi`. */
  provider: "searchapi" | "serpapi";
};

/** `interest_over_time.timeline_data[].values[0]` şeklini çözer. */
function timelinePoints(payload: unknown): number[] {
  const rec = (payload ?? {}) as { interest_over_time?: { timeline_data?: unknown } };
  const rows = rec.interest_over_time?.timeline_data;
  if (!Array.isArray(rows)) return [];
  const points: number[] = [];
  for (const raw of rows) {
    const row = (raw ?? {}) as { values?: unknown };
    const first = Array.isArray(row.values) ? (row.values[0] as Record<string, unknown>) : null;
    // `extracted_value` sayıdır; yoksa `value` metninden okunur.
    const n = Number(first?.["extracted_value"] ?? Number(first?.["value"]));
    if (Number.isFinite(n) && n >= 0) points.push(Math.round(n));
  }
  return points;
}

/**
 * Zaman serisinden momentum hesaplar — SAF, ağ YOK.
 *
 * Kural `market-data.server.ts`teki `finalize` ile AYNIDIR: seriyi ikiye böl,
 * ilk yarı ortalamasını son yarı ortalamasıyla karşılaştır. Aynı kuralı
 * kullanmak, iki yolun aynı veri için farklı momentum üretmesini engeller.
 */
export function momentumFromPoints(points: readonly number[]): number | null {
  if (points.length < 4) return null;
  const half = Math.max(1, Math.floor(points.length / 2));
  const first = points.slice(0, half).reduce((a, b) => a + b, 0) / half;
  const last = points.slice(-half).reduce((a, b) => a + b, 0) / half;
  if (!Number.isFinite(first) || first <= 0) return null;
  const pct = Math.round(((last - first) / first) * 100);
  return Math.max(-100, Math.min(100, pct));
}

/** Servis yanıtını ölçülmüş trend serisine çevirir — SAF, ağ YOK. */
export function parseKeyedTrends(
  payload: unknown,
  provider: "searchapi" | "serpapi",
): KeyedTrends | null {
  const points = timelinePoints(payload);
  const momentumPct = momentumFromPoints(points);
  if (momentumPct === null) return null;
  const avgIndex = Math.round(points.reduce((a, b) => a + b, 0) / points.length);
  return { points, momentumPct, avgIndex, provider };
}

/**
 * Anahtarlı Trends araması. SearchAPI önce (ayrı ücretsiz kota), sonra
 * SerpAPI denenir. Hata fırlatmaz — ölçüm yoksa `null`.
 */
export async function fetchKeyedTrends(
  niche: string,
  country = "US",
  timeoutMs = 6_000,
): Promise<KeyedTrends | null> {
  const q = String(niche ?? "").trim().slice(0, 80);
  if (!q) return null;
  const geo = String(country ?? "").trim().toUpperCase() || "US";

  const searchApi = trendsSearchApiKey();
  if (searchApi) {
    const url =
      `https://www.searchapi.io/api/v1/search?engine=google_trends&data_type=TIMESERIES` +
      `&q=${encodeURIComponent(q)}&geo=${geo}&api_key=${encodeURIComponent(searchApi)}`;
    const parsed = await readTrends(url, { accept: "application/json" }, timeoutMs, "searchapi");
    if (parsed) return parsed;
  }

  const serpApi = trendsSerpApiKey();
  if (serpApi) {
    const url =
      `https://serpapi.com/search.json?engine=google_trends&data_type=TIMESERIES` +
      `&q=${encodeURIComponent(q)}&geo=${geo}&api_key=${encodeURIComponent(serpApi)}`;
    return readTrends(url, { accept: "application/json" }, timeoutMs, "serpapi");
  }
  return null;
}

async function readTrends(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  provider: "searchapi" | "serpapi",
): Promise<KeyedTrends | null> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      console.log(`[trends:${provider}] HTTP ${res.status}; diğer yollara düşülüyor`);
      return null;
    }
    return parseKeyedTrends(await res.json().catch(() => null), provider);
  } catch (e) {
    console.log(`[trends:${provider}] istek başarısız: ${(e as Error).message.slice(0, 80)}`);
    return null;
  }
}
