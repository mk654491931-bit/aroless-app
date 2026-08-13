// ============================================================================
// Smart Caching (24h) — Supabase backed with an in-memory hot layer.
// Identical product / trend queries never burn a second AI call within 24h.
// ============================================================================

const TTL_MS = 24 * 60 * 60 * 1000;

type Entry = { at: number; value: unknown };
const memory = new Map<string, Entry>();

/** Stable cache key: scope + normalised parts, hashed to a short hex string. */
export async function cacheKey(scope: string, parts: unknown[]): Promise<string> {
  const raw = `${scope}::${parts.map((p) => String(p ?? "").trim().toLowerCase()).join("|")}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return `${scope}:${[...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  if (hit) memory.delete(key);

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("ai_cache")
      .select("payload, expires_at")
      .eq("cache_key", key)
      .maybeSingle();
    if (!data) return null;
    if (new Date(String(data.expires_at)).getTime() <= Date.now()) return null;
    memory.set(key, { at: Date.now(), value: data.payload });
    return data.payload as T;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, scope: string, value: unknown): Promise<void> {
  memory.set(key, { at: Date.now(), value });
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("ai_cache").upsert(
      {
        cache_key: key,
        scope,
        payload: value as never,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + TTL_MS).toISOString(),
      },
      { onConflict: "cache_key" },
    );
  } catch {
    /* cache is best-effort */
  }
}

/** get-or-compute helper. */
export async function cached<T>(scope: string, parts: unknown[], compute: () => Promise<T>): Promise<{ data: T; cache_hit: boolean }> {
  const key = await cacheKey(scope, parts);
  const hit = await cacheGet<T>(key);
  if (hit) return { data: hit, cache_hit: true };
  const data = await compute();
  await cacheSet(key, scope, data);
  return { data, cache_hit: false };
}
