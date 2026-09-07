/**
 * AI Smart Router — Ana modül
 *
 * Tek dışa aktarım: callSmartRouter({ prompt, taskType, maxTokens, temperature })
 *
 * İşleyiş:
 *  1. taskType'a göre provider öncelik listesi seçilir.
 *  2. Her provider için Round-Robin bazı key indeksinden başlanır.
 *  3.   • Key 429 / 5xx / timeout alırsa → aynı provider'daki sonraki key denenir.
 *  4.   • Tüm key'ler başarısız olursa → öncelik listesindeki sonraki provider'a geçilir.
 *  5. Hiçbir provider yanit vermezse hata fırlatılır.
 */

import {
  type ProviderId,
  type TaskType,
  loadProviderKeys,
  PROVIDER_CONFIGS,
  ROUTING_PRIORITY,
} from './config';

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

export type { ProviderId, TaskType };

export interface RouterInput {
  prompt: string;
  taskType?: TaskType;
  maxTokens?: number;
  temperature?: number;
}

export interface RouterOutput {
  text: string;
  provider: ProviderId;
  model: string;
  /** Kullanılan key numarası (1-tabanlı) */
  keyIndex: number;
  /** İlk başarılı yanıta kadar geçen süre (ms) */
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// Round-Robin durumu — Vercel function instance başına singleton
// ---------------------------------------------------------------------------

const rrIndex: Record<ProviderId, number> = {
  groq: 0, gemini: 0, openrouter: 0,
  huggingface: 0, cerebras: 0, sambanova: 0,
};

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 28_000; // Vercel 30 s limit altında

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function shouldRetryOnStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

// ---------------------------------------------------------------------------
// Tek provider çağrısı (tüm key'leri dener)
// ---------------------------------------------------------------------------

async function tryProvider(
  id: ProviderId,
  keys: string[],
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
        if (shouldRetryOnStatus(res.status)) continue; // sonraki key
        return null; // yeniden denenemez (4xx, 429 değil)
      }

      const raw: unknown = await res.json();
      const text = cfg.extractText(raw);

      if (!text) {
        console.warn(`[ai-router] ${id} key[${idx + 1}] → boş yanıt`);
        continue;
      }

      // Başarılı: Round-Robin indeksini bir sonraki key'e ilerlet
      rrIndex[id] = (idx + 1) % n;
      return { text, keyIndex: idx + 1 };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[ai-router] ${id} key[${idx + 1}] → ${msg}`);
      // timeout / ağ hatası → sonraki key
    }
  }

  return null; // provider'daki tüm key'ler başarısız
}

// ---------------------------------------------------------------------------
// Dışa aktarılan ana fonksiyon
// ---------------------------------------------------------------------------

/**
 * Akıllı çoklu sağlayıcı router.
 *
 * @example
 * const { text, provider, latencyMs } = await callSmartRouter({
 *   prompt: 'Bir ürün açıklaması yaz.',
 *   taskType: 'fast',
 *   maxTokens: 512,
 *   temperature: 0.7,
 * });
 */
export async function callSmartRouter(input: RouterInput): Promise<RouterOutput> {
  const {
    prompt,
    taskType    = 'default',
    maxTokens   = 1024,
    temperature = 0.7,
  } = input;

  const allKeys      = loadProviderKeys();
  const priorityList = ROUTING_PRIORITY[taskType];
  const t0           = Date.now();

  for (const id of priorityList) {
    const keys = allKeys[id];

    if (!keys || keys.length === 0) {
      console.warn(`[ai-router] ${id}: key tanımlı değil, atlanıyor.`);
      continue;
    }

    const result = await tryProvider(id, keys, prompt, maxTokens, temperature);

    if (result) {
      return {
        text:      result.text,
        provider:  id,
        model:     PROVIDER_CONFIGS[id].model,
        keyIndex:  result.keyIndex,
        latencyMs: Date.now() - t0,
      };
    }

    console.warn(`[ai-router] ${id}: tüm key'ler başarısız — sonraki provider'a geçiliyor.`);
  }

  throw new Error(
    `[ai-router] Tüm provider'lar başarısız (taskType=${taskType}). ` +
    'Vercel ortam değişkenlerini ve API key limitlerini kontrol et.',
  );
}
