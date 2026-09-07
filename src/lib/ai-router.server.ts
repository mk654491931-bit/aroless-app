/**
 * Velora çok sağlayıcılı AI yönlendirici (sunucu tarafı).
 *
 * Ağır bir dış gateway servisi yok: saf TypeScript try/catch + switch/case ile
 * sağlayıcı zinciri, 429/timeout durumunda anında fallback, üstel geri çekilme.
 */
import {
  callGemini,
  callGroq,
  extractJson,
  geminiKeyPool,
  groqKeyPool,
  openRouterKeyPool,
} from "./ai.server";
import { hfEnvKeys } from "./ai-keys.server";
import {
  markPoolGroupOutcome,
  parkPoolGroup,
  poolGroupAvailable,
  poolGroupConfig,
  poolGroupConfigured,
  readPoolGroupKeys,
  type PoolGroup,
} from "./ai-pool.server";
import { withEstimationRules } from "./ai-guidance";

/**
 * Ortak havuzdaki 22 anahtar için f/p + güvenilirlik sırası:
 *   1. Groq        — 5 anahtar (GROQ_API_KEY_1..5), ücretsiz, en hızlı → her iş için ilk tercih
 *   2. Cerebras    — 1 anahtar, ücretsiz, çok hızlı
 *   3. Gemini      — 5 anahtar (GEMINI_API_KEY_1..5), ücretsiz kota, en güçlü doğruluk
 *   4. SambaNova   — 1 anahtar, ücretsiz, yüksek bağlam
 *   5. OpenRouter  — 5 anahtar (OPENROUTER_API_KEY_1..5), ücretsiz modeller (kota daha dar)
 *   6. HuggingFace — 5 token (HF_TOKEN_1..5), en dar kotalı → yalnızca son çare
 * Bedrock yalnızca AWS anahtarı tanımlıysa ve ücretsiz sağlayıcılar biterse denenir.
 * Aynı sağlayıcının 5 anahtarı round-robin dağıtılır, kotalı anahtar 60sn beklemeye alınır.
 */
export const FAST_CHAIN: ProviderId[] = [
  "groq",
  "cerebras",
  "gemini",
  "sambanova",
  "pool_a",
  "pool_b",
  "pool_c",
  "pool_d",
  "openrouter",
  "huggingface",
];
/** Derin analiz / nihai sentez zinciri — kalite önce, ödeme yalnızca son çare. */
export const DEEP_CHAIN: ProviderId[] = [
  "gemini",
  "groq",
  "openrouter",
  "sambanova",
  "cerebras",
  "huggingface",
  "bedrock",
];
export const FINAL_SYNTHESIS_CHAIN: ProviderId[] = DEEP_CHAIN;

export type ProviderId =
  | "cerebras"
  | "sambanova"
  | "pool_a"
  | "pool_b"
  | "pool_c"
  | "pool_d"
  | "groq"
  | "gemini"
  | "openrouter"
  | "huggingface"
  | "bedrock";

export type ProviderCall = (
  prompt: string,
  temperature: number,
  signal: AbortSignal,
) => Promise<string>;

const TIMEOUT_MS = 45_000;

/** Pool'da tanımlı ProviderId → tek tip havuz grubu eşlemesi. */
const POOL_PROVIDER_GROUP: Partial<Record<ProviderId, PoolGroup>> = {
  cerebras: "cerebras",
  sambanova: "sambanova",
  pool_a: "pool_a",
  pool_b: "pool_b",
  pool_c: "pool_c",
  pool_d: "pool_d",
};

/** PROVIDER_A..D için OpenAI uyumlu sağlayıcı üretici (URL + model env'den). */
function pooledProvider(group: PoolGroup): ProviderCall {
  return async (prompt, temperature, signal) => {
    const keys = readPoolGroupKeys(group);
    const { baseUrl, model } = poolGroupConfig(group);
    if (!keys.length || !baseUrl)
      throw new Error(`no api key/endpoint configured for ${group}`);
    const modelName = model || "Meta-Llama-3.3-70B-Instruct";
    try {
      const text = await rotate(group, keys, [modelName], (key, m) =>
        openAICompatible({
          url: baseUrl,
          key,
          model: m,
          prompt,
          temperature,
          signal,
        }),
      );
      markPoolGroupOutcome(group, 1, "ok");
      return text;
    } catch (e) {
      // Rotasyon tamamen tükendi → grubu kısa devreye al, zincir diğerine geçsin.
      parkGroupAfterFailure(group, e);
      throw e;
    }
  };
}
async function openAICompatible(opts: {
  url: string;
  key: string;
  model: string;
  prompt: string;
  temperature: number;
  signal: AbortSignal;
  extraHeaders?: Record<string, string>;
  json?: boolean;
}): Promise<string> {
  const resp = await fetch(opts.url, {
    method: "POST",
    signal: opts.signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.key}`,
      ...(opts.extraHeaders ?? {}),
    },
    body: JSON.stringify({
      model: opts.model,
      temperature: opts.temperature,
      messages: [{ role: "user", content: opts.prompt }],
      ...(opts.json === false ? {} : { response_format: { type: "json_object" } }),
    }),
  });
  if (!resp.ok) {
    const body = (await resp.text()).slice(0, 200);
    const err = new Error(`${new URL(opts.url).hostname} ${resp.status}: ${body}`) as Error & {
      status?: number;
    };
    err.status = resp.status;
    throw err;
  }
  const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content ?? "{}";
}

// ------------------------------------------------------------------ key pool scheduling

/** Her sağlayıcı grubu için round-robin başlangıç imleci. */
const poolKeyCursor: Record<string, number> = {};
/** `group:key` → beklemeye alma bitiş zamanı (quota sonrası 60sn). */
const poolKeyCooldown = new Map<string, number>();

function schedulePoolKeys(group: string, keys: string[]): string[] {
  if (!keys.length) return keys;
  const cursor = poolKeyCursor[group] ?? 0;
  poolKeyCursor[group] = cursor + 1;
  const rotated = keys.map((_, i) => keys[(cursor + i) % keys.length]);
  const now = Date.now();
  const ready = rotated.filter((k) => (poolKeyCooldown.get(`${group}:${k}`) ?? 0) <= now);
  const parked = rotated.filter((k) => (poolKeyCooldown.get(`${group}:${k}`) ?? 0) > now);
  return [...ready, ...parked];
}

function parkPoolKey(group: string, key: string, ms = 60_000): void {
  poolKeyCooldown.set(`${group}:${key}`, Date.now() + ms);
}

/** Harici hata nesnesini havuz sonuç sınıfına çevirir. */
function routerErrorKind(e: unknown): "quota" | "server" | "network" {
  const status = (e as { status?: number }).status ?? 0;
  const msg = e instanceof Error ? e.message : "";
  if (
    status === 429 || status === 401 || status === 402 || status === 403 ||
    msg.startsWith("QUOTA:")
  )
    return "quota";
  if (status >= 500) return "server";
  return "network";
}

/** Grubu yalnızca gerçekten yapılandırılmışsa park eder (boş grubu kirletmez). */
function parkGroupAfterFailure(group: PoolGroup, e: unknown): void {
  if (!poolGroupConfigured(group)) return;
  parkPoolGroup(group, routerErrorKind(e));
}

/**
 * Bir grubun her anahtarını × her modeli dener. Anahtarlar round-robin
 * başlatılır (8 paralel ajan 5 anahtara yayılır, hepsi 1. anahtara binmez);
 * 429/401/402/403 alan anahtar 60sn beklemeye alınıp sonraki anahtara geçilir.
 */
async function rotate(
  group: string,
  keys: string[],
  models: string[],
  run: (key: string, model: string) => Promise<string>,
): Promise<string> {
  if (!keys.length) throw new Error("no api key configured");
  const ordered = schedulePoolKeys(group, keys);
  let last: unknown = null;
  for (const key of ordered) {
    for (const model of models) {
      try {
        return await run(key, model);
      } catch (e) {
        last = e;
        const status = (e as { status?: number }).status;
        const isQuota =
          status === 429 || status === 402 || status === 401 || status === 403 ||
          (e instanceof Error && e.message.startsWith("QUOTA:"));
        if (isQuota) {
          parkPoolKey(group, key); // anahtar tükendi → beklemeye al, sonraki anahtara geç
          break;
        }
      }
    }
  }
  throw last instanceof Error ? last : new Error("all keys failed");
}

// ---------------------------------------------------------------- providers

const CEREBRAS_MODELS = ["llama3.1-8b", "llama-3.3-70b"];
const SAMBANOVA_MODELS = ["Meta-Llama-3.3-70B-Instruct", "Meta-Llama-3.1-8B-Instruct"];

/**
 * Direct OpenAI-compatible provider call (Cerebras / SambaNova) that reports
 * the attempt back to the unified pool: success clears the group, a fully
 * failed rotation parks the whole group so the next agent in the same run
 * skips it instead of re-hammering a dead/quota'd provider.
 */
async function pooledDirectProvider(
  group: PoolGroup,
  url: string,
  models: string[],
  prompt: string,
  temperature: number,
  signal: AbortSignal,
): Promise<string> {
  try {
    const text = await rotate(group, readPoolGroupKeys(group), models, (key, model) =>
      openAICompatible({ url, key, model, prompt, temperature, signal }),
    );
    markPoolGroupOutcome(group, 1, "ok");
    return text;
  } catch (e) {
    parkGroupAfterFailure(group, e);
    throw e;
  }
}
const OPENROUTER_FREE = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "mistralai/mistral-small-3.1-24b-instruct:free",
  "google/gemma-2-9b-it:free",
];
const GROQ_MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
const HF_MODELS = ["meta-llama/Llama-3.1-8B-Instruct", "mistralai/Mistral-7B-Instruct-v0.3"];

export const PROVIDERS: Record<ProviderId, ProviderCall> = {
  cerebras: (prompt, temperature, signal) =>
    pooledDirectProvider(
      "cerebras",
      "https://api.cerebras.ai/v1/chat/completions",
      CEREBRAS_MODELS,
      prompt,
      temperature,
      signal,
    ),

  sambanova: (prompt, temperature, signal) =>
    pooledDirectProvider(
      "sambanova",
      "https://api.sambanova.ai/v1/chat/completions",
      SAMBANOVA_MODELS,
      prompt,
      temperature,
      signal,
    ),

  pool_a: pooledProvider("pool_a"),
  pool_b: pooledProvider("pool_b"),
  pool_c: pooledProvider("pool_c"),
  pool_d: pooledProvider("pool_d"),

  groq: async (prompt, temperature, signal) => {
    try {
      const keys = groqKeyPool();
      const text = keys.length
        ? await rotate("groq", keys, GROQ_MODELS, (key, model) =>
            openAICompatible({
              url: "https://api.groq.com/openai/v1/chat/completions",
              key,
              model,
              prompt,
              temperature,
              signal,
            }),
          )
        : await callGroq(prompt, temperature);
      markPoolGroupOutcome("groq", 1, "ok");
      return text;
    } catch (e) {
      parkGroupAfterFailure("groq", e);
      throw e;
    }
  },

  gemini: async (prompt, temperature) => {
    try {
      // 5 Gemini anahtarı arasında round-robin; QUOTA alan anahtar otomatik beklemeye alınır.
      const text = await rotate("gemini", geminiKeyPool(), ["gemini"], (key) =>
        callGemini(prompt, key, temperature, true),
      );
      markPoolGroupOutcome("gemini", 1, "ok");
      return text;
    } catch (e) {
      parkGroupAfterFailure("gemini", e);
      throw e;
    }
  },

  openrouter: async (prompt, temperature, signal) => {
    try {
      const text = await rotate("openrouter", openRouterKeyPool(), OPENROUTER_FREE, (key, model) =>
        openAICompatible({
          url: "https://openrouter.ai/api/v1/chat/completions",
          key,
          model,
          prompt,
          temperature,
          signal,
          extraHeaders: { "X-Title": "Velora Agent Router" },
        }),
      );
      markPoolGroupOutcome("openrouter", 1, "ok");
      return text;
    } catch (e) {
      parkGroupAfterFailure("openrouter", e);
      throw e;
    }
  },

  huggingface: async (prompt, temperature, signal) => {
    try {
      const text = await rotate(
        "huggingface",
        hfEnvKeys(),
        HF_MODELS,
        (key, model) =>
          openAICompatible({
            url: "https://router.huggingface.co/v1/chat/completions",
            key,
            model,
            prompt,
            temperature,
            signal,
            json: false,
          }),
      );
      markPoolGroupOutcome("hf", 1, "ok");
      return text;
    } catch (e) {
      parkGroupAfterFailure("hf", e);
      throw e;
    }
  },

  bedrock: (prompt, temperature, signal) => callBedrockClaude(prompt, temperature, signal),
};

// ---------------------------------------------------------------- bedrock (SigV4, SDK'sız)

const BEDROCK_MODELS = [
  "anthropic.claude-opus-4-1-20250805-v1:0",
  "anthropic.claude-3-opus-20240229-v1:0",
  "anthropic.claude-3-5-sonnet-20240620-v1:0",
  "anthropic.claude-3-haiku-20240307-v1:0",
];

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data));
}
function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/** AWS Bedrock Claude çağrısı — @aws-sdk yerine Worker uyumlu SigV4 imzası. */
export async function callBedrockClaude(
  prompt: string,
  temperature = 0.3,
  signal?: AbortSignal,
): Promise<string> {
  prompt = withEstimationRules(prompt);
  const accessKey = process.env["AWS_ACCESS_KEY_ID"];
  const secretKey = process.env["AWS_SECRET_ACCESS_KEY"];
  const region = process.env["AWS_REGION"] || "us-east-1";
  if (!accessKey || !secretKey) throw new Error("no aws credentials");

  let last: unknown = null;
  for (const model of BEDROCK_MODELS) {
    try {
      const host = `bedrock-runtime.${region}.amazonaws.com`;
      const path = `/model/${encodeURIComponent(model)}/invoke`;
      const payload = JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 4096,
        temperature,
        messages: [{ role: "user", content: prompt }],
      });
      const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
      const dateStamp = amzDate.slice(0, 8);
      const payloadHash = await sha256Hex(payload);
      const canonical = [
        "POST",
        path,
        "",
        `content-type:application/json\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`,
        "content-type;host;x-amz-content-sha256;x-amz-date",
        payloadHash,
      ].join("\n");
      const scope = `${dateStamp}/${region}/bedrock/aws4_request`;
      const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonical)].join("\n");
      let signingKey: ArrayBuffer | Uint8Array = new TextEncoder().encode(`AWS4${secretKey}`);
      for (const part of [dateStamp, region, "bedrock", "aws4_request"])
        signingKey = await hmac(signingKey, part);
      const signature = hex(await hmac(signingKey, toSign));

      const resp = await fetch(`https://${host}${path}`, {
        method: "POST",
        signal: signal ?? null,
        headers: {
          "Content-Type": "application/json",
          "X-Amz-Date": amzDate,
          "X-Amz-Content-Sha256": payloadHash,
          Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=${signature}`,
        },
        body: payload,
      });
      if (!resp.ok) {
        const body = (await resp.text()).slice(0, 200);
        const err = new Error(`Bedrock ${resp.status}: ${body}`) as Error & { status?: number };
        err.status = resp.status;
        throw err;
      }
      const json = (await resp.json()) as { content?: Array<{ text?: string }> };
      return json.content?.map((c) => c.text ?? "").join("") || "{}";
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error("bedrock failed");
}

// ---------------------------------------------------------------- fallback engine

export type AgentRunLog = {
  agent: string;
  provider: ProviderId | "none";
  attempts: number;
  latencyMs: number;
  ok: boolean;
  error?: string;
};

export type FallbackResult = { text: string; log: AgentRunLog };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Bir ajanı sağlayıcı zinciri üzerinden çalıştırır.
 * 429 / timeout / hata → sıradaki sağlayıcı; her tur sonunda üstel bekleme.
 */
export async function executeAgentWithFallback(
  agentName: string,
  prompt: string,
  chain: ProviderId[],
  opts: { temperature?: number; retries?: number } = {},
): Promise<FallbackResult> {
  prompt = withEstimationRules(prompt);
  const temperature = opts.temperature ?? 0.3;
  const retries = opts.retries ?? 2; // zincir üzerinden tam tur sayısı
  const started = Date.now();
  let attempts = 0;
  let lastError = "";

  for (let round = 0; round < retries; round++) {
    for (const provider of chain) {
      // Unified-pool providers: skip unconfigured / circuit-open groups so the
      // availability router never wastes an attempt on a dead node.
      const poolGroup = POOL_PROVIDER_GROUP[provider];
      if (poolGroup && (!poolGroupConfigured(poolGroup) || !poolGroupAvailable(poolGroup)))
        continue;
      attempts++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const text = await PROVIDERS[provider](prompt, temperature, controller.signal);
        clearTimeout(timer);
        if (!text || !text.trim()) throw new Error("empty response");
        return {
          text,
          log: { agent: agentName, provider, attempts, latencyMs: Date.now() - started, ok: true },
        };
      } catch (e) {
        clearTimeout(timer);
        lastError = `${provider}: ${(e as Error).message}`.slice(0, 200);
      }
    }
    await sleep(400 * 2 ** round + Math.random() * 250); // üstel geri çekilme + jitter
  }

  return {
    text: "",
    log: {
      agent: agentName,
      provider: "none",
      attempts,
      latencyMs: Date.now() - started,
      ok: false,
      error: lastError,
    },
  };
}

/** JSON bekleyen ajanlar için yardımcı. */
export function parseAgentJson<T>(text: string, fallback: T): T {
  if (!text.trim()) return fallback;
  return extractJson<T>(text, fallback);
}
