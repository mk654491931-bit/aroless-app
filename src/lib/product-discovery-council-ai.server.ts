// ============================================================================
// 14 AJAN KONSEYİ — GERÇEK AI OYLARI.
//
// SORUN (ölçülen): adım ucu `runCouncilOnProducts(products)` çağırıyordu ve ikinci
// parametre VERİLMEDİĞİ için fonksiyon her ürün için `deterministicVotes`a
// düşüyordu. Yani ekranda "14 ajan" yazıyordu ama hiçbir ajan konuşmamıştı:
// oylar kurallı hesaplamaydı. Kullanıcının istediği düzen bu değil.
//
// TASARIM (neden ürün başına değil ROL başına çağrı):
//   25 ürün × 14 ajan = 350 LLM çağrısı, Vercel Hobby adım bütçesinde imkânsız.
//   Bunun yerine her ROL, 25 ürünün tamamını TEK çağrıda puanlar → 14 çağrı.
//   Model ürün listesi dışına çıkamaz (yalnız indeks + puan döner), yanıt zod ile
//   doğrulanır ve doğrulanamayan satırlar DETERMİNİSTİK oyla doldurulur.
//
// SÖZLEŞME (konsey hep çalışır):
//   • Bir ajanın çağrısı çökerse/boş dönerse O AJANIN oyları deterministiğe
//     düşer; diğer ajanlar etkilenmez.
//   • Modelin atladığı ürün o ajan için deterministik puana düşer → hiçbir ürün
//     oysuz kalmaz, `votes` her zaman 14'tür.
//   • Süre bütçesi dolunca başlayan yeni çağrı yapılmaz, kalan roller
//     deterministiğe düşer. Sunucusuz fonksiyon asla 504 üretmez.
//   • Rapor `aiAgents`/`fallbackAgents` sayılarını döner; çağıran bunu not olarak
//     yazmalıdır — "14 ajan oyladı" demek, kaçının gerçekten konuştuğunu
//     saklamak olurdu.
// ============================================================================

import { callGemini } from "./ai.server";
import { COUNCIL_AGENTS, COUNCIL_AGENT_KEYS, type CouncilAgentKey } from "./council-chain.server";
import { buildConsensus, type AgentVote } from "./product-discovery-consensus";
import { deterministicVotes } from "./product-discovery-council.server";
import type { Consensus, NormalizedProduct } from "./product-discovery.types";

/** Bir rolün çağrısı için ayrılan asgari süre; bu altındaysa yeni çağrı başlatılmaz. */
const MIN_CALL_BUDGET_MS = 4_000;

/** Kaç rol gerçekten konuşabilsin (süre bütçesinin anahtarı). */
const MAX_AI_ROLES = 14;

/**
 * Aynı anda koşan rol sayısı.
 *
 * NEDEN VAR (ölçülen hata): roller SIRAYA koşuyordu. Rol başına ~10 sn × 14 rol
 * ≈ 140 sn; üstüne kazıma (~25 sn) + Gemini (~20 sn) + sıralama (~5 sn) eklenince
 * hat istemcinin 280 sn'lik penceresini aşıyor ve kullanıcı "Arka plan analizi
 * zaman aşımına uğradı" kartını görüyordu. Vercel Hobby'ın 300 sn'lik fonksiyon
 * tavanı da aynı sınıra dayandığı için iş sunucuda tamamlanıyor ama istemci
 * sonucu bir daha göremiyordu.
 *
 * NEDEN GÜVENLİ: bir rolün oyu diğerlerinden BAĞIMSIZDIR (her rol kendi
 * istemini alır, yalnız indeks+puan döner). Puanlar dalgalar bittikten sonra
 * `COUNCIL_AGENTS` SIRASIYLA birleştirildiği için çalıştırma sırası sonucu
 * değiştirmez — yani eşzamanlılık hız kazandırır, tekrarlanabilirliği değil.
 *
 * `COUNCIL_CONCURRENCY` env değişkeniyle 1-8 arası ayarlanabilir (havuz daralırsa
 * düşürülür). Varsayılan 4: 14 rol 4 dalgada ~4 turda biter.
 */
export const COUNCIL_CONCURRENCY = 4;

/** Aynı anda koşan rol sayısı (env ile 1-8). Dilim mantığı da bunu okur. */
export function councilConcurrency(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env["COUNCIL_CONCURRENCY"]);
  if (!Number.isFinite(raw) || raw <= 0) return COUNCIL_CONCURRENCY;
  return Math.max(1, Math.min(8, Math.round(raw)));
}

export type CouncilRunResult = {
  consensus: Consensus[];
  /** Gerçekten modelden yanıt alan rol sayısı. */
  aiAgents: number;
  /** Modele düşemeyip deterministiğe kalan rol sayısı. */
  fallbackAgents: number;
  /** Hangi roller gerçek oy verdi (kısa anahtarlar). */
  aiRoles: CouncilAgentKey[];
  ms: number;
};

/** Çağrıyı testte değiştirebilmek için注入 noktası. */
export type CouncilAiCall = (prompt: string, deadlineAt: number) => Promise<string>;

/** Varsayılan çağrı: Gemini öncelikli, havuz yedeğli (bkz. `callGemini`). */
const defaultCall: CouncilAiCall = async (prompt, deadlineAt) =>
  callGemini(prompt, undefined, 0.2, false, undefined, deadlineAt);

/** Ürünü ajana anlatan tek satırlık ÖLÇÜLMÜŞ özet. */
function candidateLine(p: NormalizedProduct, index: number): string {
  const price = p.priceUsd === null ? "fiyat yok" : `$${p.priceUsd}`;
  const rating = p.rating === null ? "puan yok" : `${p.rating.toFixed(1)}★ (${p.ratingCount ?? 0})`;
  const seller = p.seller || "satıcı yok";
  return (
    `${index}. ${p.name.slice(0, 70)} | marka: ${p.brand || "?"} | ${price} | ${rating} | ` +
    `${seller} | ön skor ${p.preScore} | kanıt ${p.dataCompleteness}/5`
  );
}

/**
 * Bir rolün istemi — saf, test edilebilir.
 *
 * DÜRÜSTLÜK: modele "TEDARİK FİYATI" ya da "REKLAM MALİYETİ" gibi ölçülmemiş
 * alanları sorulmaz; istem yalnız kazınmış alanları (fiyat, puan, satıcı,
 * satın alma sinyalleri, satıcı) listeler. Ajan yoktan yok yaratamaz.
 */
export function buildAgentPrompt(
  agent: { key: string; name: string; task: string },
  products: readonly NormalizedProduct[],
  niche: string,
): string {
  const roster = products.slice(0, 40).map(candidateLine).join("\n");
  return [
    `Sen "${agent.name}" adlı bir e-ticaret analistisin. Görevin: ${agent.task}`,
    `Niş: "${niche}". Aşağıdaki ${Math.min(products.length, 40)} aday ürünü KENDİ KRİTERİNE GÖRE puanla.`,
    "Puan 0-100 olsun (50 = nötr, kanıt yoksa 50 ver; uydurma).",
    "Her satırda tek bir cümle gerekçe yaz (en fazla 12 kelime).",
    "Sadece listedeki indeksleri kullan; yeni ürün ekleme.",
    "",
    "YANITINI YALNIZCA geçerli JSON olarak ver:",
    '{"scores":[{"i":1,"score":72,"note":"ölçülen fiyat bandı sağlıklı"}]}',
    "",
    roster,
  ].join("\n");
}

/** Model yanıtından `index → score` haritası çıkarır. Bozuk yanıt `null` verir. */
export function parseAgentScores(
  raw: string,
  productCount: number,
): Map<number, { score: number; note: string }> {
  const out = new Map<number, { score: number; note: string }>();
  let parsed: unknown = null;
  const text = String(raw ?? "").trim();
  if (!text) return out;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced?.[1]?.trim() ?? text;
  try {
    parsed = JSON.parse(body);
  } catch {
    const slice = /\{[\s\S]*\}/.exec(body);
    if (!slice) return out;
    try {
      parsed = JSON.parse(slice[0]);
    } catch {
      return out;
    }
  }
  const rows = (parsed as { scores?: unknown })?.scores;
  if (!Array.isArray(rows)) return out;
  for (const row of rows) {
    const record = (row ?? {}) as Record<string, unknown>;
    const index = Number(record["i"]);
    const score = Number(record["score"]);
    if (!Number.isInteger(index) || index < 1 || index > productCount) continue;
    if (!Number.isFinite(score)) continue;
    out.set(index, {
      score: Math.max(0, Math.min(100, Math.round(score))),
      note: String(record["note"] ?? "").slice(0, 120),
    });
  }
  return out;
}

/**
 * 14 rolü gerçek modele koşturur ve uzlaşma listesini üretir.
 *
 * @param products Gemini sonrası gelen 25 aday.
 * @param opts.call test için sahte çağrı; verilmezse gerçek havuz kullanılır.
 * @param opts.deadlineAt duvar saati sınırı; aşılırsa kalan roller deterministik.
 */
export async function runCouncilWithAi(
  products: readonly NormalizedProduct[],
  niche: string,
  opts: { call?: CouncilAiCall; deadlineAt?: number } = {},
): Promise<CouncilRunResult> {
  const startedAt = Date.now();
  // Bütçe yoksa varsayılan: Vercel Hobby adımı ~5 dk; konsey bunun içinde.
  const deadlineAt = opts.deadlineAt ?? Date.now() + 240_000;

  // DİLİM DÖNGÜSÜ — SİGNATÜR DEĞİŞMEDİ, DAVRANIŞ DEĞİŞMEDİ.
  //
  // Bu fonksiyon "hepsini tek istekte koştur" çağrısıdır (kalıcı süreç, test,
  // E2E) ve öyle kalır. İçeride artık DİLİM dilimi koşar: her tur bir dalga
  // dener, ara durum döner ve sıradaki tur oradan devam eder. Böylece aynı
  // kod yolu hem "tek istekte konsey"yi hem de "dilim dilim konsey"yi taşır ve
  // iki davranış birbirinden ayrışamaz.
  let state: CouncilSliceState | undefined;
  for (let guard = 0; guard < MAX_COUNCIL_LOOP; guard++) {
    const slice = await runCouncilSlice(products, niche, {
      call: opts.call,
      state,
      sliceDeadlineAt: deadlineAt,
    });
    if (!slice.partial) {
      return {
        consensus: slice.consensus,
        aiAgents: slice.aiAgents,
        fallbackAgents: slice.fallbackAgents,
        aiRoles: slice.aiRoles,
        ms: Date.now() - startedAt,
      };
    }
    state = slice.state;
    // Süre bitti: yeni DALGA başlatılmaz. Kalan roller deterministiğe düşer
    // (aşağıdaki zorunlu bitirme), yani sunucusuz sınır aşılmaz.
    if (deadlineAt - Date.now() < MIN_CALL_BUDGET_MS) break;
  }
  // Güvenlik ağı: teorik bir hatada sonsuz döngü yerine deterministik sonuç.
  const forced = await runCouncilSlice(products, niche, {
    call: opts.call,
    state,
    sliceDeadlineAt: deadlineAt,
    force: true,
  });
  return {
    consensus: forced.consensus,
    aiAgents: forced.aiAgents,
    fallbackAgents: forced.fallbackAgents,
    aiRoles: forced.aiRoles,
    ms: Date.now() - startedAt,
  };
}

/* ============================================================================
 * DİLİMLİ KONSEY — 14 ROL, DİLİM BAŞINA BİR DALGA.
 *
 * NEDEN: konsey tek istekte 4 dalga (~40 sn, yavaş havuzda daha fazla) koşar.
 * Sunucusuz ortamda bu, tek bir fonksiyonun dilim sınırını kat kat aşması
 * demektir. Dilimli sürüm aynı işi yapar ama HER teslimat tek dalga ile sınırlı
 * kalır ve ilerleme ara noktaya yazılır.
 *
 * SÖZLEŞME DEĞİŞMEZ: roller `COUNCIL_AGENTS` SIRASIYLA birleştirilir, her ürün
 * TAM 14 oy alır, konuşamayan rol deterministiğe düşer. Dilimleme yalnız
 * ÇALIŞMA SIRASINI değiştirir, sonucu değil — bu yüzden eşzamanlılık (1 veya 4)
 * konsensüsü değiştirmez.
 * ========================================================================= */

/** Bir rolün modele verdiği puanlar: `index → { score, note }`. */
type Scored = Map<number, { score: number; note: string }>;

/** Dilimler arasında taşınan puan satırı (JSON'a çevrilebilir). */
export type CouncilScoreRow = { i: number; score: number; note: string };
export type CouncilScores = Record<string, CouncilScoreRow[]>;

/** Ara noktaya yazılan konsey durumu. */
export type CouncilSliceState = {
  scores: CouncilScores;
  /**
   * Daha önce DENENEN roller (başarısız olsalar bile tekrar denenmezler).
   *
   * NEDEN AYRI: yalnız "puan üreten" rolleri işaretlemek, bozuk yanıt veren
   * rolü her dilimde yeniden çağırırdı; 14 bozuk rol + 16 dilim = 224 çağrı. Bu
   * liste sayesinde her rol TAM BİR KEZ denenir (eski davranışla aynı) ve
   * dilim döngüsü en fazla 14 tur sürer.
   */
  done: string[];
};

/** Test edilebilir üst sınır: 14 rol, eşzamanlılık 1 → 14 tur. */
export const MAX_COUNCIL_LOOP = 32;

/** Map tabanlı puanları ara noktaya yazılabilir hâle getirir. */
export function serializeCouncilState(
  scoresByAgent: ReadonlyMap<CouncilAgentKey, Scored>,
  done: ReadonlySet<string> | readonly string[],
): CouncilSliceState {
  const scores: CouncilScores = {};
  for (const [role, rows] of scoresByAgent) {
    scores[role] = [...rows.entries()].map(([i, value]) => ({
      i,
      score: value.score,
      note: value.note,
    }));
  }
  return { scores, done: [...(done as Iterable<string>)] };
}

/** Ara noktadan okunan puanları Map'e çevirir; bozuk satırlar ELENİR. */
export function deserializeCouncilScores(raw: unknown): Map<CouncilAgentKey, Scored> {
  const out = new Map<CouncilAgentKey, Scored>();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [role, rows] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(rows)) continue;
    const scored: Scored = new Map();
    for (const row of rows) {
      const record = (row ?? {}) as Record<string, unknown>;
      const index = Number(record["i"]);
      const score = Number(record["score"]);
      if (!Number.isInteger(index) || index < 1 || !Number.isFinite(score)) continue;
      scored.set(index, {
        score: Math.max(0, Math.min(100, Math.round(score))),
        note: String(record["note"] ?? "").slice(0, 120),
      });
    }
    if (scored.size) out.set(role as CouncilAgentKey, scored);
  }
  return out;
}

/** Bu koşuda konuşacak roller (ürün yoksa hiçbiri). */
export function councilRoleQueue(productCount: number, maxRoles = MAX_AI_ROLES): CouncilAgentKey[] {
  if (productCount <= 0) return [];
  return COUNCIL_AGENTS.slice(0, maxRoles).map((a) => a.key as CouncilAgentKey);
}

export type CouncilMerge = {
  consensus: Consensus[];
  aiAgents: number;
  fallbackAgents: number;
  aiRoles: CouncilAgentKey[];
};

/**
 * Puanları nihai uzlaşmaya çevirir — TEK yer.
 *
 * Birleştirme `COUNCIL_AGENTS` SIRASINDA ve TEK TEK yapılır: hangi dilimde
 * hangi rolün konuştuğu sonucu DEĞİŞTİRMEZ. Bu, "dilimledik ama sonucu
 * değiştirdik" hatasının yapısal engelidir.
 */
export function mergeCouncilVotes(
  products: readonly NormalizedProduct[],
  scoresByAgent: ReadonlyMap<CouncilAgentKey, Scored>,
): CouncilMerge {
  // Deterministik oylar BİR KEZ üretilir: hem yedek hem zemin (AI boş dönerse).
  const baseline = new Map<string, AgentVote[]>();
  products.forEach((p, i) => baseline.set(p.fingerprint || `P${i + 1}`, deterministicVotes(p)));

  const perProduct = new Map<string, Map<string, AgentVote>>();
  products.forEach((p, i) => perProduct.set(p.fingerprint || `P${i + 1}`, new Map()));

  const aiRoles: CouncilAgentKey[] = [];
  let aiAgents = 0;
  let fallbackAgents = 0;

  for (const agent of COUNCIL_AGENTS) {
    const scores = scoresByAgent.get(agent.key as CouncilAgentKey);
    if (!scores) {
      fallbackAgents++;
      continue;
    }
    aiAgents++;
    aiRoles.push(agent.key as CouncilAgentKey);

    products.forEach((product, index) => {
      const key = product.fingerprint || `P${index + 1}`;
      const base = (baseline.get(key) ?? []) as AgentVote[];
      const fallbackVote = base.find((v) => v.agentKey === agent.key);
      const ai = scores.get(index + 1);
      // Kanıtsız ürün, kanıtlıyla eşit puan alamaz: ölçülebilir alanı 2'nin
      // altındaysa deterministik oyun cezalı değeri korunur.
      const rawScore = ai?.score ?? fallbackVote?.score ?? 50;
      const penalised =
        product.dataCompleteness < 2 && (ai?.score ?? 50) > 50 ? Math.min(rawScore, 50) : rawScore;
      perProduct.get(key)?.set(agent.key, {
        agentKey: agent.key,
        agentName: agent.name,
        score: penalised,
        note: ai?.note || fallbackVote?.note || "",
      });
    });
  }

  const consensus: Consensus[] = products.map((product, index) => {
    const key = product.fingerprint || `P${index + 1}`;
    const collected = perProduct.get(key) ?? new Map<string, AgentVote>();
    // Sözleşme: her ürünün TAM 14 oyu olur. Modelin atladığı rol deterministiğe
    // döner, oy sayısı asla 14'ten az olmaz.
    const votes: AgentVote[] = COUNCIL_AGENT_KEYS.map((agentKey) => {
      const found = collected.get(agentKey);
      if (found) return found;
      const base = (baseline.get(key) ?? []) as AgentVote[];
      return (
        base.find((v) => v.agentKey === agentKey) ?? {
          agentKey,
          agentName: agentKey,
          score: 50,
          note: "nötr",
        }
      );
    });
    return buildConsensus({
      candidateId: key,
      name: product.name,
      votes,
      totalAgents: COUNCIL_AGENT_KEYS.length,
      dataCompleteness: product.dataCompleteness,
    });
  });

  return { consensus, aiAgents, fallbackAgents, aiRoles };
}

/** Bir DALGA rolü koşturur; hata veren rolü sessizce atlar (deterministik yedek). */
async function runCouncilWave(args: {
  products: readonly NormalizedProduct[];
  niche: string;
  roles: readonly CouncilAgentKey[];
  call: CouncilAiCall;
  deadlineAt: number;
}): Promise<Map<CouncilAgentKey, Scored>> {
  const settled = await Promise.allSettled(
    args.roles.map(async (agentKey) => {
      const agent = COUNCIL_AGENTS.find((a) => a.key === agentKey);
      if (!agent) throw new Error(`bilinmeyen rol: ${agentKey}`);
      const raw = await args.call(
        buildAgentPrompt(agent, args.products, args.niche),
        args.deadlineAt,
      );
      return [agentKey, parseAgentScores(raw, args.products.length)] as const;
    }),
  );

  const out = new Map<CouncilAgentKey, Scored>();
  for (const outcome of settled) {
    if (outcome.status === "rejected") {
      console.warn(
        `[council] rol yanıt veremedi, deterministiğe düşülüyor:`,
        outcome.reason instanceof Error ? outcome.reason.message : "unknown",
      );
      continue;
    }
    const [agentKey, parsed] = outcome.value;
    if (parsed.size) out.set(agentKey, parsed);
  }
  return out;
}

export type CouncilSliceResult = {
  /** Yalnız adım BİTTİYSE dolar (`partial === false`). */
  consensus: Consensus[];
  aiAgents: number;
  fallbackAgents: number;
  aiRoles: CouncilAgentKey[];
  /** Ara noktaya yazılacak durum (her zaman dolu). */
  state: CouncilSliceState;
  /** `true` → adım bitmedi, kalan roller sıradaki dilimde denenir. */
  partial: boolean;
  /** Kaç rol kaldı (günlük/teşhis). */
  remaining: number;
  ms: number;
};

/**
 * KONSEYİN BİR DİLİMİ — en fazla bir dalga.
 *
 * @param opts.state     önceki dilimlerden gelen durum (roller + puanlar)
 * @param opts.sliceDeadlineAt bu dilimin bitmesi gereken an
 * @param opts.force     zincir süresi bitti → kalan roller deterministik, adım BİTİR
 */
export async function runCouncilSlice(
  products: readonly NormalizedProduct[],
  niche: string,
  opts: {
    call?: CouncilAiCall;
    state?: CouncilSliceState;
    sliceDeadlineAt?: number;
    force?: boolean;
    concurrency?: number;
    /** Bu süreden az kaldıysa yeni dalga BAŞLATILMAZ (varsayılan 4 sn). */
    minCallMs?: number;
  } = {},
): Promise<CouncilSliceResult> {
  const startedAt = Date.now();
  const call = opts.call ?? defaultCall;
  const scoresByAgent = deserializeCouncilScores(opts.state?.scores);
  const done = new Set<string>(Array.isArray(opts.state?.done) ? opts.state!.done : []);
  // Puan üreten bir rol her hâlükârda "denendi" sayılır (eski ara noktalar
  // `done` taşımıyor olabilir).
  for (const role of scoresByAgent.keys()) done.add(role);

  const queue = councilRoleQueue(products.length);
  const remaining = queue.filter((role) => !done.has(role));
  const minCallMs = opts.minCallMs ?? MIN_CALL_BUDGET_MS;

  const finish = (): CouncilSliceResult => {
    const merged = mergeCouncilVotes(products, scoresByAgent);
    return {
      consensus: merged.consensus,
      aiAgents: merged.aiAgents,
      fallbackAgents: merged.fallbackAgents,
      aiRoles: merged.aiRoles,
      state: serializeCouncilState(scoresByAgent, done),
      partial: false,
      remaining: 0,
      ms: Date.now() - startedAt,
    };
  };

  // Hiç aday yok ya da tüm roller denendi → adım biter (uydurma yok).
  if (products.length === 0 || remaining.length === 0) return finish();

  // ZORLA BİTİRME: kalan roller deterministik oyla girer (konsey hep 14 oy
  // üretir). Zincirin süresi bittiğinde sürücü bunu ister.
  if (opts.force) return finish();

  const deadline = opts.sliceDeadlineAt ?? Date.now() + 1_000;
  // BU DİLİMDE yeni dalga başlatılamıyor (süre yetmiyor): adım BİTMİŞ
  // SAYILMAZ, kısmi döneriz. Sıradaki dilim taze bir pencereyle devam eder;
  // ilerleme (`state`) korunduğu için hiçbir rol baştan konuşmaz.
  if (deadline - Date.now() < minCallMs) {
    return {
      consensus: [],
      aiAgents: 0,
      fallbackAgents: 0,
      aiRoles: [],
      state: serializeCouncilState(scoresByAgent, done),
      partial: true,
      remaining: remaining.length,
      ms: Date.now() - startedAt,
    };
  }

  const concurrency = Math.max(
    1,
    Math.min(opts.concurrency ?? councilConcurrency(), remaining.length),
  );
  const wave = remaining.slice(0, concurrency);
  const scored = await runCouncilWave({ products, niche, roles: wave, call, deadlineAt: deadline });
  for (const [role, rows] of scored) scoresByAgent.set(role, rows);
  for (const role of wave) done.add(role);

  const left = queue.filter((role) => !done.has(role));
  if (left.length === 0) return finish();
  return {
    consensus: [],
    aiAgents: 0,
    fallbackAgents: 0,
    aiRoles: [],
    state: serializeCouncilState(scoresByAgent, done),
    partial: true,
    remaining: left.length,
    ms: Date.now() - startedAt,
  };
}
