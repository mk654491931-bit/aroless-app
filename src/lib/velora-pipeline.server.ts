/**
 * Velora 14 ajanlı çalışma hattı (Tier 1 → Tier 4).
 *
 * Tier 1 (Ajan 1-8)  : Cerebras → SambaNova → Groq   (hızlı ham işleme)
 * Tier 2 (Ajan 9-11) : Gemini Flash → Groq → OpenRouter free
 * Tier 3 (Ajan 12-13): OpenRouter free → Hugging Face → Groq
 * Tier 4 (Ajan 14)   : Bedrock Claude → Gemini → OpenRouter/Groq
 */
import { z } from "zod";
import {
  executeAgentWithFallback,
  parseAgentJson,
  type AgentRunLog,
  type ProviderId,
} from "./ai-router.server";

// ------------------------------------------------------------------ schemas

export const PipelineInputSchema = z.object({
  userQuery: z.string().min(2).max(2000),
  country: z.string().max(60).optional(),
  platform: z.string().max(60).optional(),
  language: z.string().max(10).default("tr"),
});
export type PipelineInput = z.infer<typeof PipelineInputSchema>;

export const ProductSchema = z.object({
  name: z.string(),
  category: z.string().default(""),
  priceRange: z.string().default(""),
  estimatedMarginPct: z.number().default(0),
  demandScore: z.number().min(0).max(100).default(0),
  competitionScore: z.number().min(0).max(100).default(0),
  sentiment: z.string().default(""),
  whyNow: z.string().default(""),
  risks: z.array(z.string()).default([]),
});
export type Product = z.infer<typeof ProductSchema>;

export const PipelineOutputSchema = z.object({
  topProducts: z.array(ProductSchema).max(5),
  executiveSummary: z.string(),
  metrics: z.object({
    totalLatencyMs: z.number(),
    agentCount: z.number(),
    succeeded: z.number(),
    failed: z.number(),
    providerHits: z.record(z.string(), z.number()),
    tierLatencyMs: z.record(z.string(), z.number()),
    logs: z.array(
      z.object({
        agent: z.string(),
        provider: z.string(),
        attempts: z.number(),
        latencyMs: z.number(),
        ok: z.boolean(),
        error: z.string().optional(),
      }),
    ),
  }),
});
export type PipelineOutput = z.infer<typeof PipelineOutputSchema>;

// ------------------------------------------------------------------ agents

type AgentDef = {
  id: number;
  name: string;
  tier: 1 | 2 | 3 | 4;
  chain: ProviderId[];
  role: string;
  temperature: number;
};

const T1: ProviderId[] = ["cerebras", "sambanova", "groq"];
const T2: ProviderId[] = ["gemini", "groq", "openrouter"];
const T3: ProviderId[] = ["openrouter", "huggingface", "groq"];
const T4: ProviderId[] = ["bedrock", "gemini", "openrouter", "groq"];

export const AGENTS: AgentDef[] = [
  {
    id: 1,
    name: "Web Scraping Cleaner",
    tier: 1,
    chain: T1,
    temperature: 0.2,
    role: "Sorguyla ilgili pazar yerlerinden gelebilecek ham listeleme metinlerini temizle; gürültüyü, HTML kalıntılarını ve tekrarları at.",
  },
  {
    id: 2,
    name: "Raw Data Normalizer",
    tier: 1,
    chain: T1,
    temperature: 0.2,
    role: "Ürün adları, birimler, para birimleri ve ölçüleri tek standarda normalize et.",
  },
  {
    id: 3,
    name: "Product Spec Extractor",
    tier: 1,
    chain: T1,
    temperature: 0.2,
    role: "Her aday ürün için teknik/fiziksel spesifikasyonları (malzeme, boyut, ağırlık, güç) çıkar.",
  },
  {
    id: 4,
    name: "Entity Resolver",
    tier: 1,
    chain: T1,
    temperature: 0.2,
    role: "Aynı ürünün farklı adlandırmalarını tek varlıkta birleştir, marka/model ayrıştır.",
  },
  {
    id: 5,
    name: "Price Parser",
    tier: 1,
    chain: T1,
    temperature: 0.2,
    role: "Tedarik ve perakende fiyat aralıklarını sayısallaştır; kargo ve komisyonu ayrı kalem yaz.",
  },
  {
    id: 6,
    name: "Attribute Standardizer",
    tier: 1,
    chain: T1,
    temperature: 0.2,
    role: "Renk, beden, paket adedi gibi varyant niteliklerini standart anahtarlara oturt.",
  },
  {
    id: 7,
    name: "Noise Filter",
    tier: 1,
    chain: T1,
    temperature: 0.2,
    role: "Doygun, yasaklı, kırılgan, patentli veya kâr etmeyen adayları ele; nedenini yaz.",
  },
  {
    id: 8,
    name: "Initial Ranker",
    tier: 1,
    chain: T1,
    temperature: 0.3,
    role: "Kalan adayları talep, marj ve lojistik kolaylığına göre ilk kez sırala (0-100).",
  },
  {
    id: 9,
    name: "Category Matcher",
    tier: 2,
    chain: T2,
    temperature: 0.3,
    role: "Her ürünü hedef platformun gerçek kategori ağacına ve komisyon oranına eşle.",
  },
  {
    id: 10,
    name: "Trend Analyzer",
    tier: 2,
    chain: T2,
    temperature: 0.4,
    role: "Mevsimsellik, arama trendi yönü ve 90 günlük momentum tahmini üret.",
  },
  {
    id: 11,
    name: "Niche Grouping Agent",
    tier: 2,
    chain: T2,
    temperature: 0.4,
    role: "Ürünleri nişlere kümele; her niş için hedef kitle ve giriş bariyerini belirt.",
  },
  {
    id: 12,
    name: "Customer Sentiment Analyzer",
    tier: 3,
    chain: T3,
    temperature: 0.3,
    role: "Tipik müşteri şikâyet/övgü temalarını ve iade risklerini duygu analiziyle özetle.",
  },
  {
    id: 13,
    name: "Competitor Price Benchmarker",
    tier: 3,
    chain: T3,
    temperature: 0.3,
    role: "Rakip fiyat bandını, satıcı yoğunluğunu ve fiyat kırma riskini kıyasla.",
  },
  {
    id: 14,
    name: "Executive Synthesis Engine",
    tier: 4,
    chain: T4,
    temperature: 0.35,
    role: "Tüm katman çıktılarını sentezleyip en iyi 5 ürünü ve stratejik yönetici raporunu üret.",
  },
];

// ------------------------------------------------------------------ prompts

function contextHeader(input: PipelineInput): string {
  return [
    `Kullanıcı sorgusu: ${input.userQuery}`,
    input.country ? `Hedef ülke: ${input.country}` : "",
    input.platform ? `Hedef platform: ${input.platform}` : "",
    `Yanıt dili: ${input.language}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function stageJsonHint(agent: AgentDef): string {
  if (agent.id === 14) {
    return `SADECE şu şekilde minified JSON döndür:
{"topProducts":[{"name":string,"category":string,"priceRange":string,"estimatedMarginPct":number,"demandScore":number 0-100,"competitionScore":number 0-100,"sentiment":string,"whyNow":string,"risks":[string]}] (tam 5 adet),
 "executiveSummary": string (200-500 kelime, sayısal, uygulanabilir strateji raporu)}`;
  }
  return `SADECE minified JSON döndür: {"findings":[string] (3-8 madde, somut ve sayısal),"candidates":[{"name":string,"note":string}] (en fazla 10)}`;
}

type StageOutput = { findings: string[]; candidates: { name: string; note: string }[] };

function buildAgentPrompt(agent: AgentDef, input: PipelineInput, prior: string): string {
  return `Sen Velora ürün istihbarat sisteminde Ajan ${agent.id} — ${agent.name}.
Görevin: ${agent.role}

${contextHeader(input)}

Önceki katmanların çıktı özeti:
${prior || "(ilk katman — önceki çıktı yok)"}

${stageJsonHint(agent)}`;
}

function summarize(outputs: { agent: AgentDef; data: StageOutput }[]): string {
  return outputs
    .map(
      ({ agent, data }) =>
        `#${agent.id} ${agent.name}: ${(data.findings ?? []).slice(0, 5).join(" | ")}${
          data.candidates?.length
            ? `\n  adaylar: ${data.candidates
                .slice(0, 10)
                .map((c) => `${c.name} (${c.note})`)
                .join("; ")}`
            : ""
        }`,
    )
    .join("\n")
    .slice(0, 12_000);
}

// ------------------------------------------------------------------ pipeline

/** 14 ajanı Tier 1→4 sırasıyla çalıştırır ve yapılandırılmış rapor döndürür. */
export async function runVeloraAgentPipeline(rawInput: unknown): Promise<PipelineOutput> {
  const input = PipelineInputSchema.parse(rawInput);
  const started = Date.now();
  const logs: AgentRunLog[] = [];
  const tierLatencyMs: Record<string, number> = {};
  const collected: { agent: AgentDef; data: StageOutput }[] = [];

  for (const tier of [1, 2, 3] as const) {
    const tierStart = Date.now();
    const agents = AGENTS.filter((a) => a.tier === tier);
    const prior = summarize(collected);
    const results = await Promise.all(
      agents.map(async (agent) => {
        const { text, log } = await executeAgentWithFallback(
          `${agent.id}. ${agent.name}`,
          buildAgentPrompt(agent, input, prior),
          agent.chain,
          { temperature: agent.temperature },
        );
        return {
          agent,
          log,
          data: parseAgentJson<StageOutput>(text, { findings: [], candidates: [] }),
        };
      }),
    );
    for (const r of results) {
      logs.push(r.log);
      if (r.log.ok) collected.push({ agent: r.agent, data: r.data });
    }
    tierLatencyMs[`tier${tier}`] = Date.now() - tierStart;
  }

  // Tier 4 — sentez
  const finalAgent = AGENTS[13];
  const tier4Start = Date.now();
  const { text, log } = await executeAgentWithFallback(
    `${finalAgent.id}. ${finalAgent.name}`,
    buildAgentPrompt(finalAgent, input, summarize(collected)),
    finalAgent.chain,
    { temperature: finalAgent.temperature, retries: 3 },
  );
  logs.push(log);
  tierLatencyMs["tier4"] = Date.now() - tier4Start;

  const parsed = parseAgentJson<{ topProducts?: unknown[]; executiveSummary?: string }>(text, {});
  const topProducts = (Array.isArray(parsed.topProducts) ? parsed.topProducts : [])
    .slice(0, 5)
    .map((p) => ProductSchema.safeParse(p))
    .filter((r): r is { success: true; data: Product } => r.success)
    .map((r) => r.data);

  const providerHits: Record<string, number> = {};
  for (const l of logs) providerHits[l.provider] = (providerHits[l.provider] ?? 0) + 1;

  if (!topProducts.length && !parsed.executiveSummary) {
    throw new Error("Tüm sağlayıcılar şu anda yanıt vermedi. Birkaç saniye sonra tekrar deneyin.");
  }

  return PipelineOutputSchema.parse({
    topProducts,
    executiveSummary: String(parsed.executiveSummary ?? "").slice(0, 12_000),
    metrics: {
      totalLatencyMs: Date.now() - started,
      agentCount: AGENTS.length,
      succeeded: logs.filter((l) => l.ok).length,
      failed: logs.filter((l) => !l.ok).length,
      providerHits,
      tierLatencyMs,
      logs,
    },
  });
}
