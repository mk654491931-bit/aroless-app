// Ajanların veri kaynağı kontratı (ağ yok, saf mantık).
//
// Neden gerekli: 4 ajanlı fikir birliği motoru (piyasa tarayıcı, büyüme
// stratejisti, risk denetçisi, bağımsız doğrulayıcı) yalnızca sabit üç
// sağlayıcıyı deniyordu (Gemini → ağ geçidi → Groq). Kullanıcının kurulumunda
// ağ geçidi yok ve iki sağlayıcı da o an kotadaysa ajanlar `score: 0` /
// `unavailable` dönüyor, ürün "AI onayı yok" diye eleniyordu. Artık zincirin
// sonu 22 slotluk anahtar havuzunu süpürür: hangi anahtar müsaitse cevabı o
// verir, yani her ajanın kararı bir AI API'sinden gelir.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./ai.server", () => {
  const approved = JSON.stringify({
    score: 88,
    decision: "APPROVED",
    summary: "Havuzdan gelen karar.",
    points: ["talep", "marj", "lojistik"],
  });
  return {
    GEMINI_MODELS_LATEST: ["gemini-flash-latest", "gemini-2.5-flash", "gemini-2.0-flash"],
    callGemini: vi.fn(async () => {
      throw new Error("QUOTA: gemini exhausted");
    }),
    callLovableAI: vi.fn(async () => {
      throw new Error("gateway down");
    }),
    callGroq: vi.fn(async () => {
      throw new Error("429 groq rate limited");
    }),
    callAiMesh: vi.fn(async () => approved),
    extractJson: (text: string, fallback: unknown) => {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return fallback;
      }
    },
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ajanlar sağlayıcı düşünce boş dönmez, havuzdan beslenir", () => {
  it("Gemini + ağ geçidi + Groq tükense de 4 ajanın kararı havuzdan gelir", async () => {
    const { callAiMesh, callGemini, callGroq } = await import("./ai.server");
    const { runConsensus } = await import("./agents.server");

    const result = await runConsensus({
      context: "Şarjlı masa lambası — aydınlatma nişi, TR pazarı",
      profit_margin_pct: 52,
      competition_level: "Medium",
    });

    // Üç sağlayıcı gerçekten başarısız oldu (kota/429) — yani havuz son şans.
    expect(callGemini).toHaveBeenCalled();
    expect(callGroq).toHaveBeenCalled();
    expect(callAiMesh).toHaveBeenCalled();

    // Buna rağmen hiçbir ajan boş dönmedi: puan ve gerekçe havuzdan geldi.
    expect(result.agent1.score).toBe(88);
    expect(result.agent1.decision).toBe("APPROVED");
    expect(result.agent2.score).toBe(88);
    expect(result.agent2.decision).toBe("APPROVED");
    expect(result.agent4?.score).toBe(88);
    expect(result.average_score).toBe(88);
    expect(result.approved).toBe(true);
    expect(result.agent1.summary.length).toBeGreaterThan(0);
    expect(result.agent1.points.length).toBeGreaterThan(0);
  });

  it("havuzun cevabı geçersizse ajan 'REJECTED' döner, ama uydurma puan üretmez", async () => {
    const ai = await import("./ai.server");
    const mesh = vi.mocked(ai.callAiMesh);
    const original = mesh.getMockImplementation();
    mesh.mockImplementation(async () => "not json at all");
    try {
      const { runConsensus } = await import("./agents.server");
      const result = await runConsensus({ context: "test", profit_margin_pct: 0 });

      expect(mesh).toHaveBeenCalled();
      expect(result.agent1.score).toBe(0);
      expect(result.agent1.decision).toBe("REJECTED");
      expect(result.approved).toBe(false);
    } finally {
      if (original) mesh.mockImplementation(original);
    }
  });
});
