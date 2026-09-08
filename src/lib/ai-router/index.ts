/**
 * AI Smart Router — Ana modül
 *
 * Dışa aktarılan tek fonksiyon:
 *   callSmartRouter({ prompt, taskType, maxTokens, temperature })
 *
 * İşleyiş:
 *  1. taskType'a göre provider öncelik listesi seçilir.
 *  2. Her provider için Round-Robin bazı key indeksinden başlanır.
 *     • Key 429/5xx/timeout alırsa → aynı provider'daki sonraki key denenir.
 *     • Tüm key'ler başarısız olursa → bir sonraki provider'a geçilir.
 *  3. Hiçbir provider yanıt vermezse anlamlı hata fırlatılır.
 *
 * Vercel Edge & Serverless Runtime ile tam uyumlu:
 *   - Standart Web Fetch API kullanılır.
 *   - process.env: Edge'de globalThis.process, Serverless'ta Node process.
 */

import {
  type ProviderId,
  type TaskType,
  loadProviderKeys,
  PROVIDER_CONFIGS,
  ROUTING_PRIORITY,
} from './config';
import { describeFailure, runWithFallback, withTimeout } from '../agent-orchestration';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type { ProviderId, TaskType };

export interface RouterInput {
  /** Modele gönderilecek prompt */
  prompt: string;
  /** İş türü: hızlı / karmaşık / genel (varsayılan: 'default') */
  taskType?: TaskType;
  /** Maksimum token sayısı (varsayılan: 1024) */
  maxTokens?: number;
  /** Yaratıcılık katsayısı 0-1 (varsayılan: 0.7) */
  temperature?: number;
}

export interface RouterOutput {
  /** Üretilen metin */
  text: string;
  /** Yanıt veren provider */
  provider: ProviderId;
  /** Kullanılan model adı */
  model: string;
  /** Kullanılan key numarası, 1-tabanlı */
  keyIndex: number;
  /** İlk yanıta kadar geçen toplam süre (ms) */
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// Round-Robin durumu — Vercel function instance başına singleton
// ---------------------------------------------------------------------------

const rrIndex: Record<ProviderId, number> = {
  groq: 0,
  gemini: 0,
  openrouter: 0,
  huggingface: 0,
  cerebras: 0,
  sambanova: 0,
};

// ---------------------------------------------------------------------------
// Fetch yardımcısı
// ---------------------------------------------------------------------------

/** Vercel 30 s limiti altında güvenli fetch timeout */
const TIMEOUT_MS = 28_000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  return withTimeout(() => fetch(url, init), TIMEOUT_MS, `ai-router:${new URL(url).hostname}`);
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

// ---------------------------------------------------------------------------
// Provider denemesi: Round-Robin başlangıcından tüm key'leri dener
// ---------------------------------------------------------------------------

async function tryProvider(
  id: ProviderId,
  keys: readonly string[],
  prompt: string,
  maxTokens: number,
  temperature: number,
): Promise<{ text: string; keyIndex: number } | null> {
  const cfg  = PROVIDER_CONFIGS[id];
  const n    = keys.length;
  const base = rrIndex[id] ?? 0;

  for (let attempt = 0; attempt < n; attempt++) {
    const idx    = (base + attempt) % n;
    const apiKey = keys[idx]!;

    try {
      const res = await fetchWithTimeout(cfg.endpoint, {
        method:  'POST',
        headers: cfg.buildHeaders(apiKey),
        body:    JSON.stringify(cfg.buildBody(prompt, maxTokens, temperature)),
      });

      if (!res.ok) {
        console.warn(`[ai-router] ${id} key[${idx + 1}/${n}] → HTTP ${res.status}`);
        if (isRetryable(res.status)) continue; // sonraki key
        return null; // 4xx (rate-limit dışı): yeniden deneme yapma
      }

      const raw: unknown = await res.json();
      const text = cfg.extractText(raw);

      if (!text) {
        console.warn(`[ai-router] ${id} key[${idx + 1}] → boş yanıt`);
        continue; // bir sonraki key'i dene
      }

      // Başarı — Round-Robin indeksini bir sonraki key'e taşı
      rrIndex[id] = (idx + 1) % n;
      return { text, keyIndex: idx + 1 };

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[ai-router] ${id} key[${idx + 1}] → ${msg}`);
      // timeout / ağ hatası → bir sonraki key
    }
  }

  return null; // bu provider'daki tüm key'ler başarısız
}

// ---------------------------------------------------------------------------
// Ana export
// ---------------------------------------------------------------------------

/**
 * Akıllı çoklu sağlayıcı router.
 *
 * @example
 * const result = await callSmartRouter({
 *   prompt: 'Kısaca yapay zekayı açıkla.',
 *   taskType: 'fast',
 *   maxTokens: 256,
 *   temperature: 0.5,
 * });
 * console.log(result.text, result.provider, result.latencyMs);
 */
export async function callSmartRouter(
  input: RouterInput,
): Promise<RouterOutput> {
  const {
    prompt,
    taskType    = 'default',
    maxTokens   = 1024,
    temperature = 0.7,
  } = input;

  const allKeys      = loadProviderKeys();
  const priorityList = ROUTING_PRIORITY[taskType];
  const t0           = Date.now();
  const configuredProviders = priorityList.filter((id) => {
    const keys = allKeys[id];
    if (!keys || keys.length === 0) {
      console.warn(`[ai-router] ${id}: ortam değişkeni tanımlı değil, atlanıyor.`);
      return false;
    }
    return true;
  });

  const result = await runWithFallback<{ text: string; keyIndex: number }>(
    configuredProviders.map((id) => ({
      name: id,
      call: async () => {
        const hit = await tryProvider(id, allKeys[id], prompt, maxTokens, temperature);
        if (!hit) throw new Error("all keys failed");
        return hit;
      },
    })),
    {
      onFailure: (failure) => {
        console.warn(
          `[ai-router] ${failure.name}: tüm key'ler başarısız — sonraki provider'a geçiliyor. (${describeFailure(failure.error)})`,
        );
      },
    },
  );
  if (result.ok) {
    const provider = result.provider as ProviderId;
    return {
      text: result.value.text,
      provider,
      model: PROVIDER_CONFIGS[provider].model,
      keyIndex: result.value.keyIndex,
      latencyMs: Date.now() - t0,
    };
  }

  throw new Error(
    `[ai-router] Tüm provider'lar başarısız oldu (taskType=${taskType}). ` +
    'Vercel ortam değişkenlerini (GROQ_KEY_1 … SAMBANOVA_KEY_1) kontrol edin.',
  );
}
