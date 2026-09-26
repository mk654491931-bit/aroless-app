/**
 * Pins the f/p + reliability priority of the shared provider chains so nobody
 * accidentally moves single-key providers ahead of the 5-key pools again.
 */
import { describe, expect, it } from "vitest";
import { DEEP_CHAIN, FAST_CHAIN, councilChainFor, type ProviderId } from "./ai-router.server";

describe("provider chain f/p ordering", () => {
  it("FAST_CHAIN leads with Groq and keeps the most rate-limited last", () => {
    expect(FAST_CHAIN[0]).toBe("groq");
    const idx = (p: ProviderId) => FAST_CHAIN.indexOf(p);
    for (const a of ["groq", "cerebras", "gemini"] as ProviderId[]) {
      for (const b of ["openrouter", "huggingface"] as ProviderId[]) {
        expect(idx(a)).toBeGreaterThanOrEqual(0);
        expect(idx(b)).toBeGreaterThanOrEqual(0);
        expect(idx(a)).toBeLessThan(idx(b));
      }
    }
    expect(FAST_CHAIN[FAST_CHAIN.length - 1]).toBe("huggingface");
  });

  it("DEEP_CHAIN leads with quality engines and trails Hugging Face then paid Bedrock", () => {
    expect(DEEP_CHAIN[0]).toBe("gemini");
    expect(DEEP_CHAIN.indexOf("groq")).toBeLessThan(DEEP_CHAIN.indexOf("huggingface"));
    expect(DEEP_CHAIN.indexOf("huggingface")).toBeLessThan(DEEP_CHAIN.indexOf("bedrock"));
    expect(DEEP_CHAIN[DEEP_CHAIN.length - 1]).toBe("bedrock");
  });

  it("both chains cover the full configured pool", () => {
    for (const chain of [FAST_CHAIN, DEEP_CHAIN]) {
      for (const p of ["groq", "gemini", "openrouter", "huggingface"] as ProviderId[])
        expect(chain).toContain(p);
    }
  });

  it("no provider appears twice in a chain", () => {
    for (const chain of [FAST_CHAIN, DEEP_CHAIN]) expect(new Set(chain).size).toBe(chain.length);
  });
});

describe("konsey sağlayıcı dağıtımı (22 ücretsiz anahtarı verimli kullan)", () => {
  it("14 ajanın hepsini TEK sağlayıcıya yığmaz", () => {
    // Eski davranış: 14 ajan da DEEP_CHAIN ile koşuyordu ve DEEP_CHAIN[0]
    // = "gemini". Ücretsiz katmanda Gemini 15 RPM sınırı olduğu için 14
    // paralel istek anında 429 üretiyor, 90 sn park ediliyor ve 22 anahtarın
    // yalnızca 5'i kullanılıyordu.
    const primaries = Array.from({ length: 14 }, (_, i) => councilChainFor(i)[0]!);
    expect(new Set(primaries).size).toBeGreaterThanOrEqual(5);
  });

  it("dağılım DETERMİNİSTİK: aynı ajan sırası → aynı sağlayıcı", () => {
    for (let i = 0; i < 14; i++) {
      expect(councilChainFor(i)).toEqual(councilChainFor(i));
    }
  });

  it("her ajan tam yedekli: 6 sağlayıcının tamamı zincirde", () => {
    for (let i = 0; i < 14; i++) {
      const chain = councilChainFor(i);
      expect(chain).toHaveLength(6);
      expect(new Set(chain).size).toBe(6);
      for (const p of [
        "groq",
        "gemini",
        "cerebras",
        "sambanova",
        "openrouter",
        "huggingface",
      ] as ProviderId[]) {
        expect(chain).toContain(p);
      }
      // Birincil sağlayıcı zincirin başında olmalı (429'da sıradakine geçsin).
      expect(chain[0]).toBe(councilChainFor(i)[0]);
    }
  });

  it("ücretsiz havuzun TAMAMI kullanılır: 5+5+5+5+1+1 = 22 anahtar", () => {
    // Kullanılan birincil sağlayıcılar tüm grupları kapsar.
    const used = new Set(Array.from({ length: 14 }, (_, i) => councilChainFor(i)[0]));
    for (const p of [
      "groq",
      "gemini",
      "cerebras",
      "sambanova",
      "openrouter",
      "huggingface",
    ] as ProviderId[]) {
      expect(used).toContain(p);
    }
  });

  it("dizge indeksleri güvenli: negatif veya devasa değer zinciri bozmaz", () => {
    for (const i of [-1, -14, 0, 13, 100, 1000]) {
      const chain = councilChainFor(i);
      expect(chain).toHaveLength(6);
      expect(new Set(chain).size).toBe(6);
    }
  });
});
