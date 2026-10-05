/**
 * Shared AI env-key scanner (server only).
 *
 * Every AI feature used to hardcode its own env names and stopped at low
 * suffixes — e.g. gemini pools read only GEMINI_API_KEY_1.._3, OpenRouter only
 * _1.._2 — so real deployments that store keys as GEMINI_API_KEY_4,
 * OPENROUTER_API_KEY_4, GROQ_API_KEY_4 or HF_TOKEN_5 were silently ignored and
 * every chain returned empty.
 *
 * This module centralizes discovery: each provider is scanned across every
 * naming convention this project has ever used (BASE, BASE_N, BASE_N_ …) for
 * slots 1..8, so whatever suffix a user actually stores under is picked up.
 * Only reads happen here — no key material is ever exported.
 */

function readEnv(name: string): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : "";
}

/**
 * DOĞRUDAN MODEL SAĞLAYICILARI — tek anahtarla erişilen ikinci yol.
 *
 * Neden ayrı: OpenRouter TEK anahtarla altı modeli birden açar ve bu proje
 * onu zaten destekliyor. Ama kullanıcı bu modellerin SAHİBİ olduğu
 * sağlayıcılardan (DeepSeek, Z.ai, Xiaomi MiMo, Alibaba Qwen) doğrudan
 * anahtarı varsa daha ucuz ve kotası daha geniş olur. Hepsi OpenAI uyumlu
 * olduğu için `PROVIDER_A..D` yuvasına yazılmakla yetkilidir — kod değişmez.
 *
 * UÇLAR VE MODEL ADLARI 2026-10-03'te CANLI doğrulandı (resmî dokümanlar):
 *   • DeepSeek  → https://api.deepseek.com/v1            · deepseek-flash
 *     (sağlayıcı duyurusu: `deepseek-flash` en son V4'ü çağırır; V4-Flash
 *      slug'ı 10 Eylül 2026'dan beri V4.1 Flash'a yönlenir)
 *   • Z.ai GLM  → https://api.z.ai/api/paas/v4           · glm-5.3
 *   • Xiaomi    → https://api.xiaomimimo.com/v1           · mimo-v2.6-pro
 *   • Qwen      → https://dashscope.aliyuncs.com/compatible-mode/v1 · qwen3.8-flash-next
 */
export const DIRECT_MODEL_PROVIDERS = [
  {
    slot: "PROVIDER_A",
    label: "DeepSeek (deepseek-flash = V4.1 Flash)",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-flash",
  },
  {
    slot: "PROVIDER_B",
    label: "Z.ai GLM (glm-5.3)",
    baseUrl: "https://api.z.ai/api/paas/v4",
    model: "glm-5.3",
  },
  {
    slot: "PROVIDER_C",
    label: "Xiaomi MiMo (mimo-v2.6-pro)",
    baseUrl: "https://api.xiaomimimo.com/v1",
    model: "mimo-v2.6-pro",
  },
  {
    slot: "PROVIDER_D",
    label: "Alibaba Qwen (qwen3.8-flash-next)",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen3.8-flash-next",
  },
] as const;

/**
 * Hangi doğrudan sağlayıcılar bu dağıtımda TANIMLI?
 *
 * Yalnız İSİM döner, anahtar değeri ASLA. Ön kontrol paneli bunu “isteğe
 * bağlı” bir kanıt olarak gösterir.
 */
export function configuredDirectModelProviders(
  env: Record<string, string | undefined> = process.env,
): { slot: string; label: string; model: string }[] {
  const out: { slot: string; label: string; model: string }[] = [];
  for (const provider of DIRECT_MODEL_PROVIDERS) {
    for (const name of [`${provider.slot}_1`, `${provider.slot}_API_KEY`, `${provider.slot}_KEY`]) {
      const value = env[name];
      if (value && value.trim()) {
        out.push({ slot: provider.slot, label: provider.label, model: provider.model });
        break;
      }
    }
  }
  return out;
}

/**
 * EVREN — Savunma Sanayii Başkanlığı'nın ulusal YZ platformu (evren.ssyz.org.tr).
 *
 * ÖLÇÜLEN/DOĞRULANAN (2026-10-04 haber duyuruları):
 *   • 14 açık ağırlıklı LLM, **OpenAI uyumlu** API, anlık yanıt + otomatik model
 *     yönlendirme; veri Türkiye'de (64× H200 kümesi) işleniyor.
 *   • **1 Kasım 2026'ya kadar API çağrıları kredi bakiyesinden düşülmeden
 *     sınırsız.** Yani o tarihe kadar bu havuz kotası TÜKENMEZ — mevcut
 *     ücretsiz katmanların (Gemini 15 RPM, HF en dar) darboğazını kırar.
 *   • Erişim e-Devlet kimlik doğrulamalı; panelde `evren_llm_…` biçiminde
 *     API anahtarı üretiliyor.
 *
 * DOĞRULANAN UÇ VE MODEL (2026-10-04):
 *   • Base URL : https://evren-llmapi.ssyz.org.tr/v1
 *   • Uç biçimi: OpenAI Chat Completions → …/v1/chat/completions
 *   • **`model="auto"`**: resmî LLM çıkarım sayfası, platformun “istekin
 *     yetenek, bağlam ve anlık filo yükünü değerlendirip uygun modeli otomatik
 *     seçtiğini” yazıyor. Yani sabit bir model adı bilmemize GEREK YOK.
 *
 * Bu yüzden `EVREN_BASE_URL` ve `EVREN_MODEL` artık ZORUNLU DEĞİL: **yalnız
 * anahtar yeterli.** Kullanıcı isterse override edebilir — sabit bir model
 * (örn. `glm-5.3`) yazarsa yalnız onu kullanır.
 */
export const EVREN_ENV = {
  /** Düz anahtar adları (slot 1..8). */
  keys: ["EVREN_API_KEY"],
  /** Numaralı adaylar — hepsi taranır, dolu olan alınır. */
  keySuffixes: ["EVREN_API_KEY_{i}", "EVREN_{i}_API_KEY", "EVREN_API_KEY{i}"],
  /** Doğrulanmış çıkarım ucu — kullanıcı değiştirebilir ama gerekmez. */
  defaultBaseUrl: "https://evren-llmapi.ssyz.org.tr/v1",
  /** Override adları — doluysa varsayılanın yerine geçer. */
  baseUrlNames: ["EVREN_BASE_URL", "EVREN_API_URL", "EVREN_URL"],
  /**
   * `auto` = platform isteği değerlendirip uygun modeli kendisi seçer (resmî
   * LLM çıkarım sayfası). Sabit slug bilmemize gerek bırakmaz.
   */
  defaultModel: "auto",
  /** Virgülle ayrılmış liste — sabit model(ler) yazılmak istenirse. */
  modelNames: ["EVREN_MODEL", "EVREN_MODELS", "EVREN_DEFAULT_MODEL"],
} as const;

/**
 * EVREN anahtarları — `PROVIDER_E_1.._8` önce, sonra düz `EVREN_API_KEY*`.
 * Yalnız DEĞER toplanır; burada hiçbir anahtar dışa verilmez.
 */
export function evrenEnvKeys(): string[] {
  return collectEnvKeys({
    base: ["PROVIDER_E_1", "EVREN_API_KEY"],
    patterns: [
      (i) => `PROVIDER_E_${i}`,
      (i) => EVREN_ENV.keySuffixes[0].replace("{i}", String(i)),
      (i) => EVREN_ENV.keySuffixes[1].replace("{i}", String(i)),
      (i) => EVREN_ENV.keySuffixes[2].replace("{i}", String(i)),
    ],
  });
}

type KeySpec = {
  /** Plain (unnumbered) env names, in priority order. */
  base?: string[];
  /** Numbered conventions, each a function of the slot (1-based). */
  patterns?: Array<(slot: number) => string>;
  /** Highest slot to scan (default 8). */
  max?: number;
};

/** Collects env values in spec order, skipping empty/duplicate entries. */
function collectEnvKeys(spec: KeySpec): string[] {
  const out: string[] = [];
  const push = (name: string) => {
    if (!name) return;
    const value = readEnv(name);
    if (value) out.push(value);
  };
  for (const b of spec.base ?? []) push(b);
  const max = spec.max ?? 8;
  for (let slot = 1; slot <= max; slot++) {
    for (const pattern of spec.patterns ?? []) push(pattern(slot));
  }
  return Array.from(new Set(out));
}

/** Gemini: GEMINI_API_KEY, GEMINI_API_KEY_1..8, GEMINI_1_API_KEY..8_API_KEY. */
export function geminiEnvKeys(): string[] {
  return collectEnvKeys({
    base: ["GEMINI_API_KEY"],
    patterns: [(i) => `GEMINI_API_KEY_${i}`, (i) => `GEMINI_${i}_API_KEY`],
  });
}

/** Groq: GROQ_API_KEY, GROQ_API_KEY_1..8, GROQ_1_API_KEY…, GROQ_API_KEY1… */
export function groqEnvKeys(): string[] {
  return collectEnvKeys({
    base: ["GROQ_API_KEY"],
    patterns: [(i) => `GROQ_API_KEY_${i}`, (i) => `GROQ_${i}_API_KEY`, (i) => `GROQ_API_KEY${i}`],
  });
}

/** OpenRouter: OPENROUTER_API_KEY, _1..8, OPENROUTER_API_KEY1…, OPENROUTER_1_API_KEY… */
export function openRouterEnvKeys(): string[] {
  return collectEnvKeys({
    base: ["OPENROUTER_API_KEY"],
    patterns: [
      (i) => `OPENROUTER_API_KEY_${i}`,
      (i) => `OPENROUTER_API_KEY${i}`,
      (i) => `OPENROUTER_${i}_API_KEY`,
    ],
  });
}

/** Hugging Face: HF_TOKEN, HUGGING_FACE_API_KEY…, HF_TOKEN_1..8, HUGGING_FACE_API_KEY_1..8 / KEY1… */
export function hfEnvKeys(): string[] {
  return collectEnvKeys({
    base: ["HF_TOKEN", "HUGGING_FACE_API_KEY", "HUGGING_FACE_TOKEN"],
    patterns: [
      (i) => `HF_TOKEN_${i}`,
      (i) => `HUGGING_FACE_API_KEY_${i}`,
      (i) => `HUGGING_FACE_API_KEY${i}`,
    ],
  });
}

/** Cerebras: CEREBRAS_API_KEY, CEREBRAS_API_KEY_1..8 */
export function cerebrasEnvKeys(): string[] {
  return collectEnvKeys({
    base: ["CEREBRAS_API_KEY"],
    patterns: [(i) => `CEREBRAS_API_KEY_${i}`],
  });
}

/** SambaNova: SAMBANOVA_API_KEY, SAMBANOVA_API_KEY_1..8 */
export function sambanovaEnvKeys(): string[] {
  return collectEnvKeys({
    base: ["SAMBANOVA_API_KEY"],
    patterns: [(i) => `SAMBANOVA_API_KEY_${i}`],
  });
}

/**
 * True when ANY AI provider credential is configured — gateway or any of the
 * project's own key pools. Used by env-check so the warning is accurate no
 * matter which suffix the user stored keys under.
 */
export function anyAiKeyConfigured(): boolean {
  const gateway = process.env["AI_GATEWAY_API_KEY"] || process.env["LOVABLE_API_KEY"];
  if (gateway?.trim()) return true;
  return (
    geminiEnvKeys().length > 0 ||
    groqEnvKeys().length > 0 ||
    openRouterEnvKeys().length > 0 ||
    hfEnvKeys().length > 0 ||
    cerebrasEnvKeys().length > 0 ||
    sambanovaEnvKeys().length > 0 ||
    evrenEnvKeys().length > 0
  );
}

/**
 * EVREN'in çıkarım ucu.
 *
 * Kullanıcı `EVREN_BASE_URL` verirse o kullanılır; vermezse **doğrulanmış**
 * varsayılan uc kullanılır. Yani kullanıcı için üçüncü zorunlu alan yok.
 */
export function evrenBaseUrl(env: Record<string, string | undefined> = process.env): string {
  for (const name of EVREN_ENV.baseUrlNames) {
    const v = env[name];
    if (v && v.trim()) return v.trim();
  }
  for (const name of ["PROVIDER_E_BASE_URL", "PROVIDER_E_URL", "PROVIDER_E_API_URL"]) {
    const v = env[name];
    if (v && v.trim()) return v.trim();
  }
  return EVREN_ENV.defaultBaseUrl;
}

/**
 * EVREN model slug'ları.
 *
 * Kullanıcı virgülle ayrılmış sabit model yazdıysa onlar kullanılır; yazmadıysa
 * `["auto"]` — platform isteği değerlendirip uygun modeli kendisi seçer.
 */
export function evrenModels(env: Record<string, string | undefined> = process.env): string[] {
  for (const name of [...EVREN_ENV.modelNames, "PROVIDER_E_MODEL"]) {
    const raw = env[name];
    if (raw && raw.trim()) {
      const list = raw
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean);
      if (list.length) return Array.from(new Set(list));
    }
  }
  return [EVREN_ENV.defaultModel];
}

/**
 * Ön kontrol paneli için EVREN kanıtı — İSİM/model/kaç anahtar, sır YOK.
 *
 * `ready` artık **yalnız anahtar**la da olur: uç ve model doğrulanmış
 * varsayılanlardan gelir (`evrenBaseUrl` / `evrenModels`). Kullanıcı üçüncü
 * ve dördüncü kutuyu doldurmak zorunda değil.
 */
export function evrenStatus(env: Record<string, string | undefined> = process.env): {
  keys: number;
  baseUrl: boolean;
  models: string[];
  ready: boolean;
} {
  let keys = 0;
  for (let i = 1; i <= 8; i++) {
    const names = [
      `PROVIDER_E_${i}`,
      `EVREN_API_KEY_${i}`,
      `EVREN_${i}_API_KEY`,
      `EVREN_API_KEY${i}`,
    ];
    if (names.some((n) => (env[n] ?? "").trim())) keys++;
  }
  if ((env["PROVIDER_E_1"] ?? "").trim() && !keys) keys = 1;
  if ((env["EVREN_API_KEY"] ?? "").trim() && !keys) keys = 1;
  const models = evrenModels(env);
  const baseUrl = Boolean(evrenBaseUrl(env));
  return { keys, baseUrl, models, ready: keys > 0 && baseUrl && models.length > 0 };
}
