// ============================================================================
// SONUÇ GERİ BİLDİRİM — "bu ürünü daha önce kaç kez önerdik, nasıl durdu?"
//
// NE ÖLÇÜLÜR: `radar_items` tablosunda KALICI olarak duran önceki kazanan
// kayıtları. Aynı ürün adı farklı günlerde yeniden çıktıysa, her biri AYRI bir
// koşunun ürünü bağımsız olarak seçtiğinin kanıtıdır. Puan ortalaması, en iyi
// sıra ve son görülme günü bu kayıtlardan hesaplanır.
//
// NE ÖLÇÜLMEZ (dürüstlük): SATIŞ. Uygulama kullanıcının ürünü alıp almadığını
// bilemez. Bu yüzden metinlerde "satış" değil "geçmiş performans / track record"
// denir: iki ayrı koşunun birbirini doğrulaması, satış kanıtı değil.
//
// Bu modül YAZMA YAPMAZ; yalnızca var olan kayıtları okur ve özetler.
// ============================================================================

import type { Json } from "@/integrations/supabase/types";
import { normalizeProductIdentity } from "./product-identity";

/** Bir ürünün geçmiş performans özeti. */
export type TrackRecord = {
  /** Kayıttaki ürün adı (insan tarafından okunabilen etiket). */
  title: string;
  /** Kaç ayrı günde kaçananlar arasına girdi. */
  appearances: number;
  /** Bu görünüşlerdeki ortalama kazanan puanı (0-100). */
  avgScore: number;
  /** En iyi sırası (1 = birinci). */
  bestRank: number;
  /** En son görüldüğü gün (`YYYY-MM-DD`). */
  lastSeenDay: string;
  /** Bugünden itibaren kaç gün geçmiş. */
  daysSinceSeen: number;
};

/** Bu özet için kaç güne bakılacağı. */
export const TRACK_RECORD_LOOKBACK_DAYS = 30;

/** Geriye dönük bakışın alt sınırı (ISO gün). */
export function lookbackStart(lookbackDays = TRACK_RECORD_LOOKBACK_DAYS, now = Date.now()): string {
  const start = new Date(now - lookbackDays * 24 * 60 * 60 * 1000);
  return start.toISOString().slice(0, 10);
}

/** İki `YYYY-MM-DD` gün arasındaki fark (gün). */
export function daysBetween(fromDay: string, toDay: string): number {
  const from = Date.parse(`${fromDay}T00:00:00.000Z`);
  const to = Date.parse(`${toDay}T00:00:00.000Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.round((to - from) / (24 * 60 * 60 * 1000)));
}

export type TrackRecordRow = {
  title: string;
  day: string;
  winner_score: number;
  payload?: unknown;
};

/** Satırın içindeki gerçek sıra numarası; yoksa 99 (bilinmiyor). */
function rankOf(row: TrackRecordRow): number {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const rank = Number(payload["rank"]);
  return Number.isFinite(rank) && rank >= 1 ? Math.round(rank) : 99;
} /**
 * Ham kazanan satırlarını ürün başına geçmiş performansa indirger.
 *
 * EŞLEŞTİRME ANAHTARI ÜRÜN ADI DEĞİL, NORMALİZE PARMAK İZİDİR: "Mini Ice Maker
 * XR-500" ile "mini ice maker xr 500" aynı üründür. Ham ada göre eşleştirilseydi
 * aynı ürün her koşuda "yeni" görünür ve geçmiş performans sessizce boşa çıkardı.
 *
 * Çıktı iki anahtarla döner: normalize parmak izi (eşleştirme için) ve ham ad
 * (panelde gösterilecek etiket). Çağıran taraf ikisinden de yararlanır.
 *
 * SAF: veritabanı bilmez, testte düz satırlarla doğrulanır. Aynı gündeki
 * TEKRAR eden satırlar tek görünüş sayılır (aynı ürün iki kez listelenmiş olabilir).
 */
export function summarizeTrackRecords(
  rows: readonly TrackRecordRow[],
  now = Date.now(),
): Record<string, TrackRecord> {
  const today = new Date(now).toISOString().slice(0, 10);
  const grouped = new Map<
    string,
    { title: string; days: Set<string>; scores: number[]; bestRank: number; lastDay: string }
  >();

  for (const row of rows) {
    const title = String(row.title ?? "").trim();
    const identity = normalizeProductIdentity(title);
    if (!identity) continue;
    const day = String(row.day ?? "").slice(0, 10);
    if (!day) continue;
    const slot = grouped.get(identity) ?? {
      title,
      days: new Set<string>(),
      scores: [],
      bestRank: 99,
      lastDay: day,
    };
    slot.days.add(day);
    const score = Number(row.winner_score);
    if (Number.isFinite(score)) slot.scores.push(score);
    slot.bestRank = Math.min(slot.bestRank, rankOf(row));
    if (day > slot.lastDay) slot.lastDay = day;
    grouped.set(identity, slot);
  }

  const out: Record<string, TrackRecord> = {};
  for (const [identity, slot] of grouped) {
    out[identity] = {
      title: slot.title,
      appearances: slot.days.size,
      avgScore:
        slot.scores.length > 0
          ? Math.round(slot.scores.reduce((sum, s) => sum + s, 0) / slot.scores.length)
          : 0,
      bestRank: slot.bestRank,
      lastSeenDay: slot.lastDay,
      daysSinceSeen: daysBetween(slot.lastDay, today),
    };
  }
  return out;
}

/**
 * Aday ürünlerin geçmiş performansını kalıcı kazanan kayıtlarından okur.
 *
 * SORGU NEDEN BU KADAR GENİŞ: `radar_items.payload` içindeki `product_identity`
 * JSON yolundan PostgREST ile `IN` filtresi güvenilir DEĞİLDİR. Bunun yerine son
 * N günün kayıtları ülkeye göre çekilir ve eşleştirme istemcide, normalize parmak
 * iziyle yapılır. 200 satırlık tek sayfalık okuma küçüktür ve her koşuda en fazla
 * bir kez yapılır; buna karşılık her koşuda ham ada göre `.in("title", …)` ile
 * sormak geçmişi sessizce kaçırırdı.
 */
export async function fetchTrackRecords(input: {
  titles: readonly string[];
  country: string;
  platform: string;
  lookbackDays?: number;
  now?: number;
}): Promise<Record<string, TrackRecord>> {
  const wanted = new Set(
    input.titles.map((t) => normalizeProductIdentity(String(t ?? ""))).filter(Boolean),
  );
  if (wanted.size === 0) return {};
  const now = input.now ?? Date.now();
  const since = lookbackStart(input.lookbackDays ?? TRACK_RECORD_LOOKBACK_DAYS, now);
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("radar_items")
      .select("title, day, winner_score, payload")
      .eq("country", (input.country || "GLOBAL").toUpperCase())
      .gte("day", since)
      .order("day", { ascending: false })
      .limit(200);
    if (error) return {};
    const all = summarizeTrackRecords(
      ((data ?? []) as unknown as TrackRecordRow[]).map((row) => ({
        title: row.title,
        day: row.day,
        winner_score: row.winner_score,
        payload: row.payload as Json,
      })),
      now,
    );
    // Yalnızca adaylarla eşleşenleri döndür: dönmemesi doğru davranıştır, çünkü
    // bu harita ajan istemine ürün başına yazılır.
    const out: Record<string, TrackRecord> = {};
    for (const identity of wanted) {
      const hit = all[identity];
      if (hit) out[identity] = hit;
    }
    return out;
  } catch {
    // Geçmiş performans ZENGİNLEŞTİRİCİDİR: okunamazsa koşu normal devam eder.
    return {};
  }
}
