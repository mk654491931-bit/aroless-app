// ============================================================================
// GÜNLÜK RADAR TAZELEME + ÖZET UYARI (sunucu; AI kotası HARCAMAZ)
//
// NEDEN VAR: `radar_items` yalnız kullanıcı "tazele" dediğinde doluyordu; yani
// "her gün otomatik taranan radar" vaadi kullanıcının tıklamasına bağlıydı.
// Zamanlanmış iş yoktu. Vercel Hobby cron günde 1 kez, ±59 dk sapmayla koşar ve
// başarısız koşuyu TEKRAR DENEMEZ → iş bu yüzden iki kurala uyar:
//   1) İDEMPOTENT: o gün kayıt varsa üretim YAPILMAZ, atlanır.
//   2) AI'SIZ: kullanıcı kotası harcanmaz; tohumlar Google Trends yedeğinden
//      gelir (`trendFallbackSeeds`) ve ölçülen trend serisiyle zenginleştirilir.
//
// ÖZET UYARI KURALI: kullanıcı başına TEK bildirim (günlük özet). QStash ücretsiz
// kotası günde 1.000 mesajdır; ürün bazlı bildirim bu kotayı yakardı.
// ============================================================================

import type { Json } from "@/integrations/supabase/types";
import { RADAR_COUNTRIES, applyTrendEvidence, trendFallbackSeeds } from "@/lib/radar.server";
import type { RadarEvidence, RadarSeed } from "@/lib/radar.server";
import {
  buildRadarSeries,
  radarDigestLines,
  radarMovers,
  RADAR_HISTORY_DAYS_DEFAULT,
  type RadarSnapshotRow,
} from "@/lib/radar-series";

/** Varsayılan ülkeler: günde 1 koşuda ikiden fazlası kotayı/zamanı gereksiz yer. */
export const RADAR_REFRESH_COUNTRIES = ["US", "TR"] as const;
/** Trend serisinin toplandığı pencere (gün) — saf sabitten gelir (tek kaynak). */
export const RADAR_HISTORY_DAYS = RADAR_HISTORY_DAYS_DEFAULT;
/** Tek koşuda işlenecek en fazla ülke (Vercel Hobby: 300 sn fonksiyon tavanı). */
export const RADAR_MAX_COUNTRIES = 3;
/** Kullanıcı başına tek bildirim: tek koşuda en fazla bu kadar kullanıcıya yazılır. */
export const RADAR_NOTIFY_LIMIT = 200;

export type RadarRefreshResult = {
  ok: boolean;
  day: string;
  countries: Array<{ country: string; inserted: number; skipped: boolean; error: string | null }>;
  digestLines: number;
  notified: number;
  /** Sır/DB eksikse nedeni ADIYLA yazılır (sessiz başarısızlık olmaz). */
  note: string | null;
};

function isoDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function normCountries(input: readonly string[] | undefined): string[] {
  const list = (input ?? RADAR_REFRESH_COUNTRIES)
    .map((c) => String(c).toUpperCase())
    .filter((c) => (RADAR_COUNTRIES as readonly string[]).includes(c));
  return Array.from(new Set(list)).slice(0, RADAR_MAX_COUNTRIES);
}

/** Tek ülke için bugünün tohumlarını üretir (AI YOK, Trends yedeği). */
async function fallbackSeeds(country: string): Promise<RadarSeed[]> {
  return trendFallbackSeeds(country, 10);
}

/**
 * Tohumları ÖLÇÜLMÜŞ trend verisiyle zenginleştirir (Google Trends).
 * Başarısız olursa tohum ham değerle kalır — akış boşalmaz.
 */
async function enrichSeeds(
  seeds: RadarSeed[],
  country: string,
): Promise<{ rows: RadarSeed[]; digests: RadarEvidence[] }> {
  const { getGoogleTrends } = await import("@/lib/market-data.server");
  const rows: RadarSeed[] = [];
  const digests: RadarEvidence[] = [];
  const deadline = Date.now() + 60_000;
  for (const seed of seeds) {
    const evidence: RadarEvidence = {
      keyword: seed.title,
      trend_source: "estimated",
      trend_momentum_pct: seed.momentum,
      series: [],
      generated_by: "trends",
    };
    if (Date.now() < deadline) {
      try {
        const t = await getGoogleTrends(seed.title, country);
        evidence.trend_source = t.source;
        evidence.trend_momentum_pct = t.momentum_pct;
        evidence.series = t.yearly.slice(-26);
        rows.push(applyTrendEvidence(seed, evidence));
        digests.push(evidence);
        continue;
      } catch {
        /* tahmini değerle devam */
      }
    }
    rows.push(seed);
    digests.push(evidence);
  }
  return { rows, digests };
}

/**
 * Günlük radar tazeleme.
 *
 * Sıra: (1) bugünün kayıtlarını oku → varsa ülkeyi ATLA (idempotent),
 * (2) yoksa Trends yedeğinden tohum üret + zenginleştir + yaz,
 * (3) son 14 günün serisinden YÜKSELEN/DÜŞEN özetini çıkar,
 * (4) `trend_alert` açık kullanıcılara TEK özet bildirim yaz.
 */
export async function runRadarRefresh(
  opts: { now?: number; countries?: readonly string[] } = {},
): Promise<RadarRefreshResult> {
  const now = opts.now ?? Date.now();
  const day = isoDay(now);
  const countries = normCountries(opts.countries);
  const result: RadarRefreshResult = {
    ok: false,
    day,
    countries: [],
    digestLines: 0,
    notified: 0,
    note: null,
  };

  let supabaseAdmin: typeof import("@/integrations/supabase/client.server").supabaseAdmin;
  try {
    ({ supabaseAdmin } = await import("@/integrations/supabase/client.server"));
  } catch {
    result.note = "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY eksik: günlük radar yazılamıyor.";
    return result;
  }

  for (const country of countries) {
    const entry = { country, inserted: 0, skipped: false, error: null as string | null };
    try {
      const existing = await supabaseAdmin
        .from("radar_items")
        .select("id")
        .eq("day", day)
        .eq("country", country)
        .limit(1);
      if ((existing.data ?? []).length > 0) {
        entry.skipped = true;
        result.countries.push(entry);
        continue;
      }
      const seeds = await fallbackSeeds(country);
      if (seeds.length === 0) {
        entry.error = "tohum üretilemedi";
        result.countries.push(entry);
        continue;
      }
      const { rows } = await enrichSeeds(seeds, country);
      const payload = rows.map((seed) => ({ ...seed, day, country }));
      const { error } = await supabaseAdmin.from("radar_items").insert(payload);
      if (error) {
        // Tek bir çakışma toplu yazmayı düşürmesin: satır satır dene.
        for (const row of payload) {
          await supabaseAdmin.from("radar_items").insert(row);
          entry.inserted += 1;
        }
      } else {
        entry.inserted = payload.length;
      }
    } catch (err) {
      entry.error = err instanceof Error ? err.message.slice(0, 140) : "bilinmeyen hata";
    }
    result.countries.push(entry);
  }

  // ---- 3) Günlük özet (14 günlük seriden) ---------------------------------
  const cutoff = isoDay(now - RADAR_HISTORY_DAYS * 86_400_000);
  const history = await supabaseAdmin
    .from("radar_items")
    .select("day,title,winner_score,momentum,price_min,price_max,est_margin_pct")
    .gte("day", cutoff)
    .order("day", { ascending: true })
    .limit(1000);
  const snapshots = (history.data ?? []) as RadarSnapshotRow[];
  const movers = radarMovers(buildRadarSeries(snapshots), 3);
  const lines = radarDigestLines(movers, { maxItems: 3 });
  result.digestLines = lines.length;

  if (lines.length > 0) {
    const prefs = await supabaseAdmin
      .from("notification_preferences")
      .select("user_id")
      .eq("trend_alert", true)
      .limit(RADAR_NOTIFY_LIMIT);
    const userIds = ((prefs.data ?? []) as { user_id: string }[]).map((r) => r.user_id);
    if (userIds.length > 0) {
      const title = `Radar günlük özet · ${lines.length} hareket`;
      const body = lines.join("\n");
      const rows = userIds.map((user_id) => ({
        user_id,
        type: "trend_alert",
        title,
        body,
        data: { day, movers: movers.up.map((m) => ({ title: m.title, scoreDelta: m.scoreDelta })) } as Json,
      }));
      const { error } = await supabaseAdmin.from("notifications").insert(rows);
      if (!error) result.notified = rows.length;
    }
  }

  result.ok = true;
  return result;
}
