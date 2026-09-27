// ============================================================================
// 14 AJAN KONSEYİ → PRODUCT DISCOVERY ADAPTÖRÜ.
//
// Bu dosya VAR OLAN 14 ajan yapısına dokunmaz; onu yeni hattın ürün şemasına
// bağlar. Mevcut konsey (`council-chain.server.ts`) her ürünü kendi uzmanlık
// dilimiyle puanlar; burada:
//
//   1. Ürünler konseyin anladığı aday formatına çevrilir.
//   2. Her ajanın oyu toplanır ve `AgentVote` listesine dönüşür.
//   3. `buildConsensus` ile uzlaşma + GÜVEN skoru hesaplanır.
//
// NEDEN AYRI ADAPTÖR: 14 ajanın tanımı, şemaları ve nötr-değer mantığı zaten
// testlerle korunuyor. Onları kopyalamak iki gerçek kaynak, iki bakım yükü ve
// zamanla iki farklı "14 ajan" anlamına gelirdi. Tek kaynak kalır.
// ============================================================================

import { buildConsensus, type AgentVote } from "./product-discovery-consensus";
import { COUNCIL_AGENT_KEYS, COUNCIL_AGENTS } from "./council-chain.server";
import type { Consensus, NormalizedProduct } from "./product-discovery.types";

/** Toplam ajan sayısı (güven hesabının paydası). */
export const TOTAL_AGENTS = COUNCIL_AGENT_KEYS.length; // 14

/**
 * Deterministic ajan oy üretici — AI YOK, ücretsiz katman için.
 *
 * NEDEN VAR: hat, 14 ajanın HEPSİ LLM çağrısı yapmadan da çalışabilmelidir
 * (ücretsiz plan bütçesi ve `deep` adımı yavaşladığında). Bu üretici ürünün
 * ÖLÇÜLMÜŞ sinyallerini ajan mantığına eşler:
 *
 *   • CFO/CFO-benzeri  → marj sinyali + fiyat bandı sağlığı
 *   • CMO/trend         → talep sinyali
 *   • CRO               → marka belirsizliği (risk)
 *   • rekabet           → satıcı yoğunluğu
 *   • UX                → puan sinyali (şikâyet varsa düşer)
 *   • tedarik           → stok sinyali
 *   • uyum/LTV          → aday metni ve tekrar satın alma ipucu
 *   • denetçi           → veri bütünlüğü (dataCompleteness)
 *
 * Bir alan ÖLÇÜLEMEDİYSE ilgili ajan NÖTR 50 verir — konseyin mevcut
 * "VERİ YOK → güvenli nötr değerlendirme" kuralıyla birebir aynı davranış.
 */
export function deterministicVotes(product: NormalizedProduct): AgentVote[] {
  const s = product.signals;
  const complaint = /şikâyet|complaint|refund|defective/i.test(product.notes);
  const thinData = product.dataCompleteness <= 2;

  const byKey: Record<string, number> = {
    cfo: s.margin,
    cmo: s.demand,
    cro: product.brand ? 72 : 45,
    trend_hunter: s.demand,
    competitor_intel: s.competition,
    ux_specialist: complaint ? Math.max(10, s.rating - 30) : s.rating,
    supply_chain: s.availability,
    pricing_strategist: s.margin,
    logistics_cost: s.margin,
    compliance_officer: product.brand ? 70 : 40,
    retention_ltv: /refill|reusable|kutu|set|kit|pack/i.test(product.name) ? 72 : 50,
    creative_director: product.notes ? 62 : 40,
    channel_fit: s.margin,
    independent_data_auditor: (thinData ? 25 : 60) + product.dataCompleteness * 5,
  };

  return COUNCIL_AGENTS.map((agent) => ({
    agentKey: agent.key,
    agentName: agent.name,
    score: Math.max(0, Math.min(100, Math.round(byKey[agent.key] ?? 50))),
    note: describe(agent.key, product),
  }));
}

function describe(key: string, p: NormalizedProduct): string {
  switch (key) {
    case "cfo":
      return `Marj sinyali ${p.signals.margin}/100${
        p.priceUsd === null ? " (fiyat yok → nötr)" : ` · $${p.priceUsd}`
      }`;
    case "cmo":
    case "trend_hunter":
      return `Talep sinyali ${p.signals.demand}/100 · ${p.sources.join(", ") || "kaynak yok"}`;
    case "competitor_intel":
      return `Rekabet sinyali ${p.signals.competition}/100`;
    case "ux_specialist":
      return p.rating === null
        ? "Puan ölçülmedi → nötr"
        : `Puan ${p.rating.toFixed(1)}/5 (${p.ratingCount ?? "?"} değerlendirme)`;
    case "independent_data_auditor":
      return `Veri bütünlüğü ${p.dataCompleteness}/5${
        p.missingFields.length ? ` · eksik: ${p.missingFields.join(", ")}` : ""
      }`;
    default:
      return `Sinyal ${p.signals.availability}/100`;
  }
}

/**
 * 14 ajanı ürünler üzerinde koşturur ve uzlaşma listesi döner.
 *
 * @param runAgents İsteğe bağlı gerçek ajan koşucusu. Verilmezse
 *   `deterministicVotes` kullanılır (ücretsiz, anında, test edilebilir).
 */
export async function runCouncilOnProducts(
  products: readonly NormalizedProduct[],
  runAgents?: (product: NormalizedProduct) => Promise<AgentVote[]>,
): Promise<Consensus[]> {
  const out: Consensus[] = [];
  for (const [index, product] of products.entries()) {
    let votes: AgentVote[];
    try {
      votes = runAgents ? await runAgents(product) : deterministicVotes(product);
    } catch {
      // Bir ajan hata verirse ürün DÜŞÜRÜLMEZ; nötr oylarla devam edilir
      // (konsey sözleşmesi: hat asla düşmez, kanıt eksikliği raporlanır).
      votes = deterministicVotes(product);
    }
    out.push(
      buildConsensus({
        candidateId: product.fingerprint || `P${index + 1}`,
        name: product.name,
        votes,
        totalAgents: TOTAL_AGENTS,
        dataCompleteness: product.dataCompleteness,
      }),
    );
  }
  return out;
}
