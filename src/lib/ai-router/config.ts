/**
 * AI Router — Provider Konfigürasyonu
 *
 * 22 API key: Groq×5 | Gemini×5 | OpenRouter×5 | HuggingFace×5 | Cerebras×1 | SambaNova×1
 * Vercel Edge & Serverless Runtime ile tam uyumlu (Node 18+, Web Fetch API)
 *
 * CHANGELOG:
 *   fix: siteOrigin() template literal düzeltildi (https:// → https://)
 *   feat: CircuitBreakerState tipi eklendi
 */

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

export type ProviderId =
  "groq" | "gemini" | "openrouter" | "huggingface" | "cerebras" | "sambanova";

export type TaskType = "fast" | "complex" | "default";

export interface ProviderConfig {
  id: ProviderId;
  endpoint: string;
  model: string;
  /** Her istek için header üretir */
  buildHeaders: (apiKey: string) => Record<string, string>;
  /** Her istek için gövde üretir (JSON-serialize edilecek) */
  buildBody: (prompt: string, maxTokens: number, temperature: number) => unknown;
  /** Ham API yanıtından metin çıkarır */
  extractText: (raw: unknown) => string;
}

/** Circuit breaker durumu — 3 ardışık hata sonrası 60 sn devre dışı */
export interface CircuitBreakerState {
  failures: number;
  openUntil: number; // Date.now() cinsinden
}

// ---------------------------------------------------------------------------
// Key yükleme
// ---------------------------------------------------------------------------

function loadKeys(prefix: string, count: number): string[] {
  const keys: string[] = [];
  for (let i = 1; i <= count; i++) {
    const val = (process.env as Record<string, string | undefined>)[`${prefix}_${i}`];
    if (val && val.trim().length > 0) keys.push(val.trim());
  }
  return keys;
}

export function loadProviderKeys(): Record<ProviderId, string[]> {
  return {
    groq: loadKeys("GROQ_KEY", 5),
    gemini: loadKeys("GEMINI_KEY", 5),
    openrouter: loadKeys("OPENROUTER_KEY", 5),
    huggingface: loadKeys("HUGGINGFACE_KEY", 5),
    cerebras: loadKeys("CEREBRAS_KEY", 1),
    sambanova: loadKeys("SAMBANOVA_KEY", 1),
  };
}

// ---------------------------------------------------------------------------
// Yardımcı fonksiyonlar
// ---------------------------------------------------------------------------

function openAiHeaders(apiKey: string, extra?: Record<string, string>): Record<string, string> {
  return { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, ...extra };
}

function openAiBody(
  model: string,
  prompt: string,
  maxTokens: number,
  temperature: number,
): unknown {
  return {
    model,
    messages: [{ role: "user", content: prompt }],
    max_tokens: maxTokens,
    temperature,
  };
}

function extractOpenAiText(raw: unknown): string {
  const r = raw as { choices?: Array<{ message?: { content?: string }; text?: string }> };
  return r?.choices?.[0]?.message?.content ?? r?.choices?.[0]?.text ?? "";
}

// ---------------------------------------------------------------------------
// Provider tanımları
// ---------------------------------------------------------------------------

/** Vercel'de VERCEL_URL otomatik set edilir (protokolsüz), yoksa localhost. */
const siteOrigin = (): string => {
  const v = (process.env as Record<string, string | undefined>)["VERCEL_URL"];
  return v ? `https://${v}` : "http://localhost:8080";
};

export const PROVIDER_CONFIGS: Record<ProviderId, ProviderConfig> = {
  // ―― Groq (OpenAI-compat) ――――――――――――――――――――――――――――――――――――――
  groq: {
    id: "groq",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.3-70b-versatile",
    buildHeaders: (k) => openAiHeaders(k),
    buildBody: (p, mt, t) => openAiBody("llama-3.3-70b-versatile", p, mt, t),
    extractText: extractOpenAiText,
  },

  // ―― Gemini (Google REST) ――――――――――――――――――――――――――――――――――
  gemini: {
    id: "gemini",
    endpoint:
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent",
    model: "gemini-1.5-flash",
    buildHeaders: (k) => ({ "Content-Type": "application/json", "x-goog-api-key": k }),
    buildBody: (p, mt, t) => ({
      contents: [{ role: "user", parts: [{ text: p }] }],
      generationConfig: { maxOutputTokens: mt, temperature: t },
    }),
    extractText: (raw) => {
      const r = raw as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      return r?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    },
  },

  // ―― OpenRouter (OpenAI-compat) ――――――――――――――――――――――――――――――
  openrouter: {
    id: "openrouter",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    model: "meta-llama/llama-3.3-70b-instruct",
    buildHeaders: (k) =>
      openAiHeaders(k, {
        "HTTP-Referer": siteOrigin(),
        "X-Title": "Aroless App",
      }),
    buildBody: (p, mt, t) => openAiBody("meta-llama/llama-3.3-70b-instruct", p, mt, t),
    extractText: extractOpenAiText,
  },

  // ―― Hugging Face (Inference API) ――――――――――――――――――――――――――――
  huggingface: {
    id: "huggingface",
    endpoint: "https://api-inference.huggingface.co/models/mistralai/Mixtral-8x7B-Instruct-v0.1",
    model: "mistralai/Mixtral-8x7B-Instruct-v0.1",
    buildHeaders: (k) => ({ "Content-Type": "application/json", Authorization: `Bearer ${k}` }),
    buildBody: (p, mt, t) => ({
      inputs: p,
      parameters: { max_new_tokens: mt, temperature: t, return_full_text: false },
    }),
    extractText: (raw) => {
      const arr = raw as Array<{ generated_text?: string }>;
      return Array.isArray(arr) ? (arr[0]?.generated_text ?? "") : "";
    },
  },

  // ―― Cerebras (OpenAI-compat) ―――――――――――――――――――――――――――――――
  cerebras: {
    id: "cerebras",
    endpoint: "https://api.cerebras.ai/v1/chat/completions",
    model: "llama3.1-70b",
    buildHeaders: (k) => openAiHeaders(k),
    buildBody: (p, mt, t) => openAiBody("llama3.1-70b", p, mt, t),
    extractText: extractOpenAiText,
  },

  // ―― SambaNova (OpenAI-compat) ――――――――――――――――――――――――――――――
  sambanova: {
    id: "sambanova",
    endpoint: "https://fast-api.snova.ai/v1/chat/completions",
    model: "Meta-Llama-3.3-70B-Instruct",
    buildHeaders: (k) => openAiHeaders(k),
    buildBody: (p, mt, t) => openAiBody("Meta-Llama-3.3-70B-Instruct", p, mt, t),
    extractText: extractOpenAiText,
  },
};

// ---------------------------------------------------------------------------
// Routing öncelikleri
// ---------------------------------------------------------------------------

export const ROUTING_PRIORITY: Record<TaskType, ProviderId[]> = {
  fast: ["cerebras", "sambanova", "groq", "openrouter"],
  complex: ["gemini", "openrouter", "groq"],
  default: ["groq", "cerebras", "sambanova", "gemini", "openrouter", "huggingface"],
};
