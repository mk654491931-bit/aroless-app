// ============================================================================
// Usage quota enforcement (server only)
//
// The quota functions are SECURITY DEFINER and resolve the user from
// `auth.uid()`, so they must be called with the caller's own access token —
// exactly like the credit RPC. PostgREST is called directly to keep the calls
// typed here instead of depending on regenerated Supabase types.
// ============================================================================

import {
  normalizeUsageSnapshot,
  parseConsumeResult,
  type RpcCapable,
  type UsageConsumeResult,
  type UsageEnforcement,
  type UsageFeature,
  type UsageSnapshot,
} from "./usage";

export type { UsageConsumeResult, UsageEnforcement, UsageSnapshot };

function config(): { url: string; key: string } | null {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  return url && key ? { url, key } : null;
}

async function callRpc(
  token: string,
  fn: string,
  args: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<{ ok: boolean; status: number; data: unknown } | null> {
  const cfg = config();
  if (!cfg || !token) return null;

  const res = await fetchImpl(`${cfg.url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(8_000),
  });

  const data = (await res.json().catch(() => null)) as unknown;
  return { ok: res.ok, status: res.status, data };
}

/** Reads the caller's monthly usage snapshot (used by the dashboard panel). */
export async function fetchUsageSnapshot(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UsageSnapshot | null> {
  try {
    const result = await callRpc(token, "usage_snapshot", {}, fetchImpl);
    if (!result?.ok) return null;
    return normalizeUsageSnapshot(result.data);
  } catch (error) {
    console.error("[usage] snapshot failed", error);
    return null;
  }
}

/**
 * Enforces and increments a monthly quota. Academy and Simulation always
 * succeed with `unlimited: true` and are never counted.
 */
export async function consumeUsage(
  token: string,
  feature: UsageFeature,
  amount = 1,
  fetchImpl: typeof fetch = fetch,
): Promise<UsageConsumeResult> {
  try {
    const result = await callRpc(
      token,
      "consume_usage",
      { _feature: feature, _amount: amount },
      fetchImpl,
    );
    if (!result) return { ok: false, error: "unauthenticated", limit: 0, used: 0 };
    if (!result.ok) {
      console.error("[usage] consume failed", result.status, result.data);
      return { ok: false, error: "unavailable", limit: 0, used: 0 };
    }
    return parseConsumeResult(result.data);
  } catch (error) {
    console.error("[usage] consume threw", error);
    return { ok: false, error: "unavailable", limit: 0, used: 0 };
  }
}

/**
 * Bumps a counter with the caller's access token (streaming route paths, where
 * there is no Supabase client in scope). Never throws and never blocks.
 */
export async function recordUsageWithToken(
  token: string,
  feature: UsageFeature,
  amount = 1,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  try {
    const result = await callRpc(
      token,
      "record_usage",
      { _feature: feature, _amount: amount },
      fetchImpl,
    );
    if (result && !result.ok) console.error("[usage] record failed", result.status, result.data);
  } catch (error) {
    console.error("[usage] record threw", error);
  }
}

/**
 * Enforces a monthly quota through the caller's own Supabase session
 * (serverFn paths, where `auth.uid()` is already the signed-in user).
 *
 * Degrades open on purpose: if the quota functions are missing (migration not
 * applied yet) or the RPC errors, the run is allowed instead of blocking a
 * paying user. Only an explicit `limit_reached` blocks.
 */
export async function enforceUsage(
  client: unknown,
  feature: UsageFeature,
  amount = 1,
): Promise<UsageEnforcement> {
  const rpc = (client as Partial<RpcCapable> | undefined)?.rpc;
  if (typeof rpc !== "function") return { ok: false, reason: "unavailable" };

  try {
    const { data, error } = await rpc.call(client, "consume_usage", {
      _feature: feature,
      _amount: amount,
    });
    if (error) {
      console.error("[usage] consume failed", error.message);
      return { ok: false, reason: "unavailable" };
    }
    const parsed = parseConsumeResult(data);
    if (parsed.ok) {
      return { ok: true, used: parsed.used, limit: parsed.limit, unlimited: parsed.unlimited };
    }
    if (parsed.error === "limit_reached") {
      return { ok: false, reason: "limit_reached", used: parsed.used, limit: parsed.limit };
    }
    return { ok: false, reason: "unavailable" };
  } catch (error) {
    console.error("[usage] consume threw", error);
    return { ok: false, reason: "unavailable" };
  }
}

type LegacyRpcCapable = {
  rpc: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
};

/**
 * Bumps a counter without enforcing the limit. Used on paths that already
 * deduct the legacy credit wallet, so the dashboard stays truthful without
 * blocking a user twice for the same run. Never throws.
 */
export async function recordUsage(
  client: unknown,
  feature: UsageFeature,
  amount = 1,
): Promise<void> {
  try {
    const rpc = (client as LegacyRpcCapable | undefined)?.rpc;
    if (typeof rpc !== "function") return;
    const result = (await rpc.call(client, "record_usage", {
      _feature: feature,
      _amount: amount,
    })) as { error?: { message?: string } } | undefined;
    if (result?.error?.message) console.error("[usage] record failed", result.error.message);
  } catch (error) {
    console.error("[usage] record threw", error);
  }
}

/** Admin-panel reset for a single user's current-month counters. */
export async function adminResetUsage(userId: string): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rpc = (supabaseAdmin as unknown as LegacyRpcCapable).rpc;
    const result = (await rpc.call(supabaseAdmin, "admin_reset_usage", {
      _user_id: userId,
    })) as { error?: { message?: string } } | undefined;
    if (result?.error?.message) {
      console.error("[usage] admin reset failed", result.error.message);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[usage] admin reset threw", error);
    return false;
  }
}
