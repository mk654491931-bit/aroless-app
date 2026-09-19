import { withEstimationRules } from "./ai-guidance";
import {
  cerebrasEnvKeys,
  geminiEnvKeys,
  groqEnvKeys,
  hfEnvKeys,
  openRouterEnvKeys,
  sambanovaEnvKeys,
} from "./ai-keys.server";
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

/**
 * Tek bir sağlayıcıya bağlı kalmayan "asla boş dönmez" yolu.
 *
 * Sıra:
 *  1) Zeminli (canlı web araması yapan) Gemini — piyasa/trend/haber verisinde
 *     en yüksek doğruluk; JSON modunda değil, arama kanıtıyla üretir.
 *  2) Ağ geçidi + TÜM anahtar havuzunun JSON modundaki süpürmesi
 *     (Gemini 5 → Groq 5 → Cerebras → SambaNova → HF 5 → OpenRouter 5).
 *
 * Neden gerekli: radar / hot products / trend uç noktaları yalnız tek bir
 * sağlayıcıyı (`callGemini` ya da `callGroq`) çağırıyordu. O sağlayıcı kotaya
 * takıldığında ya da zeminli yanıtı JSON'a çevrilemeyince uç nokta sessizce
 * BOŞ dönüyordu ("kazanan ürün radarı sürekli boş"). İkinci tur, aynı isteği
 * JSON modunda bütün havuzda tekrar dener; yani hangi sağlayıcı/anahtar o an
 * müsaitse cevabı o verir.
 */
export async function callAiMesh(
  prompt: string,
  opts: { temperature?: number; grounded?: boolean; models?: string[] } = {},
): Promise<string> {
  const { temperature = 0.5, grounded = true, models } = opts;
  let lastErr: unknown = null;
  if (grounded) {
    try {
      return await callGemini(prompt, undefined, temperature, true, models);
    } catch (e) {
      lastErr = e;
    }
  }
  try {
    // Ağ geçidi varsa önce o, yoksa doğrudan tam havuz süpürmesi (JSON modu).
    return await callLovableAI(prompt, temperature);
  } catch (e) {
    lastErr = e;
  }
  throw lastErr instanceof Error ? lastErr : new Error("AI motorları yanıt vermedi");
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
    openRouterKeyPool().length > 0 ||
    cerebrasEnvKeys().length > 0 ||
    sambanovaEnvKeys().length > 0 ||
    hfEnvKeys().length > 0
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
  prompt = withEstimationRules(prompt);
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

/** OpenAI uyumlu sağlayıcı süpürmesinin tek kaynağı. */
export type SweepProvider = "groq" | "cerebras" | "sambanova" | "hf" | "openrouter";

type SweepConfig = {
  keys: () => string[];
  url: string;
  models: string[];
  opts: OpenAIPoolOptions;
};

function sweepConfig(name: SweepProvider): SweepConfig {
  switch (name) {
    case "groq":
      return {
        keys: groqEnvKeys,
        url: "https://api.groq.com/openai/v1/chat/completions",
        models: GROQ_MODELS_LATEST,
        opts: { json: true },
      };
    case "cerebras":
      return {
        keys: cerebrasEnvKeys,
        url: "https://api.cerebras.ai/v1/chat/completions",
        models: ["llama-3.3-70b", "llama3.1-8b"],
        opts: { json: true, jsonOn400Retry: true },
      };
    case "sambanova":
      return {
        keys: sambanovaEnvKeys,
        url: "https://api.sambanova.ai/v1/chat/completions",
        models: ["Meta-Llama-3.3-70B-Instruct", "Meta-Llama-3.1-8B-Instruct"],
        opts: { json: false },
      };
    case "hf":
      return {
        keys: hfEnvKeys,
        url: "https://router.huggingface.co/v1/chat/completions",
        models: ["Qwen/Qwen2.5-7B-Instruct", "meta-llama/Llama-3.1-8B-Instruct"],
        opts: { json: false },
      };
    case "openrouter":
      return {
        keys: openRouterEnvKeys,
        url: "https://openrouter.ai/api/v1/chat/completions",
        models: OPENROUTER_MODELS_LATEST,
        opts: { json: true, jsonOn400Retry: true, extraHeaders: { "X-Title": "Aroless AI" } },
      };
  }
}

/** Bu sağlayıcı grubunda en az bir anahtar var mı? (ağ isteği yapmaz) */
export function sweepProviderConfigured(name: SweepProvider): boolean {
  return sweepConfig(name).keys().length > 0;
}

/**
 * TEK sağlayıcı grubunun bütün anahtarlarını (5 Gemini/Groq/OpenRouter/HF,
 * Cerebras, SambaNova) ve model yedeklerini sırayla dener; hepsi tükenirse
 * açık hata verir.
 *
 * Araç kartları (sol menü AI tools) her motoru AYRI bir hakem olarak çağırabilsin
 * diye dışa açıldı: hangi sağlayıcının anahtarı o an çalışıyorsa cevap ondan
 * gelir, tek bir anahtarın kotası tüm aracı kilitlemez.
 */
export async function callSweepProvider(
  name: SweepProvider,
  prompt: string,
  temperature = 0.3,
): Promise<string> {
  const cfg = sweepConfig(name);
  const text = await tryOpenAIPool(
    name,
    cfg.keys(),
    cfg.url,
    cfg.models,
    prompt,
    temperature,
    cfg.opts,
  );
  if (text) return text;
  throw new Error(`${name} motoru yanıt vermedi (anahtar yok veya kota dolu)`);
}

/**
 * Last-resort path that sweeps the project's OWN provider keys — every one of
 * the 22-slot pool (Gemini, Groq, Cerebras, SambaNova, HuggingFace tokens,
 * OpenRouter, optional PROVIDER_A..D) in reliability order. Each provider
 * rotates through every configured key × model, parks spent keys for 60s and
 * keeps going, so whichever key/provider is actually working at that moment
 * answers instead of the feature failing with an empty result.
 */
async function directFallback(prompt: string, temperature: number): Promise<string> {
  const pools = [
    geminiKeyPool().length,
    groqKeyPool().length,
    cerebrasEnvKeys().length,
    sambanovaEnvKeys().length,
    hfEnvKeys().length,
    openRouterEnvKeys().length,
    customPoolKeys().length,
  ];
  if (pools.every((n) => n === 0)) {
    throw new Error(
      "AI anahtarı tanımlı değil. .env dosyasına GEMINI_1_API_KEY / GROQ_API_KEY / OPENROUTER_API_KEY1 / HF_TOKEN_1 / CEREBRAS_API_KEY / SAMBANOVA_API_KEY veya AI_GATEWAY_* değerlerinden en az birini ekleyin.",
    );
  }

  // 1) Gemini — en güçlü doğruluk (native REST, strict JSON).
  for (const k of scheduleKeys(geminiKeyPool(), geminiCursor++)) {
    try {
      return await geminiOnce(prompt, k, temperature, false, GEMINI_MODELS_LATEST);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("QUOTA:")) parkKey(k);
    }
  }

  // 2) Groq → 3) Cerebras → 4) SambaNova → 5) HuggingFace → 6) OpenRouter.
  // Sıra ve model listeleri tek kaynaktan (`sweepConfig`) gelir; her grup kendi
  // bütün anahtarlarını dener, kota dolan anahtar park edilir ve sıradakine
  // geçilir — yani o an hangi sağlayıcı/anahtar müsaitse cevabı o verir.
  for (const name of ["groq", "cerebras", "sambanova", "hf", "openrouter"] as const) {
    const cfg = sweepConfig(name);
    const text = await tryOpenAIPool(
      name,
      cfg.keys(),
      cfg.url,
      cfg.models,
      prompt,
      temperature,
      cfg.opts,
    );
    if (text) return text;
  }

  // 7) PROVIDER_A..D — kullanıcı tanımlı OpenAI uyumlu havuzlar (BASE_URL + MODEL).
  for (const group of ["PROVIDER_A", "PROVIDER_B", "PROVIDER_C", "PROVIDER_D"] as const) {
    const { keys, url, model } = customPoolConfig(group);
    if (!keys.length || !url) continue;
    const text = await tryOpenAIPool(
      group.toLowerCase(),
      keys,
      url,
      [model],
      prompt,
      temperature,
      { json: false },
    );
    if (text) return text;
  }

  throw new Error(
    "Yapay zeka motorları şu anda meşgul, lütfen birkaç saniye sonra tekrar deneyin.",
  );
}

// ---------------------------------------------------------------------------
// Generic OpenAI-compatible pool sweeper (Groq / Cerebras / SambaNova / HF /
// OpenRouter / PROVIDER_*): her anahtar × her model denenir, kotalı anahtar
// 60sn beklemeye alınır, tüm girişimler başarısız olursa "" döner.
// ---------------------------------------------------------------------------

type OpenAIPoolOptions = {
  json?: boolean;
  jsonOn400Retry?: boolean;
  extraHeaders?: Record<string, string>;
};

async function tryOpenAIPool(
  group: string,
  keys: string[],
  url: string,
  models: string[],
  prompt: string,
  temperature: number,
  opts: OpenAIPoolOptions,
): Promise<string> {
  if (!keys.length || !models.length) return "";
  const ordered = scheduleKeys(keys, openAICursor(group));
  for (const key of ordered) {
    for (let attempt = 0; attempt < models.length; attempt++) {
      const model = models[attempt];
      try {
        const text = await postOpenAICompat({
          url,
          key,
          model,
          prompt,
          temperature,
          json: opts.json ?? false,
          extraHeaders: opts.extraHeaders,
        });
        if (text) return text;
        throw new Error("empty payload");
      } catch (e) {
        const status = (e as { status?: number }).status ?? 0;
        const body = e instanceof Error ? e.message : "";
        if (isQuotaError(status, body)) {
          parkKey(key);
          break; // bu anahtar tükendi → sıradaki anahtara geç
        }
        // JSON mode desteklenmiyorsa (400) aynı modeli JSON'suz bir kez dene.
        if (opts.json && opts.jsonOn400Retry && status === 400) {
          try {
            const retry = await postOpenAICompat({
              url,
              key,
              model,
              prompt,
              temperature,
              json: false,
              extraHeaders: opts.extraHeaders,
            });
            if (retry) return retry;
          } catch {
            /* next */
          }
        }
        await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
      }
    }
  }
  return "";
}

async function postOpenAICompat(opts: {
  url: string;
  key: string;
  model: string;
  prompt: string;
  temperature: number;
  json: boolean;
  extraHeaders?: Record<string, string>;
}): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const resp = await fetch(opts.url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.key}`,
        ...(opts.extraHeaders ?? {}),
      },
      body: JSON.stringify({
        model: opts.model,
        temperature: opts.temperature,
        messages: [{ role: "user", content: opts.prompt }],
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      const err = new Error(
        `${opts.model} ${resp.status}: ${body.slice(0, 160)}`,
      ) as Error & { status?: number };
      err.status = resp.status;
      throw err;
    }
    const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return (json.choices?.[0]?.message?.content ?? "").trim();
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      const err = new Error("timeout") as Error & { status?: number };
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const openAICursors = new Map<string, number>();
function openAICursor(group: string): number {
  const c = openAICursors.get(group) ?? 0;
  openAICursors.set(group, c + 1);
  return c;
}

function readEnv(name: string): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : "";
}

/** Keys + endpoint + model of a custom PROVIDER_<X> pool (if configured). */
function customPoolConfig(prefix: "PROVIDER_A" | "PROVIDER_B" | "PROVIDER_C" | "PROVIDER_D"): {
  keys: string[];
  url: string;
  model: string;
} {
  const keys = Array.from(
    new Set(
      Array.from({ length: 5 }, (_, i) => readEnv(`${prefix}_${i + 1}`)).filter(Boolean),
    ),
  );
  const url =
    readEnv(`${prefix}_BASE_URL`) ||
    readEnv(`${prefix}_URL`) ||
    readEnv(`${prefix}_API_URL`) ||
    readEnv(`${prefix}_HOST`);
  const model = readEnv(`${prefix}_MODEL`) || "Meta-Llama-3.3-70B-Instruct";
  return { keys, url, model };
}

/** Keys of every custom PROVIDER_* pool (endpoint optional) — for the empty check. */
function customPoolKeys(): string[] {
  const out: string[] = [];
  for (const prefix of ["PROVIDER_A", "PROVIDER_B", "PROVIDER_C", "PROVIDER_D"] as const)
    out.push(...customPoolConfig(prefix).keys);
  return Array.from(new Set(out));
}

/** All configured OpenRouter keys, de-duplicated, in rotation order. */
export function openRouterKeyPool(): string[] {
  return openRouterEnvKeys();
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
  return geminiEnvKeys();
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
  prompt = withEstimationRules(prompt);
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < models.length; attempt++) {
    const model = models[Math.min(attempt, models.length - 1)];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
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
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
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
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
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
  return groqEnvKeys();
}

/**
 * Calls Groq (OpenAI-compatible chat completions) with key rotation: when a key
 * hits its rate limit the next configured key takes over, then Lovable AI.
 */
export async function callGroq(prompt: string, temperature = 0.3): Promise<string> {
  prompt = withEstimationRules(prompt);
  const pool = groqKeyPool();
  if (!pool.length) return callLovableAI(prompt, temperature);
  const keys = scheduleKeys(pool, groqCursor++);
  const models = GROQ_MODELS_LATEST;
  let lastErr: unknown = null;
  for (const key of keys) {
    for (let attempt = 0; attempt < models.length; attempt++) {
      const model = models[attempt];
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 12_000);
      try {
        const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          signal: controller.signal,
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
          await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
          continue;
        }
        const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
        clearTimeout(t);
        return json.choices?.[0]?.message?.content ?? "{}";
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") lastErr = new Error("Groq timeout");
        else lastErr = e;
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
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
