// ============================================================================
// Aroless — 14'lü AI Konsey Mimarisi (server only)
//
//   6 uzman ekip × 2 model (1 üretici + 1 hakem) = 12 üye
//   + 1 Müdür / Sentez Motoru
//   + 1 Bağımsız Denetçi / Final Auditor
//   = 14 AI çağrısı
//
// Ekipler:
//   1. Trend & Pazar       (Groq / Gemini)
//   2. Finans & Tedarik    (OpenRouter / Groq)
//   3. Pazarlama & Kanca   (Hugging Face / OpenRouter)
//   4. Operasyon & Lojistik (Groq / Gemini)
//   5. Uyum & Risk         (OpenRouter / Gemini)
//   6. Yaratıcı & Viral    (Hugging Face / Groq)
//
// Rate-limit koruması: staggered execution (120-200 ms), otomatik fallback,
// ve 24 saatlik smart cache.
// ============================================================================
import { callGemini, callGroq, callLovableAI, callPremiumAI, extractJson } from "./ai.server";
import { callOpenRouter } from "./tools-ai.server";
import { callHuggingFace } from "./hf.server";
import { cached } from "./ai-cache.server";
import { collectSignals, signalsBlock, type PipelineSignals } from "./data-pipeline.server";
import { createAgentBus } from "./agent-bus.server";
import {
  canAffordCall,
  CouncilBudgetError,
  defaultCouncilBudgetMs,
  planCouncilBudget,
  stageFits,
  withStageDeadline,
  type CouncilBudget,
  type CouncilDepth,
  type CouncilStage,
} from "./council-budget.server";

export const COUNCIL_TEAMS = [
  "market",
  "finance",
  "marketing",
  "operations",
  "compliance",
  "creative",
] as const;
export type CouncilTeam = (typeof COUNCIL_TEAMS)[number];

export type TeamReport = {
  team: CouncilTeam;
  title: string;
  score: number;
  engine: string;
  summary: string;
  bullets: string[];
  metrics: { label: string; value: string }[];
  /** Ekibin kendi puanı (hakem düzeltmesinden önce). */
  raw_score: number;
  /** Hakem modelin verdiği puan. */
  review_score: number;
  reviewer_engine: string;
  /** Hakemin kısa gerekçesi. */
  review_note: string;
  /** Konsey ağırlığı (%). */
  weight: number;
  /** Veri desteği + hakem uyumuna göre 0-100 güven. */
  confidence: number;
};

export type CouncilReport = {
  query: string;
  country: string;
  velora_score: number;
  verdict: string;
  executive_report: string;
  teams: TeamReport[];
  director_engine: string;
  auditor_engine: string;
  auditor_score: number;
  auditor_note: string;
  action_plan: string[];
  risks: string[];
  signals: PipelineSignals;
  cache_hit: boolean;
  generated_at: string;
  /** Canlı veri hatlarının kaçının aktif olduğu (0-100). */
  data_coverage: number;
  /** Rapor genel güven skoru (0-100). */
  confidence: number;
  /** Konseyin fikir ayrılığı seviyesi (puan yayılımı). */
  disagreement: number;
  /** Projeyi durdurma kriterleri. */
  kill_criteria: string[];
  /** Fırsat penceresi (örn. "6-8 hafta"). */
  opportunity_window: string;
  /** Daha güçlü alternatif pazar önerisi. */
  alt_market: string;
  /**
   * Rapor hangi derinlikte üretildi:
   *  - `full`   → kalıcı süreçte/uzak worker'da tam hat (6 üretici + 6 hakem + müdür + denetçi)
   *  - `fast`   → 300 sn'lik sunucusuz isteğe sığacak şekilde kısaltılmış hat
   *  - `enrich` → ürün bulucunun İÇİNDEN çağrılan kısa karne (6 üretici + müdür;
   *               hakem turu ve denetçi yok — 280 sn'lik hat bütçesine sığar)
   * Arayüz bunu dürüstçe gösterir; üç rapor aynı değildir.
   */
  depth: CouncilDepth;
  /** Süre bütçesine sığmadığı için atlanan aşamalar (boşsa tam hat koştu). */
  skipped_stages: string[];
};

/** Konsey ağırlıkları — toplam 100. */
const TEAM_WEIGHTS: Record<CouncilTeam, number> = {
  market: 30,
  finance: 25,
  marketing: 20,
  operations: 10,
  compliance: 8,
  creative: 7,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Staggered execution: 120-200 ms micro-delay so 14 models never burst. */
const stagger = (slot: number) => sleep(120 + slot * 20 + Math.floor(Math.random() * 60));

function clamp100(n: unknown, fb = 55): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(1, Math.min(100, Math.round(v))) : fb;
}

const strArr = (v: unknown, n: number): string[] =>
  Array.isArray(v) ? v.slice(0, n).map((x) => String(x).slice(0, 300)) : [];

type Runner = { engine: string; run: () => Promise<string> };

/** Hangi aşamanın bütçesiyle koşuyoruz — her çağrı kendi aşamasına bağlanır. */
type CallContext = { budget: CouncilBudget; stage: CouncilStage };

/**
 * Sırayla motorları dener; ilk anlamlı JSON cevabı kazanır.
 *
 * Her deneme AŞAMANIN süre bütçesine bağlıdır: yavaş bir sağlayıcı tüm bütçeyi
 * yutamaz, sıradaki yedek motora geçilir. Süre bitmek üzereyse yeni deneme
 * başlatılmaz (bu yüzden 504 yerine eksik ama geçerli bir rapor döner).
 * Deneme sayısı profille sınırlıdır (`maxAttempts`): hızlı profilde 2, tamda 4.
 */
async function withFallback(runners: Runner[], prompt: string | undefined, ctx: CallContext) {
  const chain: Runner[] =
    prompt && !runners.some((r) => r.engine === "Lovable AI Gateway")
      ? [...runners, { engine: "Lovable AI Gateway", run: () => callLovableAI(prompt, 0.4) }]
      : runners;
  for (const r of chain.slice(0, ctx.budget.maxAttempts)) {
    if (!canAffordCall(ctx.budget, ctx.stage)) break;
    const outcome = await withStageDeadline(r.run(), ctx.budget, ctx.stage);
    if (outcome.kind === "value") {
      const parsed = extractJson<Record<string, unknown>>(outcome.value, {});
      if (parsed && Object.keys(parsed).length) return { engine: r.engine, raw: parsed };
    } else {
      await sleep(120); // 429 / timeout / süre yetmedi → anında yedek modele geç
    }
  }
  return { engine: "unavailable", raw: {} as Record<string, unknown> };
}

/**
 * Aşamaya bağlı model seçicisi.
 *
 * `withFallback`'i aşama bağlamına bağlar; 6 ekip + müdür + denetçi zinciri tek
 * argümanlı çağrıyla kalır (`pickFor(ctx)(runnerChain)`), böylece 8 ayrı model
 * listesi okunaklı durur.
 */
function pickFor(ctx: CallContext) {
  return (runners: Runner[], prompt?: string) => withFallback(runners, prompt, ctx);
}

const SHAPE = `Return ONLY minified JSON:
{"score": number 1-100,
 "summary": string (2-3 Turkish sentences),
 "bullets": [string] (3-5 concrete Turkish insights, each with a number),
 "metrics": [{"label": string, "value": string}] (3-4 items)}`;

const COUNCIL_LANG_NAMES: Record<string, string> = {
  tr: "Turkish",
  en: "English",
  es: "Spanish",
  de: "German",
  fr: "French",
  ar: "Arabic",
};
let activeCouncilLang = "tr";
function langDirective(): string {
  const name = COUNCIL_LANG_NAMES[activeCouncilLang] ?? "English";
  return `\n\nOUTPUT LANGUAGE: write every human-readable string in ${name}. Keep numbers, currency codes, URLs and brand names unchanged.`;
}

function teamPrompt(role: string, task: string, block: string): string {
  return `${role}\n\nGÖREV: ${task}\n\nCANLI VERİ SİNYALLERİ:\n${block}\n\n${SHAPE}${langDirective()}`;
}

function baseTeam(
  team: CouncilTeam,
  title: string,
  engine: string,
  raw: Record<string, unknown>,
): TeamReport {
  const score = clamp100(raw["score"]);
  return {
    team,
    title,
    engine,
    score,
    raw_score: score,
    review_score: score,
    reviewer_engine: "-",
    review_note: "",
    weight: TEAM_WEIGHTS[team],
    confidence: 50,
    summary: String(raw["summary"] ?? ""),
    bullets: strArr(raw["bullets"], 5),
    metrics: (Array.isArray(raw["metrics"]) ? raw["metrics"] : []).slice(0, 4).map((m) => ({
      label: String((m as Record<string, unknown>)?.["label"] ?? ""),
      value: String((m as Record<string, unknown>)?.["value"] ?? ""),
    })),
  };
}

async function runMarketTeam(block: string, ctx: CallContext): Promise<TeamReport> {
  const prompt = teamPrompt(
    "Sen EKİP 1 — TREND & PAZAR ANALİZİ ekibisin.",
    "Trend kaynaklarını, GitHub scraper verilerini ve sosyal sinyalleri analiz et. Pazar doygunluğunu ve trend ivmesini ölç. Puan = pazar fırsatı (1-100). Sinyalde ölçüm yoksa uydurma, 'veri yok' yaz.",
    block,
  );
  await stagger(0);
  const runnerChain: Runner[] = [
    { engine: "Groq llama-3.3-70b", run: () => callGroq(prompt, 0.3) },
    {
      engine: "Gemini Flash (grounded)",
      run: () =>
        callGemini(prompt, undefined, 0.4, true, ["gemini-flash-latest", "gemini-2.0-flash"]),
    },
    { engine: "Lovable AI Gateway", run: () => callLovableAI(prompt, 0.4) },
  ];
  const { engine, raw } = await pickFor(ctx)(runnerChain);
  return baseTeam("market", "Trend & Pazar Analizi", engine, raw);
}

async function runFinanceTeam(block: string, ctx: CallContext): Promise<TeamReport> {
  const prompt = teamPrompt(
    "Sen EKİP 2 — FİNANS & TEDARİK ekibisin.",
    "Ürün maliyeti, kargo, gümrük/vergi, kar marjı ve Çin/küresel tedarik zincirini hesapla. Metriklerde COGS, satış fiyatı, brüt marj % ve başabaş adet yer alsın. Puan = finansal sürdürülebilirlik (1-100).",
    block,
  );
  await stagger(1);
  const runnerChain: Runner[] = [
    { engine: "OpenRouter DeepSeek (free)", run: () => callOpenRouter(prompt, 0.35) },
    { engine: "Groq DeepSeek-distill", run: () => callGroq(prompt, 0.35) },
    {
      engine: "Gemini Flash",
      run: () =>
        callGemini(prompt, undefined, 0.4, false, ["gemini-flash-latest", "gemini-2.0-flash"]),
    },
    { engine: "Lovable AI Gateway", run: () => callLovableAI(prompt, 0.4) },
  ];
  const { engine, raw } = await pickFor(ctx)(runnerChain);
  return baseTeam("finance", "Finans & Tedarik", engine, raw);
}

async function runMarketingTeam(block: string, ctx: CallContext): Promise<TeamReport> {
  const prompt = teamPrompt(
    "Sen EKİP 3 — PAZARLAMA & REKLAM KANCASI ekibisin.",
    "Meta/TikTok reklam açılarını, metin yazarlığı detaylarını ve ikna kancalarını üret. Maddelerin en az ikisi doğrudan kullanılabilir reklam kancası olsun. Puan = pazarlanabilirlik (1-100).",
    block,
  );
  await stagger(2);
  const runnerChain: Runner[] = [
    {
      engine: "Hugging Face Mistral/Qwen",
      run: () => callHuggingFace(prompt, "qwen", { temperature: 0.6 }),
    },
    { engine: "OpenRouter free Llama/Qwen", run: () => callOpenRouter(prompt, 0.6) },
    { engine: "Groq llama-3.3-70b", run: () => callGroq(prompt, 0.6) },
    { engine: "Lovable AI Gateway", run: () => callLovableAI(prompt, 0.6) },
  ];
  const { engine, raw } = await pickFor(ctx)(runnerChain);
  return baseTeam("marketing", "Pazarlama & Reklam Kancası", engine, raw);
}

async function runOperationsTeam(block: string, ctx: CallContext): Promise<TeamReport> {
  const prompt = teamPrompt(
    "Sen EKİP 4 — OPERASYON & LOJİSTİK ekibisin.",
    "Teslimat süresi, envanter yönetimi, 3PL/depolama, iade oranı, kırılganlık ve kargo maliyetini değerlendir. Puan = operasyonel ölçeklenebilirlik (1-100).",
    block,
  );
  await stagger(3);
  const runnerChain: Runner[] = [
    { engine: "Groq llama-3.3-70b", run: () => callGroq(prompt, 0.35) },
    {
      engine: "Gemini Flash",
      run: () =>
        callGemini(prompt, undefined, 0.4, false, ["gemini-flash-latest", "gemini-2.0-flash"]),
    },
    { engine: "OpenRouter DeepSeek", run: () => callOpenRouter(prompt, 0.35) },
    { engine: "Lovable AI Gateway", run: () => callLovableAI(prompt, 0.4) },
  ];
  const { engine, raw } = await pickFor(ctx)(runnerChain);
  return baseTeam("operations", "Operasyon & Lojistik", engine, raw);
}

async function runComplianceTeam(block: string, ctx: CallContext): Promise<TeamReport> {
  const prompt = teamPrompt(
    "Sen EKİP 5 — UYUM & RİSK ekibisin.",
    "Fikri mülkiyet, sertifikalar (CE/FCC/RoHS), platform politikaları, ithalat yasakları, vergi/vergisi ve yasal riskleri incele. Puan = risk-adjusted uygunluk (1-100).",
    block,
  );
  await stagger(4);
  const runnerChain: Runner[] = [
    { engine: "OpenRouter DeepSeek", run: () => callOpenRouter(prompt, 0.35) },
    {
      engine: "Gemini Flash",
      run: () =>
        callGemini(prompt, undefined, 0.4, false, ["gemini-flash-latest", "gemini-2.0-flash"]),
    },
    { engine: "Groq llama-3.3-70b", run: () => callGroq(prompt, 0.35) },
    { engine: "Lovable AI Gateway", run: () => callLovableAI(prompt, 0.4) },
  ];
  const { engine, raw } = await pickFor(ctx)(runnerChain);
  return baseTeam("compliance", "Uyum & Risk", engine, raw);
}

async function runCreativeTeam(block: string, ctx: CallContext): Promise<TeamReport> {
  const prompt = teamPrompt(
    "Sen EKİP 6 — YARATICI & VİRAL İÇERİK ekibisin.",
    "Ürünün viral kancasını, TikTok/Reels/Shorts açılarını, hashtag potansiyelini, influencer uygunluğunu ve kreatif farklılaşmasını değerlendir. Puan = viral / kreatif potansiyel (1-100).",
    block,
  );
  await stagger(5);
  const runnerChain: Runner[] = [
    {
      engine: "Hugging Face Mistral/Qwen",
      run: () => callHuggingFace(prompt, "qwen", { temperature: 0.7 }),
    },
    { engine: "OpenRouter free Llama/Qwen", run: () => callOpenRouter(prompt, 0.65) },
    { engine: "Groq llama-3.3-70b", run: () => callGroq(prompt, 0.65) },
    { engine: "Lovable AI Gateway", run: () => callLovableAI(prompt, 0.65) },
  ];
  const { engine, raw } = await pickFor(ctx)(runnerChain);
  return baseTeam("creative", "Yaratıcı & Viral İçerik", engine, raw);
}

async function reviewTeam(
  team: TeamReport,
  block: string,
  slot: number,
  ctx: CallContext,
): Promise<{ score: number; note: string; engine: string }> {
  const prompt = `Sen bir HAKEM modelsin. Aşağıdaki ekip raporunu canlı verilerle karşılaştır, abartı/uydurma varsa puanı düşür.
EKİP: ${team.title} | Ekip puanı: ${team.score}
ÖZET: ${team.summary}
MADDELER: ${team.bullets.join(" | ")}

CANLI VERİ:
${block}

Return ONLY JSON: {"score": number 1-100, "note": string (max 140 characters)}${langDirective()}`;
  await stagger(slot);
  const primaryEngine =
    team.team === "market"
      ? {
          engine: "Hakem: Gemini Flash",
          run: () =>
            callGemini(prompt, undefined, 0.2, false, ["gemini-flash-latest", "gemini-2.0-flash"]),
        }
      : team.team === "finance"
        ? { engine: "Hakem: Groq", run: () => callGroq(prompt, 0.2) }
        : team.team === "marketing"
          ? { engine: "Hakem: OpenRouter", run: () => callOpenRouter(prompt, 0.2) }
          : team.team === "operations"
            ? { engine: "Hakem: OpenRouter", run: () => callOpenRouter(prompt, 0.2) }
            : team.team === "compliance"
              ? {
                  engine: "Hakem: Gemini Flash",
                  run: () =>
                    callGemini(prompt, undefined, 0.2, false, [
                      "gemini-flash-latest",
                      "gemini-2.0-flash",
                    ]),
                }
              : { engine: "Hakem: Groq", run: () => callGroq(prompt, 0.2) };
  const runners: Runner[] = [
    primaryEngine,
    team.team === "creative" || team.team === "marketing"
      ? {
          engine: "Hakem: Hugging Face",
          run: () => callHuggingFace(prompt, "qwen", { temperature: 0.2 }),
        }
      : {
          engine: "Hakem: Gemini Flash",
          run: () =>
            callGemini(prompt, undefined, 0.2, false, ["gemini-flash-latest", "gemini-2.0-flash"]),
        },
  ];
  const { engine, raw } = await withFallback(runners, prompt, ctx);
  const s = Number(raw["score"]);
  return {
    score: Number.isFinite(s) ? Math.max(1, Math.min(100, Math.round(s))) : team.score,
    note: String(raw["note"] ?? "").slice(0, 200),
    engine,
  };
}

async function runDirector(
  query: string,
  country: string,
  teams: TeamReport[],
  block: string,
  veloraScore: number,
  coverage: number,
  ctx: CallContext,
): Promise<{
  engine: string;
  verdict: string;
  report: string;
  actions: string[];
  risks: string[];
  kill: string[];
  window: string;
  alt: string;
}> {
  const prompt = `Sen 7. YAPAY ZEKA — MÜDÜR / SENTEZLEME MOTORU'sun.
Altı uzman ekibin raporunu ve hakem düzeltmelerini birleştirip tek sayfalık temiz bir "İCRA RAPORU" yaz.

ÜRÜN/NİŞ: ${query} | HEDEF ÜLKE: ${country}
${teams
  .map(
    (t) =>
      `- ${t.title} (${t.engine}, ağırlık %${t.weight}): ekip ${t.raw_score} → hakem ${t.review_score} → nihai ${t.score}/100 (güven ${t.confidence}) — ${t.summary}${t.review_note ? ` [hakem: ${t.review_note}]` : ""}`,
  )
  .join("\n")}
AROLESS SCORE (ağırlıklı): ${veloraScore}/100 | CANLI VERİ KAPSAMI: %${coverage}

CANLI VERİ:
${block}

Kapsam %60'ın altındaysa temkinli ol ve bunu raporda açıkça belirt. Sinyalle desteklenmeyen sayı uydurma.

Return ONLY JSON:
{"verdict": string (max 80 karakter: GİR / BEKLE / GEÇ + gerekçe),
 "executive_report": string (300-600 kelime, markdown başlıklı tek sayfalık icra raporu),
 "action_plan": [string] (5 sıralı somut adım, ilk 14 güne uygun),
 "risks": [string] (3 gerçekçi risk),
 "kill_criteria": [string] (3 ölçülebilir durdurma kriteri, örn. "CPA > 25$ ise durdur"),
 "opportunity_window": string (max 40 karakter, örn. "6-8 hafta"),
 "alt_market": string (max 80 karakter: daha güçlü alternatif ülke + tek cümle gerekçe)}`;
  await stagger(12);
  const runnerChain: Runner[] = [
    {
      engine: "Aroless Premium (Gemini 3.1 Pro / GPT-5.5)",
      run: () => callPremiumAI(prompt, 0.5),
    },
    {
      engine: "Gemini Pro (free)",
      run: () =>
        callGemini(prompt, undefined, 0.5, false, [
          "gemini-1.5-pro",
          "gemini-flash-latest",
          "gemini-2.0-flash",
        ]),
    },
    { engine: "Groq llama-3.3-70b", run: () => callGroq(prompt, 0.5) },
    { engine: "OpenRouter free", run: () => callOpenRouter(prompt, 0.5) },
    { engine: "Lovable AI Gateway", run: () => callLovableAI(prompt, 0.5) },
  ];
  const { engine, raw } = await pickFor(ctx)(runnerChain);

  return {
    engine,
    verdict: String(
      raw["verdict"] ?? (veloraScore >= 70 ? "GİR — güçlü fırsat" : "BEKLE — sinyal zayıf"),
    ).slice(0, 120),
    report: String(raw["executive_report"] ?? "").slice(0, 6000),
    actions: strArr(raw["action_plan"], 5),
    risks: strArr(raw["risks"], 4),
    kill: strArr(raw["kill_criteria"], 3),
    window: String(raw["opportunity_window"] ?? "").slice(0, 60),
    alt: String(raw["alt_market"] ?? "").slice(0, 140),
  };
}

async function runAuditor(
  query: string,
  country: string,
  teams: TeamReport[],
  directorVerdict: string,
  veloraScore: number,
  coverage: number,
  ctx: CallContext,
): Promise<{ engine: string; score: number; note: string }> {
  const prompt = `Sen 14. YAPAY ZEKA — BAĞIMSIZ DENETÇİ'sin. Müdürün kararını ve altı ekibin puanlarını eleştirel gözle teyit et.
Eğer ekipler arası fikir ayrılığı yüksekse, canlı veri kapsamı düşükse veya müdürün puanı hakem notlarıyla çelişiyorsa, puanı aşağı çek.

ÜRÜN/NİŞ: ${query} | HEDEF ÜLKE: ${country}
${teams.map((t) => `- ${t.title}: ${t.score}/100 (güven ${t.confidence}) [${t.engine}]`).join("\n")}
MÜDÜR KARARI: ${directorVerdict}
AROLESS SCORE (müdür): ${veloraScore}/100 | CANLI VERİ KAPSAMI: %${coverage}

Return ONLY JSON: {"score": number 1-100, "note": string (max 160 karakter, neden düzelttiğin veya onayladığın)}${langDirective()}`;
  await stagger(13);
  const runnerChain: Runner[] = [
    {
      engine: "Gemini Pro (auditor)",
      run: () =>
        callGemini(prompt, undefined, 0.4, false, ["gemini-1.5-pro", "gemini-flash-latest"]),
    },
    { engine: "Groq llama-3.3-70b", run: () => callGroq(prompt, 0.4) },
    { engine: "OpenRouter DeepSeek", run: () => callOpenRouter(prompt, 0.4) },
    { engine: "Lovable AI Gateway", run: () => callLovableAI(prompt, 0.4) },
  ];
  const { engine, raw } = await pickFor(ctx)(runnerChain);
  const s = clamp100(raw["score"], veloraScore);
  return {
    engine,
    score: s,
    note: String(raw["note"] ?? "").slice(0, 200),
  };
}

/** Canlı veri hattı süre bütçesine sığmadığında kullanılan boş sinyal seti. */
function emptySignals(query: string, country: string): PipelineSignals {
  return {
    keyword: query,
    country,
    trends: { yearly: [], monthly: [], momentum_pct: 0, source: "yok" },
    reddit: [],
    tiktok: [],
    amazon: [],
    google_rising: [],
    github: [],
    sources: [],
    collected_at: new Date().toISOString(),
  };
}

type DirectorOutput = Awaited<ReturnType<typeof runDirector>>;

/**
 * Müdür modeli süre bütçesine sığmadığında (veya hiç cevap vermediğinde) icra
 * raporunu ekip çıktılarından deterministik olarak derler.
 *
 * 300 sn'lik sunucusuz istekte kullanıcıya 504 yerine TAM bir rapor vermenin
 * son savunma hattıdır. Uydurma sayı üretmez: yalnızca ekiplerin yazdıklarını
 * birleştirir ve raporun başında bu durumu açıkça söyler.
 */
function synthesizeDirector(
  teams: TeamReport[],
  veloraScore: number,
  coverage: number,
): DirectorOutput {
  const ranked = [...teams].sort((a, b) => b.score * b.weight - a.score * a.weight);
  const weakest = [...teams].sort((a, b) => a.score - b.score).slice(0, 2);
  const verdict =
    veloraScore >= 70
      ? `GİR — güçlü fırsat (${veloraScore}/100)`
      : veloraScore >= 50
        ? `BEKLE — sinyal orta (${veloraScore}/100)`
        : `GEÇ — sinyal zayıf (${veloraScore}/100)`;

  const report = [
    "> Not: Müdür modeli süre bütçesine sığmadı. Bu icra raporu altı ekibin çıktısından otomatik derlendi, yeni sayı üretilmedi.",
    "",
    `## Aroless Score: ${veloraScore}/100 · Canlı veri kapsamı: %${coverage}`,
    "",
    "### Ekip özetleri",
    ...teams.map(
      (t) =>
        `**${t.title}** — ${t.score}/100 (ağırlık %${t.weight}, güven %${t.confidence}, motor: ${t.engine})\n${t.summary}`,
    ),
    "",
    "### Öne çıkan maddeler",
    ...ranked.slice(0, 3).flatMap((t) => t.bullets.slice(0, 2).map((b) => `- [${t.title}] ${b}`)),
  ].join("\n");

  const actions = ranked
    .flatMap((t) => t.bullets)
    .slice(0, 5)
    .map((b) => b.slice(0, 300));

  const risks = [
    ...weakest.map((t) => `${t.title} zayıf (${t.score}/100): ${t.summary}`.slice(0, 300)),
    ...(coverage < 60
      ? [
          `Canlı veri kapsamı yalnızca %${coverage}: karar öncesi Google Trends/Reddit/TikTok verisini elle doğrula.`,
        ]
      : []),
  ].slice(0, 4);

  return {
    engine: "yerel derleme (müdür modeli atlandı)",
    verdict,
    report,
    actions,
    risks,
    kill: [
      "İlk 14 günde doğrulanmış satış gelmezse durdur",
      "Hedef CPA'nın 2 katını aşarsa durdur",
      "Aroless Score 50'nin altına inerse durdur",
    ],
    window: "",
    alt: "",
  };
}

/**
 * Konsey hattını verilen süre bütçesi içinde koşar.
 *
 * Bütçe kritik: her aşama ve her model çağrısı `council-budget.server.ts`
 * kurallarına bağlanır, böylece istek platform onu kesmeden biter ve sığmayan
 * aşamalar `skipped_stages` içinde dürüstçe raporlanır.
 */
async function build(
  query: string,
  country: string,
  category: string,
  budget: CouncilBudget,
): Promise<CouncilReport> {
  const skipped: string[] = [];
  /** Her çağrı kendi aşamasının bütçesine bağlanır. */
  const ctxFor = (stage: CouncilStage): CallContext => ({ budget, stage });
  const traceId = `council_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const bus = createAgentBus(traceId);
  bus.emit("pipeline:start", { traceId, query: query.slice(0, 80), depth: budget.depth });
  const tSignals = Date.now();

  // Canlı veri hatları 24 saat önbellekli; yine de bütçeye bağlanır: askıda
  // kalan bir kaynak tüm konseyi geciktirmemeli (boş sinyalle devam ederiz).
  const signalsOutcome = budget.skips.includes("signals")
    ? ({ kind: "pending" } as const)
    : await withStageDeadline(collectSignals(query, country, category), budget, "signals");
  const signals =
    signalsOutcome.kind === "value" ? signalsOutcome.value.data : emptySignals(query, country);
  if (signalsOutcome.kind !== "value") skipped.push("canlı veri hatları");
  bus.emit("signals:collected", { traceId, coverage: 0, ms: Date.now() - tSignals });
  const block = signalsBlock(signals);

  const total = signals.sources.length || 1;
  const active = signals.sources.filter((s) => s.status === "active" && s.items > 0).length;
  const coverage = Math.round((active / total) * 100);
  bus.emit("signals:collected", { traceId, coverage, ms: Date.now() - tSignals });

  // 6 üretici ekip paralel başlar — her biri bus üzerinden izlenir, blocking yok.
  // Ekipler konseyin TEMELİDİR: bu aşamaya yer yoksa rapor üretilemez, o yüzden
  // 504 yerine açık ve hızlı bir hata veririz (kredi iade edilir).
  if (!stageFits(budget, "teams")) throw new CouncilBudgetError(budget.totalMs, "uzman ekipler");
  bus.emit("tier:start", { traceId, tier: 1 });
  const tTier1 = Date.now();
  const teamCtx = ctxFor("teams");
  const [market, finance, marketing, operations, compliance, creative] = await Promise.all([
    runMarketTeam(block, teamCtx),
    runFinanceTeam(block, teamCtx),
    runMarketingTeam(block, teamCtx),
    runOperationsTeam(block, teamCtx),
    runComplianceTeam(block, teamCtx),
    runCreativeTeam(block, teamCtx),
  ]);

  bus.emit("tier:complete", { traceId, tier: 1, ms: Date.now() - tTier1 });
  const rawTeams = [market, finance, marketing, operations, compliance, creative];

  bus.emit("tier:start", { traceId, tier: 2 });
  const tTier2 = Date.now();
  // 6 hakem ekip, slot 6-11. Süre yetmiyorsa hakem turu ATLANIR: her ekip kendi
  // puanını korur (aşağıdaki `rev?.score ?? t.raw_score`), rapor yine döner.
  const reviewersFit = stageFits(budget, "review") && !budget.skips.includes("review");
  if (!reviewersFit) skipped.push("hakem turu (6 hakem)");
  const reviewCtx = ctxFor("review");
  const reviewed: Awaited<ReturnType<typeof reviewTeam>>[] = reviewersFit
    ? await Promise.all([
        reviewTeam(market, block, 6, reviewCtx),
        reviewTeam(finance, block, 7, reviewCtx),
        reviewTeam(marketing, block, 8, reviewCtx),
        reviewTeam(operations, block, 9, reviewCtx),
        reviewTeam(compliance, block, 10, reviewCtx),
        reviewTeam(creative, block, 11, reviewCtx),
      ])
    : [];

  const teams: TeamReport[] = rawTeams.map((t, i) => {
    const rev = reviewed[i];
    const reviewScore = rev?.score ?? t.raw_score;
    const finalScore = Math.round(t.raw_score * 0.6 + reviewScore * 0.4);
    const gap = Math.abs(t.raw_score - reviewScore);
    const hasBody = t.summary.length > 20 && t.bullets.length >= 3;
    const confidence = Math.max(
      5,
      Math.min(
        99,
        Math.round(
          coverage * 0.5 +
            (100 - gap * 2) * 0.35 +
            (hasBody ? 15 : 0) +
            (t.engine === "unavailable" ? -40 : 0),
        ),
      ),
    );
    return {
      ...t,
      score: finalScore,
      review_score: reviewScore,
      review_note: rev?.note ?? "",
      reviewer_engine: rev?.engine ?? "-",
      confidence,
    };
  });

  bus.emit("tier:complete", { traceId, tier: 2, ms: Date.now() - tTier2 });
  const weightSum = teams.reduce((s, t) => s + t.weight, 0) || 1;
  const directorVelora = Math.round(teams.reduce((s, t) => s + t.score * t.weight, 0) / weightSum);

  bus.emit("tier:start", { traceId, tier: 3 });
  const tTier3 = Date.now();
  // Müdür aşaması sığmıyorsa (veya hiçbir motor cevap vermediyse) icra raporu
  // ekip çıktılarından yerel olarak derlenir — kullanıcı 504 görmez.
  const directorFits = stageFits(budget, "director") && !budget.skips.includes("director");
  if (!directorFits) skipped.push("müdür sentezi (model)");
  let director = directorFits
    ? await runDirector(query, country, teams, block, directorVelora, coverage, ctxFor("director"))
    : synthesizeDirector(teams, directorVelora, coverage);
  if (directorFits && director.engine === "unavailable" && !director.report) {
    director = synthesizeDirector(teams, directorVelora, coverage);
    skipped.push("müdür sentezi (model cevapsız)");
  }
  bus.emit("tier:complete", { traceId, tier: 3, ms: Date.now() - tTier3 });
  bus.emit("tier:start", { traceId, tier: 4 });
  const tTier4 = Date.now();

  // 14. üye: bağımsız denetçi müdür puanını teyit eder / düzeltir.
  const auditorFits = stageFits(budget, "auditor") && !budget.skips.includes("auditor");
  if (!auditorFits) skipped.push("bağımsız denetçi (14. ajan)");
  const auditor = auditorFits
    ? await runAuditor(
        query,
        country,
        teams,
        director.verdict,
        directorVelora,
        coverage,
        ctxFor("auditor"),
      )
    : {
        engine: "atlandı (süre bütçesi)",
        score: directorVelora,
        note: "Denetçi aşaması süre bütçesine sığmadı; müdür puanı değiştirilmedi.",
      };
  bus.emit("tier:complete", { traceId, tier: 4, ms: Date.now() - tTier4 });
  const finalVelora = Math.round((directorVelora + auditor.score) / 2);

  const scores = teams.map((t) => t.score);
  const disagreement = Math.max(...scores) - Math.min(...scores);
  const confidence = Math.max(
    5,
    Math.min(
      99,
      Math.round(
        (teams.reduce((s, t) => s + t.confidence, 0) / teams.length) * 0.6 +
          (auditor.score >= 60 ? 20 : 5) -
          disagreement * 0.2,
      ),
    ),
  );

  bus.emit("pipeline:complete", { traceId, ok: true, ms: Date.now() - tSignals });
  return {
    query,
    country,
    velora_score: finalVelora,
    verdict: director.verdict,
    executive_report: director.report,
    teams,
    director_engine: director.engine,
    auditor_engine: auditor.engine,
    auditor_score: auditor.score,
    auditor_note: auditor.note,
    action_plan: director.actions,
    risks: director.risks,
    signals,
    cache_hit: false,
    generated_at: new Date().toISOString(),
    data_coverage: coverage,
    confidence,
    disagreement,
    kill_criteria: director.kill,
    opportunity_window: director.window,
    alt_market: director.alt,
    depth: budget.depth,
    skipped_stages: skipped,
  };
}

/**
 * Cache-first council run (24h).
 *
 * `budgetMs` varsayılanı platformdan gelir (`defaultCouncilBudgetMs`): Render/
 * yerelde tam hat (14 ajan), Vercel Hobby'de 300 sn'ye sığan hızlı hat. Çağıran
 * taraf bu bütçeyi bilerek küçültmediği sürece hiçbir istek 504 olmaz — hat
 * kendi kendine, platform kesmeden önce biter.
 *
 * Önbellek anahtarı DERİNLİK İÇERMEZ: tetikleyici (Vercel) ile worker (Render)
 * aynı anahtarı üretmeli ki istemci worker'ın yazdığı sonucu görebilsin.
 */
/** Kısa karnenin önbellek alanı — tam raporun (`council`) yerine geçmez. */
export const COUNCIL_ENRICH_SCOPE = "council-enrich";

export async function runCouncil(
  query: string,
  country = "GLOBAL",
  category = "General",
  lang = "tr",
  budgetMs: number = defaultCouncilBudgetMs(),
  depth?: CouncilDepth,
): Promise<CouncilReport> {
  activeCouncilLang = lang.slice(0, 2);
  // Zenginleştirme (ürün bulucu içinden): kullanıcı aynı ürün için TAM konseyi
  // zaten çalıştırdıysa o raporu kullan — bedava kalite. Yoksa kısa karne AYRI
  // önbellek alanına yazılır ki 24 saat boyunca tam raporun yerine geçmesin.
  if (depth === "enrich") {
    const full = await peekCouncil(query, country, category, lang);
    if (full) return full;
  }
  const budget = planCouncilBudget({ budgetMs, depth });
  const scope = depth === "enrich" ? COUNCIL_ENRICH_SCOPE : "council";
  const { data, cache_hit } = await cached(scope, [query, country, category, lang], () =>
    build(query, country, category, budget),
  );
  return { ...data, cache_hit };
}

/** Cache lookup only — used to skip credit spend on a repeat query. */
export async function peekCouncil(
  query: string,
  country: string,
  category: string,
  lang = "tr",
): Promise<CouncilReport | null> {
  const { cacheGet, cacheKey } = await import("./ai-cache.server");
  const key = await cacheKey("council", [query, country, category, lang]);
  const hit = await cacheGet<CouncilReport>(key);
  return hit ? { ...hit, cache_hit: true } : null;
}
