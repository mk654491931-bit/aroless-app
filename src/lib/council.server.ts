// ============================================================================
// Velora — 7'li AI Konsey Mimarisi (server only, $0 API'ler)
//
//   Ekip 1 — Trend & Pazar     : Groq llama-3.3-70b   (yedek: Gemini Flash/Pro)
//   Ekip 2 — Finans & Tedarik  : OpenRouter DeepSeek  (yedek: Groq DeepSeek-distill)
//   Ekip 3 — Pazarlama & Kanca : Hugging Face         (yedek: OpenRouter free)
//   7. AI  — Müdür / Sentez    : Gemini Pro           (yedek: Groq llama-3.3)
//
// Her ekipte bir üretici + bir hakem model çalışır (6 üye) + müdür = 7 çağrı.
// Rate-limit koruması: staggered execution (150-200 ms), otomatik fallback,
// ve 24 saatlik smart cache.
// ============================================================================
import { callGemini, callGroq, callLovableAI, callPremiumAI, extractJson } from "./ai.server";
import { callOpenRouter } from "./tools-ai.server";
import { callHuggingFace } from "./hf.server";
import { cached } from "./ai-cache.server";
import { collectSignals, signalsBlock, type PipelineSignals } from "./data-pipeline.server";

export type TeamReport = {
  team: "market" | "finance" | "marketing";
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
};

/** Konsey ağırlıkları — pazar sinyali finans ve pazarlamadan baskın. */
const TEAM_WEIGHTS: Record<TeamReport["team"], number> = { market: 40, finance: 35, marketing: 25 };


const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Staggered execution: 150-200 ms micro-delay so 7 models never burst. */
const stagger = (slot: number) => sleep(150 + slot * 25 + Math.floor(Math.random() * 50));

function clamp100(n: unknown, fb = 55): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(1, Math.min(100, Math.round(v))) : fb;
}

const strArr = (v: unknown, n: number): string[] =>
  Array.isArray(v) ? v.slice(0, n).map((x) => String(x).slice(0, 300)) : [];

type Runner = { engine: string; run: () => Promise<string> };

/** Tries each engine in order; the first non-empty JSON answer wins. */
async function withFallback(runners: Runner[], prompt?: string) {
  const chain: Runner[] =
    prompt && !runners.some((r) => r.engine === "Lovable AI Gateway")
      ? [...runners, { engine: "Lovable AI Gateway", run: () => callLovableAI(prompt, 0.4) }]
      : runners;
  for (const r of chain) {
    try {
      const text = await r.run();
      const parsed = extractJson<Record<string, unknown>>(text, {});
      if (parsed && Object.keys(parsed).length) return { engine: r.engine, raw: parsed };
    } catch {
      await sleep(200); // 429 / timeout → anında yedek modele geç
    }
  }
  return { engine: "unavailable", raw: {} as Record<string, unknown> };
}



const SHAPE = `Return ONLY minified JSON:
{"score": number 1-100,
 "summary": string (2-3 Turkish sentences),
 "bullets": [string] (3-5 concrete Turkish insights, each with a number),
 "metrics": [{"label": string, "value": string}] (3-4 items)}`;

const COUNCIL_LANG_NAMES: Record<string, string> = {
  tr: "Turkish", en: "English", es: "Spanish", de: "German", fr: "French", ar: "Arabic",
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
  team: TeamReport["team"],
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

/** Ekip 1 — Trend & Pazar Analizi (Groq primary, Gemini fallback). */
async function runMarketTeam(block: string): Promise<TeamReport> {
  const prompt = teamPrompt(
    "Sen EKİP 1 — TREND & PAZAR ANALİZİ ekibisin.",
    "Trend kaynaklarını, GitHub scraper verilerini ve sosyal sinyalleri analiz et. Pazar doygunluğunu ve trend ivmesini ölç. Puan = pazar fırsatı (1-100). Sinyalde ölçüm yoksa uydurma, 'veri yok' yaz.",
    block,
  );
  await stagger(0);
  const { engine, raw } = await withFallback([
    { engine: "Groq llama-3.3-70b", run: () => callGroq(prompt, 0.3) },
    { engine: "Gemini Flash (grounded)", run: () => callGemini(prompt, undefined, 0.4, true, ["gemini-flash-latest", "gemini-2.0-flash"]) },
    { engine: "Lovable AI Gateway", run: () => callLovableAI(prompt, 0.4) },
  ]);
  return baseTeam("market", "Trend & Pazar Analizi", engine, raw);
}

/** Ekip 2 — Finans & Tedarik (OpenRouter DeepSeek primary, Groq fallback). */
async function runFinanceTeam(block: string): Promise<TeamReport> {
  const prompt = teamPrompt(
    "Sen EKİP 2 — FİNANS & TEDARİK ekibisin.",
    "Ürün maliyeti, kargo, gümrük/vergi, kar marjı ve Çin/küresel tedarik zincirini hesapla. Metriklerde COGS, satış fiyatı, brüt marj % ve başabaş adet yer alsın. Puan = finansal sürdürülebilirlik (1-100).",
    block,
  );
  await stagger(1);
  const { engine, raw } = await withFallback([
    { engine: "OpenRouter DeepSeek (free)", run: () => callOpenRouter(prompt, 0.35) },
    { engine: "Groq DeepSeek-distill", run: () => callGroq(prompt, 0.35) },
    { engine: "Gemini Flash", run: () => callGemini(prompt, undefined, 0.4, false, ["gemini-flash-latest", "gemini-2.0-flash"]) },
    { engine: "Lovable AI Gateway", run: () => callLovableAI(prompt, 0.4) },
  ]);
  return baseTeam("finance", "Finans & Tedarik", engine, raw);
}

/** Ekip 3 — Pazarlama & Reklam Kancası (Hugging Face primary, OpenRouter fallback). */
async function runMarketingTeam(block: string): Promise<TeamReport> {
  const prompt = teamPrompt(
    "Sen EKİP 3 — PAZARLAMA & REKLAM KANCASI ekibisin.",
    "Meta/TikTok reklam açılarını, metin yazarlığı detaylarını ve ikna kancalarını üret. Maddelerin en az ikisi doğrudan kullanılabilir reklam kancası olsun. Puan = pazarlanabilirlik (1-100).",
    block,
  );
  await stagger(2);
  const { engine, raw } = await withFallback([
    { engine: "Hugging Face Mistral/Qwen", run: () => callHuggingFace(prompt, "qwen", { temperature: 0.6 }) },
    { engine: "OpenRouter free Llama/Qwen", run: () => callOpenRouter(prompt, 0.6) },
    { engine: "Groq llama-3.3-70b", run: () => callGroq(prompt, 0.6) },
    { engine: "Lovable AI Gateway", run: () => callLovableAI(prompt, 0.6) },
  ]);
  return baseTeam("marketing", "Pazarlama & Reklam Kancası", engine, raw);
}

/** Peer-review pass: her ekibin çıktısını farklı bir motor denetler (üye 4-6). */
async function reviewTeam(
  team: TeamReport,
  block: string,
  slot: number,
): Promise<{ score: number; note: string; engine: string }> {
  const prompt = `Sen bir HAKEM modelsin. Aşağıdaki ekip raporunu canlı verilerle karşılaştır, abartı/uydurma varsa puanı düşür.
EKİP: ${team.title} | Ekip puanı: ${team.score}
ÖZET: ${team.summary}
MADDELER: ${team.bullets.join(" | ")}

CANLI VERİ:
${block}

Return ONLY JSON: {"score": number 1-100, "note": string (max 140 characters)}${langDirective()}`;
  await stagger(slot);
  const runners: Runner[] =
    team.team === "market"
      ? [
          { engine: "Hakem: Gemini Flash", run: () => callGemini(prompt, undefined, 0.2, false, ["gemini-flash-latest", "gemini-2.0-flash"]) },
          { engine: "Hakem: Groq", run: () => callGroq(prompt, 0.2) },
        ]
      : team.team === "finance"
        ? [
            { engine: "Hakem: Groq", run: () => callGroq(prompt, 0.2) },
            { engine: "Hakem: OpenRouter", run: () => callOpenRouter(prompt, 0.2) },
          ]
        : [
            { engine: "Hakem: OpenRouter", run: () => callOpenRouter(prompt, 0.2) },
            { engine: "Hakem: Groq", run: () => callGroq(prompt, 0.2) },
          ];
  const { engine, raw } = await withFallback(runners, prompt);
  const s = Number(raw["score"]);
  return {
    score: Number.isFinite(s) ? Math.max(1, Math.min(100, Math.round(s))) : team.score,
    note: String(raw["note"] ?? "").slice(0, 200),
    engine,
  };
}


/** 7. AI — Müdür / Sentezleme Motoru. */
async function runDirector(
  query: string,
  country: string,
  teams: TeamReport[],
  block: string,
  veloraScore: number,
  coverage: number,
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
Üç ekibin raporunu ve hakem düzeltmelerini birleştirip tek sayfalık temiz bir "İCRA RAPORU" yaz.

ÜRÜN/NİŞ: ${query} | HEDEF ÜLKE: ${country}
${teams
  .map(
    (t) =>
      `- ${t.title} (${t.engine}, ağırlık %${t.weight}): ekip ${t.raw_score} → hakem ${t.review_score} → nihai ${t.score}/100 (güven ${t.confidence}) — ${t.summary}${t.review_note ? ` [hakem: ${t.review_note}]` : ""}`,
  )
  .join("\n")}
VELORA SCORE (ağırlıklı): ${veloraScore}/100 | CANLI VERİ KAPSAMI: %${coverage}

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
  await stagger(6);
  const { engine, raw } = await withFallback([
    { engine: "Velora Premium (Gemini 3.1 Pro / GPT-5.5)", run: () => callPremiumAI(prompt, 0.5) },
    { engine: "Gemini Pro (free)", run: () => callGemini(prompt, undefined, 0.5, false, ["gemini-1.5-pro", "gemini-flash-latest", "gemini-2.0-flash"]) },
    { engine: "Groq llama-3.3-70b", run: () => callGroq(prompt, 0.5) },
    { engine: "OpenRouter free", run: () => callOpenRouter(prompt, 0.5) },
    { engine: "Lovable AI Gateway", run: () => callLovableAI(prompt, 0.5) },
  ]);

  return {
    engine,
    verdict: String(raw["verdict"] ?? (veloraScore >= 70 ? "GİR — güçlü fırsat" : "BEKLE — sinyal zayıf")).slice(0, 120),
    report: String(raw["executive_report"] ?? "").slice(0, 6000),
    actions: strArr(raw["action_plan"], 5),
    risks: strArr(raw["risks"], 4),
    kill: strArr(raw["kill_criteria"], 3),
    window: String(raw["opportunity_window"] ?? "").slice(0, 60),
    alt: String(raw["alt_market"] ?? "").slice(0, 140),
  };
}

async function build(query: string, country: string, category: string): Promise<CouncilReport> {
  const { data: signals } = await collectSignals(query, country, category);
  const block = signalsBlock(signals);

  // Canlı veri kapsamı: aktif hatların oranı.
  const total = signals.sources.length || 1;
  const active = signals.sources.filter((s) => s.status === "active" && s.items > 0).length;
  const coverage = Math.round((active / total) * 100);

  // Ekipler sıralı-asenkron: her biri 150-200 ms arayla tetiklenir.
  const [market, finance, marketing] = await Promise.all([
    runMarketTeam(block),
    runFinanceTeam(block),
    runMarketingTeam(block),
  ]);

  const reviewed = await Promise.all([
    reviewTeam(market, block, 3),
    reviewTeam(finance, block, 4),
    reviewTeam(marketing, block, 5),
  ]);

  const teams: TeamReport[] = [market, finance, marketing].map((t, i) => {
    const rev = reviewed[i];
    const reviewScore = rev?.score ?? t.raw_score;
    // Hakem ağırlığı %40: üretici model tek başına karar vermez.
    const finalScore = Math.round(t.raw_score * 0.6 + reviewScore * 0.4);
    const gap = Math.abs(t.raw_score - reviewScore);
    const hasBody = t.summary.length > 20 && t.bullets.length >= 3;
    const confidence = Math.max(
      5,
      Math.min(
        99,
        Math.round(coverage * 0.5 + (100 - gap * 2) * 0.35 + (hasBody ? 15 : 0) + (t.engine === "unavailable" ? -40 : 0)),
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

  // Ağırlıklı Velora Score (pazar 40 / finans 35 / pazarlama 25).
  const weightSum = teams.reduce((s, t) => s + t.weight, 0) || 1;
  const velora = Math.round(teams.reduce((s, t) => s + t.score * t.weight, 0) / weightSum);

  const scores = teams.map((t) => t.score);
  const disagreement = Math.max(...scores) - Math.min(...scores);
  const confidence = Math.max(
    5,
    Math.min(99, Math.round(teams.reduce((s, t) => s + t.confidence, 0) / teams.length - disagreement * 0.25)),
  );

  const director = await runDirector(query, country, teams, block, velora, coverage);

  return {
    query,
    country,
    velora_score: velora,
    verdict: director.verdict,
    executive_report: director.report,
    teams,
    director_engine: director.engine,
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
  };
}


/** Cache-first council run (24h). */
export async function runCouncil(
  query: string,
  country = "GLOBAL",
  category = "General",
  lang = "tr",
): Promise<CouncilReport> {
  activeCouncilLang = lang.slice(0, 2);
  const { data, cache_hit } = await cached("council", [query, country, category, lang], () =>
    build(query, country, category),
  );
  return { ...data, cache_hit };
}

/** Cache lookup only — used to skip credit spend on a repeat query. */
export async function peekCouncil(query: string, country: string, category: string, lang = "tr"): Promise<CouncilReport | null> {
  const { cacheGet, cacheKey } = await import("./ai-cache.server");
  const key = await cacheKey("council", [query, country, category, lang]);
  const hit = await cacheGet<CouncilReport>(key);
  return hit ? { ...hit, cache_hit: true } : null;
}
