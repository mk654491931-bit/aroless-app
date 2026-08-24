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
import { withEstimationRules } from "./ai-guidance";

/** Tier 1-3 hızlı/sıfır maliyetli zincir — tüm yan modüller bunu kullanır (Bedrock YOK). */
export const FAST_CHAIN: ProviderId[] = [
  "cerebras",
  "sambanova",
  "groq",
  "gemini",
  "openrouter",
  "huggingface",
];
/** Sadece Ürün Bulucu nihai sentez ajanı Bedrock Claude ile başlar. */
export const FINAL_SYNTHESIS_CHAIN: ProviderId[] = ["bedrock", "gemini", "openrouter", "groq"];

export type ProviderId =
  "cerebras" | "sambanova" | "groq" | "gemini" | "openrouter" | "huggingface" | "bedrock";

export type ProviderCall = (
  prompt: string,
  temperature: number,
  signal: AbortSignal,
) => Promise<string>;

const TIMEOUT_MS = 45_000;

function pool(...names: string[]): string[] {
  const raw = names.map((n) => process.env[n]).filter((v): v is string => Boolean(v && v.trim()));
  return Array.from(new Set(raw));
}

/** Basit OpenAI uyumlu chat-completions çağrısı. */
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

/** Havuzdaki her anahtar × her model kombinasyonunu sırayla dener. */
async function rotate(
  keys: string[],
  models: string[],
  run: (key: string, model: string) => Promise<string>,
): Promise<string> {
  if (!keys.length) throw new Error("no api key configured");
  let last: unknown = null;
  for (const key of keys) {
    for (const model of models) {
      try {
        return await run(key, model);
      } catch (e) {
        last = e;
        const status = (e as { status?: number }).status;
        if (status === 429 || status === 402 || status === 401) break; // anahtar tükendi → rotasyon
      }
    }
  }
  throw last instanceof Error ? last : new Error("all keys failed");
}

// ---------------------------------------------------------------- providers

const CEREBRAS_MODELS = ["llama3.1-8b", "llama-3.3-70b"];
const SAMBANOVA_MODELS = ["Meta-Llama-3.3-70B-Instruct", "Meta-Llama-3.1-8B-Instruct"];
const OPENROUTER_FREE = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "mistralai/mistral-small-3.1-24b-instruct:free",
  "google/gemma-2-9b-it:free",
];
const GROQ_MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
const HF_MODELS = ["meta-llama/Llama-3.1-8B-Instruct", "mistralai/Mistral-7B-Instruct-v0.3"];

export const PROVIDERS: Record<ProviderId, ProviderCall> = {
  cerebras: (prompt, temperature, signal) =>
    rotate(pool("CEREBRAS_API_KEY", "CEREBRAS_API_KEY_2"), CEREBRAS_MODELS, (key, model) =>
      openAICompatible({
        url: "https://api.cerebras.ai/v1/chat/completions",
        key,
        model,
        prompt,
        temperature,
        signal,
      }),
    ),

  sambanova: (prompt, temperature, signal) =>
    rotate(pool("SAMBANOVA_API_KEY", "SAMBANOVA_API_KEY_2"), SAMBANOVA_MODELS, (key, model) =>
      openAICompatible({
        url: "https://api.sambanova.ai/v1/chat/completions",
        key,
        model,
        prompt,
        temperature,
        signal,
      }),
    ),

  groq: async (prompt, temperature, signal) => {
    const keys = groqKeyPool();
    if (!keys.length) return callGroq(prompt, temperature);
    try {
      // Birincil → ikincil anahtar rotasyonu (429/401/402'de anında 2. anahtar).
      return await rotate(keys, GROQ_MODELS, (key, model) =>
        openAICompatible({
          url: "https://api.groq.com/openai/v1/chat/completions",
          key,
          model,
          prompt,
          temperature,
          signal,
        }),
      );
    } catch {
      return callGroq(prompt, temperature);
    }
  },

  gemini: (prompt, temperature) =>
    // Sıradaki anahtar 429/401/402 alırsa otomatik olarak 2./3. anahtara geçer.
    rotate(geminiKeyPool(), ["gemini"], (key) => callGemini(prompt, key, temperature, true)),

  openrouter: (prompt, temperature, signal) =>
    rotate(openRouterKeyPool(), OPENROUTER_FREE, (key, model) =>
      openAICompatible({
        url: "https://openrouter.ai/api/v1/chat/completions",
        key,
        model,
        prompt,
        temperature,
        signal,
        extraHeaders: { "X-Title": "Velora Agent Router" },
      }),
    ),

  huggingface: (prompt, temperature, signal) =>
    rotate(
      pool(
        "HF_TOKEN_1",
        "HF_TOKEN",
        "HUGGING_FACE_API_KEY1",
        "HF_TOKEN_2",
        "HUGGING_FACE_API_KEY2",
      ),
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
    ),

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
