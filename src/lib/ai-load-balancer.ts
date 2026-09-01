/**
 * AI Multi-Provider Load Balancer & Pool Manager
 *
 * - 6x Gemini API Key Pool
 * - 4x Groq API Key Pool
 * - 1x Together AI API Key
 *
 * Features:
 * - Round-robin failover (rate limit / auth errors)
 * - Provider-level auto-switch (Groq → Gemini → Together)
 * - Per-task model selection (cost/speed optimization)
 * - Status tracking (last error, retry count)
 * - Circuit breaker pattern (temp disable on repeated failures)
 */

import { z } from "zod";

// ============================================================================
// TYPES & CONFIGURATION
// ============================================================================

export type ProviderType = "gemini" | "groq" | "together";
export type ModelTier = "fastest" | "balanced" | "strongest";

export interface AIKeyPool {
  provider: ProviderType;
  keys: string[];
  currentIndex: number;
  lastError?: {
    timestamp: number;
    status: number;
    message: string;
  };
  consecutiveFailures: number;
  isCircuitOpen: boolean; // Temp disable if too many failures
}

export interface AIProviderState {
  gemini: AIKeyPool;
  groq: AIKeyPool;
  together: AIKeyPool;
}

export interface ProviderCallOptions {
  model?: string;
  temperature?: number;
  maxRetries?: number;
  tier?: ModelTier; // Task type → select tier
}

// ============================================================================
// POOL INITIALIZATION
// ============================================================================

/**
 * Ortam değişkenlerinden all provider keys'i yükle
 * Format: GEMINI_API_KEY_1 ... GEMINI_API_KEY_6, GROQ_API_KEY_1 ... GROQ_API_KEY_4, TOGETHER_API_KEY
 */
export function initializeAIProviderPools(): AIProviderState {
  const geminiKeys: string[] = [];
  const groqKeys: string[] = [];
  const togetherKeys: string[] = [];

  // Gemini: KEY_1 to KEY_6
  for (let i = 1; i <= 6; i++) {
    const key = process.env[`GEMINI_API_KEY_${i}`];
    if (key?.trim()) geminiKeys.push(key.trim());
  }

  // Groq: KEY_1 to KEY_4
  for (let i = 1; i <= 4; i++) {
    const key = process.env[`GROQ_API_KEY_${i}`];
    if (key?.trim()) groqKeys.push(key.trim());
  }

  // Together: Single key
  const togetherKey = process.env["TOGETHER_API_KEY"];
  if (togetherKey?.trim()) togetherKeys.push(togetherKey.trim());

  return {
    gemini: {
      provider: "gemini",
      keys: geminiKeys,
      currentIndex: 0,
      consecutiveFailures: 0,
      isCircuitOpen: false,
    },
    groq: {
      provider: "groq",
      keys: groqKeys,
      currentIndex: 0,
      consecutiveFailures: 0,
      isCircuitOpen: false,
    },
    together: {
      provider: "together",
      keys: togetherKeys,
      currentIndex: 0,
      consecutiveFailures: 0,
      isCircuitOpen: false,
    },
  };
}

// ============================================================================
// POOL STATE MANAGEMENT (In-memory for this session)
// ============================================================================

let globalProviderState: AIProviderState | null = null;

export function getProviderState(): AIProviderState {
  if (!globalProviderState) {
    globalProviderState = initializeAIProviderPools();
  }
  return globalProviderState;
}

export function resetProviderState(): void {
  globalProviderState = initializeAIProviderPools();
}

// ============================================================================
// KEY ROTATION & ERROR HANDLING
// ============================================================================

/**
 * Sonraki key'e geç (round-robin)
 */
function rotateKey(pool: AIKeyPool): void {
  if (pool.keys.length === 0) return;
  pool.currentIndex = (pool.currentIndex + 1) % pool.keys.length;
}

/**
 * Current key'i al (circuit breaker kontrolü ile)
 */
function getCurrentKey(pool: AIKeyPool): string | null {
  if (pool.isCircuitOpen || pool.keys.length === 0) return null;
  return pool.keys[pool.currentIndex] ?? null;
}

/**
 * Error'u logla ve pool state'i güncelle
 */
function recordError(
  pool: AIKeyPool,
  status: number,
  message: string,
  autoRotate = true,
): void {
  pool.lastError = {
    timestamp: Date.now(),
    status,
    message: message.slice(0, 200),
  };
  pool.consecutiveFailures++;

  // Circuit breaker: 5+ consecutive failures → temp disable
  if (pool.consecutiveFailures >= 5) {
    pool.isCircuitOpen = true;
    console.warn(
      `[AI Provider] ${pool.provider} circuit OPEN after ${pool.consecutiveFailures} failures`,
    );
  }

  if (autoRotate) {
    rotateKey(pool);
  }
}

/**
 * Başarılı call → reset errors
 */
function recordSuccess(pool: AIKeyPool): void {
  pool.consecutiveFailures = 0;
  pool.isCircuitOpen = false;
  pool.lastError = undefined;
}

// ============================================================================
// MODEL SELECTION BY TIER
// ============================================================================

export const MODEL_SELECTION: Record<ProviderType, Record<ModelTier, string[]>> = {
  gemini: {
    strongest: ["gemini-flash-latest", "gemini-2.5-pro", "gemini-2.0-pro"],
    balanced: ["gemini-2.5-flash", "gemini-2.0-flash"],
    fastest: ["gemini-1.5-flash"],
  },
  groq: {
    strongest: ["openai/gpt-oss-120b", "llama-3.3-70b-versatile"],
    balanced: ["llama-3.1-8b-instant"],
    fastest: ["llama-3.1-8b-instant"],
  },
  together: {
    strongest: ["meta-llama/Llama-3-70b-chat-hf"],
    balanced: ["meta-llama/Llama-2-70b-chat-hf"],
    fastest: ["NousResearch/Nous-Hermes-2-Mixtral-8x7B-DPO"],
  },
};

export function selectModelForTier(provider: ProviderType, tier: ModelTier = "balanced"): string {
  const models = MODEL_SELECTION[provider]?.[tier] ?? [];
  return models[0] ?? `${provider}-default`;
}

// ============================================================================
// PRIMARY PROVIDER SELECTION (Gemini → Groq → Together)
// ============================================================================

/**
 * Task'a uygun ilk provider'ı seç
 * Varsayılan: Gemini (güçlü) → Groq (hızlı) → Together (backup)
 */
export function selectPrimaryProvider(taskType?: string): ProviderType {
  const state = getProviderState();

  // Circuit breaker kontrolü: açık olan provider'ı atla
  if (!state.gemini.isCircuitOpen && state.gemini.keys.length > 0) return "gemini";
  if (!state.groq.isCircuitOpen && state.groq.keys.length > 0) return "groq";
  if (!state.together.isCircuitOpen && state.together.keys.length > 0) return "together";

  // Hepsi circuit açık → error
  throw new Error("[AI Provider] All providers are temporarily unavailable (circuit breaker)");
}

/**
 * Fallback provider'a geçiş yap
 * Örn: Gemini fail → Groq → Together
 */
export function getNextProvider(currentProvider: ProviderType): ProviderType | null {
  const fallbackMap: Record<ProviderType, ProviderType | null> = {
    gemini: "groq",
    groq: "together",
    together: null,
  };
  return fallbackMap[currentProvider] ?? null;
}

// ============================================================================
// API CALL WRAPPER (With failover & retry logic)
// ============================================================================

interface CallAPIOptions {
  provider: ProviderType;
  model: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  temperature?: number;
  jsonMode?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
}

interface APICallResult {
  success: boolean;
  content?: string;
  error?: {
    status: number;
    message: string;
    retriable: boolean;
  };
}

/**
 * Single AI provider call (no retry logic at this level)
 * Returns detailed error info for upper-level retry/fallback decision
 */
async function callSingleProvider(opts: CallAPIOptions): Promise<APICallResult> {
  const state = getProviderState();
  const pool = state[opts.provider];
  const key = getCurrentKey(pool);

  if (!key) {
    recordError(pool, 503, `[${opts.provider}] No keys available or circuit open`, false);
    return {
      success: false,
      error: {
        status: 503,
        message: `Provider ${opts.provider} unavailable`,
        retriable: true,
      },
    };
  }

  try {
    let url = "";
    let body: Record<string, unknown> = {
      messages: opts.messages,
      temperature: opts.temperature ?? 0.7,
    };

    switch (opts.provider) {
      case "gemini":
        url = "https://generativelanguage.googleapis.com/v1beta/openai/";
        body = {
          ...body,
          model: opts.model,
          response_format: opts.jsonMode ? { type: "json_object" } : undefined,
        };
        break;

      case "groq":
        url = "https://api.groq.com/openai/v1/chat/completions";
        body = {
          ...body,
          model: opts.model,
          response_format: opts.jsonMode ? { type: "json_object" } : undefined,
        };
        break;

      case "together":
        url = "https://api.together.xyz/v1/chat/completions";
        body = {
          ...body,
          model: opts.model,
        };
        break;
    }

    const timeoutMs = opts.timeoutMs ?? 30000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(opts.provider === "gemini" && { "x-goog-api-key": key }),
          ...(opts.provider === "groq" && { Authorization: `Bearer ${key}` }),
          ...(opts.provider === "together" && { Authorization: `Bearer ${key}` }),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const detail = await response.text().catch(() => "unknown error");
        const retriable =
          response.status === 429 || // Rate limit
          response.status === 503 || // Service unavailable
          response.status === 502; // Bad gateway

        recordError(pool, response.status, detail);
        return {
          success: false,
          error: {
            status: response.status,
            message: detail.slice(0, 200),
            retriable,
          },
        };
      }

      const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content?.trim();

      if (!content) {
        recordError(pool, 500, "Empty response content");
        return {
          success: false,
          error: {
            status: 500,
            message: "Provider returned empty response",
            retriable: true,
          },
        };
      }

      recordSuccess(pool);
      return { success: true, content };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = message.includes("abort") || message.includes("timeout");

    recordError(pool, isTimeout ? 504 : 500, message);
    return {
      success: false,
      error: {
        status: isTimeout ? 504 : 500,
        message: isTimeout ? "Request timeout" : message.slice(0, 200),
        retriable: true,
      },
    };
  }
}

/**
 * Multi-provider call with smart failover
 * Try primary provider → on retriable error, fallback to next
 */
export async function callAIWithFailover(opts: {
  prompt: string;
  tier?: ModelTier;
  taskType?: string;
  temperature?: number;
  jsonMode?: boolean;
  timeoutMs?: number;
}): Promise<string> {
  const tier = opts.tier ?? "balanced";
  const jsonMode = opts.jsonMode ?? false;
  const timeoutMs = opts.timeoutMs ?? 30000;
  const temperature = opts.temperature ?? 0.7;

  let currentProvider: ProviderType | null = selectPrimaryProvider(opts.taskType);
  const attemptedProviders = new Set<ProviderType>();

  while (currentProvider) {
    attemptedProviders.add(currentProvider);

    const model = selectModelForTier(currentProvider, tier);
    const result = await callSingleProvider({
      provider: currentProvider,
      model,
      messages: [{ role: "user", content: opts.prompt }],
      temperature,
      jsonMode,
      timeoutMs,
    });

    if (result.success && result.content) {
      console.log(`[AI] ✓ ${currentProvider}/${model} success`);
      return result.content;
    }

    // If error is retriable and we have a fallback, try next
    if (result.error?.retriable) {
      const nextProvider = getNextProvider(currentProvider);
      if (nextProvider && !attemptedProviders.has(nextProvider)) {
        console.warn(
          `[AI] ${currentProvider} failed (${result.error.status}), fallback to ${nextProvider}`,
        );
        currentProvider = nextProvider;
        continue;
      }
    }

    // Non-retriable error or no more fallback
    throw new Error(
      `[AI Provider] Call failed: ${currentProvider} (${result.error?.status}) - ${result.error?.message}`,
    );
  }

  throw new Error("[AI Provider] All providers exhausted - no fallback available");
}

// ============================================================================
// HEALTH CHECK & DIAGNOSTICS
// ============================================================================

export function getProviderHealth(): Record<string, unknown> {
  const state = getProviderState();

  return {
    gemini: {
      available: state.gemini.keys.length > 0,
      keysCount: state.gemini.keys.length,
      circuitOpen: state.gemini.isCircuitOpen,
      consecutiveFailures: state.gemini.consecutiveFailures,
      lastError: state.gemini.lastError,
    },
    groq: {
      available: state.groq.keys.length > 0,
      keysCount: state.groq.keys.length,
      circuitOpen: state.groq.isCircuitOpen,
      consecutiveFailures: state.groq.consecutiveFailures,
      lastError: state.groq.lastError,
    },
    together: {
      available: state.together.keys.length > 0,
      keysCount: state.together.keys.length,
      circuitOpen: state.together.isCircuitOpen,
      consecutiveFailures: state.together.consecutiveFailures,
      lastError: state.together.lastError,
    },
  };
}
