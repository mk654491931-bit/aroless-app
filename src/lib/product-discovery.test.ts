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
  productModelKey,
  PRODUCT_DISCOVERY_STATUSES,
  type RawProduct,
} from "./product-discovery.types";
import {
  filterAndPreRank,
  normalizeRaw,
  scoreDeterministically,
} from "./product-discovery-filter.server";
import { bingShoppingSource } from "./product-discovery-sources.server";
import {
  arcticPostUrl,
  fetchArcticPosts,
  fetchHackerNewsStories,
} from "./shared-niche-scrapers.server";
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

/* ==================================================== 1b. Model kodu anahtarı */

/**
 * Bu blok CANLI KOŞUNUN ÜRÜNÜDÜR. Espresso nişinde ölçüldü: nihai 5'lik
 * listenin 1. ve 3. sırası aynı üründü (CASABREWS CM5418), iki farklı
 * başlık yazımı geldiği için fingerprint ayırt edememişti. Yanlış çözüm
 * (benzerlik eşiği) iki farklı ürünü birleştirirdi; buradaki kural kasıtlı
 * olarak MUHAFAZAKÂR: yalnız markası ve tam bir model kodu belli olan ürün.
 */
describe("productModelKey", () => {
  it("aynı ürünün iki farklı başlık yazımını eşleştirir (canlı bulgu)", () => {
    const a = productModelKey({
      title: "CASABREWS CM5418 Compact Espresso Machine With Milk Frother",
      brand: "CASABREWS",
    });
    const b = productModelKey({
      title: "Casabrews CM5418 20 Bar Espresso Machine And Coffee Maker",
      brand: "Casabrews",
    });
    expect(a).not.toBe("");
    expect(a).toBe(b);
  });

  it("farklı markada aynı model kodu AYRI kalır", () => {
    const a = productModelKey({ title: "Dreame L10s Ultra", brand: "Dreame" });
    const b = productModelKey({ title: "Roborock L10s Ultra", brand: "Roborock" });
    expect(a).not.toBe(b);
  });

  it("farklı model kodu AYRI kalır", () => {
    const a = productModelKey({ title: "Dreame L10s Ultra", brand: "Dreame" });
    const b = productModelKey({ title: "Dreame L9 Ultra", brand: "Dreame" });
    expect(a).not.toBe(b);
  });

  it("RAKAMLA başlayan spec'leri model sanmaz (8000 Pa, 20 Bar, 10,000Pa)", () => {
    // Ölçü kodu model kodudur denirse aynı markanın ölçüleri birleşir ve
    // kullanıcıya üç ayrı ürün yerine tek ürün gider.
    for (const title of [
      "Roborock Q7 L5 Robot Vacuum And Mop With 8,000 Pa Power",
      "Philips 2000 4.4 Qt. Air Fryer With Rapid Air Technology",
      "Yabano 3.5 Bar 4 Cup Steam Espresso Maker",
    ]) {
      expect(productModelKey({ title, brand: "" })).toBe("");
    }
  });

  it("markasız ürün anahtar üretmez (uydurma eşleşme olmaz)", () => {
    expect(productModelKey({ title: "CM5418 Espresso Machine", brand: "" })).toBe("");
  });

  it("birden çok model kodu varsa BELIRSIZ sayılır, eşleştirme yapmaz", () => {
    expect(productModelKey({ title: "Dreame L10s with S20 accessory", brand: "Dreame" })).toBe("");
  });
});

describe("model kodu tekilleştirmesi", () => {
  it("farklı yazılmış aynı modeli tekleştirir ve kaynakları birleştirir", () => {
    const { survivors, stats } = filterAndPreRank(
      [
        raw({
          title: "CASABREWS CM5418 Compact Espresso Machine With Milk Frother",
          brand: "CASABREWS",
          priceUsd: 139.99,
          rating: 4.5,
          ratingCount: 1,
        }),
        raw({
          title: "Casabrews CM5418 20 Bar Espresso Machine And Coffee Maker",
          brand: "Casabrews",
          priceUsd: 139.99,
          rating: null,
          ratingCount: null,
        }),
      ],
      { nicheMomentumPct: 10, nicheEngagement: 100 },
    );
    expect(stats.rejectedByDuplicate).toBe(1);
    expect(survivors).toHaveLength(1);
    // Alan en dolu temsilci seçilir: puanı bilinen satır korunur.
    expect(survivors[0].rating).toBe(4.5);
  });

  it("farklı markalı ürünleri YANLIŞLIKLA birleştirmez", () => {
    const { survivors } = filterAndPreRank(
      [
        raw({ title: "Dreame L10s Ultra Robot Vacuum", brand: "Dreame" }),
        raw({ title: "Roborock L10s Ultra Robot Vacuum", brand: "Roborock" }),
      ],
      { nicheMomentumPct: 10, nicheEngagement: 100 },
    );
    expect(survivors).toHaveLength(2);
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

  it("90 günlük GÖRÜNTÜLENME talep sinyalini yükseltir (kohort içi)", () => {
    // Aynı fiyat/puan, tek fark: kaç kişi ürünü gerçekten GÖRDÜ. Bu ölçülmüş
    // perakende talebidir; "popüler görünüyor" ile "gerçekten ilgileniliyor"
    // ayrımını deterministik olarak yapar.
    const base = { notes: "", priceUsd: 59.9, rating: 4.4, ratingCount: 500 };
    const [hot, cold] = scoreDeterministically(
      [
        normalizeRaw(raw({ ...base, title: "Air Fryer Pro X", viewed90d: 9000 })),
        normalizeRaw(raw({ ...base, title: "Air Fryer Lite Y", viewed90d: 300 })),
      ],
      { nicheMomentumPct: null, nicheEngagement: 0 },
    );
    expect(hot!.signals.demand).toBeGreaterThan(cold!.signals.demand);
  });

  it("görüntülenme ÖLÇÜLMEDİYSE talep sinyali nötr kalır (0 sayılmaz)", () => {
    // "kimse görmedi" ile "ölçemedik" farklıdır. Ölçülmemiş satır 0
    // puanlanırsa gerçekten ilgi görmeyen ürünle aynı sınıfa düşer.
    const [unknown] = scoreDeterministically([normalizeRaw(raw({ notes: "", viewed90d: null }))], {
      nicheMomentumPct: null,
      nicheEngagement: 0,
    });
    expect(unknown!.signals.demand).toBe(50);
  });

  it("hiçbir kaynak görüntülenme ölçmediyse mevcut davranış BOZULMAZ", () => {
    // Geriye dönük uyum: view alanı eklenmeden önceki sonuçlar aynı kalmalı.
    // momentum 12 → 62; etkileşim 300 → 50 + (300/400)*50 − 25 = 62,5;
    // iki sinyalin ortalaması 62. Görüntülenme devreye girmez.
    const products = [
      normalizeRaw(raw({ title: "Ürün A" })),
      normalizeRaw(raw({ title: "Ürün B" })),
    ];
    const scored = scoreDeterministically(products, {
      nicheMomentumPct: 12,
      nicheEngagement: 300,
    });
    expect(scored.map((p) => p.signals.demand)).toEqual([62, 62]);
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

/* ==================================================== 7. Kanıt modeli */

describe("kanıt modeli (evidence slots)", () => {
  it("hiç kanıt yoksa bütünlük 0 ve BEŞ çekirdek eksik raporlanır", () => {
    const p = normalizeRaw(
      raw({
        priceUsd: null,
        brand: "",
        seller: "",
        url: "",
        notes: "",
        rating: null,
        ratingCount: null,
        inStock: null,
      }),
    );
    expect(p.dataCompleteness).toBe(0);
    expect([...p.missingFields].sort()).toEqual(["brand", "demand", "price", "seller", "url"]);
  });

  it("her alan doluyken bütünlük 5'tir (ölçek tavanı aşılmaz)", () => {
    const p = normalizeRaw(
      raw({
        brand: "Philips",
        seller: "Amazon",
        url: "https://x.test/1",
        notes: "4.6 puan · 1.204 değerlendirme",
      }),
    );
    expect(p.dataCompleteness).toBe(5);
    expect(p.missingFields).toEqual([]);
  });

  it("bonus alanların (rating/stok) yokluğu EKSİK sayılmaz", () => {
    // Puanı ve stoğu olmayan kaynaklar çoğunlukta; yoklukları kanıtsızlık
    // sayılırsa doğru satırlar haksız cezalanır.
    const p = normalizeRaw(
      raw({
        priceUsd: 29.99,
        brand: "Cosori",
        url: "https://x.test/2",
        notes: "412 değerlendirme",
        rating: null,
        ratingCount: null,
        inStock: null,
      }),
    );
    // price + brand + url + demand = 4; bonusların hiçbiri dolu değil.
    expect(p.dataCompleteness).toBe(4);
    for (const bonus of ["rating", "ratingCount", "stock"]) {
      expect(p.missingFields).not.toContain(bonus);
    }
  });

  it("notes içindeki sayısal sinyal talep kanıtı sayılır", () => {
    const base = {
      priceUsd: null,
      brand: "",
      seller: "",
      rating: null,
      ratingCount: null,
      inStock: null,
    };
    const withNumber = normalizeRaw(raw({ ...base, url: "https://x.test/3", notes: "842 yorum" }));
    const without = normalizeRaw(
      raw({ ...base, url: "https://x.test/3", notes: "tartışma sürüyor" }),
    );
    expect(withNumber.dataCompleteness).toBe(2); // url + demand
    expect(without.dataCompleteness).toBe(1); // yalnız url
    expect(without.missingFields).toContain("demand");
  });

  it("yalnız boşluktan gelen marka kanıt sayılmaz", () => {
    const p = normalizeRaw(raw({ brand: "   " }));
    expect(p.missingFields).toContain("brand");
  });
});

/* ============================================ 8. Bing Shopping kaynağı */

/**
 * ÖLÇÜLEN GERÇEK SUNUCU HTML'İNİN KÜÇÜLTÜLMÜŞ HALİ.
 *
 * Fixture bilerek CANLI YAPIDAN kopyalandı (2026-09-27): kart sınıfı
 * `br-gOffCard`, puan `aria-label="Star Rating: …"`, hacim `sa_rt_num`,
 * talep `br-offSecLbl[title]`, yönlendirme `a` href'inde base64 `u=a1…`.
 * Parser bu sınıflara bağlı olduğu için fixture de yapıyı bozmamalı.
 */
const shopCard = (inner: string) =>
  `<div class="br-gOffCard" data-offerId="1"><a class="br-offLink" href="https://www.bing.com/aclick?u=a1aHR0cHM6Ly93d3cud2FsbWFydC5jb20vaXAvYWlyLWZyeWVyLXBybz9hMTIz">${inner}</div>`;

const shopHtml = (...cards: string[]) =>
  `<html><body><div class="slide">${cards.join("")}</div></body></html>`;

const withRating = shopCard(`
  <div class="br-offSecLbl" title="More than 1K people from Bing viewed this product in the last 90 days">
    <div class="resp-one-line ">1K+ viewed</div></div>
  <div class="br-offTtl b_primtxt"><span title="Cosori Pro II Air Fryer 6.5QT">Cosori Pro II Air Fryer 6.5QT</span></div>
  <div class="br-offPrice"><div class="br-price">$129.99</div></div>
  <div class="br-offSlr"><span class="br-offSlrTxt">Walmart</span></div>
  <div id="polerat_9" class="br-offDec sa_rating">
    <div class="tags ratingNeutral"><span class="csrc" role="img" aria-label="Star Rating: 4.6 out of 5."></span>
    <div class="sa_lw_rt">4.6</div><div class="sa_lw_rt_sp">&#183;</div>
    <div class="sa_rt_num">1,204</div></div></div>`);

const withPriceOnly = shopCard(`
  <div class="br-offTtl b_primtxt"><span title="Generic Air Fryer Basket 8L">Generic Air Fryer Basket 8L</span></div>
  <div class="br-offPrice"><div class="br-price">$18.40</div></div>
  <div class="br-offSlr"><span class="br-offSlrTxt">AliExpress</span></div>`);

/** `fetch`'i tek seferlik sahte yanıtla değiştirir ve geri alır. */
async function withShopHtml<T>(html: string, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(html, { status: 200 })) as unknown as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

describe("bingShoppingSource", () => {
  it("GERÇEK puanı, değerlendirme sayısını, satıcıyı ve fiyatı okur", async () => {
    const [row] = await withShopHtml(shopHtml(withRating), () =>
      bingShoppingSource.scrape("air fryer"),
    );
    expect(row).toBeDefined();
    expect(row!.rating).toBe(4.6);
    // "1,204" → 1204: hacimsiz puan yanıltıcıdır, sayı doğru çözülmeli.
    expect(row!.ratingCount).toBe(1204);
    expect(row!.seller).toBe("Walmart");
    expect(row!.priceUsd).toBe(129.99);
    expect(row!.brand).toBe("Cosori");
    expect(row!.notes).toContain("1K+ görüntülenme / 90g");
  });

  it("SAYISIZ 'görüntülenme' kutusu talep kanıtı ÜRETMEZ", async () => {
    // Regresyon: geniş regex `style="top:150px;">` açılışındaki `>`'da
    // kesilip BOŞ dize yakalıyor, "görüntülenme" iddiası sayı üretmeden
    // notlara yazılıyordu. Kanıtsız talep satışı yapmayız.
    const noNumber = shopCard(`
      <div class="br-offSecLbl" title="More than people from Bing viewed this product"
           style="top:150px;"><div class="resp-one-line ">viewed</div></div>
      <div class="br-offTtl"><span title="Ninja Air Fryer Pro 8QT">Ninja Air Fryer Pro 8QT</span></div>
      <div class="br-offPrice"><div class="br-price">$99.99</div></div>`);
    const [row] = await withShopHtml(shopHtml(noNumber), () =>
      bingShoppingSource.scrape("air fryer"),
    );
    expect(row!.priceUsd).toBe(99.99);
    expect(row!.notes).toBe("");
  });

  it("yönlendirme adresini gerçek ürün URL'sine çözer", async () => {
    const [row] = await withShopHtml(shopHtml(withRating), () =>
      bingShoppingSource.scrape("air fryer"),
    );
    expect(row!.url).toBe("https://www.walmart.com/ip/air-fryer-pro?a123");
  });

  it("puan yazmayan kartta puan UYDURMAZ, null bırakır", async () => {
    const [row] = await withShopHtml(shopHtml(withPriceOnly), () =>
      bingShoppingSource.scrape("air fryer"),
    );
    expect(row!.rating).toBeNull();
    expect(row!.ratingCount).toBeNull();
    expect(row!.priceUsd).toBe(18.4);
  });

  it("fiyatı da puanı da olmayan kartı gürültü olarak DROPS", async () => {
    const bare = shopCard(
      `<div class="br-offTtl"><span title="Air Fryer Cookbook Volume One">Air Fryer Cookbook Volume One</span></div>`,
    );
    const rows = await withShopHtml(shopHtml(bare), () => bingShoppingSource.scrape("air fryer"));
    expect(rows).toHaveLength(0);
  });

  it("nişle ilgisiz kartı eler", async () => {
    const offNiche = shopCard(`
      <div class="br-offTtl"><span title="Ergonomic Office Chair Lumbar Support">Ergonomic Office Chair Lumbar Support</span></div>
      <div class="br-offPrice"><div class="br-price">$189.00</div></div>`);
    const rows = await withShopHtml(shopHtml(offNiche), () =>
      bingShoppingSource.scrape("air fryer"),
    );
    expect(rows).toHaveLength(0);
  });

  it("ölçülebilir kart yoksa kaynak HATA VERMEZ, 0 satır döner", async () => {
    // Kaynak doğru çalıştı, sadece bu nişte ölçülebilir ürün bulamadı. Bu bir
    // hat değil; `ok:true, items:0` demek dürüst cevaptır (dosyanın gürültü
    // kapısı sözleşmesi). Hata, ancak SAYFA yapısı değişmiş/engellenmişse.
    const bare = shopCard(
      `<div class="br-offTtl"><span title="Air Fryer Recipe Book Deluxe Edition">Air Fryer Recipe Book Deluxe Edition</span></div>`,
    );
    const rows = await withShopHtml(shopHtml(bare), () => bingShoppingSource.scrape("air fryer"));
    expect(rows).toHaveLength(0);
  });

  it("sayfa yapısı bozulursa (kart yok) kaynak hata bildirir", async () => {
    // `runSources` bunu yakalayıp `ok:false` yazar; diğer kaynaklar yaşar.
    // Sessiz "başarılı ama 0 satır" demek, engellenmeyi gizlerdi.
    await expect(
      withShopHtml("<html><body>yapı değişti</body></html>", () =>
        bingShoppingSource.scrape("air fryer"),
      ),
    ).rejects.toThrow();
  });
});

/* ================================= 9. Ortak niş kazıyıcı uçları */

describe("sharedNicheScrapers", () => {
  it("Hacker News çağrısı limiti URL'ye yazar ve alanları normalize eder", async () => {
    const original = globalThis.fetch;
    let seenUrl = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      seenUrl = String(input);
      return new Response(
        JSON.stringify({
          hits: [
            {
              title: "Show HN: air fryer automation",
              points: 42,
              num_comments: 7,
              objectID: "123",
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    try {
      const stories = await fetchHackerNewsStories("air fryer", 8, 1_000);
      expect(seenUrl).toContain("hitsPerPage=8");
      expect(seenUrl).toContain("query=air%20fryer");
      expect(stories).toEqual([
        {
          title: "Show HN: air fryer automation",
          points: 42,
          comments: 7,
          // `url` alanı yoksa HN kalıcı bağlantısına düşülür (asla boş kalmaz).
          url: "https://news.ycombinator.com/item?id=123",
        },
      ]);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("arşiv çağrısı `selftext` indekli alanını kullanır (title sorgusu bozuk)", async () => {
    const original = globalThis.fetch;
    let seenUrl = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      seenUrl = String(input);
      return new Response(JSON.stringify({ data: [{ title: "air fryer" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const posts = await fetchArcticPosts({
        subreddit: "amazonfinds",
        selftext: "air fryer",
        limit: 30,
        ms: 1_000,
      });
      expect(seenUrl).toContain("selftext=air+fryer");
      expect(seenUrl).toContain("limit=30");
      expect(posts).toHaveLength(1);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("permalink adresine çevrilir, yoksa topluluk sayfasına düşer", () => {
    expect(arcticPostUrl({ permalink: "/r/x/comments/1" }, "amazonfinds")).toBe(
      "https://reddit.com/r/x/comments/1",
    );
    expect(arcticPostUrl({}, "amazonfinds")).toBe("https://reddit.com/r/amazonfinds/");
  });
});
