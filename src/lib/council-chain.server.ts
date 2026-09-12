import { z } from "zod";

export const COUNCIL_AGENT_KEYS = [
  "cfo",
  "cmo",
  "cro",
  "trend_hunter",
  "competitor_intel",
  "ux_specialist",
  "supply_chain",
  "pricing_strategist",
  "logistics_cost",
  "compliance_officer",
  "retention_ltv",
  "creative_director",
  "channel_fit",
  "independent_data_auditor",
] as const;

export type CouncilAgentKey = (typeof COUNCIL_AGENT_KEYS)[number];

export type CouncilDebugStatus = "SUCCESS" | "EMPTY" | "FALLBACK_TRIGGERED";

export type CouncilDebugLog = {
  step: string;
  input: string;
  output: string;
  item_count: number;
  status: CouncilDebugStatus;
};

const score = z.number().min(0).max(100).default(50);
const finiteNumber = z.number().finite().default(0);
const safeString = z.string().default("");
const safeStringArray = z.array(z.string()).default([]);

export const COUNCIL_SCHEMAS = {
  cfo: z.object({
    cfo_score: score,
    unit_economics_valid: z.boolean().default(false),
    margin_ratio: finiteNumber,
    flag: safeString,
  }),
  cmo: z.object({
    cmo_score: score,
    target_roas: finiteNumber,
    audience_fit: safeString,
  }),
  cro: z.object({
    cro_score: score,
    ip_risk_level: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
    trademark_cleared: z.boolean().default(false),
  }),
  trend_hunter: z.object({
    trend_score: score,
    virality_index: finiteNumber,
    trending_platform: safeString,
  }),
  competitor_intel: z.object({
    competitor_score: score,
    market_saturation: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
    competitor_count: finiteNumber,
  }),
  ux_specialist: z.object({
    ux_score: score,
    sentiment_rating: finiteNumber,
    common_complaint: safeString,
  }),
  supply_chain: z.object({
    supply_score: score,
    stock_risk: z.boolean().default(false),
    delivery_days_avg: finiteNumber,
  }),
  pricing_strategist: z.object({
    pricing_score: score,
    optimal_price: finiteNumber,
    markup_ratio: finiteNumber,
  }),
  logistics_cost: z.object({
    logistics_score: score,
    shipping_cost_est: finiteNumber,
    freight_ratio: finiteNumber,
  }),
  compliance_officer: z.object({
    compliance_score: score,
    certificates_needed: safeStringArray,
    customs_passed: z.boolean().default(false),
  }),
  retention_ltv: z.object({
    retention_score: score,
    estimated_ltv: finiteNumber,
    repeat_purchase_rate: finiteNumber,
  }),
  creative_director: z.object({
    creative_score: score,
    hook_strength: finiteNumber,
    ugc_potential: safeString,
  }),
  channel_fit: z.object({
    channel_score: score,
    best_channel: safeString,
    margin_after_fees: finiteNumber,
  }),
  independent_data_auditor: z.object({
    auditor_score: score,
    data_confidence: finiteNumber,
    audit_approved: z.boolean().default(false),
  }),
} as const;

type CouncilSchemaMap = typeof COUNCIL_SCHEMAS;
export type CouncilOutput<K extends CouncilAgentKey = CouncilAgentKey> = z.infer<
  CouncilSchemaMap[K]
>;
export type CouncilOutputMap = Partial<{
  [K in CouncilAgentKey]: z.infer<CouncilSchemaMap[K]>;
}>;

export type CouncilAgentDefinition = {
  key: CouncilAgentKey;
  name: string;
  task: string;
  scoreKey: string;
};

export const COUNCIL_AGENTS: readonly CouncilAgentDefinition[] = [
  {
    key: "cfo",
    name: "CFO Agent",
    task: "Unit economics, landed cost ve 3PL.",
    scoreKey: "cfo_score",
  },
  {
    key: "cmo",
    name: "CMO Agent",
    task: "Audience fit, target ROAS/CPC simulation.",
    scoreKey: "cmo_score",
  },
  { key: "cro", name: "CRO Agent", task: "Brand ve IP risk scan.", scoreKey: "cro_score" },
  {
    key: "trend_hunter",
    name: "Trend Hunter Agent",
    task: "Sosyal medya engagement ve view momentum.",
    scoreKey: "trend_score",
  },
  {
    key: "competitor_intel",
    name: "Competitor Intel Agent",
    task: "Aktif Shopify/Amazon saturation audit.",
    scoreKey: "competitor_score",
  },
  {
    key: "ux_specialist",
    name: "UX Specialist Agent",
    task: "Müşteri incelemeleri sentiment analizi.",
    scoreKey: "ux_score",
  },
  {
    key: "supply_chain",
    name: "Supply Chain Agent",
    task: "Supplier stock stability ve delivery SLA.",
    scoreKey: "supply_score",
  },
  {
    key: "pricing_strategist",
    name: "Pricing Strategist Agent",
    task: "Markup merdiveni ve fiyat esnekliği.",
    scoreKey: "pricing_score",
  },
  {
    key: "logistics_cost",
    name: "Logistics Cost Agent",
    task: "Navlun/ciro oranı ve 3PL maliyeti.",
    scoreKey: "logistics_score",
  },
  {
    key: "compliance_officer",
    name: "Compliance Officer Agent",
    task: "CE/FDA/SDS ve gümrük bariyerleri.",
    scoreKey: "compliance_score",
  },
  {
    key: "retention_ltv",
    name: "Retention & LTV Analyst Agent",
    task: "Tekrar satın alma ve LTV/CAC.",
    scoreKey: "retention_score",
  },
  {
    key: "creative_director",
    name: "Creative Director Agent",
    task: "Kanca gücü, UGC ve 3 saniye retention.",
    scoreKey: "creative_score",
  },
  {
    key: "channel_fit",
    name: "Channel Fit Agent",
    task: "Pazar yeri komisyonu ve rekabet eşleşmesi.",
    scoreKey: "channel_score",
  },
  {
    key: "independent_data_auditor",
    name: "Independent Data Auditor Agent",
    task: "Konsey girdilerinin kanıt kapsamı.",
    scoreKey: "auditor_score",
  },
];

const DEFAULT_TEXT = "Veri bulunamadı; güvenli nötr değerlendirme uygulandı.";

const neutralValues: Record<CouncilAgentKey, Record<string, unknown>> = {
  cfo: { cfo_score: 50, unit_economics_valid: false, margin_ratio: 0, flag: DEFAULT_TEXT },
  cmo: { cmo_score: 50, target_roas: 0, audience_fit: DEFAULT_TEXT },
  cro: { cro_score: 50, ip_risk_level: "MEDIUM", trademark_cleared: false },
  trend_hunter: { trend_score: 50, virality_index: 0, trending_platform: DEFAULT_TEXT },
  competitor_intel: { competitor_score: 50, market_saturation: "MEDIUM", competitor_count: 0 },
  ux_specialist: { ux_score: 50, sentiment_rating: 0, common_complaint: DEFAULT_TEXT },
  supply_chain: { supply_score: 50, stock_risk: false, delivery_days_avg: 0 },
  pricing_strategist: { pricing_score: 50, optimal_price: 0, markup_ratio: 0 },
  logistics_cost: { logistics_score: 50, shipping_cost_est: 0, freight_ratio: 0 },
  compliance_officer: {
    compliance_score: 50,
    certificates_needed: [DEFAULT_TEXT],
    customs_passed: false,
  },
  retention_ltv: { retention_score: 50, estimated_ltv: 0, repeat_purchase_rate: 0 },
  creative_director: { creative_score: 50, hook_strength: 0, ugc_potential: DEFAULT_TEXT },
  channel_fit: { channel_score: 50, best_channel: DEFAULT_TEXT, margin_after_fees: 0 },
  independent_data_auditor: { auditor_score: 50, data_confidence: 50, audit_approved: false },
};

function normalizeScore(value: unknown): { value: number; fallback: boolean } {
  if (
    value === null ||
    value === undefined ||
    (typeof value !== "number" && typeof value !== "string")
  ) {
    return { value: 50, fallback: true };
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return { value: 50, fallback: true };
  return {
    value: Math.max(1, Math.min(100, Math.round(n))),
    fallback: typeof value !== "number",
  };
}

type NormalizedValue = { value: unknown; fallback: boolean };

function normalizeCouncilValue(
  key: CouncilAgentKey,
  field: string,
  value: unknown,
  fallbackValue: unknown,
): NormalizedValue {
  if (value === null || value === undefined) return { value: fallbackValue, fallback: true };

  if (typeof fallbackValue === "boolean") {
    return typeof value === "boolean"
      ? { value, fallback: false }
      : { value: fallbackValue, fallback: true };
  }

  if (typeof fallbackValue === "number") {
    const numberValue = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numberValue)
      ? { value: numberValue, fallback: typeof value !== "number" }
      : { value: fallbackValue, fallback: true };
  }

  if (Array.isArray(fallbackValue)) {
    return Array.isArray(value) && value.every((item) => typeof item === "string")
      ? { value: value.slice(0, 20), fallback: false }
      : { value: fallbackValue, fallback: true };
  }

  if (typeof fallbackValue === "string") {
    if (typeof value !== "string") return { value: fallbackValue, fallback: true };
    if (key === "cro" && field === "ip_risk_level" && !["LOW", "MEDIUM", "HIGH"].includes(value)) {
      return { value: fallbackValue, fallback: true };
    }
    if (
      key === "competitor_intel" &&
      field === "market_saturation" &&
      !["LOW", "MEDIUM", "HIGH"].includes(value)
    ) {
      return { value: fallbackValue, fallback: true };
    }
    return { value, fallback: false };
  }

  return { value: fallbackValue, fallback: true };
}

/** Parse one model response and return only the requested agent's strict fields. */
export function normalizeCouncilOutput<K extends CouncilAgentKey>(
  key: K,
  raw: unknown,
): { output: CouncilOutput<K>; usedFallback: boolean } {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const defaults = neutralValues[key];
  const scoreKey = COUNCIL_AGENTS.find((agent) => agent.key === key)?.scoreKey ?? "";
  const scoreResult = normalizeScore(source[scoreKey]);
  const candidate: Record<string, unknown> = {};
  let usedFallback = scoreResult.fallback;

  for (const [field, fallbackValue] of Object.entries(defaults)) {
    if (field === scoreKey) {
      candidate[field] = scoreResult.value;
      continue;
    }
    const normalized = normalizeCouncilValue(key, field, source[field], fallbackValue);
    candidate[field] = normalized.value;
    usedFallback = usedFallback || normalized.fallback;
  }

  const parsed = COUNCIL_SCHEMAS[key].safeParse(candidate);
  if (parsed.success) {
    return { output: parsed.data as CouncilOutput<K>, usedFallback };
  }
  return {
    output: COUNCIL_SCHEMAS[key].parse(defaults) as CouncilOutput<K>,
    usedFallback: true,
  };
}

export function agentSchemaHint(key: CouncilAgentKey): string {
  const defaults = neutralValues[key];
  return JSON.stringify(defaults);
}

export type StrictCouncilRunResult = {
  raw: unknown;
  ok: boolean;
  error?: string;
};

export type StrictCouncilChainResult = {
  outputs: CouncilOutputMap;
  logs: CouncilDebugLog[];
  councilAverage: number;
  productFingerprint: number;
  finalScore: number;
  shouldList: boolean;
};

/**
 * Runs the 14-member chain sequentially. The state is never replaced: every
 * member receives the complete accumulated JSON and returns only its own
 * strict sub-schema. A failed/empty/zero response becomes a neutral 50 before
 * the next member is called, so one provider cannot erase the search result.
 */
export async function runStrictCouncilChain(input: {
  query: string;
  context?: string;
  candidates?: Array<Record<string, unknown>>;
  run: (agent: CouncilAgentDefinition, prompt: string) => Promise<StrictCouncilRunResult>;
}): Promise<StrictCouncilChainResult> {
  const outputs: CouncilOutputMap = {};
  const logs: CouncilDebugLog[] = [];
  const candidates = input.candidates ?? [];
  const context = [
    `QUERY: ${input.query.slice(0, 240)}`,
    input.context?.slice(0, 8_000) ?? "",
    candidates.length
      ? `CANDIDATES: ${JSON.stringify(candidates).slice(0, 8_000)}`
      : "CANDIDATES: []",
  ]
    .filter(Boolean)
    .join("\n");

  for (const agent of COUNCIL_AGENTS) {
    const prior = JSON.stringify(outputs).slice(0, 14_000);
    const prompt = `You are ${agent.name}, member ${COUNCIL_AGENTS.indexOf(agent) + 1}/14 of the Aroless AI Council.\nTASK: ${agent.task}\n\n${context}\n\nPREVIOUS COUNCIL JSON (preserve it conceptually; enrich only your own fields):\n${prior || "{}"}\n\nCHAIN RULES:\n- Return ONLY valid minified JSON. No markdown or commentary.\n- Return exactly these fields and no extra fields: ${agentSchemaHint(agent.key)}\n- Never return null or a zero score. If evidence is missing, use score 50 and explain the neutral fallback in a string field when available.\n- Do not delete or rewrite another agent's output. Your response is merged server-side.\n- Numbers must be finite. Prefer conservative estimates over invented precision.`;

    let result: StrictCouncilRunResult;
    try {
      result = await input.run(agent, prompt);
    } catch (error) {
      result = {
        raw: {},
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const rawObject =
      result.raw && typeof result.raw === "object" && !Array.isArray(result.raw)
        ? (result.raw as Record<string, unknown>)
        : {};
    const normalized = normalizeCouncilOutput(agent.key, result.ok ? rawObject : {});
    outputs[agent.key] = normalized.output as never;
    const isEmpty = Object.keys(rawObject).length === 0;
    const usedFallback = !result.ok || normalized.usedFallback;
    const status: CouncilDebugStatus = !result.ok
      ? "FALLBACK_TRIGGERED"
      : isEmpty
        ? "EMPTY"
        : normalized.usedFallback
          ? "FALLBACK_TRIGGERED"
          : "SUCCESS";
    const errorText = result.error ? ` ${result.error.slice(0, 140)}` : "";
    logs.push(
      makeDebugLog(
        agent.name,
        { query: input.query, prior_agents: Object.keys(outputs).length - 1 },
        usedFallback
          ? { ...normalized.output, fallback: DEFAULT_TEXT + errorText }
          : normalized.output,
        candidates.length,
        status,
      ),
    );
    emitDebugLog(logs[logs.length - 1]);
  }

  const fingerprint = productFingerprint(candidates);
  const average = councilAverage(outputs);
  const finalScore = finalCouncilScore(outputs, fingerprint);
  return {
    outputs,
    logs,
    councilAverage: average,
    productFingerprint: fingerprint,
    finalScore,
    shouldList: finalScore >= 60,
  };
}

/** Build the broadest useful search terms without making the retriever too strict. */
export function relaxSearchQuery(query: string): string[] {
  const normalized = query.trim().replace(/\s+/g, " ").slice(0, 200);
  if (!normalized) return [];
  const stopWords = new Set([
    "a",
    "an",
    "and",
    "for",
    "the",
    "with",
    "ile",
    "ve",
    "için",
    "bir",
    "ürün",
    "product",
    "bul",
    "find",
  ]);
  const words = normalized
    .split(/[\s,;|/]+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2 && !stopWords.has(word.toLocaleLowerCase("tr-TR")));
  const broad = words.slice(0, 3).join(" ");
  const first = words[0] ?? normalized;
  const relaxedVariants = [normalized, broad, first];
  if (relaxedVariants.filter(Boolean).length < 2) {
    relaxedVariants.push(`${first} alternatif`);
  }
  return [...new Set(relaxedVariants.filter(Boolean))];
}

export function councilAverage(outputs: CouncilOutputMap): number {
  const values = COUNCIL_AGENTS.map((agent) => {
    const output = outputs[agent.key] as Record<string, unknown> | undefined;
    return normalizeScore(output?.[agent.scoreKey]).value;
  });
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

/** Product fingerprint is deterministic and neutral when evidence is absent. */
export function productFingerprint(items: Array<Record<string, unknown>>): number {
  if (!items.length) return 50;
  const uniqueNames = new Set(
    items.map((item) =>
      String(item.name ?? item.title ?? "")
        .trim()
        .toLocaleLowerCase("tr-TR"),
    ),
  );
  const withCommercialData = items.filter((item) =>
    [item.priceRange, item.estimatedMarginPct, item.category, item.whyNow].some(
      (value) => value !== undefined && String(value).trim() !== "",
    ),
  ).length;
  return Math.max(
    50,
    Math.min(100, Math.round(50 + uniqueNames.size * 5 + withCommercialData * 5)),
  );
}

export function finalCouncilScore(outputs: CouncilOutputMap, fingerprint: number): number {
  return Math.round(councilAverage(outputs) * 0.7 + fingerprint * 0.3);
}

export function makeDebugLog(
  step: string,
  input: unknown,
  output: unknown,
  itemCount: number,
  status: CouncilDebugStatus,
): CouncilDebugLog {
  const compact = (value: unknown) => {
    try {
      const serialized = JSON.stringify(value);
      return (serialized === undefined ? "null" : serialized).slice(0, 2_000);
    } catch {
      return "{}";
    }
  };
  return {
    step,
    input: compact(input),
    output: compact(output),
    item_count: Math.max(0, itemCount),
    status,
  };
}

export function emitDebugLog(log: CouncilDebugLog): void {
  console.log(JSON.stringify(log));
}
