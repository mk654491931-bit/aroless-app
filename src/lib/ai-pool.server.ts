// ============================================================================
// Aroless Unified AI Node Pool (server only)
//
// Central availability registry for the platform's resilient multi-provider
// mesh. Every feature that needs an LLM call can consume nodes from here and
// get the same guarantees:
//
//   • one ordered pool built from every configured key slot
//   • class-based priority routing (fast sweeps vs deep reasoning)
//   • per-node cooldown: 429/401/402/403 → 90s, 5xx → 45s, empty/network → 15s
//   • round-robin start cursor so concurrent tasks fan out across nodes
//   • zero secret leakage: health/summary APIs expose counts and labels only
//
// Slot layout (the "22-key pool"):
//   CEREBRAS          keys CEREBRAS_API_KEY, CEREBRAS_API_KEY_1.._5   (fast)
//   SAMBANOVA         keys SAMBANOVA_API_KEY, SAMBANOVA_API_KEY_1.._5  (deep)
//   PROVIDER_A..D     keys PROVIDER_<X>_1.._5, OpenAI-compatible URL from
//                     PROVIDER_<X>_BASE_URL (also accepts _URL / _API_URL),
//                     optional PROVIDER_<X>_MODEL override. When no base URL is
//                     configured the provider's keys are skipped automatically,
//                     so the pool degrades cleanly to the remaining nodes.
//
// No fetch to provider A–D happens until a base URL is configured — keys alone
// are never enough to guess an endpoint, and the pool must never fabricate one.
// ============================================================================

export type PoolGroup =
  | "cerebras"
  | "sambanova"
  | "pool_a"
  | "pool_b"
  | "pool_c"
  | "pool_d";

export type PoolPriority = "fast" | "deep";

export interface PoolNode {
  /** Stable public id, e.g. "CEREBRAS-02" — safe to log/show in UI. */
  id: string;
  group: PoolGroup;
  /** 1-based slot index inside the group. */
  slot: number;
  /** Primary routing class of the group. */
  priority: PoolPriority;
  /** Human label for logs/metrics ("active_api_node_used"). */
  label: string;
}

export type PoolNodeOutcome =
  | "quota" // 429/401/402/403 — long cooldown
  | "server" // 5xx — short cooldown
  | "network" // timeout / transport — short cooldown
  | "empty" // success but blank/unusable payload
  | "ok";

/** PROVIDER_<X> env prefix for the pool_a..pool_d groups. */
function poolEnvPrefix(group: PoolGroup): string {
  if (group === "pool_a") return "PROVIDER_A";
  if (group === "pool_b") return "PROVIDER_B";
  if (group === "pool_c") return "PROVIDER_C";
  if (group === "pool_d") return "PROVIDER_D";
  return group.toUpperCase();
}

const SLOT_KEY_ENVS = {
  cerebras: ["CEREBRAS_API_KEY", "CEREBRAS_API_KEY_1", "CEREBRAS_API_KEY_2", "CEREBRAS_API_KEY_3", "CEREBRAS_API_KEY_4", "CEREBRAS_API_KEY_5"],
  sambanova: ["SAMBANOVA_API_KEY", "SAMBANOVA_API_KEY_1", "SAMBANOVA_API_KEY_2", "SAMBANOVA_API_KEY_3", "SAMBANOVA_API_KEY_4", "SAMBANOVA_API_KEY_5"],
} as const;

const GROUP_PRIORITY: Record<PoolGroup, PoolPriority> = {
  cerebras: "fast",
  sambanova: "deep",
  pool_a: "fast",
  pool_b: "fast",
  pool_c: "fast",
  pool_d: "fast",
};

/** Display order when a request has no class preference. */
const ALL_ORDER: PoolGroup[] = [
  "cerebras",
  "sambanova",
  "pool_a",
  "pool_b",
  "pool_c",
  "pool_d",
];

/** "fast" sweep order: Cerebras + high-speed slots first. */
const FAST_ORDER: PoolGroup[] = [
  "cerebras",
  "pool_a",
  "pool_b",
  "pool_c",
  "pool_d",
  "sambanova",
];

/** "deep" reasoning order: SambaNova + high-context slots first. */
const DEEP_ORDER: PoolGroup[] = [
  "sambanova",
  "pool_a",
  "pool_b",
  "pool_c",
  "pool_d",
  "cerebras",
];

// ------------------------------------------------------------------ cooldown

const cooldownUntil = new Map<string, number>(); // node id -> epoch ms
const groupCooldownUntil = new Map<PoolGroup, number>(); // whole group parked
const COOLDOWN_MS: Record<Exclude<PoolNodeOutcome, "ok">, number> = {
  quota: 90_000,
  server: 45_000,
  network: 15_000,
  empty: 15_000,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ registry

function readEnv(name: string): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : "";
}

function poolGroupKeys(group: PoolGroup): string[] {
  if (group === "pool_a" || group === "pool_b" || group === "pool_c" || group === "pool_d") {
    const prefix = poolEnvPrefix(group);
    const keys: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const v = readEnv(`${prefix}_${i}`);
      if (v) keys.push(v);
    }
    return Array.from(new Set(keys));
  }
  const envs = SLOT_KEY_ENVS[group];
  const keys = envs.map(readEnv).filter(Boolean);
  return Array.from(new Set(keys));
}

/** Optional OpenAI-compatible endpoint config for a PROVIDER_<X> group. */
export function poolGroupConfig(group: PoolGroup): {
  baseUrl: string;
  model: string;
} {
  if (group === "pool_a" || group === "pool_b" || group === "pool_c" || group === "pool_d") {
    const prefix = poolEnvPrefix(group);
    const baseUrl =
      readEnv(`${prefix}_BASE_URL`) ||
      readEnv(`${prefix}_URL`) ||
      readEnv(`${prefix}_API_URL`) ||
      readEnv(`${prefix}_HOST`);
    const model = readEnv(`${prefix}_MODEL`) || "Meta-Llama-3.3-70B-Instruct";
    return { baseUrl, model };
  }
  if (group === "cerebras") {
    return { baseUrl: "https://api.cerebras.ai/v1/chat/completions", model: "" };
  }
  return { baseUrl: "https://api.sambanova.ai/v1/chat/completions", model: "" };
}

/** All configured, cooled-down nodes, in priority-aware order. */
export function buildPoolNodes(
  priority: PoolPriority | "all" = "all",
): PoolNode[] {
  const groups: PoolGroup[] =
    priority === "fast" ? FAST_ORDER : priority === "deep" ? DEEP_ORDER : ALL_ORDER;
  const nodes: PoolNode[] = [];
  for (const group of groups) {
    const keys = poolGroupKeys(group);
    if (!keys.length) continue;
    if (group === "cerebras" || group === "sambanova") {
      keys.forEach((_, i) => {
        const slot = i + 1;
        if (!isNodeCool(group, slot)) return;
        nodes.push({
          id: `${group.toUpperCase()}-${String(slot).padStart(2, "0")}`,
          group,
          slot,
          priority: GROUP_PRIORITY[group],
          label: `${group.toUpperCase()}-${String(slot).padStart(2, "0")}`,
        });
      });
      continue;
    }
    const { baseUrl } = poolGroupConfig(group);
    if (!baseUrl) continue; // no endpoint → never guess one
    keys.forEach((_, i) => {
      const slot = i + 1;
      if (!isNodeCool(group, slot)) return;
      nodes.push({
        id: `${group.toUpperCase()}-${String(slot).padStart(2, "0")}`,
        group,
        slot,
        priority: GROUP_PRIORITY[group],
        label: `${group.toUpperCase()}-${String(slot).padStart(2, "0")}`,
      });
    });
  }
  return nodes;
}

function isNodeCool(group: PoolGroup, slot: number): boolean {
  const id = nodeId(group, slot);
  if ((cooldownUntil.get(id) ?? 0) > Date.now()) return false;
  if ((groupCooldownUntil.get(group) ?? 0) > Date.now()) return false;
  return true;
}

function nodeId(group: PoolGroup, slot: number): string {
  return `${group.toUpperCase()}-${String(slot).padStart(2, "0")}`;
}

/** Reads a group's API keys in slot order (used by provider wrappers). */
export function readPoolGroupKeys(group: PoolGroup): string[] {
  return poolGroupKeys(group);
}

/** True when the group has at least one configured key. */
export function poolGroupConfigured(group: PoolGroup): boolean {
  return poolGroupKeys(group).length > 0;
}

export function poolGroupAvailable(group: PoolGroup): boolean {
  if (!poolGroupConfigured(group)) return false;
  if ((groupCooldownUntil.get(group) ?? 0) > Date.now()) return false;
  const { baseUrl } = poolGroupConfig(group);
  if (group === "cerebras" || group === "sambanova") return true;
  return Boolean(baseUrl);
}

/**
 * Report the outcome of a node attempt. Failures park the node; repeated
 * quota/server failures across a group park the whole group briefly.
 */
export function markPoolGroupOutcome(group: PoolGroup, slot: number, outcome: PoolNodeOutcome): void {
  if (outcome === "ok") {
    cooldownUntil.delete(nodeId(group, slot));
    groupCooldownUntil.delete(group);
    return;
  }
  cooldownUntil.set(nodeId(group, slot), Date.now() + COOLDOWN_MS[outcome]);
}

/**
 * Park an ENTIRE group (whole rotation exhausted). Used when a provider
 * wrapper burned through every key of a group in one call.
 */
export function parkPoolGroup(group: PoolGroup, outcome: Exclude<PoolNodeOutcome, "ok">): void {
  groupCooldownUntil.set(group, Date.now() + COOLDOWN_MS[outcome]);
}

/** Smallest future wait before the given priority class has a node again. */
export function poolBackoffMs(priority: PoolPriority | "all" = "all"): number {
  const now = Date.now();
  let min = 0;
  const groups = priority === "all" ? ALL_ORDER : priority === "fast" ? FAST_ORDER : DEEP_ORDER;
  for (const group of groups) {
    const keys = poolGroupKeys(group);
    if (!keys.length) continue;
    const until = Math.max(cooldownUntil.get(nodeId(group, 1)) ?? 0, groupCooldownUntil.get(group) ?? 0);
    if (until > now) min = min === 0 ? until - now : Math.min(min, until - now);
    else return 0;
  }
  return min;
}

/** Counts + labels only — never key material. Safe for logs / health UIs. */
export function poolHealthSummary(): {
  total: number;
  configured: number;
  available: number;
  byGroup: Record<string, { configured: number; available: number }>;
} {
  const byGroup: Record<string, { configured: number; available: number }> = {};
  for (const group of ALL_ORDER) {
    const keys = poolGroupKeys(group);
    if (!keys.length) continue;
    const { baseUrl } = poolGroupConfig(group);
    const usable = group === "cerebras" || group === "sambanova" ? true : Boolean(baseUrl);
    const configured = keys.length;
    const available = usable ? buildPoolNodes().filter((n) => n.group === group).length : 0;
    byGroup[group] = { configured, available };
  }
  const total = Object.values(byGroup).reduce((s, g) => s + g.configured, 0);
  const available = Object.values(byGroup).reduce((s, g) => s + g.available, 0);
  return { total, configured: total, available, byGroup };
}

// ------------------------------------------------------------------ one-shot call

export type PoolCallOptions = {
  prompt: string;
  temperature?: number;
  jsonMode?: boolean;
  timeoutMs?: number;
};

export class PoolNodeError extends Error {
  readonly kind: Exclude<PoolNodeOutcome, "ok">;
  readonly status: number;
  readonly retriable: boolean;
  constructor(kind: Exclude<PoolNodeOutcome, "ok">, message: string, status = 0) {
    super(message);
    this.name = "PoolNodeError";
    this.kind = kind;
    this.status = status;
    this.retriable = true;
  }
}

function classify(status: number, body: string): PoolNodeError {
  if (status === 429 || status === 401 || status === 402 || status === 403)
    return new PoolNodeError("quota", `${status} ${body.slice(0, 140)}`.trim(), status);
  if (status >= 500)
    return new PoolNodeError("server", `${status} ${body.slice(0, 140)}`.trim(), status);
  return new PoolNodeError("server", `${status} ${body.slice(0, 140)}`.trim(), status);
}

/**
 * Deterministic single-slot OpenAI-compatible call with timeout.
 * Throws PoolNodeError — caller should markPoolGroupOutcome + rotate.
 */
export async function callPoolNode(
  node: PoolNode,
  opts: PoolCallOptions,
): Promise<string> {
  const { baseUrl, model } = poolGroupConfig(node.group);
  if (!baseUrl) throw new PoolNodeError("server", `no endpoint for ${node.group}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 45_000);
  try {
    const resp = await fetch(baseUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${readPoolGroupKeys(node.group)[node.slot - 1] ?? ""}`,
      },
      body: JSON.stringify({
        model,
        temperature: opts.temperature ?? 0.3,
        messages: [{ role: "user", content: opts.prompt }],
        ...(opts.jsonMode === false ? {} : { response_format: { type: "json_object" } }),
      }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw classify(resp.status, body);
    }
    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = (json.choices?.[0]?.message?.content ?? "").trim();
    if (!text) throw new PoolNodeError("empty", "empty payload");
    return text;
  } catch (e) {
    if (e instanceof PoolNodeError) throw e;
    if (e instanceof Error && e.name === "AbortError")
      throw new PoolNodeError("network", "timeout");
    throw new PoolNodeError("network", e instanceof Error ? e.message : "network error");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Try every ready node of a class in priority order until one succeeds.
 * Never throws the last error for quota/network — returns "" only when truly
 * nothing is available so callers can fall through to their own chains.
 */
export async function runPoolWithFailover(
  priority: PoolPriority | "all",
  opts: PoolCallOptions,
): Promise<{ text: string; node: PoolNode | null }> {
  const nodes = buildPoolNodes(priority);
  if (!nodes.length) return { text: "", node: null };
  let lastErr: unknown = null;
  for (const node of nodes) {
    try {
      const text = await callPoolNode(node, opts);
      markPoolGroupOutcome(node.group, node.slot, "ok");
      return { text, node };
    } catch (e) {
      lastErr = e;
      if (e instanceof PoolNodeError) {
        markPoolGroupOutcome(node.group, node.slot, e.kind);
      }
      if (e instanceof PoolNodeError && e.kind === "quota") continue;
      // 5xx / network / empty — quick hop to the next node, tiny stagger
      await sleep(150);
    }
  }
  if (lastErr instanceof Error) return { text: "", node: null };
  return { text: "", node: null };
}

/** Test helper: clear all cooldowns (also used between tests). */
export function resetPoolCooldowns(): void {
  cooldownUntil.clear();
  groupCooldownUntil.clear();
}
