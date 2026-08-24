// Server-only multi-provider AI router for the 19 Aroless tools.
// Hybrid mode: several engines answer the same prompt in parallel and their
// outputs are fused into one richer, cross-checked result.
import {
  callGemini,
  callGroq,
  callLovableAI,
  extractJson,
  geminiKeyPool,
  isQuotaError,
} from "./ai.server";
import { withEstimationRules } from "./ai-guidance";

export type ToolResult = {
  headline: string;
  metrics: { label: string; value: string; tone?: "profit" | "warning" | "action" | "neutral" }[];
  bullets: string[];
  table: { columns: string[]; rows: string[][] } | null;
  document: string | null;
  /** Concrete risks / traps found by the critic pass. */
  risks?: string[];
  /** Prioritised next actions. */
  actions?: string[];
  /** Assumptions the numbers depend on. */
  assumptions?: string[];
  /** One-line verdict (go / dikkat / kaçın …). */
  verdict?: string;
  /** 0-100 opportunity/quality score. */
  score?: number;
  provider: string;
  /** Engines that actually contributed to this fused answer. */
  providers?: string[];
  /** 0-100 — engine agreement + coverage based confidence. */
  confidence?: number;
};

const EMPTY: Omit<ToolResult, "provider"> = {
  headline: "",
  metrics: [],
  bullets: [],
  table: null,
  document: null,
  risks: [],
  actions: [],
  assumptions: [],
  verdict: "",
  score: 0,
};

export const SCHEMA_HINT = `Think step by step internally (unit economics, benchmarks, worst case) but output ONLY minified JSON with this exact shape:
{"headline": string (max 120 chars, contains at least one number),
 "verdict": string (max 60 chars, e.g. "GİRİLİR — marj %31" / "DİKKAT — kur riski"),
 "score": number 0-100 (opportunity/quality score for this specific case),
 "metrics": [{"label": string, "value": string, "tone": "profit"|"warning"|"action"|"neutral"}] (3-6 items, always numeric values with units),
 "bullets": [string] (3-6 concrete, numeric insights — no generic advice),
 "risks": [string] (2-4 specific failure modes with the number that triggers them),
 "actions": [string] (3-5 prioritised next steps, each starting with a verb and a deadline/quantity),
 "assumptions": [string] (1-3 assumptions the numbers depend on),
 "table": {"columns": [string], "rows": [[string]]} | null,
 "document": string | null (full ready-to-send text when the task asks for a letter/pitch/sheet, markdown allowed)}`;

/** All configured OpenRouter keys, de-duplicated, in rotation order. */
function openRouterKeyPool(): string[] {
  const raw = [
    process.env["OPENROUTER_API_KEY"],
    process.env["OPENROUTER_API_KEY1"],
    process.env["OPENROUTER_API_KEY_1"],
    process.env["OPENROUTER_API_KEY2"],
    process.env["OPENROUTER_API_KEY_2"],
    process.env["OPENROUTER_2_API_KEY"],
    process.env["OPENROUTER_API_KEY_3"],
    process.env["OPENROUTER_API_KEY3"],
  ].filter((k): k is string => Boolean(k && k.trim()));
  return Array.from(new Set(raw));
}

/** OpenAI-compatible OpenRouter call with key rotation and gateway fallback. */
export async function callOpenRouter(prompt: string, temperature = 0.4): Promise<string> {
  prompt = withEstimationRules(prompt);
  const keys = openRouterKeyPool();
  if (!keys.length) return callLovableAI(prompt, temperature);
  // Keep only OpenRouter-native providers here; Google models are served through
  // the direct Gemini key rotation instead (avoids "provider 'google' is not supported").
  const models = ["meta-llama/llama-3.3-70b-instruct", "mistralai/mistral-small-3.1-24b-instruct"];
  let lastErr: unknown = null;
  for (const key of keys) {
    for (let i = 0; i < models.length; i++) {
      try {
        const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model: models[i],
            temperature,
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
          }),
        });
        if (!resp.ok) {
          const body = (await resp.text()).slice(0, 180);
          lastErr = new Error(`OpenRouter ${resp.status}: ${body}`);
          if (isQuotaError(resp.status, body)) break; // key spent — rotate
          continue;
        }
        const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
        return json.choices?.[0]?.message?.content ?? "{}";
      } catch (e) {
        lastErr = e;
      }
    }
  }
  try {
    return await callLovableAI(prompt, temperature);
  } catch {
    throw lastErr instanceof Error ? lastErr : new Error("OpenRouter request failed");
  }
}

export async function callGroq2(prompt: string, temperature = 0.3): Promise<string> {
  prompt = withEstimationRules(prompt);
  return callGroq(prompt, temperature);
}

export type Provider = "gemini" | "groq" | "openrouter" | "lovable";

const ALL_PROVIDERS: Provider[] = ["gemini", "groq", "openrouter", "lovable"];

let geminiCursor = 0;
/** Round-robin over every configured Gemini key so no single key is drained. */
function geminiKey(slot: 1 | 2 = 1) {
  const pool = geminiKeyPool();
  if (!pool.length) return undefined;
  const idx = (geminiCursor++ + (slot - 1)) % pool.length;
  return pool[idx];
}

function buildRunners(full: string, temperature: number): Record<Provider, () => Promise<string>> {
  return {
    gemini: () => callGemini(full, geminiKey(1), temperature, true),
    groq: () => callGroq(full, temperature),
    openrouter: () => callOpenRouter(full, temperature),
    lovable: () => callLovableAI(full, temperature),
  };
}

function parseResult(text: string): Partial<ToolResult> | null {
  const parsed = extractJson<Partial<ToolResult>>(text, {});
  if (!parsed) return null;
  const empty =
    !parsed.headline && !parsed.bullets?.length && !parsed.document && !parsed.metrics?.length;
  return empty ? null : parsed;
}

/**
 * Hybrid execution, 2 stages:
 *  1) Draft — the 3 best-suited engines answer the same prompt in parallel.
 *  2) Synthesis — a different engine acts as a critic/editor: it reads all
 *     drafts, kills contradictions, keeps the strongest numbers and returns a
 *     single sharper answer. Falls back to a mechanical fusion when the critic
 *     is unavailable.
 */
export async function runTool(
  prompt: string,
  preferred: Provider = "gemini",
  temperature = 0.5,
): Promise<ToolResult> {
  const full = `${prompt}\n\n${SCHEMA_HINT}`;
  const runners = buildRunners(full, temperature);
  const order: Provider[] = [preferred, ...ALL_PROVIDERS.filter((p) => p !== preferred)];
  const primary = order.slice(0, 3);
  const backup = order.slice(3);

  const settled = await Promise.allSettled(primary.map((p) => runners[p]()));
  const good: { provider: Provider; data: Partial<ToolResult> }[] = [];
  let lastErr: unknown = null;
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") {
      const data = parseResult(s.value);
      if (data) good.push({ provider: primary[i], data });
    } else lastErr = s.reason;
  });

  if (!good.length) {
    for (const p of backup) {
      try {
        const data = parseResult(await runners[p]());
        if (data) good.push({ provider: p, data });
        if (good.length) break;
      } catch (e) {
        lastErr = e;
      }
    }
  }
  if (!good.length) {
    // Absolute last resort — keep the UI working instead of surfacing an API error.
    try {
      const data = parseResult(await callLovableAI(full, temperature));
      if (data) good.push({ provider: "lovable", data });
    } catch (e) {
      lastErr = e;
    }
  }
  if (!good.length) {
    // Kısa nefes molası + tam tur yeniden deneme: bir motorun limiti dolduysa
    // cooldown sonrası diğerleri devralır.
    await new Promise((r) => setTimeout(r, 1500));
    for (const p of order) {
      try {
        const data = parseResult(await runners[p]());
        if (data) {
          good.push({ provider: p, data });
          break;
        }
      } catch (e) {
        lastErr = e;
      }
    }
  }
  if (!good.length) {
    void lastErr;
    throw new Error("Tüm motorlar şu anda yoğun. Birkaç saniye içinde tekrar deneyin.");
  }

  const fused = fuse(good);
  if (good.length < 2) return fused;

  const critic = await synthesize(prompt, good, order);
  if (!critic) return fused;

  return {
    ...fused,
    ...critic,
    metrics: critic.metrics.length ? critic.metrics : fused.metrics,
    bullets: critic.bullets.length ? critic.bullets : fused.bullets,
    table: critic.table ?? fused.table,
    document: critic.document ?? fused.document,
    provider: `hibrit: ${good.map((g) => g.provider).join(" + ")} → sentez`,
    providers: good.map((g) => g.provider),
    confidence: scoreConfidence(good, true),
  };
}

/** Critic/editor pass: one engine reviews every draft and writes the final answer. */
async function synthesize(
  prompt: string,
  drafts: { provider: Provider; data: Partial<ToolResult> }[],
  order: Provider[],
): Promise<ToolResult | null> {
  const used = new Set(drafts.map((d) => d.provider));
  const editor = order.find((p) => !used.has(p)) ?? order[0];

  const body = drafts
    .map(
      (d, i) =>
        `### TASLAK ${i + 1} (motor: ${d.provider})\n${JSON.stringify(d.data).slice(0, 6000)}`,
    )
    .join("\n\n");

  const criticPrompt = `${prompt}

Aşağıda aynı göreve verilmiş ${drafts.length} bağımsız AI taslağı var. Sen baş analistsin (editör/eleştirmen):
${body}

Görevin:
1. Sayısal çelişkileri tespit et; en gerçekçi/muhafazakâr olanı seç ve gerekiyorsa kendin yeniden hesapla.
2. Genel geçer, dolgu cümleleri at. Sadece bu vakaya özgü, ölçülebilir çıktılar bırak.
3. Taslakların atladığı riskleri, gizli maliyetleri ve aksiyonları ekle.
4. Doküman istenen görevlerde en iyi taslağı temel al ama yeniden yazarak güçlendir.
Tek ve nihai cevabı üret.

${SCHEMA_HINT}`;

  const runnerFor: Record<Provider, () => Promise<string>> = {
    gemini: () => callGemini(criticPrompt, geminiKey(1), 0.25, true),
    groq: () => callGroq(criticPrompt, 0.25),
    openrouter: () => callOpenRouter(criticPrompt, 0.25),
    lovable: () => callLovableAI(criticPrompt, 0.25),
  };

  for (const p of [editor, ...order.filter((o) => o !== editor)]) {
    try {
      const data = parseResult(await runnerFor[p]());
      if (data) return normalize(data, p);
    } catch {
      /* try next editor */
    }
  }
  return null;
}

function scoreConfidence(good: { data: Partial<ToolResult> }[], synthesized: boolean): number {
  const scores = good.map((g) => Number(g.data.score)).filter((n) => Number.isFinite(n) && n > 0);
  const spread = scores.length > 1 ? Math.max(...scores) - Math.min(...scores) : 25;
  const agreement = Math.max(0, 100 - spread * 1.5);
  const coverage = Math.min(100, good.length * 28);
  return Math.round(Math.min(98, agreement * 0.45 + coverage * 0.45 + (synthesized ? 10 : 0)));
}

/** Merges several engine answers into a single, richer result. */
function fuse(parts: { provider: Provider; data: Partial<ToolResult> }[]): ToolResult {
  const normalized = parts.map((p) => normalize(p.data, p.provider));
  const providers = parts.map((p) => p.provider);
  const base = [...normalized].sort(
    (a, b) => b.bullets.length + b.metrics.length - (a.bullets.length + a.metrics.length),
  )[0];

  const metrics: ToolResult["metrics"] = [];
  const seenLabel = new Set<string>();
  for (const r of normalized) {
    for (const m of r.metrics) {
      const k = m.label.toLowerCase().trim();
      if (k && !seenLabel.has(k)) {
        seenLabel.add(k);
        metrics.push(m);
      }
    }
  }

  const uniq = (lists: (string[] | undefined)[], limit: number) => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const list of lists) {
      for (const item of list ?? []) {
        const k = item
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, "")
          .slice(0, 60);
        if (k && !seen.has(k)) {
          seen.add(k);
          out.push(item);
        }
      }
    }
    return out.slice(0, limit);
  };

  const table =
    normalized
      .map((r) => r.table)
      .filter(Boolean)
      .sort((a, b) => b!.rows.length - a!.rows.length)[0] ?? null;
  const document =
    normalized
      .map((r) => r.document)
      .filter(Boolean)
      .sort((a, b) => b!.length - a!.length)[0] ?? null;
  const scores = normalized.map((r) => r.score ?? 0).filter((n) => n > 0);

  return {
    headline: base.headline || normalized.find((r) => r.headline)?.headline || "",
    verdict: base.verdict || normalized.find((r) => r.verdict)?.verdict || "",
    score: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
    metrics: metrics.slice(0, 8),
    bullets: uniq(
      normalized.map((r) => r.bullets),
      10,
    ),
    risks: uniq(
      normalized.map((r) => r.risks),
      6,
    ),
    actions: uniq(
      normalized.map((r) => r.actions),
      6,
    ),
    assumptions: uniq(
      normalized.map((r) => r.assumptions),
      4,
    ),
    table,
    document,
    provider: providers.length > 1 ? `hibrit: ${providers.join(" + ")}` : providers[0],
    providers,
    confidence: scoreConfidence(parts, false),
  };
}

/** Multi-AI consensus: four engines score the same product independently. */
export async function runConsensus(prompt: string) {
  const ask = async (fn: () => Promise<string>) => {
    const parsed = extractJson<{ score?: number; note?: string }>(await fn(), {});
    return {
      score: clampNum(parsed.score, 0, 100, 0),
      note: String(parsed.note ?? "").slice(0, 400),
    };
  };
  const scoring = `${prompt}\n\nReturn ONLY JSON: {"score": number 0-100, "note": string (max 2 sentences, concrete)}`;
  const settle = async (fn: () => Promise<string>) => {
    try {
      return await ask(fn);
    } catch {
      return { score: 0, note: "Bu motor şu anda yanıt vermedi." };
    }
  };
  const [gemini, groq, openrouter, lovable] = await Promise.all([
    settle(() => callGemini(scoring, geminiKey(1), 0.4, true)),
    settle(() => callGroq(scoring, 0.3)),
    settle(() => callOpenRouter(scoring, 0.4)),
    settle(() => callLovableAI(scoring, 0.4)),
  ]);

  // Weighted hybrid — grounded/search-capable engines carry more weight.
  const weights: Record<string, number> = {
    gemini: 0.34,
    groq: 0.24,
    openrouter: 0.22,
    lovable: 0.2,
  };
  const entries = Object.entries({ gemini, groq, openrouter, lovable }).filter(
    ([, r]) => r.score > 0,
  );
  const wSum = entries.reduce((s, [k]) => s + (weights[k] ?? 0), 0);
  const hybrid = wSum
    ? Math.round(entries.reduce((s, [k, r]) => s + r.score * (weights[k] ?? 0), 0) / wSum)
    : 0;

  const scores = entries.map(([, r]) => r.score);
  const spread = scores.length > 1 ? Math.max(...scores) - Math.min(...scores) : 0;
  const agreement = scores.length > 1 ? Math.max(0, 100 - spread * 2) : 0;

  return { gemini, groq, openrouter, lovable, hybrid, agreement, engines: entries.length };
}

function clampNum(v: unknown, min: number, max: number, fb: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fb;
}

function strList(v: unknown, limit: number): string[] {
  return Array.isArray(v)
    ? v
        .slice(0, limit)
        .map((x) => String(x).slice(0, 400))
        .filter(Boolean)
    : [];
}

function normalize(p: Partial<ToolResult>, provider: string): ToolResult {
  const tones = new Set(["profit", "warning", "action", "neutral"]);
  return {
    ...EMPTY,
    headline: String(p.headline ?? "").slice(0, 160),
    verdict: String(p.verdict ?? "").slice(0, 80),
    score: clampNum(p.score, 0, 100, 0),
    metrics: Array.isArray(p.metrics)
      ? p.metrics.slice(0, 6).map((m) => ({
          label: String((m as { label?: string })?.label ?? "").slice(0, 40),
          value: String((m as { value?: string })?.value ?? "").slice(0, 40),
          tone: tones.has(String((m as { tone?: string })?.tone))
            ? (m as ToolResult["metrics"][number]).tone
            : "neutral",
        }))
      : [],
    bullets: strList(p.bullets, 8),
    risks: strList(p.risks, 5),
    actions: strList(p.actions, 6),
    assumptions: strList(p.assumptions, 4),

    table:
      p.table && Array.isArray(p.table.columns) && Array.isArray(p.table.rows)
        ? {
            columns: p.table.columns.slice(0, 8).map(String),
            rows: p.table.rows
              .slice(0, 20)
              .map((r) => (Array.isArray(r) ? r.slice(0, 8).map(String) : [])),
          }
        : null,
    document: p.document ? String(p.document).slice(0, 8000) : null,
    provider,
  };
}
