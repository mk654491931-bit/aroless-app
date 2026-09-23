/**
 * VELORA AUTONOMOUS MULTI-AGENT ORCHESTRATOR — 14 ajan · 4 faz · ücretsiz plan güvenli.
 *
 * NEDEN AYRI BİR KATMAN: `velora-pipeline.server.ts` 14 ajanı TEK bir bloklayan
 * istek içinde, sırayla koşar. Vercel Hobby gibi dar bir fonksiyon limitinde bu
 * ya 504 üretir ya da hattı ortasında keser. Bu modül aynı 14 ajanı
 * **istatistiksel mikro-adımlara** böler:
 *
 *   1. 14 ajan 4 FAZA ayrılır; her faz KENDİ yalıtılmış yükünde koşar.
 *   2. Her fazın sert bir tavanı vardır: `VELORA_PHASE_CEILING_MS` (8 sn). Tavan
 *      aşılırsa faz yarıda kesilmez — tamamlanmayan üyeler NÖTR sonuçla döner ve
 *      hat dürüstçe "kısmi" der. Hiçbir faz asla 8 sn'yi geçemez.
 *   3. Fazlar arası durum Supabase'deki geçici kovada (`ai_cache`, scope
 *      `velora-orch`) `runId` ile taşınır → her adım STATELESS'tir ve herhangi bir
 *      instance'ta koşabilir.
 *   4. Sonraki faz QStash ile KENDİNE yayınlanır (self-chaining fan-out). QStash
 *      yoksa aynı adımlar istek içinde koşar ve toplam süre yine 4×8 sn ≈ 32 sn
 *      ile sınırlı kalır — yani dar limitlerde de 504 üretilmez.
 *
 * ORTAK KANIT (ground truth): 14 ajanın HEPSİ trend radarı kazımalarını ve canlı
 * piyasa kanıtını (`data-pipeline.server.ts` + `market-verify.server.ts`) ortak
 * veri olarak görür. Doğrulanmamış/halüsinasyon metrik kural gereği reddedilir.
 *
 * PUSH PROTOKOLÜ: Faz 4 tamamlanınca kazanan karne (dossier) Aroless Winner DTO'ya
 * çevrilir ve nişin kazanan tablosuna (`radar_items` — panelin okuduğu mevcut
 * "winner" tablosu) yazılır. Ardından OTOMATİK SELF-TEST koşar: kayıt geri
 * okunur, alan bütünlüğü ve tavan uyumu doğrulanır.
 */
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import { COUNCIL_AGENTS, agentSchemaHint, type CouncilAgentKey } from "./council-chain.server";
import { DEEP_CHAIN, executeAgentWithFallback, parseAgentJson } from "./ai-router.server";
import { combineJointScores } from "./consensus-types";
import { qstashConfigured, qstashFanOut } from "./discovery-jobs.server";
import {
  collectVeloraEvidence,
  scrapedCandidates,
  veloraProductScore,
  ProductSchema,
  type PipelineInput,
  type Product,
  type RetrieverCandidate,
} from "./velora-pipeline.server";

// ---------------------------------------------------------------------------
// Faz planı — 14 ajanın tamamı, boşluksuz ve çakışmasız 4 faza dağıtılır.
// ---------------------------------------------------------------------------

/** Her fazın sert tavanı: ücretsiz plan fonksiyon limitinin ALTINDA kalır. */
export const VELORA_PHASE_CEILING_MS = 8_000;

/**
 * Fazın ZAMANINDA dönebilmesi için ayrılan pay.
 *
 * Üyelerin bütçesi tavanın tamamı olsaydı, zaman aşımı tam sınırda tetiklenir ve
 * toplama/sıralama maliyetiyle faz tavanı birkaç ms AŞABİLİRDİ. Bu pay, adımın
 * "tavan içinde" kalmasını garanti eder (bulucudaki `RETURN_MARGIN` ile aynı sözleşme).
 */
export const VELORA_STEP_RETURN_MARGIN_MS = 250;

export type VeloraPhaseId = 1 | 2 | 3 | 4;

export type VeloraPhaseDefinition = {
  id: VeloraPhaseId;
  key: string;
  name: string;
  /** Bu fazda koşan üyeler — hepsi AYNI ortak kanıt bloğunu görür. */
  agents: readonly CouncilAgentKey[];
};

export const VELORA_PHASES: readonly VeloraPhaseDefinition[] = [
  {
    id: 1,
    key: "ingestion",
    name: "Data Ingestion & Discovery",
    agents: ["trend_hunter", "competitor_intel", "ux_specialist", "independent_data_auditor"],
  },
  {
    id: 2,
    key: "economics",
    name: "Product & Competitor Analysis",
    agents: ["cfo", "supply_chain", "logistics_cost", "pricing_strategist"],
  },
  {
    id: 3,
    key: "strategy",
    name: "Strategy & Creative Drafting",
    agents: ["cmo", "creative_director", "channel_fit"],
  },
  {
    id: 4,
    key: "synthesis",
    name: "Critique, Validation & Synthesis",
    agents: ["cro", "compliance_officer", "retention_ltv"],
  },
];

/** Planın kapsadığı üye sayısı — 14 ajanın tamamı olmalı (test bunu doğrular). */
export function plannedAgentCount(): number {
  return VELORA_PHASES.reduce((total, phase) => total + phase.agents.length, 0);
}

export function phaseById(id: VeloraPhaseId): VeloraPhaseDefinition {
  const phase = VELORA_PHASES.find((p) => p.id === id);
  if (!phase) throw new Error(`UNKNOWN_VELORA_PHASE:${id}`);
  return phase;
}

// ---------------------------------------------------------------------------
// Koşu durumu — stateless adımlar arasında taşınan geçici durum (temp bucket).
// ---------------------------------------------------------------------------

export const VeloraAgentResultSchema = z.object({
  key: z.string(),
  name: z.string(),
  ok: z.boolean(),
  timedOut: z.boolean().default(false),
  score: z.number().min(0).max(100),
  latencyMs: z.number().min(0),
  output: z.record(z.string(), z.unknown()).default({}),
  error: z.string().optional(),
});
export type VeloraAgentResult = z.infer<typeof VeloraAgentResultSchema>;

export const VeloraPhaseResultSchema = z.object({
  id: z.number().int().min(1).max(4),
  key: z.string(),
  name: z.string(),
  ms: z.number().min(0),
  /** Faz tavanı içinde tamamlandı mı? */
  withinCeiling: z.boolean(),
  agents: z.array(VeloraAgentResultSchema),
});
export type VeloraPhaseResult = z.infer<typeof VeloraPhaseResultSchema>;

export const VeloraRunStateSchema = z.object({
  runId: z.string(),
  query: z.string(),
  country: z.string(),
  platform: z.string(),
  language: z.string(),
  startedAtMs: z.number(),
  status: z.enum(["running", "completed", "failed"]),
  /** Toplanan ORTAK kanıt bloğu — her fazın istemi bunu taşır. */
  evidenceBlock: z.string().default(""),
  scrapedTrends: z.array(z.string()).default([]),
  live: z.boolean().default(false),
  /** AI retriever'ın adlandırdığı ürünler + kazınmış trend yedekleri. */
  candidates: z.array(z.record(z.string(), z.unknown())).default([]),
  phases: z.array(VeloraPhaseResultSchema).default([]),
});
export type VeloraRunState = z.infer<typeof VeloraRunStateSchema>;

/** Faz sonuçlarını hattın gördüğü `PipelineInput` şekline çevirir. */
function stateInput(state: VeloraRunState): PipelineInput {
  return {
    userQuery: state.query,
    country: state.country || undefined,
    platform: state.platform || undefined,
    language: state.language,
  };
}

// ---------------------------------------------------------------------------
// Zaman dilimli izole faz yürütücüsü
// ---------------------------------------------------------------------------

/** Bir sözü sert bir tavana bağlar; tavan aşılırsa reddeder (faz asla asılı kalmaz). */
function withCeiling<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}_TIMEOUT`)), Math.max(1, ms));
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function clampScore(value: unknown, fallback = 50): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export type VeloraOrchestratorDeps = {
  /** Koşu durumunu ve kazanan kayıtlarını kalıcılaştıran depo. */
  store: VeloraStore;
  /** Bir fazı başlatmak için kullanılan AI çağrısı (testlerde stub'lanır). */
  runAgent?: typeof executeAgentWithFallback;
  /** Faz tavanı — testlerde küçültülür. */
  phaseCeilingMs?: number;
  /** Sonraki fazı devretme yolu (QStash). `null` ise adımlar istek içinde koşar. */
  handoff?: ((args: { runId: string; phase: VeloraPhaseId }) => Promise<VeloraHandoff>) | null;
};

export type VeloraHandoff = { ok: boolean; mode: VeloraDispatchMode; messageId?: string; error?: string };
export type VeloraDispatchMode = "qstash" | "inline";

/**
 * Sonraki fazı QStash ile KENDİNE (`/api/jobs`, kind `velora-phase`) yayınlar.
 *
 * Dönen `null`, "devir yapılamıyor" demektir: QStash yapılandırılmamış ya da
 * origin public değil. O durumda orkestratör fazları aynı istek içinde sürer
 * (yine her faz 8 sn tavanlı, toplam ≈ 32 sn). QStash hiçbir koşulda zorunlu
 * değildir; sadece daha küçük adımlar sağlar.
 */
export function veloraQStashHandoff(
  origin: string,
): ((args: { runId: string; phase: VeloraPhaseId }) => Promise<VeloraHandoff>) | null {
  if (!origin || !/^https?:\/\//i.test(origin) || /localhost|127\.0\.0\.1/i.test(origin)) {
    return null;
  }
  if (!qstashConfigured()) return null;
  const url = `${origin.replace(/\/+$/, "")}/api/jobs`;
  return async ({ runId, phase }) => {
    const published = await qstashFanOut({
      url,
      body: { kind: "velora-phase", runId, phase },
      dedupeId: `velora:${runId}:${phase}`,
    });
    return published.ok
      ? { ok: true, mode: "qstash", messageId: published.messageId }
      : { ok: false, mode: "qstash", error: published.error };
  };
}

/** Bir üyeyi kendi süre bütçesi içinde koşar; asla fırlatmaz. */
async function runOneAgent(
  agentKey: CouncilAgentKey,
  phase: VeloraPhaseDefinition,
  state: VeloraRunState,
  deadlineAt: number,
  deps: VeloraOrchestratorDeps,
): Promise<VeloraAgentResult> {
  const definition = COUNCIL_AGENTS.find((a) => a.key === agentKey);
  const name = definition?.name ?? agentKey;
  const scoreKey = definition?.scoreKey ?? "";
  const started = Date.now();
  const budget = deadlineAt - started;
  const neutral = (error?: string, timedOut = false): VeloraAgentResult => ({
    key: agentKey,
    name,
    ok: false,
    timedOut,
    score: 50,
    latencyMs: Date.now() - started,
    output: {},
    ...(error ? { error } : {}),
  });

  if (budget <= 0) return neutral("PHASE_CEILING_REACHED", true);

  const run = deps.runAgent ?? executeAgentWithFallback;
  try {
    const result = await withCeiling(
      run(name, agentPrompt(agentKey, definition?.task ?? "", phase, state), DEEP_CHAIN, {
        temperature: 0.3,
        retries: 1,
      }),
      budget,
      `velora:${agentKey}`,
    );
    const output = parseAgentJson<Record<string, unknown>>(result.text, {});
    return {
      key: agentKey,
      name,
      ok: result.log.ok,
      timedOut: false,
      score: clampScore(output[scoreKey]),
      latencyMs: Date.now() - started,
      output,
      ...(result.log.error ? { error: result.log.error } : {}),
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return neutral(message, message.endsWith("_TIMEOUT"));
  }
}

/**
 * Tek bir fazı İZOLE ve ZAMAN DİLİMLİ bir adımda koşar.
 *
 * Üyeler paralel koşar; her üye kendi kalan bütçesine bağlıdır, bu yüzden
 * `Promise.all` tavanı ASLA aşamaz. Tavan içinde dönmeyen üye nötr sonuçla
 * işaretlenir (`timedOut: true`) — faz verisi kaybolmaz, `withinCeiling` dürüst
 * raporlanır.
 */
export async function runVeloraPhase(
  phase: VeloraPhaseDefinition,
  state: VeloraRunState,
  deps: VeloraOrchestratorDeps,
): Promise<VeloraPhaseResult> {
  const started = Date.now();
  const ceiling = deps.phaseCeilingMs ?? VELORA_PHASE_CEILING_MS;
  const margin = Math.min(VELORA_STEP_RETURN_MARGIN_MS, Math.floor(ceiling / 4));
  const deadlineAt = started + ceiling - margin;
  const agents = await Promise.all(
    phase.agents.map((key) => runOneAgent(key, phase, state, deadlineAt, deps)),
  );
  const ms = Date.now() - started;
  return {
    id: phase.id,
    key: phase.key,
    name: phase.name,
    ms,
    withinCeiling: ms <= ceiling,
    agents,
  };
}

function agentPrompt(
  agentKey: CouncilAgentKey,
  task: string,
  phase: VeloraPhaseDefinition,
  state: VeloraRunState,
): string {
  const definition = COUNCIL_AGENTS.find((a) => a.key === agentKey);
  const name = definition?.name ?? agentKey;
  const index = COUNCIL_AGENTS.findIndex((a) => a.key === agentKey) + 1;
  return `You are ${name}, member ${index}/14 of the Aroless AI Council.
VELORA PHASE ${phase.id}/4 — ${phase.name}
TASK: ${task}

QUERY: ${state.query}
COUNTRY: ${state.country || "GLOBAL"}
PLATFORM: ${state.platform || "any"}

${
  state.evidenceBlock
    ? `SHARED LIVE EVIDENCE (trend radar scrapings + live market verification — the SAME ground truth every council member receives):\n${state.evidenceBlock.slice(0, 4_000)}`
    : "SHARED LIVE EVIDENCE: none available for this run. Score neutrally."
}

CHAIN RULES:
- Return ONLY valid minified JSON. No markdown or commentary.
- Return exactly these fields and no extra fields: ${agentSchemaHint(agentKey)}
- GROUND TRUTH RULE: use only the shared scraped evidence above. Never invent metrics; unverified or hallucinated numbers are rejected. If evidence is missing, use score 50 and explain the neutral fallback.
- Never return null or a zero score. Numbers must be finite; prefer conservative estimates.`;
}

// ---------------------------------------------------------------------------
// ORTAK KARAR — analiz hattı ⊕ 14'lü konsey (bulucuyla aynı formül)
// ---------------------------------------------------------------------------

/**
 * Analiz hattı parmak izi (0-100): hat ne kadar GERÇEK kanıt gördü?
 * Bulucunun `productFingerprint`i ile aynı sözleşme — uydurma veri puan üretmez.
 */
export function veloraAnalysisScore(state: VeloraRunState): number {
  const scraped = Math.min(1, state.scrapedTrends.length / 10);
  const named = Math.min(1, state.candidates.filter((c) => c["source"] === "ai").length / 3);
  const live = state.live ? 1 : 0;
  return Math.round((scraped * 0.3 + named * 0.4 + live * 0.3) * 100);
}

export function councilAverageOf(phases: readonly VeloraPhaseResult[]): number {
  const scores = phases.flatMap((phase) => phase.agents.map((agent) => agent.score));
  if (scores.length === 0) return 0;
  return Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length);
}

// ---------------------------------------------------------------------------
// KAZANAN KARNESİ (Winner Dossier) ve Aroless Winner DTO
// ---------------------------------------------------------------------------

export const WinnerDtoSchema = z.object({
  run_id: z.string(),
  query: z.string(),
  country: z.string(),
  platform: z.string(),
  generated_at: z.string(),
  council_average: z.number().min(0).max(100),
  analysis_score: z.number().min(0).max(100),
  joint_score: z.number().min(0).max(100),
  joint_source: z.enum(["joint", "analysis", "council", "none"]),
  listed: z.boolean(),
  products: z.array(ProductSchema),
  evidence: z.object({
    live: z.boolean(),
    scraped_trends: z.number().int().min(0),
    radar: z.array(z.string()),
  }),
  phases: z.array(
    z.object({
      id: z.number(),
      key: z.string(),
      ms: z.number(),
      within_ceiling: z.boolean(),
      agents: z.number().int().min(0),
    }),
  ),
});
export type WinnerDto = z.infer<typeof WinnerDtoSchema>;

function parsePriceBand(band: string): { min: number; max: number } {
  const numbers = String(band ?? "")
    .replace(/[^0-9.,\s-]/g, " ")
    .split(/[\s-]+/)
    .map((part) => Number(part.replace(",", ".")))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (numbers.length === 0) return { min: 0, max: 0 };
  return { min: Math.min(...numbers), max: Math.max(...numbers) };
}

/** Kazanan DTO → nişin kazanan tablosuna (`radar_items`) yazılacak satırlar. */
export function winnerRows(dto: WinnerDto): WinnerRow[] {
  const day = dto.generated_at.slice(0, 10);
  return dto.products.map((product) => {
    const band = parsePriceBand(product.priceRange);
    return {
      day,
      country: dto.country || "GLOBAL",
      platform: dto.platform || "General",
      category: product.category || "General",
      niche: dto.query.slice(0, 120),
      title: product.name.slice(0, 200),
      winner_score: clampScore(product.winnerScore),
      momentum: clampScore(product.demandScore),
      est_margin_pct: Math.max(0, Math.round(Number(product.estimatedMarginPct) || 0)),
      price_min: band.min,
      price_max: band.max,
      reason: (product.whyNow || product.sentiment || "").slice(0, 500) || null,
      payload: {
        run_id: dto.run_id,
        joint_score: dto.joint_score,
        analysis_score: dto.analysis_score,
        council_average: dto.council_average,
        rank: product.rank,
        source: product.source,
        risks: product.risks,
      } as Json,
    };
  });
}

/** Koşu durumundan kazanan karnesini (dossier) kurar. Tamamen deterministik. */
export function buildWinnerDossier(state: VeloraRunState): WinnerDto {
  const councilAverage = councilAverageOf(state.phases);
  const analysis = veloraAnalysisScore(state);
  const joint = combineJointScores({ analysisScore: analysis, councilScore: councilAverage });
  const listed = joint.score >= 60;
  const products: Product[] = (state.candidates as unknown as RetrieverCandidate[])
    .map((candidate) => ({
      candidate,
      score: veloraProductScore(candidate, joint.score).score,
    }))
    .sort(
      (a, b) =>
        b.score - a.score || String(a.candidate["name"]).localeCompare(String(b.candidate["name"])),
    )
    .slice(0, 5)
    .map(({ candidate, score }, index) =>
      ProductSchema.parse({
        name: String(candidate["name"] ?? state.query),
        category: String(candidate["category"] ?? ""),
        priceRange: String(candidate["priceRange"] ?? ""),
        estimatedMarginPct: Number(candidate["estimatedMarginPct"] ?? 0),
        demandScore: clampScore(candidate["demandScore"]),
        competitionScore: clampScore(candidate["competitionScore"]),
        sentiment: String(candidate["sentiment"] ?? ""),
        whyNow: String(candidate["whyNow"] ?? ""),
        risks: Array.isArray(candidate["risks"]) ? candidate["risks"].map(String) : [],
        councilScore: joint.score,
        councilDecision: listed ? "LISTED" : `REVIEW_${councilAverage}`,
        winnerScore: score,
        rank: index + 1,
        source:
          candidate["source"] === "trend-radar"
            ? "trend-radar"
            : candidate["source"] === "fallback"
              ? "fallback"
              : "ai",
      }),
    );

  return WinnerDtoSchema.parse({
    run_id: state.runId,
    query: state.query,
    country: state.country,
    platform: state.platform,
    generated_at: new Date().toISOString(),
    council_average: councilAverage,
    analysis_score: analysis,
    joint_score: joint.score,
    joint_source: joint.source,
    listed,
    products,
    evidence: {
      live: state.live,
      scraped_trends: state.scrapedTrends.length,
      radar: state.scrapedTrends.slice(0, 16),
    },
    phases: state.phases.map((phase) => ({
      id: phase.id,
      key: phase.key,
      ms: phase.ms,
      within_ceiling: phase.withinCeiling,
      agents: phase.agents.length,
    })),
  });
}

// ---------------------------------------------------------------------------
// Depo (Supabase) — geçici durum + kazanan kaydı
// ---------------------------------------------------------------------------

export type WinnerRow = {
  day: string;
  country: string;
  platform: string;
  category: string;
  niche: string;
  title: string;
  winner_score: number;
  momentum: number;
  est_margin_pct: number;
  price_min: number;
  price_max: number;
  reason: string | null;
  payload: Json;
};

export type VeloraStore = {
  saveState(state: VeloraRunState): Promise<void>;
  loadState(runId: string): Promise<VeloraRunState | null>;
  /** Kazanan satırlarını yazar ve yazılan kayıt kimliklerini döner. */
  pushWinners(rows: WinnerRow[]): Promise<{ ok: boolean; ids: string[]; error?: string }>;
  /** SELF-TEST: yazılan kayıtları geri okur. */
  fetchWinners(day: string, titles: string[]): Promise<WinnerRow[]>;
};

/** Geçici koşu durumunun anahtarı (`ai_cache` = mevcut TTL'li geçici kova). */
export function runStateKey(runId: string): string {
  return `velora-run:${runId}`;
}

/** Varsayılan Supabase deposu: temp state `ai_cache`, kazananlar `radar_items`. */
export function defaultVeloraStore(): VeloraStore {
  return {
    async saveState(state) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      // Idempotent yazım: aynı runId için upsert yerine sil+yaz (tekil indeks
      // varsayımına bağlı kalmamak için) — geçici durum zaten TTL'li.
      await supabaseAdmin.from("ai_cache").delete().eq("cache_key", runStateKey(state.runId));
      const { error } = await supabaseAdmin.from("ai_cache").insert({
        cache_key: runStateKey(state.runId),
        scope: "velora-orch",
        payload: JSON.parse(JSON.stringify(state)) as Json,
        expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
      });
      if (error) throw new Error(error.message);
    },

    async loadState(runId) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data, error } = await supabaseAdmin
        .from("ai_cache")
        .select("payload")
        .eq("cache_key", runStateKey(runId))
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      const parsed = VeloraRunStateSchema.safeParse(data.payload);
      return parsed.success ? parsed.data : null;
    },

    async pushWinners(rows) {
      if (rows.length === 0) return { ok: true, ids: [] };
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("radar_items")
          .insert(rows as never)
          .select("id");
        if (error) {
          // Tek bir çakışma (aynı gün + aynı başlık) toplu yazımı düşürmesin:
          // satır satır dene, kaydedilebilenleri kaydet.
          const ids: string[] = [];
          for (const row of rows) {
            const single = await supabaseAdmin
              .from("radar_items")
              .insert(row as never)
              .select("id");
            if (!single.error && single.data?.[0]) {
              ids.push(String((single.data[0] as { id: string }).id));
            }
          }
          if (ids.length === 0) return { ok: false, ids: [], error: error.message };
          return { ok: true, ids };
        }
        return { ok: true, ids: (data ?? []).map((row) => String((row as { id: string }).id)) };
      } catch (e) {
        return { ok: false, ids: [], error: e instanceof Error ? e.message : String(e) };
      }
    },

    async fetchWinners(day, titles) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data, error } = await supabaseAdmin
        .from("radar_items")
        .select("*")
        .eq("day", day)
        .in("title", titles);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as WinnerRow[];
    },
  };
}

// ---------------------------------------------------------------------------
// ORKESTRASYON — faza faza ilerle, aradaki devri QStash ile yap
// ---------------------------------------------------------------------------

/** Faz 1'den önce toplanan ORTAK kanıt (trend radarı kazımaları + canlı piyasa). */
async function ingestEvidence(state: VeloraRunState): Promise<void> {
  const evidence = await collectVeloraEvidence(stateInput(state));
  state.evidenceBlock = evidence.block;
  state.scrapedTrends = evidence.radar;
  state.live = evidence.live;
}

/**
 * Faz 2'de koşan ürün retriever'ı: AI'nın adlandırdığı GERÇEK ürünler.
 *
 * Tek atıştır (relaxation döngüsü monotlitte kalır) — faz tavanı içinde kalması
 * gerekir. AI boş dönerse kazınmış gerçek trend adları ve son çare yedekleri
 * kullanılır; hiçbir koşulda uydurma ürün adı yazılmaz.
 */
async function retrieveCandidates(state: VeloraRunState, deps: VeloraOrchestratorDeps) {
  const run = deps.runAgent ?? executeAgentWithFallback;
  const prompt = `You are the Product Retriever for Aroless. Name real, specific, buyable products for the query.
QUERY: ${state.query}
COUNTRY: ${state.country || "GLOBAL"}
PLATFORM: ${state.platform || "any"}
${
  state.evidenceBlock
    ? `\nSHARED LIVE EVIDENCE (the SAME scrapings the 14 council members receive — treat as ground truth):\n${state.evidenceBlock.slice(0, 3_000)}\n`
    : "\nSHARED LIVE EVIDENCE: none available for this run.\n"
}
Never return markdown. Return ONLY JSON:
{"candidates":[{"name":string,"category":string,"priceRange":string,"estimatedMarginPct":number,"demandScore":number,"competitionScore":number,"sentiment":string,"whyNow":string,"risks":string[]}]}`;

  const named: Record<string, unknown>[] = [];
  try {
    const result = await withCeiling(
      run("Product Retriever", prompt, DEEP_CHAIN, { temperature: 0.35, retries: 1 }),
      Math.max(500, deps.phaseCeilingMs ?? VELORA_PHASE_CEILING_MS),
      "velora:retriever",
    );
    const parsed = parseAgentJson<{ candidates?: unknown[] }>(result.text, {});
    for (const item of parsed.candidates ?? []) {
      if (!item || typeof item !== "object") continue;
      const value = item as Record<string, unknown>;
      const name = String(value.name ?? value.title ?? "").trim();
      if (!name) continue;
      named.push({ ...value, name: name.slice(0, 180), source: "ai" });
    }
  } catch {
    /* retriever düşse de hat kazınmış trendlerle devam eder */
  }

  const seen = new Set(named.map((c) => String(c["name"]).toLocaleLowerCase("tr-TR")));
  const pool = [...named];
  for (const candidate of scrapedCandidates(state.scrapedTrends)) {
    const identity = candidate.name.toLocaleLowerCase("tr-TR");
    if (seen.has(identity)) continue;
    seen.add(identity);
    pool.push(candidate as unknown as Record<string, unknown>);
  }
  if (pool.length === 0) {
    pool.push({
      name: state.query,
      source: "fallback",
      category: "Broad match",
      sentiment: "Neutral fallback; manual validation required.",
      whyNow: "Live evidence unavailable; retained as the closest query candidate.",
      risks: ["Live evidence unavailable"],
      demandScore: 50,
      competitionScore: 50,
    });
  }
  state.candidates = pool.slice(0, 24);
}

export type VeloraRunResult = {
  runId: string;
  status: "completed" | "dispatched" | "failed";
  completedPhases: number;
  nextPhase?: VeloraPhaseId;
  dispatch: VeloraHandoff;
  dossier?: WinnerDto;
  push?: { ok: boolean; ids: string[]; error?: string };
  selfTest?: VeloraSelfTestReport;
  error?: string;
};

/**
 * Bir koşuyu `fromPhase`ten itibaren sürer.
 *
 * Her faz kaydedildikten sonra: QStash devri varsa SONRAKİ FAZ YAYINLANIR ve
 * fonksiyon ANINDA döner (istatistiksel mikro-adım). Devir yoksa aynı istek
 * içinde devam edilir; toplam süre yine 4×8 sn ile sınırlıdır.
 */
async function drive(
  state: VeloraRunState,
  fromPhase: VeloraPhaseId,
  deps: VeloraOrchestratorDeps,
  dispatch: VeloraHandoff,
): Promise<VeloraRunResult> {
  try {
    for (let id = fromPhase; id <= 4; id = (id + 1) as VeloraPhaseId) {
      const phase = phaseById(id);
      // Faz 2 aynı adımda ürün retriever'ını da koşar (paralel, tavanlı).
      if (id === 2) await retrieveCandidates(state, deps);
      const result = await runVeloraPhase(phase, state, deps);
      state.phases = [...state.phases.filter((p) => p.id !== id), result].sort((a, b) => a.id - b.id);
      await deps.store.saveState(state);

      if (id < 4 && deps.handoff) {
        const nextPhase = (id + 1) as VeloraPhaseId;
        const published = await deps.handoff({ runId: state.runId, phase: nextPhase });
        if (published.ok) {
          return {
            runId: state.runId,
            status: "dispatched",
            completedPhases: id,
            nextPhase,
            dispatch: published,
          };
        }
        // Yayın düştü: hattı ortada bırakmak yerine aynı istekte sürdür.
        dispatch = published;
      }
    }

    const dossier = buildWinnerDossier(state);
    const push = await deps.store.pushWinners(winnerRows(dossier));
    state.status = "completed";
    await deps.store.saveState(state);
    const selfTest = await selfTestVeloraRun(state, { store: deps.store, dossier, push });
    return {
      runId: state.runId,
      status: "completed",
      completedPhases: 4,
      dispatch,
      dossier,
      push,
      selfTest,
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    state.status = "failed";
    await deps.store.saveState(state).catch(() => {});
    return { runId: state.runId, status: "failed", completedPhases: state.phases.length, dispatch, error };
  }
}

/** Yeni bir koşu açar: ORTAK kanıtı toplar, Faz 1'i koşar ve devreder. */
export async function startVeloraRun(
  input: unknown,
  deps: VeloraOrchestratorDeps,
): Promise<VeloraRunResult> {
  const parsed = VeloraInputSchema.parse(input);
  const state: VeloraRunState = {
    runId: parsed.runId ?? `velora_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    query: parsed.userQuery,
    country: (parsed.country ?? "GLOBAL").toUpperCase(),
    platform: parsed.platform ?? "General",
    language: parsed.language,
    startedAtMs: Date.now(),
    status: "running",
    evidenceBlock: "",
    scrapedTrends: [],
    live: false,
    candidates: [],
    phases: [],
  };
  await deps.store.saveState(state);
  await ingestEvidence(state);
  return drive(state, 1, deps, { ok: true, mode: deps.handoff ? "qstash" : "inline" });
}

/** QStash geri çağrısı: kaydedilmiş durumu yükler ve `phase`i koşar. */
export async function resumeVeloraRun(
  runId: string,
  phase: VeloraPhaseId,
  deps: VeloraOrchestratorDeps,
): Promise<VeloraRunResult> {
  const state = await deps.store.loadState(runId);
  if (!state) {
    return {
      runId,
      status: "failed",
      completedPhases: 0,
      dispatch: { ok: false, mode: "qstash", error: "RUN_STATE_NOT_FOUND" },
      error: "RUN_STATE_NOT_FOUND",
    };
  }
  if (state.status === "completed") {
    return { runId, status: "completed", completedPhases: state.phases.length, dispatch: { ok: true, mode: "qstash" } };
  }
  state.status = "running";
  return drive(state, phase, deps, { ok: true, mode: deps.handoff ? "qstash" : "inline" });
}

export const VeloraInputSchema = z.object({
  runId: z.string().trim().min(3).max(120).optional(),
  userQuery: z.string().trim().min(2).max(2000),
  country: z.string().trim().max(60).optional(),
  platform: z.string().trim().max(60).optional(),
  language: z.string().max(10).default("tr"),
});

// ---------------------------------------------------------------------------
// OTOMATİK SELF-TEST & TEŞHİS DÖNGÜSÜ
// ---------------------------------------------------------------------------

export type VeloraSelfTestReport = {
  status: "SUCCESS" | "FAILED";
  pushResult: { recordIds: string[]; status: "PUSHED" | "FAILED"; error?: string };
  performance: { phase: string; ms: number; ceilingMs: number; withinCeiling: boolean }[];
  agentsLogged: number;
  expectedAgents: number;
  dbFetchVerified: boolean;
  payloadIntegrity: boolean;
  verdict: "PASS" | "FAIL";
  notes: string[];
};

/**
 * Push sonrası teşhis: (1) kaydı geri okuyup alan bütünlüğünü doğrular,
 * (2) hiçbir fazın 8 sn tavanını aşmadığını ve 14 ajan alt çıktısının tamamının
 * kayıtlı olduğunu kontrol eder.
 */
export async function selfTestVeloraRun(
  state: VeloraRunState,
  args: {
    store: VeloraStore;
    dossier: WinnerDto;
    push: { ok: boolean; ids: string[]; error?: string };
  },
): Promise<VeloraSelfTestReport> {
  const notes: string[] = [];
  const ceiling = VELORA_PHASE_CEILING_MS;
  const performance = state.phases.map((phase) => ({
    phase: `P${phase.id}:${phase.key}`,
    ms: phase.ms,
    ceilingMs: ceiling,
    withinCeiling: phase.withinCeiling,
  }));
  const agentsLogged = state.phases.reduce((total, phase) => total + phase.agents.length, 0);
  const expectedAgents = plannedAgentCount();

  let dbFetchVerified = false;
  let payloadIntegrity = false;
  const titles = args.dossier.products.map((p) => p.name.slice(0, 200));
  if (args.push.ok && titles.length > 0) {
    try {
      const day = args.dossier.generated_at.slice(0, 10);
      const rows = await args.store.fetchWinners(day, titles);
      const found = new Set(rows.map((row) => row.title));
      dbFetchVerified = titles.every((title) => found.has(title));
      payloadIntegrity =
        dbFetchVerified &&
        rows.every(
          (row) =>
            Number.isFinite(row.winner_score) &&
            row.winner_score >= 0 &&
            row.winner_score <= 100 &&
            typeof row.niche === "string" &&
            row.niche.length > 0 &&
            row.payload !== null &&
            typeof row.payload === "object",
        );
      if (!dbFetchVerified) notes.push("DB_FETCH_MISSING_ROWS");
      else if (!payloadIntegrity) notes.push("DB_PAYLOAD_FIELD_MISSING");
    } catch (e) {
      notes.push(`DB_FETCH_FAILED:${e instanceof Error ? e.message : String(e)}`);
    }
  } else if (!args.push.ok) {
    notes.push(`PUSH_FAILED:${args.push.error ?? "unknown"}`);
  }

  if (agentsLogged !== expectedAgents) notes.push(`AGENT_COUNT_MISMATCH:${agentsLogged}/${expectedAgents}`);
  for (const phase of performance) {
    if (!phase.withinCeiling) notes.push(`PHASE_CEILING_EXCEEDED:${phase.phase}`);
  }
  const timedOut = state.phases.flatMap((p) => p.agents.filter((a) => a.timedOut).map((a) => a.key));
  if (timedOut.length > 0) notes.push(`AGENTS_TIMED_OUT:${timedOut.join(",")}`);

  const verdict =
    args.push.ok && dbFetchVerified && payloadIntegrity && agentsLogged === expectedAgents
      ? "PASS"
      : "FAIL";

  return {
    status: args.push.ok ? "SUCCESS" : "FAILED",
    pushResult: {
      recordIds: args.push.ids,
      status: args.push.ok ? "PUSHED" : "FAILED",
      ...(args.push.error ? { error: args.push.error } : {}),
    },
    performance,
    agentsLogged,
    expectedAgents,
    dbFetchVerified,
    payloadIntegrity,
    verdict,
    notes,
  };
}

/** İstenen biçimde son durum raporu (panelde ve logda gösterilir). */
export function formatVeloraSelfTestReport(report: VeloraSelfTestReport, runId: string): string {
  const perf = report.performance
    .map((p) => `${p.phase}=${p.ms}ms`)
    .join(" · ");
  const compliant = report.performance.every((p) => p.withinCeiling);
  return [
    `[RUN]: ${runId}`,
    `[STATUS]: ${report.status}`,
    `[PUSH RESULT]: ${report.pushResult.recordIds.length} kayıt (${report.pushResult.recordIds.slice(0, 3).join(", ") || "-"}) · ${report.pushResult.status}`,
    `[PERFORMANCE]: ${perf || "-"} · tavan=${VELORA_PHASE_CEILING_MS}ms · uyumlu=${compliant ? "YES" : "NO"}`,
    `[AGENTS]: ${report.agentsLogged}/${report.expectedAgents}`,
    `[TEST ${report.verdict}]: db_fetch=${report.dbFetchVerified ? "OK" : "FAIL"} · payload=${report.payloadIntegrity ? "OK" : "FAIL"}${report.notes.length ? ` · ${report.notes.join(", ")}` : ""}`,
  ].join("\n");
}
