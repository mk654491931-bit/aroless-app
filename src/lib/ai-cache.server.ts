// ============================================================================
// Smart Caching (24h) — Supabase backed with an in-memory hot layer.
// Identical product / trend queries never burn a second AI call within 24h.
//
// ÜCRETSİZ PLAN NOTU: AI kotaları bu mimarideki en dar kaynaktır. Aynı girdiyle
// tekrar gelen bir istek ikinci kez modele gitmemelidir — hem kota israfı hem de
// gereksiz bekleme olur. Bu yüzden TTL artık **çağrı başına** verilebilir:
// zaman duyarlı sonuçlar (ör. araçların `news` çıktısı, 10 dk) kısa, yapısal
// sonuçlar (ör. landed-cost hesabı, 12 saat) uzun yaşar.
// ============================================================================

/** Varsayılan yaşam süresi: 24 saat. Çağrı başına kısaltılabilir. */
const TTL_MS = 24 * 60 * 60 * 1000;

type Entry = { at: number; expiresAt: number; value: unknown };
const memory = new Map<string, Entry>();

/**
 * Kalıcı (Supabase) katman testlerde kapatılır.
 *
 * `swr-cache.server.ts` ile aynı kural: testler bu modülün BELLEK içi
 * sözleşmesini doğrular (TTL, cache_hit, anahtar normalizasyonu). Kalıcı katman
 * açık kalsaydı testler ağa çıkar ve önceki koşulardan kalan kayıtlar sonucu
 * değiştirirdi.
 */
function persistEnabled(): boolean {
  return !(process.env["VITEST"] || process.env["NODE_ENV"] === "test");
}

/** Stable cache key: scope + normalised parts, hashed to a short hex string. */
export async function cacheKey(scope: string, parts: unknown[]): Promise<string> {
  const raw = `${scope}::${parts
    .map((p) =>
      String(p ?? "")
        .trim()
        .toLowerCase(),
    )
    .join("|")}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return `${scope}:${[...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const hit = memory.get(key);
  if (hit) {
    // TTL girdi bazlıdır: kısa ömürlü (ör. 10 dk'lık haber) bir kayıt bellekte
    // 24 saat kalmamalı, yoksa bayat veri "taze" sanılırdı.
    if (hit.expiresAt > Date.now()) return hit.value as T;
    memory.delete(key);
  }

  if (!persistEnabled()) return null;

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("ai_cache")
      .select("payload, expires_at")
      .eq("cache_key", key)
      .maybeSingle();
    if (!data) return null;
    const expiresAt = new Date(String(data.expires_at)).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
    memory.set(key, { at: Date.now(), expiresAt, value: data.payload });
    return data.payload as T;
  } catch {
    return null;
  }
}

/**
 * Değeri belleğe ve (mümkünse) Supabase'e yazar.
 *
 * `ttlMs` verilmezse 24 saat kullanılır; kalıcı katmanın `expires_at` alanı da
 * aynı süreden hesaplanır ki sunucusuz bir sonraki örnek bu kaydı okuduğunda
 * onu taze sanmasın.
 */
export async function cacheSet(
  key: string,
  scope: string,
  value: unknown,
  ttlMs: number = TTL_MS,
): Promise<void> {
  const ttl = Math.max(1_000, Math.min(TTL_MS, Math.round(ttlMs)));
  memory.set(key, { at: Date.now(), expiresAt: Date.now() + ttl, value });
  if (!persistEnabled()) return;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("ai_cache").upsert(
      {
        cache_key: key,
        scope,
        payload: value as never,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + ttl).toISOString(),
      },
      { onConflict: "cache_key" },
    );
  } catch {
    /* cache is best-effort */
  }
}

/** get-or-compute helper. */
export async function cached<T>(
  scope: string,
  parts: unknown[],
  compute: () => Promise<T>,
  ttlMs: number = TTL_MS,
): Promise<{ data: T; cache_hit: boolean }> {
  const key = await cacheKey(scope, parts);
  const hit = await cacheGet<T>(key);
  if (hit) return { data: hit, cache_hit: true };
  const data = await compute();
  await cacheSet(key, scope, data, ttlMs);
  return { data, cache_hit: false };
}
