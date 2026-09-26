/**
 * VELORA AUTONOMOUS MULTI-AGENT ORCHESTRATOR — 14 ajan · tek paralel burst · ücretsiz plan güvenli.
 *
 * NEDEN AYRI BİR KATMAN: `velora-pipeline.server.ts` 14 ajanı TEK bir bloklayan
 * istek içinde, sırayla koşar. Vercel Hobby gibi dar bir fonksiyon limitinde bu
 * ya 504 üretir ya da hattı ortasında keser. Bu modül aynı 14 ajanı
 * **istatistiksel mikro-adımlara** böler:
 *
 *   1. 14 ajan TEK FAZDA, birbirinden bağımsız Promise.all yükünde başlar.
 *   2. AI analiz hattı aynı fazda aynı anda finalistleri puanlar. 14 ajanın
 *      tamamı ve bağımsız analiz turu aynı deadline'ı paylaşır.
 *   3. Fazın sert tavanı vardır: `VELORA_PHASE_CEILING_MS` (8 sn). Tavan
 *      aşılırsa faz yarıda kesilmez — tamamlanmayan üyeler NÖTR sonuçla döner,
 *      devam eden AI isteği GERÇEKTEN iptal edilir (AbortSignal) ve hat dürüstçe
 *      "kısmi" der. Hiçbir faz asla 8 sn'yi geçemez.
 *   4. Burst durumu Supabase'deki geçici kovada (`ai_cache`, scope
 *      `velora-orch`) `runId` ile taşınır → her adım STATELESS'tir ve herhangi bir
 *      instance'ta koşabilir. Aynı runId'nin tekrar teslimi (QStash retry)
 *      IDEMPOTENTTİR: kayıtlı faz yeniden koşmaz, koşan faz ikinci kez başlatılmaz.
 *   5. Burst tamamlanınca saf kalite kapısı, %70/%30 birleşimi ve sıralama çalışır;
 *      ek QStash zinciri yoktur.
 *
 * İKİ BAĞIMSIZ KANIT HATTI: ürün analizi ve 14 ajanlı konsey, aynı anda kendi
 * trend radarı + canlı piyasa kazımasını başlatır. Snapshots ayrı state alanlarında
 * tutulur; hiçbir hat diğerinin kazınmış kanıtını görmez. Doğrulanmamış/halüsinasyon
 * metrik kural gereği reddedilir.
 *
 * FAZ 0 — 14 AJAN DEVREYE GİRMEDEN ÖNCEKİ NİŞ KAZIMASI:
 * `harvestNicheSignals` seçilen niş için GERÇEK veriyi (Google Trends momentum,
 * Reddit talebi + şikâyetleri, Hacker News, Google News, gözlenen marketplace
 * fiyatları, AliExpress tedarik maliyeti, trend radarı, GitHub) ajanlardan
 * bağımsız olarak toplar. Her kaynak `active`/`error` olarak RAPORLANIR; yavaş
 * veya ölü kaynak diğerlerini düşürmez. Bu kanıt iki hatta da aynı şekilde
 * dağıtılır ve her ajan kendi uzmanlığına ait DİLİMİ ayrıca görür
 * (`velora-agent-focus.ts`) — mali müşavir fiyatı, telif denetçisi marka
 * izini, UX ajanı şikâyeti görür.
 *
 * NİHAİ SONUÇ — 14 AJAN ORTALAMASI:
 * Sıralamanın birincil anahtarı 14 ajanın ÜRÜN BAŞINA oy ortalamasıdır
 * (`velora-council-score.ts` → `councilFinalScore`). Ortalama, oyun sayısı
 * (katılım) ve yayılım (uzlaşma) ile düzeltilir: 3 ajandan gelen yüksek puan,
 * 14 ajandan gelen orta puanın üstüne ÇIKAMAZ. Bağımsız analiz hattı kararı
 * bozmaz — yalnız eşitlik bozucu (tie-break) ve "ajan oyu hiç gelmedi" durumunda
 * tek başına çalışan yedek hat olarak görev yapar. Kullanıcıya en iyi
 * `VELORA_TOP_N` (5) ürün gösterilir; eksik sıra UYDURULMAZ.
 *
 * PUSH PROTOKOLÜ: Burst tamamlanınca kazanan karne (dossier) Aroless Winner DTO'ya
 * çevrilir ve nişin kazanan tablosuna (`radar_items` — panelin okuduğu mevcut
 * "winner" tablosu) yazılır. Ardından OTOMATİK SELF-TEST koşar: kayıt geri
 * okunur, alan bütünlüğü ve tavan uyumu doğrulanır.
 *
 * DURUM OKUMA: `veloraRunStatus(runId)` koşunun nerede olduğunu döner; panel bu
 * uçtan `runId` ile yoklar (POST yalnızca ilk adımı tetikler). Kalıcı kovanın
 * TTL'i dolsa bile nihai sonuç `radar_items` payload'ından geri kurulabilir.
 */
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import { COUNCIL_AGENTS, agentSchemaHint, type CouncilAgentKey } from "./council-chain.server";
import {
  DEEP_CHAIN,
  councilChainFor,
  executeAgentWithFallback,
  parseAgentJson,
} from "./ai-router.server";
import { combineJointScores } from "./consensus-types";
import { agentFocusBlock } from "./velora-agent-focus";
import { councilFinalScore, councilRankKey } from "./velora-council-score";
import {
  NicheSignalsSchema,
  emptyNicheSignals,
  nicheSignalsBlock,
  type NicheSignals,
} from "./velora-niche-signals";
import { harvestNicheSignalsCached } from "./velora-niche-scrape.server";
import { fetchTrackRecords } from "./velora-track-record.server";
import { writeVeloraQueryCache } from "./velora-query-cache.server";
import {
  councilAlignment,
  marketReach,
  marketReachLine,
  voteSpread,
  type CouncilAlignment,
  type MarketReach,
} from "./velora-insights";
import { JOB_POLL_INTERVAL_MS, qstashConfigured, qstashFanOut } from "./discovery-jobs.server";
import {
  analysisOnlyScore,
  normalizeProductIdentity,
  scrapedCandidates,
  ProductSchema,
  type Product,
  type RetrieverCandidate,
} from "./velora-pipeline.server";

// ---------------------------------------------------------------------------
// Burst planı — 14 ajanın tamamı aynı anda paralel başlar; sonraki aşamalar safdır.
// ---------------------------------------------------------------------------

/** Burst'ın sert tavanı: ücretsiz plan fonksiyon limitinin ALTINDA kalır. */
export const VELORA_PHASE_CEILING_MS = 8_000;

/**
 * FAZ 0 (niş kazıması) tavanı — AI çağrısı YOK, yalnız ağ.
 *
 * Ajan fazlarından biraz geniş olabilir çünkü burada 8 kaynak paralel kazılır ve
 * yavaş bir kaynak diğerlerini bekletmemelidir. Yine de Vercel Hobby'nin 300 sn
 * fonksiyon payının çok altındadır; toplam istek-içi yol 8·4 + 12 = 44 sn'dir.
 */
export const VELORA_HARVEST_CEILING_MS = 12_000;

/**
 * Fazın ZAMANINDA dönebilmesi için ayrılan pay.
 *
 * Üyelerin bütçesi tavanın tamamı olsaydı, zaman aşımı tam sınırda tetiklenir ve
 * toplama/sıralama maliyetiyle faz tavanı birkaç ms AŞABİLİRDİ. Bu pay, adımın
 * "tavan içinde" kalmasını garanti eder (bulucudaki `RETURN_MARGIN` ile aynı sözleşme).
 */
export const VELORA_STEP_RETURN_MARGIN_MS = 250;

/**
 * Ajanların odağındaki finalist ürün sayısı — yani 14 ajanın TÜMÜNÜN
 * puanladığı havuz.
 *
 * Neden 12: kullanıcı "nişin TAMAMINI tarasın, 3 ürünü değil" dedi. 8 üründe
 * tarama yapılırsa konsey gerçekte yalnızca 8 adayı görüyor, 60 adaylık tarama
 * havuzunun geri kalanı hiç puanlanmıyor ve "en iyi 5" iddiası eksik bir
 * taramaya dayanıyordu. 12, her ajana makul bir bağlam bütçesi (≈3 KB metin)
 * bırakırken havuzu genişletir; 14 ajan × 12 ürün = 168 oy.
 *
 * Üst sınır bilinçlidir: bağlam penceresi ve 8 saniyelik faz tavanı korunur.
 * Havuz `VELORA_PIPELINE_TOP_N` ile kesişir, yani en az iki bağımsız hattın
 * ilk-N listesinin birleşimi garanti edilir.
 */
export const VELORA_FINALIST_COUNT = 12;

/** İstenen en iyi ürün sayısı — 14 ajan ortalamasına göre. */
export const VELORA_TOP_N = 5;

/**
 * Her bağımsız hattın niş için çıkardığı "en iyi ürün" sayısı.
 *
 * 14 ajanlı konsey hattı da AI analiz hattı da birbirinden BAĞIMSIZ olarak kendi
 * ilk-N listesini bulur. Nihai sıralama 14 ajan ortalamasıdır; bu iki liste
 * yalnız aday havuzunu genişletir.
 *
 * Neden `VELORA_FINALIST_COUNT` eşit: kullanıcı nişin TAMAMININ taranmasını
 * istedi. İki hat 8'er üründe dursaydı havuz en fazla 16 ile sınırlı kalır ve
 * 60 adaylık taramanın geri kalanı hiç değerlendirilmezdi. Değerler eşit
 * olduğunda her iki hat da finalist havuzunun tamamını doldurur.
 */
export const VELORA_PIPELINE_TOP_N = VELORA_FINALIST_COUNT;

/** Bir ürünün ajan kararı "kabul edilebilir" sayılması için gereken en küçük oy oranı. */
export const VELORA_MIN_AGENT_COVERAGE = 0.5;

/**
 * ÜRÜN KALİTE KAPISI — nihai listeye yalnızca GERÇEK ürünler girebilsin.
 *
 * "En iyi 3" istenir; listeyi yedek metinle (ör. "mini ice maker için taşınabilir
 * alternatif") doldurmak kullanıcıya değersiz sonuç gösterir. Bu yüzden kaynağı
 * `fallback` olan adaylar ve ağırlıklı puanı bu barajın altında kalan zayıf
 * adaylar listeye ALINMAZ; eksik sıra doldurulmaz ve durum dürüstçe not edilir.
 */
export const VELORA_MIN_PRODUCT_SCORE = 25;

/**
 * Koşan bir fazın kilidi (ms). Aynı faz bu süre içinde tekrar teslim edilirse
 * ikinci kez BAŞLATILMAZ (QStash retry aynı işi iki kez harcayamaz).
 */
export const VELORA_PHASE_LEASE_MS = 90_000;

/** Bu süre boyunca hiç ilerleme yazılmadıysa koşu "bayat" sayılır ve panel yoklamayı bırakır. */
export const VELORA_RUN_STALE_MS = 180_000;

export type VeloraPhaseId = 0 | 1 | 2 | 3 | 4;

export type VeloraPhaseDefinition = {
  id: VeloraPhaseId;
  key: string;
  name: string;
  /** Bu burst'ta koşan üyeler — hepsi AYNI ortak kanıt bloğunu görür. */
  agents: readonly CouncilAgentKey[];
};

export const VELORA_PHASES: readonly VeloraPhaseDefinition[] = [
  {
    // FAZ 0 — 14 AJANDAN ÖNCE. AI çağrısı YOK: yalnız gerçek veri kazınır.
    // 8 ücretsiz kaynak paralel taranır, her biri `active`/`error` olarak
    // raporlanır ve sonuç koşu durumuna yazılır. Böylece kazıma da QStash
    // ile adım adım taşınır: 14 ajanın burst'ü ağ kazımasıyla asla yarışmaz.
    id: 0,
    key: "niche-harvest",
    name: "Deep Niche Harvest (pre-council scrape)",
    agents: [],
  },
  {
    id: 1,
    key: "parallel-council",
    name: "14-Agent Council + Independent AI Analysis",
    // Kullanıcı şartı: 14 üyenin tamamı aynı anda başlar. Her üye aynı ortak
    // kanıtı ve aynı finalist listesini görür; sıralı zincir yoktur.
    agents: [
      "cfo",
      "cmo",
      "cro",
      "trend_hunter",
      "competitor_intel",
      "ux_specialist",
      "supply_chain",
      "pricing_strategist",
      "logistics_cost",
      "compliance_officer",
      "retention_ltv",
      "creative_director",
      "channel_fit",
      "independent_data_auditor",
    ],
  },
  // Bundan sonraki üç adım yeni model çağrısı yapmaz; 14 ajanın ortak ürün
  // puanlarını kalite kapısı, 14 ajan ortalaması ve push için deterministik
  // olarak kaydeden checkpoint'lerdir.
  { id: 2, key: "quality-gate", name: "Evidence Quality Gate", agents: [] },
  { id: 3, key: "council-average", name: "14-Agent Average Decision", agents: [] },
  { id: 4, key: "ranking-push", name: "Final Ranking & Push", agents: [] },
];

/** Bir fazın sert tavanı — Faz 0 (kazıma) AI çağrısı yapmadığı için geniştir. */
export function phaseCeilingFor(id: VeloraPhaseId): number {
  return id === 0 ? VELORA_HARVEST_CEILING_MS : VELORA_PHASE_CEILING_MS;
}

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

/** Bir ajanın TEK ÜRÜN için verdiği puan ve gerekçesi (`product_scores` dizisi). */
export const VeloraProductVoteSchema = z.object({
  /** Finalist kimliği (`C1`) ya da ürün adı — eşleştirme normalize kimlikle yapılır. */
  id: z.string().min(1),
  score: z.number().min(0).max(100),
  note: z.string().default(""),
});
export type VeloraProductVote = z.infer<typeof VeloraProductVoteSchema>;

export const VeloraAgentResultSchema = z.object({
  key: z.string(),
  name: z.string(),
  ok: z.boolean(),
  timedOut: z.boolean().default(false),
  score: z.number().min(0).max(100),
  latencyMs: z.number().min(0),
  output: z.record(z.string(), z.unknown()).default({}),
  /** Bu üyenin ÜRÜN BAŞINA verdiği puanlar (ürün başına consensus bunlardan çıkar). */
  productVotes: z.array(VeloraProductVoteSchema).default([]),
  error: z.string().optional(),
});
export type VeloraAgentResult = z.infer<typeof VeloraAgentResultSchema>;

export const VeloraPhaseResultSchema = z.object({
  id: z.number().int().min(0).max(4),
  key: z.string(),
  name: z.string(),
  ms: z.number().min(0),
  /** Faz tavanı içinde tamamlandı mı? */
  withinCeiling: z.boolean(),
  agents: z.array(VeloraAgentResultSchema),
});
export type VeloraPhaseResult = z.infer<typeof VeloraPhaseResultSchema>;

export const VeloraPushResultSchema = z.object({
  ok: z.boolean(),
  ids: z.array(z.string()).default([]),
  error: z.string().optional(),
});
export type VeloraPushResult = z.infer<typeof VeloraPushResultSchema>;

export const VeloraSelfTestReportSchema = z.object({
  status: z.enum(["SUCCESS", "FAILED"]),
  pushResult: z.object({
    recordIds: z.array(z.string()).default([]),
    status: z.enum(["PUSHED", "FAILED"]),
    error: z.string().optional(),
  }),
  performance: z
    .array(
      z.object({
        phase: z.string(),
        ms: z.number(),
        ceilingMs: z.number(),
        withinCeiling: z.boolean(),
      }),
    )
    .default([]),
  agentsLogged: z.number().int().min(0),
  expectedAgents: z.number().int().min(0),
  dbFetchVerified: z.boolean(),
  payloadIntegrity: z.boolean(),
  verdict: z.enum(["PASS", "FAIL"]),
  notes: z.array(z.string()).default([]),
});
export type VeloraSelfTestReport = z.infer<typeof VeloraSelfTestReportSchema>;

/**
 * HAT A — BAĞIMSIZ AI ANALİZ HATTI'nın ürün başına puanı.
 *
 * NEDEN VAR: 14 ajanlı konsey (HAT B) koşarken analiz hattı yalnız deterministik
 * bir formülle (`analysisOnlyScore`) sıralama yapıyordu; yani %30'luk ağırlık
 * gerçek bir AI yorumuna değil, hesaba dayanıyordu. Artık analiz hattı finalistleri
 * KENDİ AI turuyla puanlar ve bu puan ağırlıklı birleşime girer.
 *
 * DÜRÜSTLÜK: tur tamamlanamazsa giriş `source: "heuristic"` ile işaretlenir ve
 * formül puanı kullanılır — sessizce uydurma AI puanı üretilmez.
 */
export const VeloraAnalysisEntrySchema = z.object({
  candidateId: z.string(),
  identity: z.string().default(""),
  name: z.string().default(""),
  score: z.number().min(0).max(100),
  reason: z.string().default(""),
  source: z.enum(["ai", "heuristic"]).default("ai"),
});
export type VeloraAnalysisEntry = z.infer<typeof VeloraAnalysisEntrySchema>;

/** Bir hattın kendi canlı scraping snapshot'ı; diğer hatta aktarılmaz. */
export const VeloraEvidenceSnapshotSchema = z.object({
  block: z.string().default(""),
  radar: z.array(z.string()).default([]),
  live: z.boolean().default(false),
  error: z.string().optional(),
});
export type VeloraEvidenceSnapshot = z.infer<typeof VeloraEvidenceSnapshotSchema>;

function emptyEvidenceSnapshot(): VeloraEvidenceSnapshot {
  return { block: "", radar: [], live: false };
}

export const VeloraRunStateSchema = z.object({
  runId: z.string(),
  query: z.string(),
  country: z.string(),
  platform: z.string(),
  language: z.string(),
  startedAtMs: z.number(),
  /** Son yazım anı — panelin "bayat koşu" tespiti bu alana bakar. */
  updatedAtMs: z.number().default(0),
  status: z.enum(["running", "completed", "failed"]),
  /**
   * FAZ 0'ın ÖLÇÜLEN kanıtı. 14 ajanın hepsi bu TEK kazımanın üstünde kendi
   * uzmanlık dilimini alır; ağ kazıması ajanlarla yarışmaz ve 24 saat önbellekli
   * çalıştığı için aynı niş ikinci kez taranmaz.
   */
  nicheSignals: NicheSignalsSchema.default(emptyNicheSignals()),
  /**
   * Faz 0 tamamen çökerse hata nedeni burada saklanır. Boş bir string
   * "sorun yok" demek DEĞİLDİR: panelde ve dossier notlarında görünür.
   */
  harvestError: z.string().default(""),
  /**
   * İki hattın AYRI kanıt görünümü. Product Retriever + Analysis Line yalnız
   * `analysis`, 14 ajan ise yalnız `council` snapshot'ını görür; ikisi de Faz 0'ın
   * aynı kazımasından türetilir ama karar hâlâ bağımsızdır.
   */
  evidenceByLine: z
    .object({
      analysis: VeloraEvidenceSnapshotSchema.default(emptyEvidenceSnapshot()),
      council: VeloraEvidenceSnapshotSchema.default(emptyEvidenceSnapshot()),
    })
    .default({ analysis: emptyEvidenceSnapshot(), council: emptyEvidenceSnapshot() }),
  /** Geriye dönük dossier/panel özeti: iki hattın kanıtının birleşik görünümü. */
  evidenceBlock: z.string().default(""),
  scrapedTrends: z.array(z.string()).default([]),
  live: z.boolean().default(false),
  /** AI retriever'ın adlandırdığı ürünler + kazınmış trend yedekleri (finalistler). */
  candidates: z.array(z.record(z.string(), z.unknown())).default([]),
  /**
   * HAT A çıktısı: bağımsız AI analiz hattının ürün başına puanları. Faz 1'in 14
   * üyesi koşarken PARALEL üretilir ve karne ağırlıklı birleşiminde kullanılır.
   */
  analysisLine: z.array(VeloraAnalysisEntrySchema).default([]),
  /**
   * SONUÇ GERİ BİLDİRİM: aday ürünlerin önceki koşulardaki performansı.
   * Anahtar = ürün adı. Satış ölçümü DEĞİLDİR: bağımsız koşuların aynı üründe
   * birbirini doğrulamasıdır, o yüzden "track record" denir.
   */
  trackRecord: z
    .record(
      z.string(),
      z.object({
        title: z.string().default(""),
        appearances: z.number().int().min(0),
        avgScore: z.number().min(0).max(100),
        bestRank: z.number().int().min(1),
        lastSeenDay: z.string(),
        daysSinceSeen: z.number().int().min(0),
      }),
    )
    .default({}),
  /**
   * Koşuyu başlatan kullanıcı. Ürün kararına GİRMEZ; yalnızca 24 saatlik sorgu
   * önbelleğinin kimin için yazılacağını bilmek için tutulur.
   */
  requestedBy: z.string().max(80).nullable().default(null),
  phases: z.array(VeloraPhaseResultSchema).default([]),
  /** Şu an koşan faz — aynı fazın ikinci teslimini idempotent kılar. */
  runningPhase: z
    .object({ id: z.number().int().min(0).max(4), startedAtMs: z.number() })
    .nullable()
    .default(null),
  /** Son push sonucu (durum ucu bunu panelde gösterir). */
  push: VeloraPushResultSchema.nullable().default(null),
  /** Son otomatik self-test raporu. */
  selfTest: VeloraSelfTestReportSchema.nullable().default(null),
});
export type VeloraRunState = z.infer<typeof VeloraRunStateSchema>;

/** Finalist adayın sabit kimliği (`C1`…) — ajan oyları bu kimlikle eşleşir. */
export function candidateIdOf(candidate: Record<string, unknown>, index: number): string {
  const existing = String(candidate["candidateId"] ?? "").trim();
  return existing || `C${index + 1}`;
}

// ---------------------------------------------------------------------------
// Zaman dilimli izole faz yürütücüsü
// ---------------------------------------------------------------------------

/**
 * Bir sözü sert bir tavana bağlar; tavan aşılırsa reddeder (faz asla asılı kalmaz).
 *
 * `onTimeout` GERÇEK iptaldir: tavan dolduğunda çağrılır ve altta yatan AI
 * isteğini keser. Aksi halde zaman aşımına uğrayan istek arka planda koşmaya
 * devam edip ücretsiz kotayı yakardı.
 */
function withCeiling<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => {
        try {
          onTimeout?.();
        } catch {
          /* iptal edilemeyen kaynak hattı düşürmesin */
        }
        reject(new Error(`${label}_TIMEOUT`));
      },
      Math.max(1, ms),
    );
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
  /**
   * FAZ 0 kazıyıcısı; varsayılan 24 saatlik önbellekli canlı kazımadır.
   * Testler bunu stub'lar — ağ çağrısı yapılmaz.
   */
  harvest?: typeof harvestNicheSignalsCached;
  /** Test ve özel sağlayıcılar için geçmiş performans okuyucusu. */
  fetchTrackRecord?: typeof fetchTrackRecords;
};

export type VeloraHandoff = {
  ok: boolean;
  mode: VeloraDispatchMode;
  messageId?: string;
  error?: string;
};
export type VeloraDispatchMode = "qstash" | "inline";

/**
 * Sonraki fazı QStash ile KENDİNE (`/api/jobs`, kind `velora-phase`) yayınlar.
 *
 * Dönen `null`, "devir yapılamıyor" demektir: QStash yapılandırılmamış ya da
 * origin public değil. O durumda orkestratör fazları aynı istek içinde sürer
 * (yine her faz 8 sn tavanlı). QStash hiçbir koşulda zorunlu değildir; sadece
 * daha küçük adımlar sağlar.
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

/**
 * Bir ajanın yanıtından ÜRÜN BAŞINA puanları çıkarır.
 *
 * Toleranslıdır (`product_scores` / `productScores` / `products`) ama UYDURMAZ:
 * bilinmeyen ürün kimliği ve puanı olmayan kayıt sessizce atlanır. Böylece
 * olmayan bir ürün için puan üretilemez; eksik veri "eksik" kalır.
 */
export function parseProductVotes(
  output: Record<string, unknown>,
  state: VeloraRunState,
): VeloraProductVote[] {
  const raw =
    output["product_scores"] ??
    output["productScores"] ??
    output["product_votes"] ??
    output["products"];
  if (!Array.isArray(raw)) return [];

  const byId = new Map<string, string>();
  const byIdentity = new Map<string, string>();
  state.candidates.forEach((candidate, index) => {
    const candidateId = candidateIdOf(candidate, index);
    byId.set(candidateId.toLocaleLowerCase("tr-TR"), candidateId);
    const identity = normalizeProductIdentity(String(candidate["name"] ?? ""));
    if (identity) byIdentity.set(identity, candidateId);
  });

  const votes = new Map<string, VeloraProductVote>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const value = item as Record<string, unknown>;
    const rawId = String(
      value["id"] ?? value["candidateId"] ?? value["name"] ?? value["title"] ?? "",
    ).trim();
    if (!rawId) continue;
    const candidateId =
      byId.get(rawId.toLocaleLowerCase("tr-TR")) ?? byIdentity.get(normalizeProductIdentity(rawId));
    if (!candidateId) continue; // finalist olmayan ürün: yok sayılır
    const score = Number(value["score"] ?? value["value"] ?? value["rating"]);
    if (!Number.isFinite(score)) continue; // puan yoksa puan UYDURULMAZ
    const note = String(value["note"] ?? value["reason"] ?? value["evidence"] ?? value["why"] ?? "")
      .trim()
      .slice(0, 240);
    const previous = votes.get(candidateId);
    votes.set(candidateId, {
      id: candidateId,
      score: clampScore(score),
      note: note || previous?.note || "",
    });
  }
  return [...votes.values()];
}

/** Bir üyeyi kendi süre bütçesi içinde koşar; asla fırlatmaz. */
async function runOneAgent(
  agentKey: CouncilAgentKey,
  phase: VeloraPhaseDefinition,
  state: VeloraRunState,
  deadlineAt: number,
  deps: VeloraOrchestratorDeps,
  /** 0-13: sağlayıcı dağılımı için konsey içindeki sıra. */
  councilIndex: number,
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
    productVotes: [],
    ...(error ? { error } : {}),
  });

  if (budget <= 0) return neutral("PHASE_CEILING_REACHED", true);

  const run = deps.runAgent ?? executeAgentWithFallback;
  const controller = new AbortController();
  try {
    // SAĞLAYICI DAĞITIMI: her ajan kendi birincil sağlayıcısından başlar
    // (`councilChainFor`). 14 ajanın hepsi gemini ile başlardı ve ücretsiz
    // 15 RPM sınırı anında 429 üretirdi; şimdi yük 5 Groq + 5 Gemini +
    // Cerebras + SambaNova + 5 OpenRouter + 5 HF arasında paylaşılır.
    const chain = deps.runAgent ? DEEP_CHAIN : councilChainFor(councilIndex);
    const result = await withCeiling(
      run(name, agentPrompt(agentKey, definition?.task ?? "", phase, state), chain, {
        temperature: 0.3,
        retries: 1,
        signal: controller.signal,
      }),
      budget,
      `velora:${agentKey}`,
      () => controller.abort(),
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
      productVotes: parseProductVotes(output, state),
      ...(result.log.error ? { error: result.log.error } : {}),
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    controller.abort();
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
  /**
   * İKİ HAT AYNI ANDA BAŞLAR.
   *
   * Analiz hattının bağımsız AI puanlama turu burada, Faz 1'in 14 üyesiyle
   * PARALEL başlatılır: ajanlar ürünleri puanlarken analiz hattı AYNI finalistleri
   * kendi turuyla puanlar. Tur tavanlıdır ve çökerse deterministik formüle düşer;
   * ajan kararı bu yüzden asla gecikmez veya bozulmaz. `ms` iki kol da
   * tamamlandıktan sonra ölçülür — 15 çağrı için 8 sn sözü ölçümde de geçerlidir.
   */
  const analysisLineTask =
    phase.id === 1 && state.analysisLine.length === 0 && state.candidates.length > 0
      ? runAnalysisLine(state, deps)
      : null;
  const agents = await Promise.all(
    // `councilIndex` konsey içindeki GLOBAL sıradır, böylece sağlayıcı
    // dağılımı 14 ajana eşit yayılır.
    phase.agents.map((key) =>
      runOneAgent(
        key,
        phase,
        state,
        deadlineAt,
        deps,
        COUNCIL_AGENTS.findIndex((a) => a.key === key),
      ),
    ),
  );
  // Paralel koşan analiz turu karne kurulmadan ÖNCE katılır. Ölçüm ajanlardan
  // hemen sonra değil, iki kol da bittiğinde alınır; 8 sn sözü 15 çağrı için de
  // geçerli kalır.
  if (analysisLineTask) await analysisLineTask;
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

/**
 * Finalist listesi — 14 ajanın TAMAMI bu ürünleri görür ve HEPSİNİ puanlar.
 *
 * Ajanlar koşu sorgusuna değil, ürün başına ölçülebilir bir karara bağlanır: aynı
 * finalist kimlikleri (`C1`…) istemde listelenir, yanıtta `product_scores` ile
 * geri istenir ve konsensus bu kimlikler üzerinden kurulur.
 */
export function finalistBlock(state: VeloraRunState): string {
  if (state.candidates.length === 0) {
    return "FINALIST PRODUCTS: none available — return an empty product_scores array.";
  }
  return [
    "FINALIST PRODUCTS (the ONLY products in scope — you MUST score EVERY one of them):",
    "A `track=` suffix means the product was also picked by EARLIER independent runs (past performance, NOT sales data). Weight it as weak corroboration only; never let it override the scraped evidence.",
    ...state.candidates.map((candidate, index) => {
      const id = candidateIdOf(candidate, index);
      const name = String(candidate["name"] ?? "").trim() || "(unnamed)";
      const category = String(candidate["category"] ?? "-").trim() || "-";
      const price = String(candidate["priceRange"] ?? "-").trim() || "-";
      const source = String(candidate["source"] ?? "ai").trim() || "ai";
      const history = state.trackRecord[normalizeProductIdentity(name)];
      // Geçmiş performans yalnızca VARSA yazılır; yoksa "bilinmiyor" anlamına
      // gelen bir satır uydurmak yerine alan boş bırakılır.
      const track = history
        ? ` · track=${history.appearances}x önceki koşuda, ort=${history.avgScore}, en iyi sıra=${history.bestRank}, ${history.daysSinceSeen}g önce`
        : "";
      return `${id}. ${name} · category=${category} · price=${price} · source=${source}${track}`;
    }),
  ].join("\n");
}

/**
 * Pazar erişimi özeti — hangi kanal hangi pazarda satılabilir?
 *
 * Kural tabanlıdır (kanal pazarı + bilinen sertifika bariyerleri) ve ÜRÜNLERİN
 * ADLARI BİRLEŞTİRİLEREK tek satırda verilir: 14 ajanın her biri kendi ürününe
 * bariyer denk gelip gelmediğini kendisi eşleştirir. Bu bilgi ajanların kendi
 * puanına eklediği bir yargı değil, GÖRÜNÜR GEÇEN kuraldır.
 *
 * "Uygun" yalnızca bilinen bir engel çıkmadığı anlamına gelir; vergi/gümrük
 * hesabı yapılmaz ve iddia edilmez.
 */
function marketReachBlock(state: VeloraRunState): string {
  const productText = state.candidates
    .map((c) => `${String(c["name"] ?? "")} ${String(c["category"] ?? "")}`)
    .join(" · ");
  if (!productText.trim()) return "";
  const line = marketReachLine(marketReach({ platform: state.platform || "General", productText }));
  return line
    ? `MARKET REACH (rule-based channel availability — NOT a tax/duty calculation; match products to markets yourself): ${line}\n`
    : "";
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
  const councilEvidence = state.evidenceByLine.council;
  // Her ajan kendi UZMANLIK DİLİMİNİ ayrıca görür: aynı kazıma, o rolün
  // kararına etki eden ölçülmüş alanlara indirgenir (fiyat, şikâyet, bariyer,
  // tedarik, kanal…). Ek AI çağrısı YOKTUR — maliyet sıfırdır.
  const focus = agentFocusBlock(
    agentKey,
    state.nicheSignals,
    state.candidates.map((candidate) => String(candidate["name"] ?? "")),
  );
  return `You are ${name}, member ${index}/14 of the Aroless AI Council.
VELORA PHASE ${phase.id}/4 — ${phase.name}
TASK: ${task}

QUERY: ${state.query}
COUNTRY: ${state.country || "GLOBAL"}
PLATFORM: ${state.platform || "any"}

${
  councilEvidence.block
    ? `PRE-COUNCIL SCRAPING EVIDENCE (collected by phase 0 BEFORE any agent ran — trend radar, Google Trends, Reddit, Hacker News, Google News, observed marketplace prices, supplier cost):\n${councilEvidence.block.slice(0, 3_200)}`
    : 'PRE-COUNCIL SCRAPING EVIDENCE: the pre-council harvest returned no data. Score neutrally and say "unverified".'
}

${focus ?? ""}

${finalistBlock(state)}

${marketReachBlock(state)}
CHAIN RULES:
- Return ONLY valid minified JSON. No markdown or commentary.
- Return exactly these fields and no extra fields: ${agentSchemaHint(agentKey)} PLUS "product_scores".
- "product_scores" MUST list EVERY finalist exactly once: {"product_scores":[{"id":"C1","score":0-100,"note":"one short evidence-based reason"}]}
- Score EVERY finalist above and no other product. Never invent products that are not in the list; a missing id is treated as "no opinion".
- GROUND TRUTH RULE: use only the shared scraped evidence above. Never invent metrics; unverified or hallucinated numbers are rejected. If a finalist cannot be verified from the shared evidence, give it score 50 and write "unverified" in its note.
- Never return null or a zero score. Numbers must be finite; prefer conservative estimates.`;
}

// ---------------------------------------------------------------------------
// ÜRÜN BAŞINA AJAN KONSENSÜSÜ
// ---------------------------------------------------------------------------

export type VeloraProductConsensus = {
  candidateId: string;
  identity: string;
  name: string;
  /** Bu ürünü puanlayan ajanların ortalaması (0-100). */
  councilScore: number;
  /** Bu ürünü puanlayan ajan sayısı (0-14). */
  votes: number;
  /** Oy oranı (0-1) — "kaç ajan gerçekten konuştu". */
  coverage: number;
  /**
   * Oy YAYILIMI (popülasyon standart sapması). Ortalama tek başına yanıltıcıdır:
   * 14 ajanın hepsinin 71 vermesi ile 7'sinin 90, 7'sinin 52 vermesi aynı ortalamayı
   * verir. Yayılım "hepsi hemfikir" ile "konsey bölünmüş" durumlarını ayırır.
   */
  spread: number;
  minScore: number;
  maxScore: number;
  /** Yayılımdan türeyen katılım etiketi (panelde rozet olarak gösterilir). */
  alignment: CouncilAlignment;
  /** Ajanların bıraktığı gerekçeler (kanıt referansları). */
  evidence: string[];
};

/**
 * 14 ajanın ÜRÜN BAŞINA puanlarını tek konsensüse indirger.
 *
 * Run geneli konsey ortalaması her ürüne kopyalanmaz: her ürün yalnızca KENDİSİ
 * hakkında konuşan ajanların oylarını alır. Hiç oy almamış ürün sonuç kümesine
 * girmez ("oy yok" ile "50 puan" aynı şey değildir).
 */
export function productConsensus(state: VeloraRunState): Map<string, VeloraProductConsensus> {
  const totals = new Map<
    string,
    {
      candidateId: string;
      identity: string;
      name: string;
      sum: number;
      votes: number;
      minScore: number;
      maxScore: number;
      scores: number[];
      evidence: string[];
    }
  >();
  const aliases = new Map<string, string>();

  state.candidates.forEach((candidate, index) => {
    const candidateId = candidateIdOf(candidate, index);
    const name = String(candidate["name"] ?? "").trim();
    const identity = normalizeProductIdentity(name);
    totals.set(candidateId, {
      candidateId,
      identity,
      name,
      sum: 0,
      votes: 0,
      minScore: 100,
      maxScore: 0,
      scores: [],
      evidence: [],
    });
    aliases.set(candidateId.toLocaleLowerCase("tr-TR"), candidateId);
    if (identity) aliases.set(identity, candidateId);
  });

  for (const phase of state.phases) {
    for (const agent of phase.agents) {
      for (const vote of agent.productVotes) {
        const candidateId =
          aliases.get(vote.id.toLocaleLowerCase("tr-TR")) ??
          aliases.get(normalizeProductIdentity(vote.id));
        const slot = candidateId ? totals.get(candidateId) : undefined;
        if (!slot) continue;
        slot.sum += vote.score;
        slot.votes += 1;
        slot.scores.push(vote.score);
        slot.minScore = Math.min(slot.minScore, vote.score);
        slot.maxScore = Math.max(slot.maxScore, vote.score);
        if (vote.note && slot.evidence.length < 4)
          slot.evidence.push(`${agent.name}: ${vote.note}`);
      }
    }
  }

  const consensus = new Map<string, VeloraProductConsensus>();
  for (const slot of totals.values()) {
    if (slot.votes === 0) continue;
    const mean = slot.sum / slot.votes;
    const spread = voteSpread(slot.scores);
    consensus.set(slot.candidateId, {
      candidateId: slot.candidateId,
      identity: slot.identity,
      name: slot.name,
      councilScore: Math.round(mean),
      votes: slot.votes,
      coverage: Math.min(1, slot.votes / Math.max(1, plannedAgentCount())),
      spread,
      minScore: slot.minScore,
      maxScore: slot.maxScore,
      alignment: councilAlignment(slot.votes, spread),
      evidence: slot.evidence,
    });
  }
  return consensus;
}

// ---------------------------------------------------------------------------
// ORTAK KARAR — analiz hattı ⊕ 14'lü konsey (bulucuyla aynı formül)
// ---------------------------------------------------------------------------

/**
 * Analiz hattı parmak izi (0-100): hat ne kadar GERÇEK kanıt gördü?
 * Bulucunun `productFingerprint`i ile aynı sözleşme — uydurma veri puan üretmez.
 * (Karar bilgisidir; ürün sıralaması ürün başına `analysisOnlyScore` ile yapılır.)
 */
export function veloraAnalysisScore(state: VeloraRunState): number {
  const analysisEvidence = state.evidenceByLine.analysis; // line-specific snapshot
  const scraped = Math.min(1, analysisEvidence.radar.length / 10);
  const named = Math.min(1, state.candidates.filter((c) => c["source"] === "ai").length / 3);
  const live = analysisEvidence.live ? 1 : 0;
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

/** Nihai listenin dayandığı hat — panelde dürüstçe etiketlenir. */
export type WinnerRankSource = "council-average" | "analysis-only";

export const WinnerDtoSchema = z.object({
  run_id: z.string(),
  query: z.string(),
  country: z.string(),
  platform: z.string(),
  generated_at: z.string(),
  /** Run geneli konsey ortalaması (bilgi amaçlı; ürün puanı DEĞİL). */
  council_average: z.number().min(0).max(100),
  /** Run geneli analiz parmak izi (bilgi amaçlı; ürün puanı DEĞİL). */
  analysis_score: z.number().min(0).max(100),
  /** Run geneli ortak karar (bilgi amaçlı). */
  joint_score: z.number().min(0).max(100),
  joint_source: z.enum(["joint", "analysis", "council", "none"]),
  listed: z.boolean(),
  /** 14 ajan ortalamasına göre sıralanan en iyi ürünler (en fazla 5). */
  products: z.array(ProductSchema),
  /** İstenen nihai ürün sayısı (5). */
  requested_top: z.number().int().min(1),
  /** İki bağımsız ilk-5 listesinin kaç üründe örtüştüğü (ölçülür; eksik sıra DOLDURULMAZ). */
  intersection_count: z.number().int().min(0),
  /**
   * Sonuç kümesi 14 AJAN ORTALAMASINA göre mi kuruldu (`council-average`), yoksa
   * ajan oyu hiç gelmediği için yalnız analiz hattı mı (`analysis-only`)?
   */
  rank_source: z.enum(["council-average", "analysis-only"]),
  /** Değerlendirilen finalist sayısı. */
  finalists: z.number().int().min(0),
  /** En az bir ajan oyu almış ürün sayısı. */
  evaluated: z.number().int().min(0),
  /** Dürüst uyarılar (eksik kesişim, ajan oyu yok, canlı kanıt yok…). */
  notes: z.array(z.string()).default([]),
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

/** Katılım etiketi beyaz listeden mi? Bozuk veri `none`a düşer. */
function alignmentOf(value: unknown): CouncilAlignment {
  const known: CouncilAlignment[] = ["unanimous", "strong", "split", "contested", "none"];
  const raw = String(value ?? "");
  return known.includes(raw as CouncilAlignment) ? (raw as CouncilAlignment) : "none";
}

/**
 * Pazar erişimi kayıttan okunur; yoksa ÜRÜNÜN ADINDAN yeniden hesaplanır.
 * Böylece geçmiş koşuların kaydı eksik olsa bile kart boş kalmaz.
 */
function marketReachOf(
  value: unknown,
  title: string,
  category: string,
  platform: string,
): MarketReach | undefined {
  if (value && typeof value === "object") {
    const parsed = ProductSchema.shape.marketReach.safeParse(value);
    if (parsed.success) return parsed.data as MarketReach;
  }
  if (!title) return undefined;
  return marketReach({ platform, productText: `${title} ${category ?? ""}` });
}

function trackRecordOf(value: unknown):
  | {
      title: string;
      appearances: number;
      avgScore: number;
      bestRank: number;
      lastSeenDay: string;
      daysSinceSeen: number;
    }
  | undefined {
  const parsed = ProductSchema.shape.trackRecord.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

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
      // Kalıcı kovanın (radar_items) payload'ı, geçici durum TTL'i dolsa bile
      // karneyi kayıpsız geri kurmaya yetecek kadar bilgi taşır.
      payload: {
        run_id: dto.run_id,
        joint_score: dto.joint_score,
        run_analysis_score: dto.analysis_score,
        run_council_average: dto.council_average,
        rank: product.rank,
        source: product.source,
        rank_source: dto.rank_source,
        intersection_count: dto.intersection_count,
        requested_top: dto.requested_top,
        finalists: dto.finalists,
        evaluated: dto.evaluated,
        live: dto.evidence.live,
        scraped_trends: dto.evidence.scraped_trends,
        candidate_id: product.candidateId ?? null,
        product_identity: product.identity ?? null,
        product_analysis_score: product.analysisScore ?? null,
        product_council_score: product.councilScore ?? null,
        product_council_votes: product.councilVotes ?? null,
        product_council_coverage: product.councilCoverage ?? null,
        product_verification: product.verification ?? null,
        product_council_spread: product.councilSpread ?? null,
        product_council_alignment: product.councilAlignment ?? null,
        product_market_reach: product.marketReach ?? null,
        product_track_record: product.trackRecord ?? null,
        risks: product.risks,
      } as Json,
    };
  });
}

/**
 * KOŞU DURUMUNDAN KAZANAN KARNESİ — tamamen deterministik ve saftır.
 *
 * Sıralama KURALI (kullanıcı isteği): nihai liste 14 ajanın ÜRÜN BAŞINA verdiği
 * puanların ORTALAMASINA göre kurulur. Ortalama tek başına kullanılmaz; iki ölçülebilir
 * güven çarpanı ile düzeltilir (`velora-council-score.ts`):
 *   • KATILIM — kaç ajan gerçekten oy verdi (az oy = cezalı),
 *   • UZLAŞMA — oyların yayılımı (bölünmüş konsey = cezalı).
 *
 * Bağımsız analiz hattı kararı BOZMAZ: yalnız eşitlik bozucudur ve konsey
 * hiç oy vermediyse kararın tamamıdır (bu durum `rank_source: "analysis-only"`
 * ile dürüstçe etiketlenir).
 *
 * Aday havuzu iki bağımsız hattın ilk `VELORA_PIPELINE_TOP_N` listesinin
 * BİRLEŞİMİDİR: hiçbir ajan oyu gelmezse liste boş kalmaz, ama sonuç
 * "yalnız analiz hattı" diye işaretlenir. Eksik sıra DOLDURULMAZ.
 */
export function buildWinnerDossier(state: VeloraRunState): WinnerDto {
  const councilAverage = councilAverageOf(state.phases);
  const analysis = veloraAnalysisScore(state);
  const joint = combineJointScores({ analysisScore: analysis, councilScore: councilAverage });
  const consensus = productConsensus(state);
  const notes: string[] = [];
  const agentCount = Math.max(1, plannedAgentCount());

  // HAT A — AI ANALİZ HATTI: ürünün KENDİ kanıtına dayanır (konsey girdisi yok).
  const analysisRanked = (state.candidates as unknown as RetrieverCandidate[])
    .map((candidate, index) => {
      const candidateId = candidateIdOf(candidate as unknown as Record<string, unknown>, index);
      return {
        candidate,
        candidateId,
        identity: normalizeProductIdentity(String(candidate.name ?? "")),
        analysisScore: analysisScoreFor(state, candidateId, analysisOnlyScore(candidate)),
      };
    })
    .sort((a, b) => b.analysisScore - a.analysisScore || a.identity.localeCompare(b.identity));

  // HAT B — 14 AJANLI KONSEY HATTI: ajanların ürün başına oyları.
  const councilRanked = analysisRanked
    .filter((row) => consensus.has(row.candidateId))
    .map((row) => ({ ...row, councilScore: consensus.get(row.candidateId)!.councilScore }))
    .sort((a, b) => b.councilScore - a.councilScore || a.identity.localeCompare(b.identity));

  const analysisTop = analysisRanked.slice(0, VELORA_PIPELINE_TOP_N);
  const councilTop = councilRanked.slice(0, VELORA_PIPELINE_TOP_N);
  const councilTopIds = new Set(councilTop.map((row) => row.candidateId));
  const overlapCount = analysisTop.filter((row) => councilTopIds.has(row.candidateId)).length;
  const hasCouncilLine = councilTop.length > 0;
  const rankSource: WinnerRankSource = hasCouncilLine ? "council-average" : "analysis-only";

  if (consensus.size === 0) notes.push("AGENT_CONSENSUS_UNAVAILABLE");
  else if (overlapCount === 0) notes.push("NO_PRODUCT_INTERSECTION");
  if (!state.live) notes.push("LIVE_EVIDENCE_UNAVAILABLE");
  if (!state.evidenceByLine.analysis.block) notes.push("SHARED_EVIDENCE_EMPTY");
  if (state.harvestError) notes.push(`HARVEST_FAILED:${state.harvestError.slice(0, 80)}`);
  const thinVotes = [...consensus.values()].filter(
    (entry) => entry.votes < Math.ceil(agentCount * VELORA_MIN_AGENT_COVERAGE),
  ).length;
  if (thinVotes > 0) notes.push(`THIN_AGENT_COVERAGE:${thinVotes}`);

  // ADAY HAVUZU: iki bağımsız hattın ilk-N listelerinin birleşimi. Konsey oyu
  // olmayan adaylar da havuzda kalır — karar saf fonksiyonda dürüstçe
  // "analysis-only" işaretlenir.
  const selected = new Map<string, (typeof analysisRanked)[number]>();
  for (const row of [...analysisTop, ...councilTop]) selected.set(row.candidateId, row);

  const ranked = [...selected.values()]
    .map((row) => {
      const entry = consensus.get(row.candidateId);
      // NİHAİ PUAN = 14 ajan ortalaması × güven (katılım × uzlaşma).
      const verdict = councilFinalScore({
        councilScore: entry?.councilScore ?? 0,
        votes: entry?.votes ?? 0,
        spread: entry?.spread ?? 0,
        agentCount,
        analysisScore: row.analysisScore,
      });
      const verification: "verified" | "unverified" | "unknown" =
        !entry || entry.coverage < VELORA_MIN_AGENT_COVERAGE
          ? "unknown"
          : state.live
            ? "verified"
            : "unverified";
      const candidate = row.candidate as unknown as Record<string, unknown>;
      const productName = String(candidate["name"] ?? state.query);
      const productCategory = String(candidate["category"] ?? "");
      // Pazar erişimi kural tabanlıdır (kanal pazarı + bilinen sertifika
      // bariyerleri); ek AI çağrısı YOK, maliyet sıfır.
      const reach = marketReach({
        platform: state.platform || "General",
        productText: `${productName} ${productCategory}`,
      });
      // Geçmiş performans: aynı ürünün önceki koşularda nasıl durduğu. Anahtar
      // ham ad DEĞİL, normalize parmak izidir — farklı yazımlar aynı üründür.
      const history = state.trackRecord?.[normalizeProductIdentity(productName)];
      return {
        row,
        entry,
        verification,
        verdict,
        product: ProductSchema.parse({
          name: productName,
          category: productCategory,
          priceRange: String(candidate["priceRange"] ?? ""),
          estimatedMarginPct: Number(candidate["estimatedMarginPct"] ?? 0),
          demandScore: clampScore(candidate["demandScore"]),
          competitionScore: clampScore(candidate["competitionScore"]),
          sentiment: String(candidate["sentiment"] ?? ""),
          whyNow: String(candidate["whyNow"] ?? ""),
          risks: Array.isArray(candidate["risks"]) ? candidate["risks"].map(String) : [],
          councilScore: entry?.councilScore ?? 0,
          councilDecision: verdict.score >= 60 ? "LISTED" : `REVIEW_${entry?.councilScore ?? 0}`,
          winnerScore: verdict.score,
          rank: 1,
          source:
            candidate["source"] === "trend-radar"
              ? "trend-radar"
              : candidate["source"] === "fallback"
                ? "fallback"
                : "ai",
          candidateId: row.candidateId,
          identity: row.identity,
          analysisScore: row.analysisScore,
          councilVotes: entry?.votes ?? 0,
          councilCoverage: entry?.coverage ?? 0,
          councilSpread: entry?.spread ?? 0,
          councilMin: entry?.minScore ?? 0,
          councilMax: entry?.maxScore ?? 0,
          councilAlignment: entry?.alignment ?? "none",
          councilConfidence: verdict.confidence,
          marketReach: reach as MarketReach,
          trackRecord: history
            ? {
                title: history.title,
                appearances: history.appearances,
                avgScore: history.avgScore,
                bestRank: history.bestRank,
                lastSeenDay: history.lastSeenDay,
                daysSinceSeen: history.daysSinceSeen,
              }
            : undefined,
          agentEvidence: entry?.evidence ?? [],
          verification,
        }),
      };
    })
    .sort((a, b) =>
      councilRankKey({
        verdict: a.verdict,
        councilScore: a.entry?.councilScore ?? 0,
        votes: a.entry?.votes ?? 0,
        analysisScore: a.row.analysisScore,
        identity: a.row.identity,
      }).localeCompare(
        councilRankKey({
          verdict: b.verdict,
          councilScore: b.entry?.councilScore ?? 0,
          votes: b.entry?.votes ?? 0,
          analysisScore: b.row.analysisScore,
          identity: b.row.identity,
        }),
      ),
    );

  // KALİTE KAPISI: yedek metinler (gerçek ürün DEĞİL) nihai listeye ALINMAZ;
  // eksik sıra DOLDURULMAZ. Konsey oyu olmayan aday da "14 ajan ortalaması"
  // iddiası taşıyamaz, bu yüzden o koşulda liste bilinçli olarak kısalabilir.
  const qualified = ranked.filter(
    (item) => item.product.source !== "fallback" && item.verdict.score >= VELORA_MIN_PRODUCT_SCORE,
  );
  const gateDropped = ranked.length - qualified.length;
  if (gateDropped > 0) notes.push(`QUALITY_GATE_DROPPED:${gateDropped}`);
  const products: Product[] = qualified
    .slice(0, VELORA_TOP_N)
    .map((item, index) => ({ ...item.product, rank: index + 1 }));

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
    listed: products.some((product) => product.winnerScore >= 60),
    products,
    requested_top: VELORA_TOP_N,
    intersection_count: overlapCount,
    rank_source: rankSource,
    finalists: state.candidates.length,
    evaluated: consensus.size,
    notes,
    evidence: {
      live: state.live,
      scraped_trends: state.scrapedTrends.length,
      radar: state.scrapedTrends.slice(0, 16),
    },
    phases: state.phases.map((phase) => ({
      id: phase.id,
      key: phase.key,
      name: phase.name,
      ms: phase.ms,
      within_ceiling: phase.withinCeiling,
      agents: phase.agents.length,
    })),
  });
}

/**
 * Kalıcı kazanan kayıtlarından karneyi geri kurar.
 *
 * Geçici kovanın (ai_cache) TTL'i dolduğunda panelin boş kalmaması için: sonuç
 * ürünleri `radar_items` payload'ında kalıcıdır ve kayıpsız geri okunabilir.
 * Geri kurulamayan alanlar (ör. ajan gerekçe metinleri) dürüstçe `notes` ile
 * bildirilir; uydurulmaz.
 */
export function dossierFromWinnerRows(runId: string, rows: readonly WinnerRow[]): WinnerDto | null {
  if (rows.length === 0) return null;
  const payloadOf = (row: WinnerRow): Record<string, unknown> =>
    row.payload && typeof row.payload === "object" ? (row.payload as Record<string, unknown>) : {};
  const numberOr = (value: unknown, fallback: number) =>
    Number.isFinite(Number(value)) ? Number(value) : fallback;
  const first = payloadOf(rows[0]!);
  const sorted = [...rows].sort(
    (a, b) =>
      Math.round(numberOr(payloadOf(a)["rank"], 99)) -
        Math.round(numberOr(payloadOf(b)["rank"], 99)) || b.winner_score - a.winner_score,
  );
  const products: Product[] = sorted.slice(0, VELORA_TOP_N).map((row, index) => {
    const payload = payloadOf(row);
    const verification = ["verified", "unverified", "unknown"].includes(
      String(payload["product_verification"]),
    )
      ? (String(payload["product_verification"]) as "verified" | "unverified" | "unknown")
      : "unverified";
    const source = ["ai", "trend-radar", "fallback"].includes(String(payload["source"]))
      ? (String(payload["source"]) as "ai" | "trend-radar" | "fallback")
      : "ai";
    return ProductSchema.parse({
      name: row.title,
      category: row.category,
      priceRange: row.price_max > 0 ? `${row.price_min} - ${row.price_max}` : "",
      estimatedMarginPct: Math.max(0, Math.round(Number(row.est_margin_pct) || 0)),
      demandScore: clampScore(row.momentum),
      competitionScore: 50,
      sentiment: "",
      whyNow: row.reason ?? "",
      risks: Array.isArray(payload["risks"]) ? (payload["risks"] as unknown[]).map(String) : [],
      councilScore: clampScore(numberOr(payload["product_council_score"], 0), 0),
      councilDecision: numberOr(payload["product_council_score"], 0) > 0 ? "LISTED" : "REVIEW_0",
      winnerScore: clampScore(row.winner_score, 0),
      rank: Math.max(1, Math.round(numberOr(payload["rank"], index + 1))),
      source,
      candidateId: String(payload["candidate_id"] ?? `C${index + 1}`),
      identity: String(payload["product_identity"] ?? normalizeProductIdentity(row.title)),
      analysisScore: clampScore(numberOr(payload["product_analysis_score"], 0), 0),
      councilVotes: Math.max(0, Math.round(numberOr(payload["product_council_votes"], 0))),
      councilCoverage: Math.max(0, Math.min(1, numberOr(payload["product_council_coverage"], 0))),
      councilSpread: Math.max(0, numberOr(payload["product_council_spread"], 0)),
      councilAlignment: alignmentOf(payload["product_council_alignment"]),
      marketReach: marketReachOf(
        payload["product_market_reach"],
        row.title,
        row.category,
        row.platform,
      ),
      trackRecord: trackRecordOf(payload["product_track_record"]),
      agentEvidence: [],
      verification,
    });
  });

  return WinnerDtoSchema.parse({
    run_id: runId,
    query: rows[0]!.niche,
    country: rows[0]!.country,
    platform: rows[0]!.platform,
    generated_at: `${rows[0]!.day}T00:00:00.000Z`,
    council_average: clampScore(numberOr(first["run_council_average"], 0), 0),
    analysis_score: clampScore(numberOr(first["run_analysis_score"], 0), 0),
    joint_score: clampScore(numberOr(first["joint_score"], 0), 0),
    joint_source: "joint",
    listed: rows.some((row) => row.winner_score >= 60),
    products,
    requested_top: Math.max(1, Math.round(numberOr(first["requested_top"], VELORA_TOP_N))),
    intersection_count: Math.max(0, Math.round(numberOr(first["intersection_count"], 0))),
    rank_source: first["rank_source"] === "council-average" ? "council-average" : "analysis-only",
    finalists: Math.max(0, Math.round(numberOr(first["finalists"], products.length))),
    evaluated: Math.max(0, Math.round(numberOr(first["evaluated"], 0))),
    notes: ["RECOVERED_FROM_WINNER_LEDGER", "AGENT_EVIDENCE_NOT_RECOVERABLE"],
    evidence: {
      live: first["live"] === true,
      scraped_trends: Math.max(0, Math.round(numberOr(first["scraped_trends"], 0))),
      radar: [],
    },
    phases: [],
  });
}

// ---------------------------------------------------------------------------
// Depo (Supabase) — geçici durum + kalıcı kazanan kaydı
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
  pushWinners(rows: WinnerRow[]): Promise<VeloraPushResult>;
  /** SELF-TEST: yazılan kayıtları geri okur. */
  fetchWinners(day: string, titles: string[]): Promise<WinnerRow[]>;
  /** KALICI KOVAN: bir koşunun kazanan kayıtlarını `runId` ile geri okur. */
  fetchRunWinners(runId: string): Promise<WinnerRow[]>;
};

/** Geçici koşu durumunun anahtarı (`ai_cache` = mevcut TTL'li geçici kova). */
export function runStateKey(runId: string): string {
  return `velora-run:${runId}`;
}

/**
 * Geçici durumun TTL'i (ms).
 *
 * Koşu 4 fazda saniyeler içinde biter ama panel/worker gecikirse ya da QStash bir
 * fazı saatler sonra tekrar teslim ederse durum kaybolmamalı: 24 saat, koşunun
 * tamamının (ve yeniden teslimlerin) üzerinde geniş bir güvenlik payıdır. Nihai
 * sonuç zaten `radar_items`'ta kalıcıdır.
 */
export const VELORA_STATE_TTL_MS = 24 * 60 * 60 * 1000;

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
        expires_at: new Date(Date.now() + VELORA_STATE_TTL_MS).toISOString(),
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

    async fetchRunWinners(runId) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data, error } = await supabaseAdmin
        .from("radar_items")
        .select("*")
        .filter("payload->>run_id", "eq", runId);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as WinnerRow[];
    },
  };
}

// ---------------------------------------------------------------------------
// ORKESTRASYON — faza faza ilerle, aradaki devri QStash ile yap
// ---------------------------------------------------------------------------

/**
 * FAZ 0 — 14 AJAN DEVREYE GİRMEDEN ÖNCEKİ NİŞ KAZIMASI.
 *
 * Seçilen niş için gerçek veri toplar (bkz. `velora-niche-scrape.server.ts`):
 * Google Trends momentum, Reddit talebi + şikâyetleri, Hacker News, Google News,
 * gözlenen marketplace fiyatları, AliExpress tedarik maliyeti, trend radarı ve
 * GitHub. Her kaynak `active`/`error` olarak raporlanır; hiçbiri hattı düşüremez.
 *
 * NEDEN AYRI ADIM: kazıma ağ işidir, ajanlar model işidir. Aynı istek içinde
 * koşsalardı yavaş bir kaynak 14 ajanın burst bütçesini yerdi. Ayrı adımda
 * kazımanın kendi tavanı, kaydı ve QStash devri vardır; Faz 1 yalnızca hazır
 * kanıtla açılır.
 *
 * İKİ HAT NEDEN AYRI GÖRÜNÜYOR: iki hat aynı kazımayı okur ama kararı
 * BAĞIMSIZ verir (retriever/analiz hattı konsey oylarını hiç görmez). Aynı
 * kazımayı iki kez ÇEKMİYORUZ: bu yalnız iki kat ağ yükü ve iki kat bekleme
 * demekti, fazladan bilgi değil.
 */
async function runHarvestPhase(state: VeloraRunState, deps: VeloraOrchestratorDeps): Promise<void> {
  const harvest = deps.harvest ?? harvestNicheSignalsCached;
  let signals: NicheSignals;
  try {
    const outcome = await harvest({
      niche: state.query,
      country: state.country,
      platform: state.platform,
    });
    signals = NicheSignalsSchema.parse(outcome.data);
  } catch (error) {
    // Kazıma hattı tamamen çökerse hata DÜŞÜRÜLMEZ: boş ama geçerli kanıtla
    // konsey çalışır ve sonuç "unverified" olarak işaretlenir.
    signals = emptyNicheSignals({
      niche: state.query,
      country: state.country,
      platform: state.platform,
    });
    state.harvestError = error instanceof Error ? error.message : String(error);
  }

  state.nicheSignals = signals;
  const block = nicheSignalsBlock(signals);
  const snapshot: VeloraEvidenceSnapshot = { block, radar: signals.radar, live: signals.live };
  state.evidenceByLine = { analysis: snapshot, council: snapshot };
  state.scrapedTrends = signals.radar;
  state.evidenceBlock = block;
  state.live = signals.live;
}

/**
 * Analiz hattının ADAY SNAPSHOT'ı: bu koşunun finalistleri.
 *
 * Tek atıştır (relaxation döngüsü monotlitte kalır) — faz tavanı içinde kalması
 * gerekir. AI boş dönerse kazınmış gerçek trend adları ve son çare yedekleri
 * kullanılır; hiçbir koşulda uydurma ürün adı yazılmaz. Her adaya koşu boyunca
 * DEĞİŞMEYEN bir kimlik (`C1`…) verilir: 14 ajanın ürün başına puanları ve iki
 * hattın kesişimi bu kimlikler üzerinden eşleştirilir.
 */
async function retrieveCandidates(state: VeloraRunState, deps: VeloraOrchestratorDeps) {
  const run = deps.runAgent ?? executeAgentWithFallback;
  const analysisEvidence = state.evidenceByLine.analysis; // line-specific snapshot
  const prompt = `You are the Product Retriever for Aroless. Name real, specific, buyable products for the query.
QUERY: ${state.query}
COUNTRY: ${state.country || "GLOBAL"}
PLATFORM: ${state.platform || "any"}
${
  analysisEvidence.block
    ? `\nANALYSIS-LINE SCRAPING EVIDENCE (this line's independent trend radar + live market scrape; the 14-member council uses a separate snapshot):\n${analysisEvidence.block.slice(0, 3_000)}\n`
    : "\nANALYSIS-LINE SCRAPING EVIDENCE: this line's independent scrape returned no data.\n"
}
QUALITY BAR (bu koşunun amacı GERÇEKTEN iyi ürünler göstermek — zayıf aday listeye girmemeli):
- Yalnızca GERÇEK, SOMUT ve satın alınabilir ürünler döndür (ör. "katlanabilir silikon su şişesi 750ml"), asla geniş kategori ("ev gereçleri", "aksesuar") veya "için alternatif" gibi dolgu metni.
- Uydurma marka/model adı ve doğrulanamayan sayı YASAK. Emin değilsen aralık ver.
- Her ürün için: gerçekçi fiyat bandı, paylaşılan kanıta dayanan SOMUT bir "neden şimdi", ve en az bir gerçek risk.
- Talebi ANALYSIS-LINE SCRAPING EVIDENCE içinde görünen ürünleri tercih et; her aday birbirinden FARKLI olmalı.
- ${VELORA_FINALIST_COUNT} adaya kadar DÖN. Konsey 14 ajandan oluşuyor ve havuzu tümüyle puanlayacak: yakın varyantları tekrarlamak yerine farklı segment, fiyat kademesi, format ve kullanım senaryolarını kapsa. Beş benzer ürün beş farklı üründen değersizdir.
- Kaliteli aday azsa daha az ürün döndürmek, uydurmaktan iyidir.
Return at most ${VELORA_FINALIST_COUNT} products, each specific and buyable. Never return markdown. Return ONLY JSON:
{"candidates":[{"name":string,"category":string,"priceRange":string,"estimatedMarginPct":number,"demandScore":number,"competitionScore":number,"sentiment":string,"whyNow":string,"risks":string[]}]}`;

  const named: Record<string, unknown>[] = [];
  const controller = new AbortController();
  try {
    const result = await withCeiling(
      run("Product Retriever", prompt, DEEP_CHAIN, {
        temperature: 0.35,
        retries: 1,
        signal: controller.signal,
      }),
      Math.max(1, Math.floor((deps.phaseCeilingMs ?? VELORA_PHASE_CEILING_MS) * 0.75)),
      "velora:retriever",
      () => controller.abort(),
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

  const seen = new Set(named.map((c) => normalizeProductIdentity(String(c["name"]))));
  const pool = [...named];
  for (const candidate of scrapedCandidates(state.evidenceByLine.analysis.radar)) {
    const identity = normalizeProductIdentity(candidate.name);
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
  state.candidates = pool.slice(0, VELORA_FINALIST_COUNT).map((candidate, index) => ({
    ...candidate,
    candidateId: `C${index + 1}`,
  }));

  // SONUÇ GERİ BİLDİRİM: bu adayların önceki koşulardaki performansı. Ajanlar
  // karar verirken görür; okunamazsa boş geçilir (hat engellenmez).
  const loadHistory = deps.fetchTrackRecord ?? fetchTrackRecords;
  try {
    state.trackRecord = await loadHistory({
      titles: state.candidates.map((c) => String(c["name"] ?? "")),
      country: state.country,
      platform: state.platform,
    });
  } catch {
    state.trackRecord = {};
  }
}

/**
 * Ürünün ANALİZ HATTI puanı: bağımsız AI turu bir puan verdiyse O, yoksa
 * deterministik kanıt formülü. Böylece sıralama hiçbir koşulda boş kalmaz ve
 * AI turu tamamlanmadığında hat dürüstçe "formül" moduna düşer.
 */
export function analysisScoreFor(
  state: VeloraRunState,
  candidateId: string,
  fallback: number,
): number {
  const entry = state.analysisLine.find((row) => row.candidateId === candidateId);
  if (!entry) return clampScore(fallback);
  return clampScore(entry.score);
}

/**
 * HAT A — BAĞIMSIZ AI ANALİZ HATTI (14 ajanla AYNI ANDA koşar).
 *
 * NEDEN AYRI TUR: 14 ajanlı konsey ürünleri kendi oylarıyla sıralar. Analiz
 * hattı eskiden yalnız deterministik formülle (`analysisOnlyScore`) sıralıyordu;
 * yani %30'luk ağırlık gerçek bir AI yorumuna değil hesaba dayanıyordu. Bu tur
 * finalistleri KENDİ BAĞIMSIZ scraping snapshot'ıyla puanlar. 14 ajan kendi
 * ayrı council snapshot'ını görür; iki hat birbirinin kazıma sonucunu paylaşmaz.
 *
 * ZAMAN SÖZÜ: faz tavanına bağlıdır ve Faz 1 ajanlarıyla PARALEL yürür; tavan
 * dolarsa tur iptal edilir, formül puanı yazılır ve koşu ASLA düşmez.
 */
async function runAnalysisLine(state: VeloraRunState, deps: VeloraOrchestratorDeps): Promise<void> {
  const candidates = state.candidates.slice(0, VELORA_FINALIST_COUNT);
  if (candidates.length === 0) return;

  const candidateIdAt = (index: number) =>
    candidateIdOf(candidates[index] as unknown as Record<string, unknown>, index);

  /** Tur tamamlanmazsa dürüstçe formül puanı — `source: "heuristic"`. */
  const heuristicEntry = (index: number): VeloraAnalysisEntry => {
    const candidate = candidates[index] as unknown as RetrieverCandidate & Record<string, unknown>;
    const name = String(candidate.name ?? "").trim();
    return {
      candidateId: candidateIdAt(index),
      identity: normalizeProductIdentity(name),
      name,
      score: clampScore(analysisOnlyScore(candidate)),
      reason: "Deterministik kanıt formülü (AI analiz turu tamamlanamadı).",
      source: "heuristic",
    };
  };
  const heuristic = (): VeloraAnalysisEntry[] =>
    candidates.map((_, index) => heuristicEntry(index));

  const list = candidates
    .map((candidate, index) => {
      const risks = Array.isArray(candidate["risks"]) ? (candidate["risks"] as unknown[]) : [];
      return [
        `${candidateIdAt(index)}: ${String(candidate["name"] ?? "").trim()}`,
        `   price=${String(candidate["priceRange"] ?? "-")} · margin=${String(candidate["estimatedMarginPct"] ?? "-")}% · demand=${String(candidate["demandScore"] ?? "-")} · competition=${String(candidate["competitionScore"] ?? "-")}`,
        `   whyNow=${String(candidate["whyNow"] ?? "-")}`,
        `   risks=${risks.map(String).join("; ") || "-"}`,
      ].join("\n");
    })
    .join("\n");

  // Yalnizca KENDI hat snapshot'i: 14 ajan ayri bir council kazimasi goruyor,
  // bu yuzden birlesik `evidenceBlock` bilerek kullanilmaz.
  const analysisEvidence = state.evidenceByLine.analysis;
  const prompt = `You are the INDEPENDENT AI ANALYSIS LINE for Aroless. A separate 14-member council scores these SAME finalists in parallel with its own independent scrape; your verdict must be YOUR OWN — never assume anyone else's score.
QUERY: ${state.query}
COUNTRY: ${state.country || "GLOBAL"}
PLATFORM: ${state.platform || "any"}
${
  state.evidenceBlock
    ? `\nANALYSIS-LINE SCRAPING EVIDENCE (this line's own trend radar + live market scrape):\n${analysisEvidence.block.slice(0, 2_000)}\n`
    : "\nANALYSIS-LINE SCRAPING EVIDENCE: this line's independent scrape returned no data.\n"
}
FINALISTS:
${list}

Score EVERY finalist 0-100 for: would this really make money in this country/platform right now?
Rules:
- Ground every score in the LIVE EVIDENCE and the finalist's own numbers; never invent metrics.
- Be discriminating and use the full range: saturated competition, thin margin or weak evidence must pull the score DOWN.
- A vague or undifferentiated product must never score high.
Return ONLY JSON:
{"scores":[{"id":"C1","score":0,"reason":"short, concrete justification"}]}`;

  const run = deps.runAgent ?? executeAgentWithFallback;
  const controller = new AbortController();
  const ceiling = Math.max(500, deps.phaseCeilingMs ?? VELORA_PHASE_CEILING_MS);
  try {
    const result = await withCeiling(
      run("Analysis Line", prompt, DEEP_CHAIN, {
        temperature: 0.25,
        retries: 1,
        signal: controller.signal,
      }),
      ceiling,
      "velora:analysis-line",
      () => controller.abort(),
    );
    const parsed = parseAgentJson<{ scores?: unknown[] }>(result.text, {});
    const votes = new Map<string, { score: number; reason: string }>();
    for (const raw of parsed.scores ?? []) {
      if (!raw || typeof raw !== "object") continue;
      const value = raw as Record<string, unknown>;
      const id = String(value.id ?? value.candidateId ?? "").trim();
      const score = Number(value.score);
      if (!id || !Number.isFinite(score)) continue;
      votes.set(id.toLocaleLowerCase("tr-TR"), {
        score: clampScore(score),
        reason: String(value.reason ?? "").slice(0, 240),
      });
    }
    if (votes.size === 0) {
      // AI yanıt verdi ama puan üretmedi: uydurma sıfır yazmak yerine formüle düş.
      state.analysisLine = heuristic();
      return;
    }
    state.analysisLine = candidates.map((candidate, index) => {
      const candidateId = candidateIdAt(index);
      const name = String(candidate["name"] ?? "").trim();
      const identity = normalizeProductIdentity(name);
      const hit =
        votes.get(candidateId.toLocaleLowerCase("tr-TR")) ??
        votes.get(identity) ??
        votes.get(name.toLocaleLowerCase("tr-TR"));
      if (!hit) return heuristicEntry(index);
      return {
        candidateId,
        identity,
        name,
        score: hit.score,
        reason: hit.reason,
        source: "ai" as const,
      };
    });
  } catch {
    controller.abort();
    state.analysisLine = heuristic();
  }
}

export type VeloraRunResult = {
  runId: string;
  status: "completed" | "dispatched" | "failed";
  completedPhases: number;
  nextPhase?: VeloraPhaseId;
  dispatch: VeloraHandoff;
  dossier?: WinnerDto;
  push?: VeloraPushResult;
  selfTest?: VeloraSelfTestReport;
  /** Bu teslim yeni iş üretmedi: faz zaten kayıtlı ya da hâlâ koşuyor. */
  deduped?: boolean;
  error?: string;
};

/**
 * Bir koşuyu `fromPhase`ten itibaren sürer.
 *
 * IDEMPOTENT: kayıtlı bir faz YENİDEN koşmaz (QStash retry AI kotasını iki kez
 * harcayamaz). Her faz başlamadan önce `runningPhase` yazılır; böylece eşzamanlı
 * ikinci teslim aynı fazı ikinci kez başlatamaz (bkz. `resumeVeloraRun`).
 *
 * Her faz kaydedildikten sonra: QStash devri varsa SONRAKİ FAZ YAYINLANIR ve
 * fonksiyon ANINDA döner (istatistiksel mikro-adım). Devir yoksa aynı istek
 * içinde devam edilir; toplam süre yine faz tavanlarıyla sınırlıdır.
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
      if (state.phases.some((recorded) => recorded.id === id)) {
        // Kayıtlı faz: tekrar koşmadan sonraki adıma geç (retry-safe).
        continue;
      }

      state.runningPhase = { id, startedAtMs: Date.now() };
      state.updatedAtMs = Date.now();
      await deps.store.saveState(state);

      // FAZ 0: AI çağrısı yok, yalnız niş kazıması. Ürün snapshot'ı ve 14 ajan
      // bundan SONRA kurulur; kazıma ile model burst'ü asla yarışmaz.
      if (id === 0) {
        const harvestStarted = Date.now();
        await runHarvestPhase(state, deps);
        const harvestMs = Date.now() - harvestStarted;
        state.phases = [
          ...state.phases.filter((p) => p.id !== id),
          {
            id,
            key: phase.key,
            name: phase.name,
            ms: harvestMs,
            withinCeiling: harvestMs <= (deps.phaseCeilingMs ?? VELORA_HARVEST_CEILING_MS),
            agents: [],
          },
        ];
        state.runningPhase = null;
        state.updatedAtMs = Date.now();
        await deps.store.saveState(state);
        if (deps.handoff) {
          const published = await deps.handoff({ runId: state.runId, phase: 1 });
          if (published.ok) {
            return {
              runId: state.runId,
              status: "dispatched",
              completedPhases: 0,
              nextPhase: 1,
              dispatch: published,
            };
          }
          dispatch = published;
        }
        continue;
      }

      // Ürün snapshot'ı yoksa (eski/yarım durum) finalistleri burada kur.
      if (id === 1 || state.candidates.length === 0) await retrieveCandidates(state, deps);

      const result = await runVeloraPhase(phase, state, deps);
      state.phases = [...state.phases.filter((p) => p.id !== id), result].sort(
        (a, b) => a.id - b.id,
      );
      state.runningPhase = null;
      state.updatedAtMs = Date.now();
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
    state.push = push;
    state.runningPhase = null;
    state.updatedAtMs = Date.now();
    await deps.store.saveState(state);

    // SORGUL ÖNBELEĞİ: yalnızca TAMAMLANAN koşu yazılır, üstelik KULLANICIYA ÖZEL
    // (anahtar kullanıcı kimliğini içerir). Aynı nişi 24 saat içinde tekrar
    // çalıştıran kullanıcı 14 ajanı yeniden ücretlemeden önceki karneyi görür.
    if (state.requestedBy) {
      await writeVeloraQueryCache(
        {
          userId: state.requestedBy,
          query: state.query,
          country: state.country,
          platform: state.platform,
        },
        state.runId,
      );
    }
    const selfTest = await selfTestVeloraRun(state, { store: deps.store, dossier, push });
    state.selfTest = selfTest;
    await deps.store.saveState(state);
    return {
      runId: state.runId,
      status: "completed",
      completedPhases: VELORA_PHASES.length,
      dispatch,
      dossier,
      push,
      selfTest,
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    state.status = "failed";
    state.runningPhase = null;
    state.updatedAtMs = Date.now();
    await deps.store.saveState(state).catch(() => {});
    return {
      runId: state.runId,
      status: "failed",
      completedPhases: state.phases.length,
      dispatch,
      error,
    };
  }
}

/** Yeni bir koşu açar: ORTAK kanıtı toplar, finalistleri belirler, Faz 1'i koşar ve devreder. */
export async function startVeloraRun(
  input: unknown,
  deps: VeloraOrchestratorDeps,
): Promise<VeloraRunResult> {
  const parsed = VeloraInputSchema.parse(input);
  const state: VeloraRunState = {
    runId:
      parsed.runId ?? `velora_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    query: parsed.userQuery,
    country: (parsed.country ?? "GLOBAL").toUpperCase(),
    platform: parsed.platform ?? "General",
    language: parsed.language,
    startedAtMs: Date.now(),
    updatedAtMs: Date.now(),
    status: "running",
    nicheSignals: emptyNicheSignals({
      niche: parsed.userQuery,
      country: (parsed.country ?? "GLOBAL").toUpperCase(),
      platform: parsed.platform ?? "General",
    }),
    harvestError: "",
    evidenceByLine: {
      analysis: emptyEvidenceSnapshot(),
      council: emptyEvidenceSnapshot(),
    },
    evidenceBlock: "",
    scrapedTrends: [],
    live: false,
    candidates: [],
    analysisLine: [],
    trackRecord: {},
    requestedBy: parsed.requestedBy ?? null,
    phases: [],
    runningPhase: null,
    push: null,
    selfTest: null,
  };
  await deps.store.saveState(state);
  // FAZ 0 kazıması 14 ajandan ÖNCE koşar (drive → phase 0) ve ölçülen kanıtı
  // duruma yazar; Faz 1 yalnızca hazır kanıtla açılır.
  return drive(state, 0, deps, { ok: true, mode: deps.handoff ? "qstash" : "inline" });
}

/**
 * QStash geri çağrısı: kaydedilmiş durumu yükler ve `phase`i koşar.
 *
 * Tekrar teslim güvenliği iki katmanlıdır:
 *  1. `phase` zaten kayıtlıysa hiçbir ajan çağrılmaz (drive kayıtlı fazı atlar).
 *  2. Aynı faz hâlâ koşuyorsa (kilit içinde) ikinci teslim HİÇ başlatılmaz.
 */
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
    return {
      runId,
      status: "completed",
      completedPhases: state.phases.length,
      dispatch: { ok: true, mode: deps.handoff ? "qstash" : "inline" },
      deduped: true,
      dossier: buildWinnerDossier(state),
      ...(state.push ? { push: state.push } : {}),
      ...(state.selfTest ? { selfTest: state.selfTest } : {}),
    };
  }

  const running = state.runningPhase;
  if (running && running.id === phase && Date.now() - running.startedAtMs < VELORA_PHASE_LEASE_MS) {
    // Aynı faz HÂLÂ koşuyor: yeni iş üretme, çift AI harcamasını engelle.
    return {
      runId,
      status: "dispatched",
      completedPhases: state.phases.length,
      nextPhase: phase,
      dispatch: { ok: true, mode: deps.handoff ? "qstash" : "inline" },
      deduped: true,
    };
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
  requestedBy: z.string().trim().max(80).optional(),
});

// ---------------------------------------------------------------------------
// DURUM OKUMA — panel `runId` ile koşunun nerede olduğunu buradan öğrenir
// ---------------------------------------------------------------------------

export type VeloraRunPhaseSummary = {
  id: number;
  key: string;
  name: string;
  ms: number;
  withinCeiling: boolean;
  agents: number;
  timedOut: number;
};

export type VeloraRunStatus = {
  runId: string;
  status: "unknown" | "running" | "completed" | "failed";
  completedPhases: number;
  totalPhases: number;
  /** Hâlâ koşan faz (kilitli). */
  activePhase: number | null;
  /** Sıradaki faz (yoksa null → koşu bitti). */
  nextPhase: number | null;
  updatedAtMs: number;
  /** Uzun süredir ilerleme yok: panelin sonsuz yoklamasını engeller. */
  stale: boolean;
  pollIntervalMs: number;
  dossier: WinnerDto | null;
  push: VeloraPushResult | null;
  selfTest: VeloraSelfTestReport | null;
  phases: VeloraRunPhaseSummary[];
  /**
   * FAZ 0 KAZIMA TABLOSU — 14 ajan devreye girmeden ÖNCE hangi kaynaktan ne
   * geldi. Panel bunu gösterir çünkü "kanıt toplandı" demek, hangi kaynağın
   * öldüğünü gizlemek değildir: kaynak `error` ise ajan o alanda nötr puanlar.
   */
  harvest: {
    niche: string;
    live: boolean;
    sources: { name: string; status: "active" | "error"; items: number; detail: string }[];
    reddit: number;
    complaints: number;
    prices: number;
    priceMedianUsd: number | null;
    supplierLive: boolean;
    trendMomentumPct: number | null;
  } | null;
  /** Karne geçici kovadan değil, kalıcı kazanan kayıtlarından geri kuruldu. */
  recovered: boolean;
  notes: string[];
};

function phaseSummaries(state: VeloraRunState): VeloraRunPhaseSummary[] {
  return state.phases.map((phase) => ({
    id: phase.id,
    key: phase.key,
    name: phase.name,
    ms: phase.ms,
    withinCeiling: phase.withinCeiling,
    agents: phase.agents.length,
    timedOut: phase.agents.filter((agent) => agent.timedOut).length,
  }));
}

/**
 * Faz 0 kazıma özetini panel için düzleştirir.
 *
 * Burada "kaç kaynak öldü" bilgisi kasıtlı olarak KAYBOLMAZ. 14 ajanın
 * puanları bu tabloya dayandığı için, kullanıcının hangi alanda kanıt olmadığını
 * görmesi kararın güvenilirliği için zorunludur.
 */
function harvestSummary(state: VeloraRunState): VeloraRunStatus["harvest"] {
  const s = state.nicheSignals;
  if (!s || (!s.sources.length && !s.niche)) return null;
  return {
    niche: s.niche,
    live: s.live,
    sources: s.sources.map((row) => ({
      name: row.name,
      status: row.status,
      items: row.items,
      detail: row.detail,
    })),
    reddit: s.reddit.length,
    complaints: s.reddit.filter((r) => r.complaint).length,
    prices: s.priceSamples.length,
    priceMedianUsd: s.retailMedianUsd ?? null,
    supplierLive: Boolean(s.supplier?.live),
    trendMomentumPct: Number.isFinite(s.trendMomentumPct) ? s.trendMomentumPct : null,
  };
}

function nextMissingPhase(state: VeloraRunState): VeloraPhaseId | null {
  for (const phase of VELORA_PHASES) {
    if (!state.phases.some((recorded) => recorded.id === phase.id)) return phase.id;
  }
  return null;
}

/**
 * Koşu durumu + (tamamlandıysa) kazanan karne.
 *
 * Karne SAF bir fonksiyondur (`buildWinnerDossier`), bu yüzden ayrıca saklanmaz:
 * durum okunur ve gerekirse yerinde kurulur. Geçici kova silinmişse (TTL) nihai
 * sonuç kalıcı `radar_items` kayıtlarından geri kurulur ve `recovered: true` ile
 * dürüstçe işaretlenir.
 */
export async function veloraRunStatus(
  runId: string,
  deps: Pick<VeloraOrchestratorDeps, "store">,
): Promise<VeloraRunStatus> {
  const totalPhases = VELORA_PHASES.length;
  const base = {
    runId,
    totalPhases,
    pollIntervalMs: JOB_POLL_INTERVAL_MS,
  };
  const notes: string[] = [];

  let state: VeloraRunState | null = null;
  try {
    state = await deps.store.loadState(runId);
  } catch (e) {
    notes.push(`STATE_READ_FAILED:${e instanceof Error ? e.message : String(e)}`);
  }

  if (!state) {
    try {
      const rows = await deps.store.fetchRunWinners(runId);
      const dossier = dossierFromWinnerRows(runId, rows);
      if (dossier) {
        return {
          ...base,
          status: "completed",
          completedPhases: totalPhases,
          activePhase: null,
          nextPhase: null,
          updatedAtMs: 0,
          stale: false,
          dossier,
          push: { ok: true, ids: rows.map((row) => row.title) },
          selfTest: null,
          phases: [],
          harvest: null,
          recovered: true,
          notes: ["STATE_EXPIRED_USING_WINNER_LEDGER", ...dossier.notes],
        };
      }
    } catch (e) {
      notes.push(`LEDGER_READ_FAILED:${e instanceof Error ? e.message : String(e)}`);
    }
    return {
      ...base,
      status: "unknown",
      completedPhases: 0,
      activePhase: null,
      nextPhase: null,
      updatedAtMs: 0,
      stale: false,
      dossier: null,
      push: null,
      selfTest: null,
      phases: [],
      harvest: null,
      recovered: false,
      notes: ["RUN_STATE_NOT_FOUND", ...notes],
    };
  }

  const completed = state.status === "completed" || state.phases.length >= totalPhases;
  const dossier = completed ? buildWinnerDossier(state) : null;
  const updatedAtMs = state.updatedAtMs || state.startedAtMs;
  return {
    ...base,
    status: state.status,
    completedPhases: state.phases.length,
    activePhase: state.runningPhase?.id ?? null,
    nextPhase: state.status === "running" ? nextMissingPhase(state) : null,
    updatedAtMs,
    stale: state.status === "running" && Date.now() - updatedAtMs > VELORA_RUN_STALE_MS,
    dossier,
    push: state.push,
    selfTest: state.selfTest,
    phases: phaseSummaries(state),
    harvest: harvestSummary(state),
    recovered: false,
    notes: [...notes, ...(dossier?.notes ?? [])],
  };
}

// ---------------------------------------------------------------------------
// OTOMATİK SELF-TEST & TEŞHİS DÖNGÜSÜ
// ---------------------------------------------------------------------------

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
    push: VeloraPushResult;
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
  } else {
    notes.push("NO_SHARED_WINNERS:INTERSECTION_EMPTY");
  }

  if (agentsLogged !== expectedAgents)
    notes.push(`AGENT_COUNT_MISMATCH:${agentsLogged}/${expectedAgents}`);
  for (const phase of performance) {
    if (!phase.withinCeiling) notes.push(`PHASE_CEILING_EXCEEDED:${phase.phase}`);
  }
  const timedOut = state.phases.flatMap((p) =>
    p.agents.filter((a) => a.timedOut).map((a) => a.key),
  );
  if (timedOut.length > 0) notes.push(`AGENTS_TIMED_OUT:${timedOut.join(",")}`);
  if (state.candidates.length > 0 && agentsLogged === 0) notes.push("PRODUCT_EVIDENCE_EMPTY");

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
  const perf = report.performance.map((p) => `${p.phase}=${p.ms}ms`).join(" · ");
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
