// ============================================================================
// 14 AJAN UZLAŞMA + GÜVEN MOTORU.
//
// İki AYRI soru burada cevaplanır ve ikisi karıştırılmaz:
//
//   1. `councilScore`  → "Ajanlar bu ürünü ortalama kaç puanlıyor?"
//   2. `confidenceScore` → "BU puana ne kadar güvenebiliriz?"
//
// Neden ayrı: 14 ajanın hepsinin 85 verdiği bir ürün, oyları 40'a düşen
// bir ürünle AYNI councilScore'u taşıyabilir ama güven düzeyi tamamen
// farklıdır. Kullanıcı "en iyi 5 ürün" ister; ikinci sıradaki ürünün neden
// düştüğünü bilmek ister. GÜVEN skoru bu boşluğu doldurur ve sıralamada
// eşitlik bozucu (tie-breaker) olarak kullanılır.
//
// GÜVEN ÜÇ BİLEŞENİN BÜTÜNÜDÜR:
//   A) Uzlaşma   — oyların yayılımı düşükse yüksek güven.
//   B) Kapsam     — 14 ajanın kaçı gerçekten oy kullandı (coverage).
//   C) Veri bütünlüğü — kaynak kanıtın ne kadar dolu olduğu.
//
// ÜÇÜ DE ölçülemezse (veri yok) güven DÜŞÜK kalır. Bu, "ölçmeden güvenli
// görünme" tuzağını kapatır.
// ============================================================================

import type { Consensus } from "./product-discovery.types";

/** Bir ajanın oyu. 0-100 puan + gerekçe. */
export type AgentVote = {
  agentKey: string;
  agentName: string;
  score: number;
  note?: string;
};

/**
 * Oyların standart sapması (yayılım).
 *
 * Tek ajan veya oy yoksa 0 döner — "bölünme yok" demektir, ama bu güven
 * yüksek demek DEĞİLDİR (onu `coverage` yakalar).
 */
export function voteSpread(votes: readonly AgentVote[]): number {
  if (votes.length < 2) return 0;
  const mean = votes.reduce((a, v) => a + v.score, 0) / votes.length;
  const variance = votes.reduce((a, v) => a + (v.score - mean) ** 2, 0) / votes.length;
  return Math.sqrt(variance);
}

/** Ajanlar arası uyum etiketi — panelde rozet olarak gösterilir. */
export type Alignment = "unanimous" | "strong" | "split" | "polarized";

export function alignmentOf(spread: number, votes: number): Alignment {
  if (votes < 2) return "split";
  if (spread <= 6) return "unanimous";
  if (spread <= 14) return "strong";
  if (spread <= 26) return "split";
  return "polarized";
}

/**
 * Güven skoru (0-100) — uzlaşma + kapsam + veri bütünlüğü.
 *
 * @param votes Bu ürünü puanlayan ajanların oyları.
 * @param totalAgents Toplam ajan sayısı (14).
 * @param dataCompleteness 0-5 arası kaynak veri bütünlüğü.
 */
export function confidenceScore(
  votes: readonly AgentVote[],
  totalAgents: number,
  dataCompleteness: number,
): number {
  if (votes.length === 0) return 0; // kimse konuşmadı → en düşük güven

  // A) UZLAŞMA: yayılım 0 → 100, yayılım 45+ → 0.
  const spread = voteSpread(votes);
  const agreement = Math.max(0, 100 - (spread / 45) * 100);

  // B) KAPSAM: 14'ün 14'ü oy kullandıysa 100, 1 ajan konuştuysa ~7.
  // Kısmi kapsam HAFİFCE cezalanır (yarıya kadar 0-100 arası doğrusal).
  const coverage = (votes.length / Math.max(1, totalAgents)) * 100;

  // C) VERİ BÜTÜNLÜĞÜ: 0-5 → 0-100.
  const completeness = (Math.max(0, Math.min(5, dataCompleteness)) / 5) * 100;

  // Ağırlıklar: uzlaşma en önemli (ajanlar birbirine ne kadar katılıyor),
  // sonra kapsam, en son veri bütünlüğü.
  return Math.round(agreement * 0.4 + coverage * 0.35 + completeness * 0.25);
}

/**
 * Bir aday için tam uzlaşma kaydı üretir.
 *
 * Eşitlik bozucu (tie-breaker) kuralı: Aynı `councilScore`ta iki üründen
 * ÖNCE yüksek güvenli olan gelir. 78 puanı %40 güvenle alan bir ürün, 78
 * puanı %95 güvenle alan bir ürünün ALTINDA sıralanır — çünkü ilki o puanı
 * kırk oyla, ikincisi on dört oyla savunabilmektedir.
 */
export function buildConsensus(args: {
  candidateId: string;
  name: string;
  votes: readonly AgentVote[];
  totalAgents: number;
  dataCompleteness: number;
}): Consensus {
  const { candidateId, name, votes, totalAgents, dataCompleteness } = args;
  if (votes.length === 0) {
    return {
      candidateId,
      name,
      councilScore: 0,
      votes: 0,
      coverage: 0,
      disagreement: 0,
      confidenceScore: 0,
      minScore: 0,
      maxScore: 0,
      evidence: [],
    };
  }
  const scores = votes.map((v) => v.score);
  const councilScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const spread = voteSpread(votes);
  return {
    candidateId,
    name,
    councilScore,
    votes: votes.length,
    coverage: Math.min(1, votes.length / Math.max(1, totalAgents)),
    // Yayılımı 0-100'e normalize et: 45+ yayılım = tam bölünme.
    disagreement: Math.round(Math.max(0, Math.min(100, (spread / 45) * 100))),
    confidenceScore: confidenceScore(votes, totalAgents, dataCompleteness),
    minScore: Math.min(...scores),
    maxScore: Math.max(...scores),
    evidence: votes
      .filter((v) => v.note)
      .slice(0, 4)
      .map((v) => `${v.agentName}: ${v.note}`),
  };
}

/** Final sıralama: councilScore DESC, sonra confidenceScore DESC. */
export function rankByConsensus(consensus: readonly Consensus[]): Consensus[] {
  return [...consensus].sort(
    (a, b) => b.councilScore - a.councilScore || b.confidenceScore - a.confidenceScore,
  );
}

/**
 * Veri bütünlüğü penaltısı — 14 ajanın istemine girmeden ÖNCE uygulanır.
 *
 * Kural tabanlıdır ve AI çağırmaz. Kanıtı çok eksik ürünler, 14 ajanın
 * puanlama yapmasına harcanan tokenı boşa yakmaz: ajanlar "VERİ YOK" deyip
 * nötr puan verirdi. Tek istisna: hiç kanıtı olmayan ürün AI üretimi
 * olabilir (Gemini kısa listesi) ve onlar bu aşamadan geçer — çünkü
 * Gemini'nin işi tam olarak kanıt toplamaktır.
 */
export function completenessPenalty(product: {
  dataCompleteness: number;
  priceUsd: number | null;
  source: string;
}): number {
  // 0-20 puanlık penaltı. Ürün ne kadar eksikse o kadar ağır cezalanır.
  const missing = 5 - Math.max(0, Math.min(5, product.dataCompleteness));
  const basePenalty = missing * 4;
  // Fiyatı bilinmeyen ürün +4 daha: marj hesaplanamaz, CFO ajanı kanıtsız.
  const pricePenalty = product.priceUsd === null ? 4 : 0;
  return Math.min(20, basePenalty + pricePenalty);
}
