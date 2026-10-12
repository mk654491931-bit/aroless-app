// ============================================================================
// RADAR ZAMAN SERİSİ (saf fonksiyonlar; ağ/AI/DB YOK)
//
// NEDEN VAR: `radar_items` tablosu GÜN GÜN kazanan kayıtları saklıyor
// (day, winnerscore, momentum, price_min/price_max, est_margin_pct). Ama
// arayüzde yalnız BUGÜN gösteriliyordu; yani "radar" bir anlık fotoğraftı,
// trend değildi. Buradaki fonksiyonlar o seriyi ürüne çevirir: gün gün
// skor/momentum/fiyat hareketi, yön bayrakları ve uyarı özeti (digest).
//
// KURAL: hesaplar YALNIZ ölçülmüş alanlardan yapılır; ölçülmeyen alan
// (ör. fiyat 0 ise) değişime KATILMAZ, `null` döner — 0 varsayılmaz.
// ============================================================================

/**
 * Serinin toplandığı varsayılan pencere (gün).
 *
 * 14 gün seçildi: kazanan ürün hareketi haftalık ritimde anlamlıdır, daha uzun
 * pencere eski (artık geçerli olmayan) fiyatları trend gibi gösterir.
 */
export const RADAR_HISTORY_DAYS_DEFAULT = 14;

export type RadarSnapshotRow = {
  day: string;
  title: string;
  winner_score: number;
  momentum: number;
  price_min: number;
  price_max: number;
  est_margin_pct: number;
};

export type RadarPoint = {
  day: string;
  score: number;
  momentum: number;
  priceMin: number;
  priceMax: number;
  marginPct: number;
};

export type RadarFlag =
  | "yeni"
  | "yeniden-yukselis"
  | "fiyat-dusuyor"
  | "momentum-kirildi"
  | "istikrarli";

export type RadarSeries = {
  /** Normalize edilmiş kimlik anahtarı (aynı ürünün farklı yazımlarını birleştirir). */
  key: string;
  /** En son görülen yazım. */
  title: string;
  days: number;
  points: RadarPoint[];
  firstDay: string;
  lastDay: string;
  scoreDelta: number;
  momentumDelta: number;
  /** Ölçülmüş fiyat varsa yüzde değişim; yoksa `null`. */
  priceChangePct: number | null;
  flags: RadarFlag[];
  /** Sparkline için skor serisi (en eski → en yeni). */
  spark: number[];
};

/** Aynı ürünü farklı yazımlardan birleştiren anahtar (küçük harf + ilk 4 kelime). */
export function seriesKey(title: string): string {
  return String(title ?? "")
    .toLocaleLowerCase("tr-TR")
    .replace(/[^a-z0-9çğıöşü\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join(" ");
}

function finite(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Günlük kayıtları ürün başına seriye çevirir (en eski → en yeni).
 *
 * `minPoints` altındaki seriler elenir: tek günlük kayıt "trend" değildir.
 */
export function buildRadarSeries(
  rows: readonly RadarSnapshotRow[],
  opts: { minPoints?: number } = {},
): RadarSeries[] {
  const minPoints = Math.max(1, opts.minPoints ?? 2);
  const groups = new Map<string, RadarSnapshotRow[]>();
  for (const row of rows) {
    const key = seriesKey(row.title);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const out: RadarSeries[] = [];
  for (const [key, list] of groups) {
    const sorted = [...list].sort((a, b) => a.day.localeCompare(b.day));
    // Aynı gün birden fazla kayıt varsa EN YÜKSEK skorlu olan alınır
    // (aynı gün tekrar üretimi veriyi bozmasın).
    const byDay = new Map<string, RadarSnapshotRow>();
    for (const row of sorted) {
      const prev = byDay.get(row.day);
      if (!prev || finite(row.winner_score)! > finite(prev.winner_score)!) byDay.set(row.day, row);
    }
    const days = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
    const points: RadarPoint[] = days.map((d) => ({
      day: d.day,
      score: finite(d.winner_score) ?? 0,
      momentum: finite(d.momentum) ?? 0,
      priceMin: Math.max(0, finite(d.price_min) ?? 0),
      priceMax: Math.max(0, finite(d.price_max) ?? 0),
      marginPct: Math.max(0, finite(d.est_margin_pct) ?? 0),
    }));
    if (points.length < minPoints) continue;

    const first = points[0]!;
    const last = points[points.length - 1]!;
    const scoreDelta = Math.round((last.score - first.score) * 10) / 10;
    const momentumDelta = last.momentum - first.momentum;
    const priceChangePct =
      first.priceMin > 0 && last.priceMin > 0
        ? Math.round(((last.priceMin - first.priceMin) / first.priceMin) * 1000) / 10
        : null;

    const flags: RadarFlag[] = [];
    if (points.length <= 2 && scoreDelta >= 5) flags.push("yeni");
    if (scoreDelta > 0 && momentumDelta > 0) flags.push("yeniden-yukselis");
    if (priceChangePct !== null && priceChangePct <= -5) flags.push("fiyat-dusuyor");
    if (scoreDelta < 0 && momentumDelta < 0) flags.push("momentum-kirildi");
    if (flags.length === 0) flags.push("istikrarli");

    out.push({
      key,
      title: days[days.length - 1]!.title,
      days: points.length,
      points,
      firstDay: first.day,
      lastDay: last.day,
      scoreDelta,
      momentumDelta,
      priceChangePct,
      flags,
      spark: points.map((p) => p.score),
    });
  }
  return out.sort((a, b) => b.scoreDelta - a.scoreDelta || b.lastDay.localeCompare(a.lastDay));
}

/** Uyarı özeti için yükselen/düşen ayrımı. */
export function radarMovers(
  series: readonly RadarSeries[],
  limit = 3,
): { up: RadarSeries[]; down: RadarSeries[] } {
  const up = series.filter((s) => s.scoreDelta > 0).slice(0, limit);
  const down = series
    .filter((s) => s.scoreDelta < 0)
    .sort((a, b) => a.scoreDelta - b.scoreDelta)
    .slice(0, limit);
  return { up, down };
}

/**
 * Bildirim gövdesi (tek özet — kota koruması).
 *
 * Kullanıcı başına TEK bildirim: QStash ücretsiz kotası günde 1.000 mesajdır;
 * ürün bazlı spam yerine günlük özet tasarımı bilinçlidir.
 */
export function radarDigestLines(
  movers: { up: readonly RadarSeries[]; down: readonly RadarSeries[] },
  opts: { maxItems?: number } = {},
): string[] {
  const max = Math.max(0, opts.maxItems ?? 3);
  const lines: string[] = [];
  for (const s of movers.up.slice(0, max)) {
    const bits = [`skor ${s.scoreDelta > 0 ? "+" : ""}${s.scoreDelta}`];
    if (s.priceChangePct !== null && s.priceChangePct !== 0) {
      bits.push(`fiyat ${s.priceChangePct > 0 ? "+" : ""}${s.priceChangePct}%`);
    }
    if (s.flags.includes("fiyat-dusuyor")) bits.push("son 90 günün dibine yaklaşıyor");
    lines.push(`${s.title}: ${bits.join(" · ")}`);
  }
  for (const s of movers.down.slice(0, Math.max(0, max - movers.up.length))) {
    lines.push(`${s.title}: skor ${s.scoreDelta} (momentum kırıldı)`);
  }
  return lines;
}

/**
 * SVG sparkline yolu — saf, test edilebilir.
 *
 * Boş/tek noktada `""` döner (arayüz çizgi yerine düz nokta gösterir).
 */
export function sparklinePath(
  values: readonly number[],
  width: number,
  height: number,
  padding = 1,
): string {
  const vals = values.filter((v) => Number.isFinite(v));
  if (vals.length < 2 || width <= 0 || height <= 0) return "";
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const innerW = Math.max(1, width - padding * 2);
  const innerH = Math.max(1, height - padding * 2);
  return vals
    .map((v, i) => {
      const x = padding + (i / (vals.length - 1)) * innerW;
      const y = padding + (1 - (v - min) / span) * innerH;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

/** Bayrak etiketleri (arayüz çipleri). */
export const RADAR_FLAG_LABEL: Record<RadarFlag, string> = {
  yeni: "yeni giriş",
  "yeniden-yukselis": "yeniden yükseliş",
  "fiyat-dusuyor": "fiyat düşüyor",
  "momentum-kirildi": "momentum kırıldı",
  istikrarli: "istikrarlı",
};
