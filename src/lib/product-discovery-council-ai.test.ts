// ============================================================================
// 14 AJAN — GERÇEK AI OY DÖNGÜSÜ (birim testleri, AĞ YOK).
//
// Kilitlenen söz: konsey HER ZAMAN 14 oy üretir, hiçbir ürün oysuz kalmaz,
// model atladığı satırlarda deterministik değer devreye girer, süre bütçesi
// dolunca yeni çağrı başlatılmaz ve bozuk model yanıtı hattı düşürmez.
// ============================================================================
import { describe, expect, it } from "vitest";

import {
  buildAgentPrompt,
  COUNCIL_CONCURRENCY,
  parseAgentScores,
  runCouncilWithAi,
} from "./product-discovery-council-ai.server";
import { COUNCIL_AGENT_KEYS } from "./council-chain.server";
import type { NormalizedProduct } from "./product-discovery.types";

const product = (over: Partial<NormalizedProduct> = {}): NormalizedProduct => ({
  name: "Ninja Air Fryer Pro 8QT",
  brand: "Ninja",
  seller: "Walmart",
  category: "",
  priceUsd: 129.99,
  rating: 4.6,
  ratingCount: 1204,
  inStock: null,
  sources: ["bing-shopping"],
  url: "https://example.com",
  notes: "1K+ görüntülenme / 90g",
  viewed90d: 1000,
  id: "sku-8qt",
  imageUrl: "https://example.com/8qt.jpg",
  salesVolume: 2100,
  fingerprint: `fp-${Math.random().toString(36).slice(2, 8)}`,
  preScore: 70,
  signals: { demand: 80, competition: 60, margin: 70, rating: 85, availability: 50 },
  dataCompleteness: 4,
  missingFields: ["stock"],
  source: "scraped",
  ...over,
});

describe("buildAgentPrompt", () => {
  it("yalnız ÖLÇÜLMÜŞ alanları listeler (tedarik maliyeti SORMAZ)", () => {
    // Ölçülmeyen alanı sormak modeli uydurmaya çağırır; bu hatta yasak.
    const prompt = buildAgentPrompt(
      { key: "cfo", name: "CFO Agent", task: "Unit economics" },
      [product()],
      "air fryer",
    );
    expect(prompt).toContain("Ninja Air Fryer Pro 8QT");
    expect(prompt).toContain("$129.99");
    expect(prompt).toContain("4.6★");
    expect(prompt).not.toContain("tedarik");
  });

  it("JSON sözleşmesini istemde açıkça yazar", () => {
    const prompt = buildAgentPrompt(
      { key: "cmo", name: "CMO Agent", task: "Audience fit" },
      [product()],
      "air fryer",
    );
    expect(prompt).toContain('"scores"');
    expect(prompt).toContain("JSON");
  });
});

describe("parseAgentScores", () => {
  it("temiz JSON'u okur", () => {
    const scores = parseAgentScores('{"scores":[{"i":1,"score":72,"note":"iyi"}]}', 3);
    expect(scores.get(1)?.score).toBe(72);
  });

  it("```json sarmalını ve ön/son metni tolere eder", () => {
    const scores = parseAgentScores('```json\n{"scores":[{"i":2,"score":61}]}\n```', 3);
    expect(scores.get(2)?.score).toBe(61);
  });

  it("LİSTE DIŞI indeksleri ve geçersiz puanları eler", () => {
    const scores = parseAgentScores(
      '{"scores":[{"i":0,"score":10},{"i":9,"score":10},{"i":1,"score":"çok"},{"i":3,"score":999}]}',
      3,
    );
    // 0 ve 9 geçersiz indeks, "çok" geçersiz puan; 3 geçerli ama 100'e kırpılır.
    expect(scores.has(0)).toBe(false);
    expect(scores.has(9)).toBe(false);
    expect(scores.has(1)).toBe(false);
    expect(scores.get(3)?.score).toBe(100);
  });

  it("bozuk/boş yanıtta boş harita döner (hat düşmez)", () => {
    expect(parseAgentScores("", 3).size).toBe(0);
    expect(parseAgentScores("hiç json değil", 3).size).toBe(0);
    expect(parseAgentScores('{"scores":"olmadı"}', 3).size).toBe(0);
  });
});

describe("runCouncilWithAi", () => {
  const rows = [product(), product({ name: "Cosori Pro II", fingerprint: "fp-2" })];

  it("HER ÜRÜN için tam 14 oy üretir", async () => {
    const run = await runCouncilWithAi(rows, "air fryer", {
      call: async () =>
        JSON.stringify({
          scores: rows.map((_, i) => ({ i: i + 1, score: 60 + i, note: "iyi" })),
        }),
    });
    expect(run.aiAgents).toBe(COUNCIL_AGENT_KEYS.length);
    for (const c of run.consensus) {
      // `Consensus.votes` OY SAYISIDIR (0-14); kanıtlar `evidence` içindedir.
      expect(c.votes).toBe(COUNCIL_AGENT_KEYS.length);
      expect(c.coverage).toBe(1);
    }
  });

  it("model bir rolü atladığında O ROL deterministiğe düşer, oy sayısı 14 kalır", async () => {
    const run = await runCouncilWithAi(rows, "air fryer", {
      call: async (prompt) => {
        // Yalnız CFO rolü geçerli JSON dönsün, diğerleri bozuk dönsün.
        if (prompt.includes("CFO Agent")) return '{"scores":[{"i":1,"score":80}]}';
        return "bozuk yanıt";
      },
    });
    expect(run.aiAgents).toBe(1);
    expect(run.fallbackAgents).toBe(COUNCIL_AGENT_KEYS.length - 1);
    for (const c of run.consensus) expect(c.votes).toBe(COUNCIL_AGENT_KEYS.length);
  });

  it("model BİR ÜRÜNÜ atladığında o ajan için deterministik oy girer", async () => {
    const run = await runCouncilWithAi(rows, "air fryer", {
      call: async () => '{"scores":[{"i":1,"score":90}]}',
    });
    const second = run.consensus[1]!;
    expect(second.votes).toBe(COUNCIL_AGENT_KEYS.length);
    // 2. ürün modele hiç sunulmadığı gerekçesiyle burada "görmedi" notu taşımaz:
    // kanıt dizisi o ürün için deterministik ajan notlarından gelir.
    const evidence = second.evidence.join(" ");
    expect(evidence.length).toBeGreaterThan(0);
  });

  it("çağrı HATA verirse rol deterministiğe düşer, hat düşmez", async () => {
    const run = await runCouncilWithAi(rows, "air fryer", {
      call: async () => {
        throw new Error("havuz soğuk");
      },
    });
    expect(run.aiAgents).toBe(0);
    expect(run.consensus).toHaveLength(2);
    for (const c of run.consensus) expect(c.votes).toBe(COUNCIL_AGENT_KEYS.length);
  });

  it("süre bütçesi dolunca yeni çağrı BAŞLATMAZ", async () => {
    let calls = 0;
    const run = await runCouncilWithAi(rows, "air fryer", {
      deadlineAt: Date.now() - 1, // süre çoktan geçmiş
      call: async () => {
        calls++;
        return '{"scores":[{"i":1,"score":70}]}';
      },
    });
    expect(calls).toBe(0);
    expect(run.aiAgents).toBe(0);
    expect(run.fallbackAgents).toBe(COUNCIL_AGENT_KEYS.length);
    // Konsey yine de tam üretildi — sunucusuz sınırı aşmadan.
    for (const c of run.consensus) expect(c.votes).toBe(COUNCIL_AGENT_KEYS.length);
  });

  it("kanıtsız ürün (kanıt <2/5) modelin yüksek puanını 50'ye kırpar", async () => {
    // Ölçülmeyen ürün, ölçülen ürünle eşit puan alamaz; bu konseyin temel dürüstlük
    // kuralıdır (deterministik sürümde de aynı ceza vardır).
    const thin = product({ dataCompleteness: 1, fingerprint: "fp-thin" });
    const run = await runCouncilWithAi([thin], "air fryer", {
      call: async () => '{"scores":[{"i":1,"score":99}]}',
    });
    // Kanıtsız ürün 50 üstü puan alamaz: konsayl skoru da bu yüzden yüksek çıkmaz.
    expect(run.consensus[0]!.councilScore).toBeLessThanOrEqual(50);
  });

  it("AI gerekçesi kanıt dizisine taşınır (arayüzde gerekçe olarak görünür)", async () => {
    const run = await runCouncilWithAi([product()], "air fryer", {
      call: async () => '{"scores":[{"i":1,"score":77,"note":"ölçülen fiyat sağlıklı"}]}',
    });
    expect(run.consensus[0]!.evidence.join(" ")).toContain("ölçülen fiyat sağlıklı");
  });

  it("aday listesi boşsa istem kurulmaz, sonuç boş döner", async () => {
    let called = false;
    const run = await runCouncilWithAi([], "air fryer", {
      call: async () => {
        called = true;
        return "{}";
      },
    });
    expect(called).toBe(false);
    expect(run.consensus).toEqual([]);
  });
});

/**
 * SÜRE BÜTÇESİ — eşzamanlılık kaliteyi değil SÜRE kazandırır.
 *
 * Sorun bu: roller sırayla koşuyordu (14 × ~10 sn ≈ 140 sn) ve hat istemcinin
 * 280 sn'lik penceresini aşıyordu. Aşağıdaki testler iki şeyi kilitler:
 *   1. roller GERÇEKTEN eşzamanlı koşar (üstel ama sınırlı),
 *   2. eşzamanlılık uzlaşma sonucunu DEĞİŞTİRMEZ (tekrarlanabilirlik korunur).
 */
describe("konsey eşzamanlılığı", () => {
  const rows = [product({ fingerprint: "fp-1" }), product({ fingerprint: "fp-2" })];

  /** Aynı isteme her zaman aynı puanı döndüren sahte model. */
  const hashCall = (prompt: string) => {
    let h = 0;
    for (let i = 0; i < prompt.length; i++) h = (h * 31 + prompt.charCodeAt(i)) % 9973;
    return JSON.stringify({
      scores: rows.map((_, i) => ({ i: i + 1, score: (h + i * 7) % 101, note: "n" })),
    });
  };

  const withConcurrency = async (value: string) => {
    const previous = process.env["COUNCIL_CONCURRENCY"];
    process.env["COUNCIL_CONCURRENCY"] = value;
    try {
      return await runCouncilWithAi(rows, "air fryer", { call: async (p) => hashCall(p) });
    } finally {
      if (previous === undefined) delete process.env["COUNCIL_CONCURRENCY"];
      else process.env["COUNCIL_CONCURRENCY"] = previous;
    }
  };

  it("roller paralel koşar ama eşzamanlılık sınırı aşılmaz", async () => {
    let active = 0;
    let peak = 0;
    const run = await runCouncilWithAi(rows, "air fryer", {
      call: async (prompt) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return hashCall(prompt);
      },
    });
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(COUNCIL_CONCURRENCY);
    // Hız kazanırken oy sayısı eksilmez.
    expect(run.aiAgents).toBe(COUNCIL_AGENT_KEYS.length);
    for (const c of run.consensus) expect(c.votes).toBe(COUNCIL_AGENT_KEYS.length);
  });

  it("eşzamanlılık uzlaşma sonucunu DEĞİŞTİRMEZ (1 ve 4 dalga birebir aynı)", async () => {
    // Bu, "hızlandırdık ama sonucu değiştirdik" hatasının regresyon testidir:
    // sıralı ve paralel koşum aynı konsensüsü vermek ZORUNDA.
    const sequential = await withConcurrency("1");
    const parallel = await withConcurrency("4");
    expect(parallel.consensus.map((c) => [c.candidateId, c.councilScore, c.votes])).toEqual(
      sequential.consensus.map((c) => [c.candidateId, c.councilScore, c.votes]),
    );
    expect(parallel.aiRoles).toEqual(sequential.aiRoles);
  });

  it("COUNCIL_CONCURRENCY=1 gerçekten sıralı koşar", async () => {
    const previous = process.env["COUNCIL_CONCURRENCY"];
    process.env["COUNCIL_CONCURRENCY"] = "1";
    try {
      let active = 0;
      let peak = 0;
      await runCouncilWithAi(rows, "air fryer", {
        call: async (prompt) => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 2));
          active--;
          return hashCall(prompt);
        },
      });
      expect(peak).toBe(1);
    } finally {
      if (previous === undefined) delete process.env["COUNCIL_CONCURRENCY"];
      else process.env["COUNCIL_CONCURRENCY"] = previous;
    }
  });
});
