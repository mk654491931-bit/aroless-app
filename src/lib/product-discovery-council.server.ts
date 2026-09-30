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

import { buildConsensus, completenessPenalty, type AgentVote } from "./product-discovery-consensus";
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
 *   • CMO/trend         → talep sinyali + ÖLÇÜLEN satış hacmi/görüntülenme
 *   • CRO               → marka bilinirliği + kaç kaynakta görüldüğü
 *   • rekabet           → satıcı yoğunluğu
 *   • UX                → puan sinyali (şikâyet varsa düşer)
 *   • tedarik           → stok sinyali
 *   • uyum/LTV          → aday metni + kanıt gücü + tekrar satın alma ipucu
 *   • denetçi           → veri bütünlüğü (dataCompleteness)
 *
 * Bir alan ÖLÇÜLEMEDİYSE ilgili ajan NÖTR 50 verir — konseyin mevcut
 * "VERİ YOK → güvenli nötr değerlendirme" kuralıyla birebir aynı davranış.
 *
 * ÖLÇÜLEN KANIT ÖDÜLLENDİRİLİR: AI anahtarı olmadığında sonucun TAMAMI bu
 * üreticiden gelir; bu yüzden yalnız "marka var mı" gibi ikili işaretlere
 * bakmak, ölçülmüş satış hacmi ve çoklu kaynak kanıtı olan ürünü kaynak
 * göstermeyen ürünle aynı puana düşürürdü. Uydurma yok — yalnız ÖLÇÜLMÜŞ
 * alanlar (satış hacmi, 90 günlük görüntülenme, kaynak sayısı) puana girer.
 */
/** Ölçülen satış hacmini 0-100 talep sinyaline çevirir; ölçülmediyse `null`. */
export function salesDemandScore(sales: number | null): number | null {
  if (sales === null || sales <= 0) return null;
  // log10: 10 satış → 62, 100 → 74, 1.000 → 86, 10.000 → 98.
  return Math.max(0, Math.min(100, Math.round(50 + Math.log10(sales) * 12)));
}

/** Ölçülen 90 günlük görüntülenmeyi 0-100 talep sinyaline çevirir; yoksa `null`. */
export function viewsDemandScore(views: number | null): number | null {
  if (views === null || views <= 0) return null;
  // log10: 100 görüntülenme → 70, 10.000 → 90.
  return Math.max(0, Math.min(100, Math.round(50 + Math.log10(views) * 10)));
}

/** Kaç FARKLI kaynak ürünü doğruladı → kanıt gücü (0-24). */
export function sourceStrength(sources: readonly string[]): number {
  return Math.min(3, sources.length) * 8;
}

export function deterministicVotes(product: NormalizedProduct): AgentVote[] {
  const s = product.signals;
  const complaint = /şikâyet|complaint|refund|defective/i.test(product.notes);
  const thinData = product.dataCompleteness <= 2;

  // ÖLÇÜLEN hacim → 0-100 talep sinyali. `null` = ölçülmedi (50'ye zorlanmaz).
  const salesDemand = salesDemandScore(product.salesVolume);
  const viewDemand = viewsDemandScore(product.viewed90d);
  const measured = [salesDemand, viewDemand].filter((v): v is number => v !== null);
  // Kohort içi normalize edilmiş sinyal (2 pay) ölçülen hacimle harmanlanır;
  // hiç hacim ölçülmediyse mevcut sinyal AYNEN kalır — nötre düşürülmez.
  const demand = measured.length
    ? Math.round((s.demand * 2 + measured.reduce((a, b) => a + b, 0)) / (2 + measured.length))
    : s.demand;
  // Kaç FARKLI kaynak aynı ürünü doğruladı → kanıt gücü (0-24).
  const evidence = sourceStrength(product.sources);

  const byKey: Record<string, number> = {
    cfo: s.margin,
    cmo: demand,
    cro: Math.min(92, (product.brand ? 58 : 42) + evidence),
    trend_hunter: demand,
    competitor_intel: s.competition,
    ux_specialist: complaint ? Math.max(10, s.rating - 30) : s.rating,
    supply_chain: s.availability,
    pricing_strategist: s.margin,
    logistics_cost: s.margin,
    compliance_officer: Math.min(
      88,
      (product.brand ? 60 : 38) + (product.category ? 12 : 0) + Math.floor(evidence / 2),
    ),
    retention_ltv: Math.min(
      90,
      (/refill|reusable|kutu|set|kit|pack/i.test(product.name) ? 62 : 46) + evidence,
    ),
    creative_director: Math.min(
      86,
      (product.notes ? 50 : 36) + (product.imageUrl ? 8 : 0) + evidence,
    ),
    channel_fit: Math.min(92, Math.round(s.margin * 0.7 + s.availability * 0.3)),
    independent_data_auditor: (thinData ? 25 : 60) + product.dataCompleteness * 5,
  };

  // VERİ BÜTÜNLÜĞÜ PENALTISI: eksik alan sayısı arttıkça HER ajanın puanı
  // aşağı çekilir. Penaltı yalnız güven puanında uygulanıp `councilScore`'a
  // yansımadığı sürece kanıtsız ürün, kanıtlı ürünle eşit puanı taşıyabilirdi.
  // Burada uygulanınca 14 ajan zaten bölünür: `independent_data_auditor`
  // kanıtsızlığı en sert cezalandırır, talep ajanları fiyatsızlığı görür.
  //
  // Penaltı AJAN BAZINDA kırpılır (tümünden aynı miktarda düşmek, bölünmeyi
  // ve dolayısıyla güven hesabını bozmazdı).
  const penalty = completenessPenalty(product);

  return COUNCIL_AGENTS.map((agent) => {
    // Denetçi ajan kanıtsızlığı zaten kendi cezasını taşıyor; ikinci kez
    // kırpmak onu tek başına haksız yere çökerdi.
    const applied = agent.key === "independent_data_auditor" ? 0 : penalty;
    const base = byKey[agent.key] ?? 50;
    return {
      agentKey: agent.key,
      agentName: agent.name,
      score: Math.max(0, Math.min(100, Math.round(base - applied))),
      note: describe(agent.key, product),
    };
  });
}

function describe(key: string, p: NormalizedProduct): string {
  switch (key) {
    case "cfo":
      return `Marj sinyali ${p.signals.margin}/100${
        p.priceUsd === null ? " (fiyat yok → nötr)" : ` · $${p.priceUsd}`
      }`;
    case "cmo":
    case "trend_hunter":
      return `Talep sinyali ${p.signals.demand}/100${
        p.salesVolume !== null ? ` · satış ${p.salesVolume}` : ""
      }${p.viewed90d !== null ? ` · görüntülenme ${p.viewed90d}` : ""} · ${
        p.sources.join(", ") || "kaynak yok"
      }`;
    case "competitor_intel":
      return `Rekabet sinyali ${p.signals.competition}/100 · ${p.sources.length} kaynak`;
    case "ux_specialist":
      return p.rating === null
        ? "Puan ölçülmedi → nötr"
        : `Puan ${p.rating.toFixed(1)}/5 (${p.ratingCount ?? "?"} değerlendirme)`;
    case "cro":
      return `Marka ${p.brand || "yok"} · ${p.sources.length} kaynak doğruladı`;
    case "compliance_officer":
      return `Marka ${p.brand || "yok"} · kategori ${p.category || "yok"}`;
    case "creative_director":
      return `Vitrin kanıtı: not ${p.notes ? "var" : "yok"}, görsel ${
        p.imageUrl ? "var" : "yok"
      }`;
    case "retention_ltv":
      return `Tekrar satın alma sinyali: ${p.signals.demand}/100`;
    case "channel_fit":
      return `Marj ${p.signals.margin}/100 · stok ${p.signals.availability}/100`;
    case "pricing_strategist":
    case "logistics_cost":
      return `Marj sinyali ${p.signals.margin}/100`;
    case "supply_chain":
      return `Stok sinyali ${p.signals.availability}/100`;
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
