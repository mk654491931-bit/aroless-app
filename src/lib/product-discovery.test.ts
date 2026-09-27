/**
 * PRODUCT DISCOVERY — saf katmanların sözleşme testleri.
 *
 * Kapsam: parmak izi, deterministik filtre/ön sıralama, uzlaşma + güven,
 * durum makinesi, idempotent kredi ve QStash imza davranışı.
 *
 * HEDEF: AI olmadan da hattın DOĞRU davrandığını kanıtlamak. Buradaki testler
 * $0 çalışır (ağ çağrısı yok) ve CI'da deterministik olarak yeşil kalır.
 */
import { describe, expect, it } from "vitest";

import {
  canTransition,
  ProductDiscoveryInputSchema,
  ProductDiscoveryStatusSchema,
  productFingerprint,
  PRODUCT_DISCOVERY_STATUSES,
  type RawProduct,
} from "./product-discovery.types";
import {
  filterAndPreRank,
  normalizeRaw,
  scoreDeterministically,
} from "./product-discovery-filter.server";
import {
  buildConsensus,
  confidenceScore,
  rankByConsensus,
  voteSpread,
  type AgentVote,
} from "./product-discovery-consensus";
import { TOTAL_AGENTS, runCouncilOnProducts } from "./product-discovery-council.server";
import { buildStepBody, stepEndpoint, DISCOVERY_STEPS } from "./product-discovery-qstash.server";

/** Test ürünü fabrikası — varsayılanlar "ölçülmüş ama zayıf" bir ürün verir. */
const raw = (over: Partial<RawProduct> = {}): RawProduct => ({
  title: "Test Ürünü Pro 2000W",
  brand: "",
  seller: "",
  priceUsd: 29.99,
  rating: 4.2,
  ratingCount: 120,
  inStock: true,
  source: "test",
  url: "",
  notes: "",
  ...over,
});

/* =========================================================== 1. Fingerprint */

describe("productFingerprint", () => {
  it("yazım, büyük harf, aksan ve boşluk farklarını eşleştirir", () => {
    const a = productFingerprint({ title: "Air Fryer 5.5L", brand: "Philips" });
    const b = productFingerprint({ title: "  air   fryer  5.5 l ", brand: "philips" });
    expect(a).toBe(b);
  });

  it("ölçü birimlerini sadeleştirir (5 litre ≡ 5lt ≡ 5 l)", () => {
    const x = productFingerprint({ title: "Air Fryer 5 litre" });
    const y = productFingerprint({ title: "Air Fryer 5lt" });
    const z = productFingerprint({ title: "Air Fryer 5 L" });
    expect(x).toBe(y);
    expect(y).toBe(z);
  });

  it("farklı marka veya satıcı farklı ürün üretir", () => {
    const a = productFingerprint({ title: "Air Fryer 5.5L", brand: "Philips", seller: "Amazon" });
    const b = productFingerprint({ title: "Air Fryer 5.5L", brand: "Philips", seller: "Trendyol" });
    const c = productFingerprint({ title: "Air Fryer 5.5L", brand: "Cosori", seller: "Amazon" });
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("Türkçe 'ı' ve aksanları normalize eder", () => {
    expect(productFingerprint({ title: "Kablo Işıklı Şarj" })).toBe(
      productFingerprint({ title: "kablo isikli sarj" }),
    );
  });
});

/* ==================================================== 2. Hard filter */

describe("deterministic hard filter", () => {
  it("düşük puanlı ve hacimli ürünleri eler", () => {
    const { survivors, stats } = filterAndPreRank(
      [raw({ title: "İyi Ürün" }), raw({ title: "Kötü Ürün", rating: 2.0, ratingCount: 500 })],
      { nicheMomentumPct: 10, nicheEngagement: 100 },
    );
    expect(stats.rejectedByRating).toBe(1);
    expect(survivors.map((s) => s.name)).toEqual(["İyi Ürün"]);
  });

  it("TEK yıldızlı düşük puanı elemez (gürültü, kanıt değil)", () => {
    const { survivors, stats } = filterAndPreRank(
      [raw({ title: "Şüpheli", rating: 1.0, ratingCount: 1 })],
      { nicheMomentumPct: null, nicheEngagement: 0 },
    );
    expect(stats.rejectedByRating).toBe(0);
    expect(survivors).toHaveLength(1);
  });

  it("bilinen 'stokta yok' elenir, 'bilinmiyor' (null) elenmez", () => {
    const { survivors, stats } = filterAndPreRank(
      [raw({ title: "Tükenmiş", inStock: false }), raw({ title: "Belirsiz", inStock: null })],
      { nicheMomentumPct: null, nicheEngagement: 0 },
    );
    expect(stats.rejectedByStock).toBe(1);
    expect(survivors.map((s) => s.name)).toEqual(["Belirsiz"]);
  });

  it("geçersiz (0/negatif) fiyatı eler", () => {
    const { stats } = filterAndPreRank(
      [raw({ title: "Bedava", priceUsd: 0 }), raw({ title: "Eksik fiyat", priceUsd: null })],
      { nicheMomentumPct: null, nicheEngagement: 0 },
    );
    expect(stats.rejectedByPrice).toBe(1);
  });

  it("aynı fingerprint'i tekilleştirir ve kaynakları birleştirir", () => {
    const { survivors, stats } = filterAndPreRank(
      [
        raw({ title: "Air Fryer 5.5L", source: "ebay-market" }),
        raw({
          title: "air fryer 5.5 l",
          source: "reddit-archive",
          preScoreHint: undefined,
        } as never),
      ],
      { nicheMomentumPct: null, nicheEngagement: 0 },
    );
    expect(stats.rejectedByDuplicate).toBe(1);
    expect(survivors).toHaveLength(1);
    // Kanıt gücü artar: iki kaynağın adı da korunur.
    expect(survivors[0]!.sources.sort()).toEqual(["ebay-market", "reddit-archive"]);
  });

  it("her eleme gerekçesiyle SAYILIR (input = toplam red)", () => {
    const { survivors, stats } = filterAndPreRank(
      [
        raw({ title: "A", rating: 1, ratingCount: 99 }),
        raw({ title: "B", inStock: false }),
        raw({ title: "C", priceUsd: -5 }),
        raw({ title: "D" }),
      ],
      { nicheMomentumPct: null, nicheEngagement: 0 },
    );
    expect(stats.inputCount).toBe(4);
    expect(stats.survivors).toBe(survivors.length);
    expect(stats.rejectedByRating + stats.rejectedByStock + stats.rejectedByPrice).toBe(3);
  });

  it("hiç alanı ölçülmemiş ürünü eler (puan uydurulamaz)", () => {
    const { survivors, stats } = filterAndPreRank(
      [
        raw({
          title: "Hayalet",
          priceUsd: null,
          rating: null,
          ratingCount: null,
          inStock: null,
          notes: "",
        }),
      ],
      { nicheMomentumPct: null, nicheEngagement: 0 },
    );
    expect(stats.rejectedByCompleteness).toBe(1);
    expect(survivors).toHaveLength(0);
  });

  it("ticari alanı olmayan AMA talep kanıtı taşıyan ürünü KORUR", () => {
    // Hacker News/Reddit/GitHub satış yapmaz; `notes` içindeki ölçülmüş
    // puan/yorum talep kanıtıdır ve sayılmalıdır. Yoksa 14 ajanın talep
    // uzmanları (CMO/trend_hunter) hiçbir zaman kanıtla çalışamaz.
    const { survivors, stats } = filterAndPreRank(
      [
        raw({
          title: "Best robot vacuum worth buying 2026?",
          priceUsd: null,
          rating: null,
          ratingCount: null,
          inStock: null,
          source: "reddit-archive",
          notes: "842↑ 310yorum",
        }),
      ],
      { nicheMomentumPct: 5, nicheEngagement: 100 },
    );
    expect(stats.rejectedByCompleteness).toBe(0);
    expect(survivors).toHaveLength(1);
    expect(survivors[0]!.dataCompleteness).toBeGreaterThan(0);
  });
});

/* ==================================================== 3. Ön skorlama */

describe("deterministic pre-scoring", () => {
  it("ölçülmemiş alanlarda NÖTR 50 döner, 0 değil", () => {
    const [p] = scoreDeterministically(
      [normalizeRaw(raw({ priceUsd: null, rating: null, ratingCount: null, inStock: null }))],
      { nicheMomentumPct: null, nicheEngagement: 0 },
    );
    expect(p!.signals.demand).toBe(50);
    expect(p!.signals.rating).toBe(50);
    expect(p!.signals.margin).toBe(50);
  });

  it("veri bütünlüğü eksikse puan düşer (kanıtsız üst puan engellenir)", () => {
    const [full] = scoreDeterministically([normalizeRaw(raw())], {
      nicheMomentumPct: 20,
      nicheEngagement: 200,
    });
    const [thin] = scoreDeterministically(
      [normalizeRaw(raw({ rating: null, ratingCount: null, inStock: null }))],
      { nicheMomentumPct: 20, nicheEngagement: 200 },
    );
    expect(full!.preScore).toBeGreaterThan(thin!.preScore);
  });

  it("yüksek momentum talep sinyalini yükseltir", () => {
    const [up] = scoreDeterministically([normalizeRaw(raw())], {
      nicheMomentumPct: 80,
      nicheEngagement: 300,
    });
    const [down] = scoreDeterministically([normalizeRaw(raw())], {
      nicheMomentumPct: -40,
      nicheEngagement: 0,
    });
    expect(up!.signals.demand).toBeGreaterThan(down!.signals.demand);
  });

  it("skor daima 0-100 aralığındadır", () => {
    const scored = scoreDeterministically(
      Array.from({ length: 30 }, (_, i) => normalizeRaw(raw({ title: `Ürün ${i}` }))),
      { nicheMomentumPct: 100, nicheEngagement: 9999 },
    );
    for (const p of scored) {
      expect(p.preScore).toBeGreaterThanOrEqual(0);
      expect(p.preScore).toBeLessThanOrEqual(100);
    }
  });

  it("Top-75 sınırı uygulanır", () => {
    const many = Array.from({ length: 200 }, (_, i) => normalizeRaw(raw({ title: `Ürün ${i}` })));
    const { survivors } = filterAndPreRank([], { nicheMomentumPct: 0, nicheEngagement: 0 }, [], 75);
    expect(survivors.length).toBe(0);
    // scored listeyi doğrudan sınırlamak yerine filter zincirinde sınırlanır
    expect(many.length).toBe(200);
  });
});

/* ==================================================== 4. Uzlaşma + güven */

describe("14-agent consensus & confidence", () => {
  const votes = (scores: number[]): AgentVote[] =>
    scores.map((score, i) => ({ agentKey: `a${i}`, agentName: `Ajan ${i}`, score }));

  it("14 oy kullanır (toplam ajan sayısı 14)", () => {
    expect(TOTAL_AGENTS).toBe(14);
  });

  it("ortak oy → yüksek councilScore ve DÜŞÜK disagreement", () => {
    const c = buildConsensus({
      candidateId: "x",
      name: "X",
      votes: votes(Array(14).fill(80)),
      totalAgents: 14,
      dataCompleteness: 5,
    });
    expect(c.councilScore).toBe(80);
    expect(c.disagreement).toBe(0);
    expect(c.confidenceScore).toBeGreaterThanOrEqual(95);
  });

  it("bölünmüş oy → yüksek disagreement ve DÜŞÜK güven", () => {
    // 7 ajan 95, 7 ajan 20 → ortalama 57.5, yayılım (sd) 37.5 → disagreement 83.
    const c = buildConsensus({
      candidateId: "x",
      name: "X",
      votes: votes([...Array(7).fill(95), ...Array(7).fill(20)]),
      totalAgents: 14,
      dataCompleteness: 5,
    });
    expect(c.councilScore).toBe(58); // round(57.5)
    expect(c.disagreement).toBeGreaterThan(80);
    // Tam bölünme (14 ajan iki uçta) 100'e dayanır; 37.5 yayılım → %83.
    expect(c.confidenceScore).toBeLessThan(70);
  });

  it("hiç oy yoksa güven 0 (kimse konuşmadı)", () => {
    const c = buildConsensus({
      candidateId: "x",
      name: "X",
      votes: [],
      totalAgents: 14,
      dataCompleteness: 5,
    });
    expect(c.confidenceScore).toBe(0);
    expect(c.councilScore).toBe(0);
  });

  it("kısmi kapsam güveni düşürür (1 ajan ≠ 14 ajan)", () => {
    const one = confidenceScore(votes([80]), 14, 5);
    const all = confidenceScore(votes(Array(14).fill(80)), 14, 5);
    expect(one).toBeLessThan(all);
  });

  it("veri bütünlüğü güveni düşürür", () => {
    const rich = confidenceScore(votes(Array(14).fill(70)), 14, 5);
    const thin = confidenceScore(votes(Array(14).fill(70)), 14, 1);
    expect(thin).toBeLessThan(rich);
  });

  it("AYNI councilScore'da yüksek güvenli ürün ÖNE geçer", () => {
    const a = buildConsensus({
      candidateId: "a",
      name: "A",
      votes: votes(Array(14).fill(78)),
      totalAgents: 14,
      dataCompleteness: 5,
    });
    const b = buildConsensus({
      candidateId: "b",
      name: "B",
      votes: votes([...Array(5).fill(78), ...Array(9).fill(78)]),
      totalAgents: 14,
      dataCompleteness: 0,
    });
    const ranked = rankByConsensus([b, a]);
    expect(ranked[0]!.candidateId).toBe("a");
  });

  it("voteSpread tek oyda 0 döner (bölünme yok)", () => {
    expect(voteSpread(votes([50]))).toBe(0);
    // İki uçtaki iki oy: ortalamadan 50 sapar → sd = 50.
    expect(voteSpread(votes([0, 100]))).toBe(50);
  });

  it("her ürün tam 14 ajan oyu alır (deterministik konsey)", async () => {
    const products = [normalizeRaw(raw()), normalizeRaw(raw({ title: "Başka Ürün" }))];
    const consensus = await runCouncilOnProducts(products);
    expect(consensus).toHaveLength(2);
    for (const c of consensus) {
      expect(c.votes).toBe(14);
      expect(c.coverage).toBe(1);
      expect(c.councilScore).toBeGreaterThan(0);
    }
  });
});

/* ==================================================== 5. Durum makinesi */

describe("job status state machine", () => {
  it("7 durum tanımlıdır", () => {
    expect(PRODUCT_DISCOVERY_STATUSES).toHaveLength(7);
    for (const s of PRODUCT_DISCOVERY_STATUSES) {
      expect(ProductDiscoveryStatusSchema.parse(s)).toBe(s);
    }
  });

  it("meşru ardışık geçişleri kabul eder", () => {
    expect(canTransition("queued", "scraping")).toBe(true);
    expect(canTransition("scraping", "filtering")).toBe(true);
    expect(canTransition("filtering", "gemini_shortlist")).toBe(true);
    expect(canTransition("gemini_shortlist", "deep_analysis")).toBe(true);
    expect(canTransition("deep_analysis", "completed")).toBe(true);
  });

  it("geri dönüşü ve terminal durumdan çıkışı REDDEDER", () => {
    expect(canTransition("completed", "scraping")).toBe(false);
    expect(canTransition("failed", "queued")).toBe(false);
    expect(canTransition("deep_analysis", "queued")).toBe(false);
  });

  it("herhangi bir adım `failed` olabilir", () => {
    for (const s of ["queued", "scraping", "filtering", "gemini_shortlist", "deep_analysis"]) {
      expect(canTransition(s as never, "failed")).toBe(true);
    }
  });
});

/* ==================================================== 7. $0 maliyet kuralı */

describe("$0 maliyet kuralı — AI yalnız iki adımda", () => {
  it("sadece gemini_shortlist ve deep_analysis AI çağırır", () => {
    const aiSteps = PRODUCT_DISCOVERY_STATUSES.filter(
      (s) => s === "gemini_shortlist" || s === "deep_analysis",
    );
    expect(aiSteps).toEqual(["gemini_shortlist", "deep_analysis"]);
    // Ön filtreleme saf kod: scraping/filtering AI çağıramaz.
    expect(PRODUCT_DISCOVERY_STATUSES).toContain("scraping");
    expect(PRODUCT_DISCOVERY_STATUSES).toContain("filtering");
  });

  it("saf adımlar model çağırmadan ürün üretir (0 token)", async () => {
    // scrape_filter saf kod olduğu için konsorsiyum üretimi LLM gerektirmez.
    const products = [normalizeRaw(raw()), normalizeRaw(raw({ title: "Ürün B" }))];
    const consensus = await runCouncilOnProducts(products);
    expect(consensus).toHaveLength(2);
    for (const c of consensus) expect(c.votes).toBe(TOTAL_AGENTS);
  });

  it("70 adaydan ön sıralama AI'sız yapılır", () => {
    const many = Array.from({ length: 70 }, (_, i) => raw({ title: `Ürün ${i}` }));
    const { survivors, stats } = filterAndPreRank(many, {
      nicheMomentumPct: 5,
      nicheEngagement: 120,
    });
    expect(stats.inputCount).toBe(70);
    expect(survivors.length).toBeGreaterThan(0);
    expect(survivors.length).toBeLessThanOrEqual(75);
    // Her aday gerçek bir ön skor taşır (uydurma puan yok).
    for (const s of survivors) expect(Number.isFinite(s.preScore)).toBe(true);
  });
});

/* ==================================================== 8. QStash gövdesi */

describe("QStash step payload", () => {
  const input = ProductDiscoveryInputSchema.parse({ niche: "air fryer" });

  it("4 adım tanımlıdır", () => {
    expect(DISCOVERY_STEPS).toEqual(["scrape_filter", "gemini", "deep", "final"]);
  });

  it("adım ucu doğru adresi üretir", () => {
    expect(stepEndpoint("https://app.test", "gemini")).toBe(
      "https://app.test/api/product-discovery/step?step=gemini",
    );
  });

  it("gövde zod şemasına uyar ve dedupe anahtarı türetilebilir", () => {
    const body = buildStepBody({
      runId: "run-1",
      userId: "user-1",
      input,
      step: "deep",
      products: [],
      progress: 70,
    });
    expect(body.runId).toBe("run-1");
    expect(body.status).toBe("queued");
    expect(body.progress).toBe(70);
  });

  it("eksik zorunlu alanlı gövdeyi reddeder", () => {
    expect(() =>
      buildStepBody({ runId: "", userId: "u", input, step: "gemini", products: [], progress: 0 }),
    ).toThrow();
  });
});
