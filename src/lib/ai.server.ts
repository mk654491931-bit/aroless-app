// Server-only AI helpers. Kept out of *.functions.ts so server-function
// splitting never strips them.

/**
 * Newest-first Gemini model ladder used everywhere. "latest" aliases always
 * resolve to Google's current Flash generation, so answers stay up to date
 * without code changes; older ids stay as availability fallbacks.
 */
export const GEMINI_MODELS_LATEST = [
  "gemini-flash-latest",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
];

/** Groq ladder: strongest open model first, fastest one last. */
export const GROQ_MODELS_LATEST = [
  "openai/gpt-oss-120b",
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
];

/** OpenRouter ladder used when both Gemini and Groq pools are spent. */
export const OPENROUTER_MODELS_LATEST = [
  "google/gemini-2.0-flash-001",
  "meta-llama/llama-3.3-70b-instruct",
];
export async function callLovableAI(prompt: string, temperature = 0.4): Promise<string> {
  // Ağ geçidi yapılandırılmışsa önce o (kota derdi yok); yoksa doğrudan
  // projenin kendi anahtar havuzları. Lokalde gereksiz bekleme olmaz.
  if (!hasGateway()) return directFallback(prompt, temperature);
  try {
    return await callGatewayResponses(prompt);
  } catch (e) {
    try {
      return await directFallback(prompt, temperature);
    } catch {
      throw e;
    }
  }
}

/**
 * Premium yol: en güçlü modeller (yapılandırılmış AI ağ geçidi) önce çalışır —
 * kritik sentez/rapor çıktılarının kalitesi için. Ağ geçidi yoksa ya da
 * başarısız olursa kendi anahtar havuzlarına düşer, yani asla boş dönmez.
 */
export async function callPremiumAI(prompt: string, temperature = 0.4): Promise<string> {
  if (!hasGateway()) return directFallback(prompt, temperature);
  try {
    return await callGatewayResponses(prompt, [
      "google/gemini-3.1-pro-preview",
      "google/gemini-3.6-flash",
      "openai/gpt-5.5",
      "google/gemini-2.5-pro",
    ]);
  } catch (e) {
    try {
      return await directFallback(prompt, temperature);
    } catch {
      throw e;
    }
  }
}

/** Ağ geçidi (LOVABLE_API_KEY veya AI_GATEWAY_*) tanımlı mı? */
export function hasGateway(): boolean {
  const { key, url } = gatewayConfig();
  return Boolean(key && url);
}

/** Herhangi bir AI sağlayıcısı yapılandırıldı mı? */
export function hasAnyAiProvider(): boolean {
  return (
    hasGateway() ||
    geminiKeyPool().length > 0 ||
    groqKeyPool().length > 0 ||
    openRouterKeyPool().length > 0
  );
}

/**
 * Optional OpenAI-compatible AI gateway.
 *
 * Configure with `AI_GATEWAY_URL` + `AI_GATEWAY_API_KEY` (any OpenAI-compatible
 * endpoint: OpenRouter, Groq, OpenAI, a self-hosted proxy, or the managed
 * gateway). When no key is present the whole gateway path is skipped and the
 * app falls back to the project's own provider key pools.
 */

function gatewayConfig() {
  const key = process.env["AI_GATEWAY_API_KEY"] || process.env["LOVABLE_API_KEY"] || "";
  const url =
    process.env["AI_GATEWAY_URL"] ||
    (process.env["LOVABLE_API_KEY"] ? "https://ai.gateway.lovable.dev/v1/chat/completions" : "");
  const models = (process.env["AI_GATEWAY_MODELS"] || "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return { key, url, models };
}

async function callGatewayResponses(prompt: string, modelPreference?: string[]): Promise<string> {
  const { key, url, models: envModels } = gatewayConfig();
  if (!key || !url) throw new Error("AI gateway not configured");
  const models = modelPreference?.length
    ? modelPreference
    : envModels.length
      ? envModels
      : [
          "google/gemini-3.6-flash",
          "google/gemini-3.5-flash",
          "google/gemini-2.5-flash",
          "openai/gpt-5.6-terra",
        ];

  let lastErr: unknown = null;
  for (const model of models) {
    try {
      const body: Record<string, unknown> = {
        model,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      };
      // GPT-5.6 rejects tool/completion requests unless reasoning is disabled.
      if (model.startsWith("openai/gpt-5.6")) body["reasoning_effort"] = "none";
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          "Lovable-API-Key": key,
        },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        lastErr = new Error(`Gateway error: ${resp.status} ${(await resp.text()).slice(0, 180)}`);
        continue;
      }
      const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = (json.choices?.[0]?.message?.content ?? "").trim();
      if (text) return text;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Gateway request failed");
}

/**
 * Last-resort path that only uses the project's own provider keys (Gemini →
 * Groq → OpenRouter).
 */
async function directFallback(prompt: string, temperature: number): Promise<string> {
  if (
    geminiKeyPool().length === 0 &&
    groqKeyPool().length === 0 &&
    openRouterKeyPool().length === 0
  ) {
    throw new Error(
      "AI anahtarı tanımlı değil. .env dosyasına GEMINI_1_API_KEY / GROQ_API_KEY / OPENROUTER_API_KEY1 veya AI_GATEWAY_* değerlerinden en az birini ekleyin.",
    );
  }
  const geminiModels = GEMINI_MODELS_LATEST;

  for (const k of scheduleKeys(geminiKeyPool(), geminiCursor++)) {
    try {
      return await geminiOnce(prompt, k, temperature, false, geminiModels);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("QUOTA:")) parkKey(k);
    }
  }
  for (const k of scheduleKeys(groqKeyPool(), groqCursor++)) {
    for (const model of GROQ_MODELS_LATEST) {
      try {
        const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${k}` },
          body: JSON.stringify({
            model,
            temperature,
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
          }),
        });
        if (!resp.ok) {
          const body = (await resp.text()).slice(0, 180);
          if (isQuotaError(resp.status, body)) {
            parkKey(k);
            break;
          }
          continue;
        }
        const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
        return json.choices?.[0]?.message?.content ?? "{}";
      } catch {
        // try next model / key
      }
    }
  }
  for (const k of openRouterKeyPool()) {
    for (const model of OPENROUTER_MODELS_LATEST) {
      try {
        const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${k}` },
          body: JSON.stringify({
            model,
            temperature,
            messages: [{ role: "user", content: prompt }],
          }),
        });
        if (!resp.ok) {
          const body = (await resp.text()).slice(0, 180);
          if (isQuotaError(resp.status, body)) {
            parkKey(k);
            break;
          }
          continue;
        }
        const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const text = json.choices?.[0]?.message?.content;
        if (text) return text;
      } catch {
        // try next model / key
      }
    }
  }
  throw new Error(
    "Yapay zeka motorları şu anda meşgul, lütfen birkaç saniye sonra tekrar deneyin.",
  );
}

/** All configured OpenRouter keys, de-duplicated, in rotation order. */
export function openRouterKeyPool(): string[] {
  const raw = [
    process.env["OPENROUTER_API_KEY"],
    process.env["OPENROUTER_API_KEY1"],
    process.env["OPENROUTER_API_KEY_1"],
    process.env["OPENROUTER_API_KEY2"],
    process.env["OPENROUTER_API_KEY_2"],
  ].filter((k): k is string => Boolean(k && k.trim()));
  return Array.from(new Set(raw));
}

/** Pull a JSON object out of a model response that may be fenced or prefixed. */
export function extractJson<T>(text: string, fallback: T): T {
  const raw = (text ?? "").trim();
  if (!raw) return fallback;
  const candidates: string[] = [];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1]);
  candidates.push(raw);
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(raw.slice(first, last + 1));
  for (const c of candidates) {
    try {
      return JSON.parse(c.trim()) as T;
    } catch {
      /* next */
    }
  }
  // Best-effort recovery from truncated JSON: close any open strings, arrays, objects.
  const start = raw.indexOf("{");
  if (start !== -1) {
    const tail = raw.slice(start);
    let inStr = false,
      esc = false;
    const stack: string[] = [];
    for (let i = 0; i < tail.length; i++) {
      const ch = tail[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{" || ch === "[") stack.push(ch);
      else if (ch === "}" || ch === "]") stack.pop();
    }
    let repaired = tail.replace(/,\s*$/, "");
    if (inStr) repaired += '"';
    // Drop trailing partial key/value like `,"foo":` or `,"foo"`
    repaired = repaired.replace(/,\s*"[^"]*"\s*:?\s*$/, "");
    while (stack.length) {
      const open = stack.pop();
      repaired += open === "{" ? "}" : "]";
    }
    try {
      return JSON.parse(repaired) as T;
    } catch {
      /* give up */
    }
  }
  return fallback;
}

/** All configured Gemini keys, de-duplicated, in rotation order. */
export function geminiKeyPool(): string[] {
  const raw = [
    process.env["GEMINI_API_KEY_1"],
    process.env["GEMINI_1_API_KEY"],
    process.env["GEMINI_API_KEY_2"],
    process.env["GEMINI_2_API_KEY"],
    process.env["GEMINI_API_KEY_3"],
    process.env["GEMINI_3_API_KEY"],
    process.env["GEMINI_API_KEY"],
  ].filter((k): k is string => Boolean(k && k.trim()));
  return Array.from(new Set(raw));
}

function isQuotaError(status: number, body: string): boolean {
  return (
    status === 429 ||
    status === 403 ||
    /quota|RESOURCE_EXHAUSTED|exceeded|expired|invalid.*key|API key not valid/i.test(body)
  );
}

/** Single-key Gemini attempt. Throws with a QUOTA: prefix when the key is spent. */
async function geminiOnce(
  prompt: string,
  apiKey: string,
  temperature: number,
  grounded: boolean,
  models: string[],
): Promise<string> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < models.length; attempt++) {
    const model = models[Math.min(attempt, models.length - 1)];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          // New-style Gemini keys authenticate via header, not the ?key= query param.
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            ...(grounded ? { tools: [{ google_search: {} }] } : {}),
            generationConfig: {
              ...(grounded ? {} : { responseMimeType: "application/json" }),
              temperature,
              maxOutputTokens: 32768,
            },
          }),
          signal: controller.signal,
        },
      );
      if (resp.status === 400 && grounded) {
        clearTimeout(timeout);
        return geminiOnce(prompt, apiKey, temperature, false, models);
      }
      if (!resp.ok) {
        const t = await resp.text();
        if (isQuotaError(resp.status, t)) throw new Error(`QUOTA: ${resp.status}`);
        lastErr = new Error(`Gemini error: ${resp.status} ${t.slice(0, 160)}`);
        await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
        continue;
      }
      const json = (await resp.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const parts = json.candidates?.[0]?.content?.parts ?? [];
      const text = parts
        .map((p) => p.text ?? "")
        .join("")
        .trim();
      return text || "{}";
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("QUOTA:")) throw e;
      lastErr = e;
      await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Gemini request failed");
}

// ---------------------------------------------------------------------------
// Key scheduler: round-robin across every configured key + per-key cooldown.
// Concurrent requests therefore start on DIFFERENT keys instead of hammering
// key #1, and a key that returns a quota error is parked for 60s.
// ---------------------------------------------------------------------------
const keyCooldownUntil = new Map<string, number>();
let geminiCursor = 0;
let groqCursor = 0;

function parkKey(key: string, ms = 60_000) {
  keyCooldownUntil.set(key, Date.now() + ms);
}

function isCool(key: string) {
  const until = keyCooldownUntil.get(key) ?? 0;
  return until <= Date.now();
}

/** Orders a key pool starting at the shared cursor, cooled-down keys last. */
function scheduleKeys(pool: string[], cursor: number): string[] {
  if (pool.length === 0) return [];
  const rotated = pool.map((_, i) => pool[(cursor + i) % pool.length]);
  const ready = rotated.filter(isCool);
  const parked = rotated.filter((k) => !isCool(k));
  return [...ready, ...parked];
}

/** Runs tasks with a hard concurrency cap so API rate limits are never burst. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Calls Gemini with automatic key rotation: keys are handed out round-robin
 * (so parallel calls use different keys), quota-hit keys are parked, and the
 * built-in Lovable AI gateway is the final fallback — the user never sees an
 * API error.
 */
export async function callGemini(
  prompt: string,
  apiKey?: string,
  temperature = 0.9,
  grounded = true,
  modelPreference?: string[],
): Promise<string> {
  const models = modelPreference?.length ? modelPreference : GEMINI_MODELS_LATEST;
  const pool = geminiKeyPool();
  const cursor = geminiCursor++;
  const preferred = apiKey && isCool(apiKey) ? [apiKey] : [];
  const keys = Array.from(new Set([...preferred, ...scheduleKeys(pool, cursor)]));
  let lastErr: unknown = null;
  for (const key of keys) {
    try {
      return await geminiOnce(prompt, key, temperature, grounded, models);
    } catch (e) {
      lastErr = e;
      if (e instanceof Error && e.message.startsWith("QUOTA:")) parkKey(key);
      // quota or hard failure on this key — rotate to the next one
    }
  }
  // Every Gemini key exhausted — keep the app working on the built-in gateway.
  try {
    return await callLovableAI(prompt, temperature);
  } catch {
    throw lastErr instanceof Error ? lastErr : new Error("Gemini request failed");
  }
}

/** All configured Groq keys, de-duplicated, in rotation order. */
export function groqKeyPool(): string[] {
  const raw = [
    process.env["GROQ_API_KEY"],
    process.env["GROQ_API_KEY_1"],
    process.env["GROQ_API_KEY1"],
    process.env["GROQ_API_KEY_2"],
    process.env["GROQ_API_KEY2"],
    process.env["GROQ_2_API_KEY"],
    process.env["GROQ_API_KEY_3"],
    process.env["GROQ_API_KEY3"],
  ].filter((k): k is string => Boolean(k && k.trim()));
  return Array.from(new Set(raw));
}

/**
 * Calls Groq (OpenAI-compatible chat completions) with key rotation: when a key
 * hits its rate limit the next configured key takes over, then Lovable AI.
 */
export async function callGroq(prompt: string, temperature = 0.3): Promise<string> {
  const pool = groqKeyPool();
  if (!pool.length) return callLovableAI(prompt, temperature);
  const keys = scheduleKeys(pool, groqCursor++);
  const models = GROQ_MODELS_LATEST;
  let lastErr: unknown = null;
  for (const key of keys) {
    for (let attempt = 0; attempt < models.length; attempt++) {
      const model = models[attempt];
      try {
        const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model,
            temperature,
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
          }),
        });
        if (!resp.ok) {
          const body = (await resp.text()).slice(0, 180);
          lastErr = new Error(`Groq error: ${resp.status} ${body}`);
          if (isQuotaError(resp.status, body)) {
            parkKey(key);
            break;
          } // key spent — rotate
          await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
          continue;
        }
        const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
        return json.choices?.[0]?.message?.content ?? "{}";
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      }
    }
  }
  try {
    return await callLovableAI(prompt, temperature);
  } catch {
    throw lastErr instanceof Error ? lastErr : new Error("Groq request failed");
  }
}

export { isQuotaError };
