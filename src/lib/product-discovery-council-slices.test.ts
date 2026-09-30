// ============================================================================
// DİLİMLİ KONSEY — 14 ROL, DİLİM BAŞINA BİR DALGA (birim testleri, AĞ YOK).
//
// Kilitlenen söz: dilimleme adımı KÜÇÜLTÜR ama sonucu DEĞİŞTİRMEZ. Ayrıca:
//   • her dilim en fazla `concurrency` rol çağırır,
//   • hiçbir rol iki kez denenmez (dilimler arası `done` defteri),
//   • dilim dilim koşan konsey, tek istekte koşan konseyle BİREBİR aynıdır,
//   • süre bitince/ zorla bitirmede kalan roller deterministiğe düşer ve YENİ
//     çağrı başlatılmaz.
// ============================================================================
import { describe, expect, it } from "vitest";

import { COUNCIL_AGENTS, COUNCIL_AGENT_KEYS } from "./council-chain.server";
import {
  councilRoleQueue,
  deserializeCouncilScores,
  runCouncilSlice,
  runCouncilWithAi,
  serializeCouncilState,
  type CouncilSliceState,
} from "./product-discovery-council-ai.server";
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
  fingerprint: "fp-1",
  preScore: 70,
  signals: { demand: 80, competition: 60, margin: 70, rating: 85, availability: 50 },
  dataCompleteness: 4,
  missingFields: [],
  source: "scraped",
  ...over,
});

const rows = [product(), product({ name: "Cosori Pro II", fingerprint: "fp-2" })];

/** Aynı isteme her zaman aynı puanı veren sahte model (tekrarlanabilir). */
function hashCall(prompt: string): string {
  let h = 0;
  for (let i = 0; i < prompt.length; i++) h = (h * 31 + prompt.charCodeAt(i)) % 9973;
  return JSON.stringify({
    scores: rows.map((_, i) => ({ i: i + 1, score: (h + i * 7) % 101, note: "n" })),
  });
}

/** Hangi rolün konuştuğunu istemden çıkarır (rol adı istemde geçer). */
function roleOf(prompt: string): string {
  return COUNCIL_AGENTS.find((a) => prompt.includes(a.name))?.key ?? "?";
}

describe("konsey dilim yürütücüsü", () => {
  it("HER DİLİM EN FAZLA BİR DALGA koşar (10 sn'lik işlem kuralı)", async () => {
    const perSlice: number[] = [];
    let calls = 0;
    const slice = await runCouncilSlice(rows, "air fryer", {
      call: async (prompt) => {
        calls++;
        return hashCall(prompt);
      },
      sliceDeadlineAt: Date.now() + 60_000,
      concurrency: 4,
    });
    perSlice.push(calls);

    expect(slice.partial).toBe(true);
    expect(calls).toBe(4);
    expect(slice.remaining).toBe(COUNCIL_AGENT_KEYS.length - 4);
  });

  it("ARA DURUMU döner: hangi roller denendi ve puanları", async () => {
    const slice = await runCouncilSlice(rows, "air fryer", {
      call: async (prompt) => hashCall(prompt),
      sliceDeadlineAt: Date.now() + 60_000,
      concurrency: 4,
    });

    expect(slice.state.done).toHaveLength(4);
    expect(Object.keys(slice.state.scores)).toHaveLength(4);
    // Puan satırları taşınabilir (JSON) biçimdedir.
    const roundTrip = deserializeCouncilScores(slice.state.scores);
    expect(roundTrip.size).toBe(4);
    expect(roundTrip.get("cfo")?.get(1)?.score).toBe(slice.state.scores["cfo"]?.[0]?.score);
  });

  it("DİLİM DİLİM koşan konsey, TEK İSTEKTE koşanla BİREBİR aynıdır", async () => {
    const previous = process.env["COUNCIL_CONCURRENCY"];
    process.env["COUNCIL_CONCURRENCY"] = "3";
    try {
      // 1) Dilim dilim: her dilim taze bir pencere ile devam eder.
      let state: CouncilSliceState | undefined;
      const attempted: string[] = [];
      let slices = 0;
      let slicedResult: Awaited<ReturnType<typeof runCouncilSlice>> | undefined;
      for (let guard = 0; guard < 40; guard++) {
        const slice = await runCouncilSlice(rows, "air fryer", {
          call: async (prompt) => {
            attempted.push(roleOf(prompt));
            return hashCall(prompt);
          },
          state,
          sliceDeadlineAt: Date.now() + 60_000,
          concurrency: 3,
        });
        slices++;
        state = slice.state;
        if (!slice.partial) {
          slicedResult = slice;
          break;
        }
      }

      // 2) Tek istekte (aynı kod yolu).
      const single = await runCouncilWithAi(rows, "air fryer", {
        call: async (prompt) => hashCall(prompt),
      });

      expect(slicedResult).toBeDefined();
      expect(slices).toBe(Math.ceil(COUNCIL_AGENT_KEYS.length / 3));
      // Hiçbir rol iki kez denenmedi.
      expect(new Set(attempted).size).toBe(attempted.length);
      expect(new Set(attempted).size).toBe(COUNCIL_AGENT_KEYS.length);

      // Sonuç BİREBİR aynı: dilimleme sırayı değiştirir, konsensüsü değil.
      expect(
        slicedResult!.consensus.map((c) => [c.candidateId, c.councilScore, c.votes, c.coverage]),
      ).toEqual(single.consensus.map((c) => [c.candidateId, c.councilScore, c.votes, c.coverage]));
      expect(slicedResult!.aiRoles).toEqual(single.aiRoles);
    } finally {
      if (previous === undefined) delete process.env["COUNCIL_CONCURRENCY"];
      else process.env["COUNCIL_CONCURRENCY"] = previous;
    }
  });

  it("her ürün DİLİMLİ koşuda da tam 14 oy alır", async () => {
    let state: CouncilSliceState | undefined;
    let result: Awaited<ReturnType<typeof runCouncilSlice>> | undefined;
    for (let guard = 0; guard < 40; guard++) {
      const slice = await runCouncilSlice(rows, "air fryer", {
        call: async (prompt) => hashCall(prompt),
        state,
        sliceDeadlineAt: Date.now() + 60_000,
        concurrency: 4,
      });
      state = slice.state;
      if (!slice.partial) {
        result = slice;
        break;
      }
    }
    expect(result?.consensus).toHaveLength(2);
    for (const c of result?.consensus ?? []) {
      expect(c.votes).toBe(COUNCIL_AGENT_KEYS.length);
      expect(c.coverage).toBe(1);
    }
  });

  it("ZORLA BİTİRME: kalan roller deterministiğe düşer, YENİ ÇAĞRI yapılmaz", async () => {
    let calls = 0;
    const slice = await runCouncilSlice(rows, "air fryer", {
      call: async (prompt) => {
        calls++;
        return hashCall(prompt);
      },
      sliceDeadlineAt: Date.now() + 60_000,
      force: true,
    });
    expect(calls).toBe(0);
    expect(slice.partial).toBe(false);
    expect(slice.aiAgents).toBe(0);
    expect(slice.fallbackAgents).toBe(COUNCIL_AGENT_KEYS.length);
    for (const c of slice.consensus) expect(c.votes).toBe(COUNCIL_AGENT_KEYS.length);
  });

  it("SÜRE YETMİYORSA adım bitmiş SAYILMAZ (kısmi döner, sıradaki dilim devam eder)", async () => {
    let calls = 0;
    const slice = await runCouncilSlice(rows, "air fryer", {
      call: async (prompt) => {
        calls++;
        return hashCall(prompt);
      },
      // Pencere neredeyse kapalı: yeni dalga başlatılamaz.
      sliceDeadlineAt: Date.now() + 100,
    });
    expect(calls).toBe(0);
    expect(slice.partial).toBe(true);
    expect(slice.remaining).toBe(COUNCIL_AGENT_KEYS.length);
  });

  it("ADAY YOKSA istem kurulmaz (boş sonuç, çağrı yok)", async () => {
    let called = false;
    const slice = await runCouncilSlice([], "air fryer", {
      call: async () => {
        called = true;
        return "{}";
      },
      sliceDeadlineAt: Date.now() + 60_000,
    });
    expect(called).toBe(false);
    expect(slice.partial).toBe(false);
    expect(slice.consensus).toEqual([]);
  });

  it("kısmi durum bozuksa yalnız o satır elenir (hat düşmez)", () => {
    const parsed = deserializeCouncilScores({
      cfo: [{ i: 1, score: 70, note: "x" }, { i: 0, score: 10 }, { i: 2, score: "çok" }],
      // Tanınmayan/bozuk satırlar elenir (ara nokta serbest JSON'dur).
      tanimsiz: "olmadı",
      cmo: [{ i: 1, score: 999 }],
    });
    expect(parsed.get("cfo")?.get(1)?.score).toBe(70);
    expect(parsed.get("cfo")?.has(0)).toBe(false);
    expect(parsed.get("cfo")?.has(2)).toBe(false);
    expect(parsed.has("tanimsiz" as never)).toBe(false);
    // 100'e kırpılır.
    expect(parsed.get("cmo")?.get(1)?.score).toBe(100);
  });

  it("dilim defteri serileştirmesi tur atar (ara nokta JSON'a yazılabilir)", () => {
    const state = serializeCouncilState(new Map([["cfo", new Map([[1, { score: 61, note: "n" }]])]]), [
      "cfo",
    ]);
    expect(state).toEqual({ scores: { cfo: [{ i: 1, score: 61, note: "n" }] }, done: ["cfo"] });
  });

  it("rol kuyruğu aday yoksa boştur (boşa çağrı yapılmaz)", () => {
    expect(councilRoleQueue(0)).toEqual([]);
    expect(councilRoleQueue(3)).toHaveLength(COUNCIL_AGENT_KEYS.length);
  });
});
