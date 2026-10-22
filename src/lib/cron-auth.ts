// ============================================================================
// CRON / ZAMANLANMIŞ İŞ YETKİLENDİRMESİ (saf; ağ/DB YOK)
//
// Vercel cron bir uca `Authorization: Bearer $CRON_SECRET` başlığıyla GET atar
// (Vercel dokümanı, 2026). Biz de aynı sırla doğrularız; sır tanımlı DEĞİLSE
// uç çalışmaz (fail-closed) — aksi hâlde internete açık bir "günlük iş"
// tetikleyicisi herkese açık olurdu.
//
// NEDEN AYRI MODÜL: bu karar güvenlik sınırıdır ve test edilebilir olmalıdır
// (bkz. `cron-auth.test.ts`). Vercel Hobby'de cron günde 1 kez, ±59 dk sapmayla
// koşar ve başarısız koşuyu TEKRAR DENEMEZ; bu yüzden iş idempotenttir.
// ============================================================================

import { timingSafeEqualString } from "./safe-compare";

export type CronAuthEnv = {
  CRON_SECRET?: string;
  JOB_WORKER_SECRET?: string;
};

const SECRET_NAMES = ["CRON_SECRET", "JOB_WORKER_SECRET"] as const;

/** Bu dağıtımda hangi sır adları tanımlı (YALNIZ İSİM, değer değil). */
export function cronSecretNames(env: CronAuthEnv): string[] {
  const out: string[] = [];
  for (const name of SECRET_NAMES) {
    const v = env[name];
    if (typeof v === "string" && v.trim()) out.push(name);
  }
  return out;
}

/** Zamanlanmış iş ucu kullanılabilir mi? Sır yoksa `false` (fail-closed). */
export function cronConfigured(env: CronAuthEnv = process.env): boolean {
  return cronSecretNames(env).length > 0;
}

function bearer(headers: Headers, name: string): string {
  const raw = (headers.get(name) ?? headers.get(name.toLowerCase()) ?? "").trim();
  if (!raw) return "";
  return raw.replace(/^Bearer\s+/i, "").trim();
}

/**
 * İsteği yetkilendirir.
 *
 * KABUL EDİLEN YOLLAR: `Authorization: Bearer <sır>` (Vercel cron) veya
 * `x-cron-secret: <sır>` (elle tetikleme / QStash). Sırlardan HERHANGİ biri
 * eşleşirse geçer. Sır yoksa `false`.
 */
export function cronAuthorized(headers: Headers, env: CronAuthEnv = process.env): boolean {
  const provided = [bearer(headers, "authorization"), bearer(headers, "x-cron-secret")].filter(
    Boolean,
  );
  if (provided.length === 0) return false;
  for (const name of SECRET_NAMES) {
    const expected = (env[name] ?? "").trim();
    if (!expected) continue;
    // Sabit zamanlı: sırlar `===` ile karşılaştırılmaz (timing attack).
    if (provided.some((p) => timingSafeEqualString(p, expected))) return true;
  }
  return false;
}
