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

async function runOperationsTeam(block: string): Promise<TeamReport> {
  const prompt = teamPrompt(
    "Sen EKİP 4 — OPERASYON & LOJİSTİK ekibisin.",
    "Teslimat süresi, envanter yönetimi, 3PL/depolama, iade oranı, kırılganlık ve kargo maliyetini değerlendir. Puan = operasyonel ölçeklenebilirlik (1-100).",
    block,
  );
  await stagger(3);
  const { engine, raw } = await withFallback([
    { engine: "Groq llama-3.3-70b", run: () => callGroq(prompt, 0.35) },
    { engine: "Gemini Flash", run: () => callGemini(prompt, undefined, 0.4, false, ["gemini-flash-latest", "gemini-2.0-flash"]) },
    { engine: "OpenRouter DeepSeek", run: () => callOpenRouter(prompt, 0.35) },
    { engine: "Lovable AI Gateway", run: () => callLovableAI(prompt, 0.4) },
  ]);
  return baseTeam("operations", "Operasyon & Lojistik", engine, raw);
}

async function runComplianceTeam(block: string): Promise<TeamReport> {
  const prompt = teamPrompt(
    "Sen EKİP 5 — UYUM & RİSK ekibisin.",
    "Fikri mülkiyet, sertifikalar (CE/FCC/RoHS), platform politikaları, ithalat yasakları, vergi/vergisi ve yasal riskleri incele. Puan = risk-adjusted uygunluk (1-100).",
    block,
  );
  await stagger(4);
  const { engine, raw } = await withFallback([
    { engine: "OpenRouter DeepSeek", run: () => callOpenRouter(prompt, 0.35) },
    { engine: "Gemini Flash", run: () => callGemini(prompt, undefined, 0.4, false, ["gemini-flash-latest", "gemini-2.0-flash"]) },
    { engine: "Groq llama-3.3-70b", run: () => callGroq(prompt, 0.35) },
    { engine: "Lovable AI Gateway", run: () => callLovableAI(prompt, 0.4) },
  ]);
  return baseTeam("compliance", "Uyum & Risk", engine, raw);
}

async function runCreativeTeam(block: string): Promise<TeamReport> {
  const prompt = teamPrompt(
    "Sen EKİP 6 — YARATICI & VİRAL İÇERİK ekibisin.",
    "Ürünün viral kancasını, TikTok/Reels/Shorts açılarını, hashtag potansiyelini, influencer uygunluğunu ve kreatif farklılaşmasını değerlendir. Puan = viral / kreatif potansiyel (1-100).",
    block,
  );
  await stagger(5);
  const { engine, raw } = await withFallback([
    { engine: "Hugging Face Mistral/Qwen", run: () => callHuggingFace(prompt, "qwen", { temperature: 0.7 }) },
    { engine: "OpenRouter free Llama/Qwen", run: () => callOpenRouter(prompt, 0.65) },
    { engine: "Groq llama-3.3-70b", run: () => callGroq(prompt, 0.65) },
    { engine: "Lovable AI Gateway", run: () => callLovableAI(prompt, 0.65) },
  ]);
  return baseTeam("creative", "Yaratıcı & Viral İçerik", engine, raw);
}

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
  const primaryEngine =
    team.team === "market"
      ? { engine: "Hakem: Gemini Flash", run: () => callGemini(prompt, undefined, 0.2, false, ["gemini-flash-latest", "gemini-2.0-flash"]) }
      : team.team === "finance"
        ? { engine: "Hakem: Groq", run: () => callGroq(prompt, 0.2) }
        : team.team === "marketing"
          ? { engine: "Hakem: OpenRouter", run: () => callOpenRouter(prompt, 0.2) }
          : team.team === "operations"
            ? { engine: "Hakem: OpenRouter", run: () => callOpenRouter(prompt, 0.2) }
            : team.team === "compliance"
              ? { engine: "Hakem: Gemini Flash", run: () => callGemini(prompt, undefined, 0.2, false, ["gemini-flash-latest", "gemini-2.0-flash"]) }
              : { engine: "Hakem: Groq", run: () => callGroq(prompt, 0.2) };
  const runners: Runner[] = [
    primaryEngine,
    team.team === "creative" || team.team === "marketing"
      ? { engine: "Hakem: Hugging Face", run: () => callHuggingFace(prompt, "qwen", { temperature: 0.2 }) }
      : { engine: "Hakem: Gemini Flash", run: () => callGemini(prompt, undefined, 0.2, false, ["gemini-flash-latest", "gemini-2.0-flash"]) },
  ];
  const { engine, raw } = await withFallback(runners, prompt);
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
  const { engine, raw } = await withFallback([
    { engine: "Aroless Premium (Gemini 3.1 Pro / GPT-5.5)", run: () => callPremiumAI(prompt, 0.5) },
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

async function runAuditor(
  query: string,
  country: string,
  teams: TeamReport[],
  directorVerdict: string,
  veloraScore: number,
  coverage: number,
): Promise<{ engine: string; score: number; note: string }> {
  const prompt = `Sen 14. YAPAY ZEKA — BAĞIMSIZ DENETÇİ'sin. Müdürün kararını ve altı ekibin puanlarını eleştirel gözle teyit et.
Eğer ekipler arası fikir ayrılığı yüksekse, canlı veri kapsamı düşükse veya müdürün puanı hakem notlarıyla çelişiyorsa, puanı aşağı çek.

ÜRÜN/NİŞ: ${query} | HEDEF ÜLKE: ${country}
${teams.map((t) => `- ${t.title}: ${t.score}/100 (güven ${t.confidence}) [${t.engine}]`).join("\n")}
MÜDÜR KARARI: ${directorVerdict}
AROLESS SCORE (müdür): ${veloraScore}/100 | CANLI VERİ KAPSAMI: %${coverage}

Return ONLY JSON: {"score": number 1-100, "note": string (max 160 karakter, neden düzelttiğin veya onayladığın)}${langDirective()}`;
  await stagger(13);
  const { engine, raw } = await withFallback([
    { engine: "Gemini Pro (auditor)", run: () => callGemini(prompt, undefined, 0.4, false, ["gemini-1.5-pro", "gemini-flash-latest"]) },
    { engine: "Groq llama-3.3-70b", run: () => callGroq(prompt, 0.4) },
    { engine: "OpenRouter DeepSeek", run: () => callOpenRouter(prompt, 0.4) },
    { engine: "Lovable AI Gateway", run: () => callLovableAI(prompt, 0.4) },
  ]);
  const s = clamp100(raw["score"], veloraScore);
  return {
    engine,
    score: s,
    note: String(raw["note"] ?? "").slice(0, 200),
  };
}

async function build(query: string, country: string, category: string): Promise<CouncilReport> {
  const { data: signals } = await collectSignals(query, country, category);
  const block = signalsBlock(signals);

  const total = signals.sources.length || 1;
  const active = signals.sources.filter((s) => s.status === "active" && s.items > 0).length;
  const coverage = Math.round((active / total) * 100);

  // 6 üretici ekip paralel başlar.
  const [market, finance, marketing, operations, compliance, creative] = await Promise.all([
    runMarketTeam(block),
    runFinanceTeam(block),
    runMarketingTeam(block),
    runOperationsTeam(block),
    runComplianceTeam(block),
    runCreativeTeam(block),
  ]);

  const rawTeams = [market, finance, marketing, operations, compliance, creative];

  // 6 hakem ekip, slot 6-11.
  const reviewed = await Promise.all([
    reviewTeam(market, block, 6),
    reviewTeam(finance, block, 7),
    reviewTeam(marketing, block, 8),
    reviewTeam(operations, block, 9),
    reviewTeam(compliance, block, 10),
    reviewTeam(creative, block, 11),
  ]);

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

  const weightSum = teams.reduce((s, t) => s + t.weight, 0) || 1;
  const directorVelora = Math.round(teams.reduce((s, t) => s + t.score * t.weight, 0) / weightSum);

  const director = await runDirector(query, country, teams, block, directorVelora, coverage);

  // 14. üye: bağımsız denetçi müdür puanını teyit eder / düzeltir.
  const auditor = await runAuditor(query, country, teams, director.verdict, directorVelora, coverage);
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
