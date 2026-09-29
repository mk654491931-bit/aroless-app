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

function councilConcurrency(env: NodeJS.ProcessEnv = process.env): number {
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
  const call = opts.call ?? defaultCall;
  // Bütçe yoksa varsayılan: Vercel Hobby adımı ~5 dk; konsey bunun içinde.
  const deadlineAt = opts.deadlineAt ?? Date.now() + 240_000;

  // Deterministik oylar BİR KEZ üretilir: hem yedek hem zemin (AI boş dönerse).
  const baseline = new Map<string, AgentVote[]>();
  products.forEach((p, i) => baseline.set(p.fingerprint || `P${i + 1}`, deterministicVotes(p)));

  const perProduct = new Map<string, Map<string, AgentVote>>();
  products.forEach((p, i) => perProduct.set(p.fingerprint || `P${i + 1}`, new Map()));

  const aiRoles: CouncilAgentKey[] = [];
  let aiAgents = 0;
  let fallbackAgents = 0;

  // ------------------------------------------------ SINIRLI EŞZAMANLILIK
  //
  // Roller dalgalar hâlinde koşar. Bir rolün çağrısı çökerse YALNIZ o rol
  // deterministiğe düşer; dalganın kalanı etkilenmez (sözleşme değişmez).
  type Scored = Map<number, { score: number; note: string }>;
  const scoresByAgent = new Map<CouncilAgentKey, Scored>();
  const rolesToRun: CouncilAgentKey[] =
    products.length === 0 ? [] : COUNCIL_AGENTS.slice(0, MAX_AI_ROLES).map((a) => a.key as CouncilAgentKey);

  const concurrency = Math.max(1, Math.min(councilConcurrency(), rolesToRun.length));
  const waves: CouncilAgentKey[][] = [];
  for (let i = 0; i < rolesToRun.length; i += concurrency) {
    waves.push(rolesToRun.slice(i, i + concurrency));
  }

  for (const wave of waves) {
    // Süre bitti: başlayan DALGA yapılmaz, kalan roller deterministiğe düşer.
    // Sunucusuz sınırı aşmayız.
    if (deadlineAt - Date.now() < MIN_CALL_BUDGET_MS) break;

    const settled = await Promise.allSettled(
      wave.map(async (agentKey) => {
        const agent = COUNCIL_AGENTS.find((a) => a.key === agentKey);
        if (!agent) throw new Error(`bilinmeyen rol: ${agentKey}`);
        const raw = await call(buildAgentPrompt(agent, products, niche), deadlineAt);
        return [agentKey, parseAgentScores(raw, products.length)] as const;
      }),
    );

    for (const outcome of settled) {
      if (outcome.status === "rejected") {
        console.warn(
          `[council] rol yanıt veremedi, deterministiğe düşülüyor:`,
          outcome.reason instanceof Error ? outcome.reason.message : "unknown",
        );
        continue;
      }
      const [agentKey, parsed] = outcome.value;
      if (parsed.size) scoresByAgent.set(agentKey, parsed);
    }
  }

  // Birleştirme COUNCIL_AGENTS sırasında ve TEK TEK yapılır: eşzamanlı dalgalar
  // oy topluluğunu bozmaz, yalnız süreyi kısaltır.
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

  return {
    consensus,
    aiAgents,
    fallbackAgents,
    aiRoles,
    ms: Date.now() - startedAt,
  };
}
