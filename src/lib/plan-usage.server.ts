/**
 * PAKET KULLANIMI — sunucu tarafı (kayıt + okuma).
 *
 * NEDEN BURADA: `credit_usage_log` tablosu (user_id, tool, credits, success,
 * created_at) zaten vardı ama ona HİÇBİR satır yazılmıyordu. Sonuç: kullanım
 * günlüğü boş, sol bardaki modül kullanımı hiç eksilmiyor, paket kotaları
 * (30/90/300 araç vb.) yalnız ekranda yazan bir sayıydı.
 *
 * Bu modül iki işi yapar:
 *   1. `recordAiUsage` — gerçekten jeton düşen her AI işini deftere yazar,
 *   2. `planUsageSnapshot` — bu ayın sayaçlarını paket limitleriyle birleştirir.
 *
 * FAIL-SOFT: defter yazılamazsa AI işi DÜŞMEZ (kullanıcı hizmet almaya devam
 * eder). Defter yalnız "ne kadar kullanıldı" sorusunu yanıtlar; cevapsız kalması
 * işi iptal etmek için sebep değildir. Limit kapısı bu yüzden sayacı
 * okuyamazsa ENGELLEMEZ (fail-open) — kota korumak için müşteriyi kapıda
 * bırakmak daha kötüdür.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ADMIN_QUOTA, tierLevel } from "./plans";
import {
  emptyUsageCounts,
  monthRange,
  planUsageRows,
  usageKindForFeature,
  type UsageCounts,
  type UsageRow,
} from "./plan-usage";

/** Tek ay için okunacak en fazla satır (kaba üst sınır; aşılırsa sayaç alt sınır olur). */
const MAX_ROWS = 5_000;

export type UsageSnapshot = {
  tier: string;
  level: 0 | 1 | 2 | 3;
  isAdmin: boolean;
  /** "2026-10" */
  period: string;
  /** Sayaçların başladığı an (ay başı, ISO). */
  since: string;
  rows: UsageRow[];
  /** Sayaç okunabildi mi? `false` ise satırlar 0 gösterir — "kullanılmadı" değil "bilinmiyor". */
  measured: boolean;
};

/**
 * Bir AI işini deftere yazar.
 *
 * KURAL: yalnız GERÇEKTEN jeton düşen işler yazılır (`credits > 0`). Önbellekten
 * dönen yanıt jeton harcamadığı için kullanım da artırmaz — arayüzde
 * "önbellekten geldi, jeton harcanmadı" sözü böylece doğru kalır.
 */
export async function recordAiUsage(opts: {
  userId: string;
  /** `tool:listing-seo` | `council` | `agent-pipeline` | `radar-scan` … */
  feature: string;
  credits: number;
  success?: boolean;
  model?: string | null;
  meta?: Record<string, unknown>;
}): Promise<void> {
  const credits = Math.max(0, Math.floor(Number(opts.credits) || 0));
  if (!opts.userId || credits === 0) return;
  try {
    const { error } = await supabaseAdmin.from("credit_usage_log").insert({
      user_id: opts.userId,
      tool: String(opts.feature ?? "unknown").slice(0, 80),
      credits,
      success: opts.success ?? true,
      model: opts.model ? String(opts.model).slice(0, 80) : null,
      meta: { kind: usageKindForFeature(opts.feature), ...(opts.meta ?? {}) },
    } as never);
    if (error) {
      console.warn(`[usage] kayıt yazılamadı (${opts.feature}): ${error.message.slice(0, 80)}`);
    }
  } catch (e) {
    console.warn(`[usage] kayıt hatası (${opts.feature}): ${(e as Error).message.slice(0, 80)}`);
  }
}

/**
 * Bu ayın sayaçları. Hata durumunda `null` döner: "okunamadı" ile "hiç
 * kullanılmadı" AYNI ŞEY DEĞİLDİR ve limit kapısı ikisini ayırmak zorundadır.
 */
export async function monthUsage(
  userId: string,
  now: Date = new Date(),
): Promise<UsageCounts | null> {
  if (!userId) return null;
  const { startIso } = monthRange(now);
  try {
    const { data, error } = await supabaseAdmin
      .from("credit_usage_log")
      .select("tool, credits")
      .eq("user_id", userId)
      .gte("created_at", startIso)
      .limit(MAX_ROWS);
    if (error) {
      console.warn(`[usage] sayaç okunamadı: ${error.message.slice(0, 80)}`);
      return null;
    }
    const counts = emptyUsageCounts();
    for (const row of (data ?? []) as { tool?: string | null; credits?: number | null }[]) {
      const kind = usageKindForFeature(String(row.tool ?? ""));
      counts[kind] += Math.max(0, Math.floor(Number(row.credits ?? 0)));
    }
    return counts;
  } catch (e) {
    console.warn(`[usage] sayaç hatası: ${(e as Error).message.slice(0, 80)}`);
    return null;
  }
}

/** Kullanıcı yönetici mi? (Yalnız ücretsiz planda sorulur — ek sorgu maliyeti yok.) */
export async function isAdminUser(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (error) return false;
    return Boolean(data);
  } catch {
    return false;
  }
}

/** Üst bar / sol bar / ayarlar: paket + bu ayın kullanımı tek yanıtta. */
export async function planUsageSnapshot(
  userId: string,
  now: Date = new Date(),
): Promise<UsageSnapshot> {
  const { startIso, key } = monthRange(now);
  let tier = "Free";
  try {
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("subscription_tier")
      .eq("id", userId)
      .maybeSingle();
    tier = (data as { subscription_tier?: string | null } | null)?.subscription_tier ?? "Free";
  } catch {
    // profil okunamazsa ücretsiz varsayılır; ekran yanlış limit gösterirse
    // kullanıcı paketini görmez — bu yüzden log bırakılır.
    console.warn("[usage] profil okunamadı, Free varsayıldı");
  }
  const level = tierLevel(tier);
  const admin = level === 0 ? await isAdminUser(userId) : false;
  const counts = await monthUsage(userId, now);
  return {
    tier,
    level,
    isAdmin: admin,
    period: key,
    since: startIso,
    measured: counts !== null,
    rows: planUsageRows(level, counts ?? emptyUsageCounts(), admin),
  };
}

/** Yönetici kotası — panelin "admin 250" satırı ile aynı kaynak. */
export const USAGE_ADMIN_QUOTA = ADMIN_QUOTA;
