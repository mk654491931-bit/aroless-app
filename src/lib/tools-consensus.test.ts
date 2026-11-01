import { describe, expect, it } from "vitest";
import {
  aggregateConsensus,
  consensusProviderLabels,
  type ConsensusEntry,
} from "./tools-ai.server";

const entry = (provider: ConsensusEntry["provider"], score: number): ConsensusEntry => ({
  provider,
  score,
  note: "",
});

describe("çok motorlu konsey — saf toplama", () => {
  it("altı ücretsiz sağlayıcıyı da listeler", () => {
    const ids = consensusProviderLabels().map((p) => p.id);
    expect(ids).toEqual(["gemini", "groq", "openrouter", "hf", "cerebras", "sambanova"]);
  });

  it("yalnız yanıt veren motorları paydaya katar", () => {
    const { hybrid, engines, agreement } = aggregateConsensus([
      entry("gemini", 80),
      entry("groq", 80),
      entry("cerebras", 0), // yanıt vermedi — ortalamayı aşağı çekmez
    ]);
    expect(engines).toBe(2);
    expect(hybrid).toBe(80);
    expect(agreement).toBe(100);
  });

  it("motorlar ayrışırsa uyum düşer, hibrit ağırlıklı kalır", () => {
    const { hybrid, engines, agreement } = aggregateConsensus([
      entry("gemini", 90),
      entry("groq", 40),
      entry("openrouter", 50),
    ]);
    expect(engines).toBe(3);
    expect(agreement).toBe(0); // 90-40 = 50 → 100 - 100
    expect(hybrid).toBeGreaterThan(40);
    expect(hybrid).toBeLessThan(90);
  });

  it("hiç motor konuşmazsa sıfır döner, uydurma skor yok", () => {
    expect(aggregateConsensus([entry("gemini", 0), entry("hf", 0)])).toEqual({
      hybrid: 0,
      engines: 0,
      agreement: 0,
    });
  });

  it("tek motor yanıt verirse uyum 0'dır (karşılaştıracak ikinci görüş yok)", () => {
    const result = aggregateConsensus([entry("sambanova", 72)]);
    expect(result).toEqual({ hybrid: 72, engines: 1, agreement: 0 });
  });
});
