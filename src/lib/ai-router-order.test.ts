/**
 * Pins the f/p + reliability priority of the shared provider chains so nobody
 * accidentally moves single-key providers ahead of the 5-key pools again.
 */
import { describe, expect, it } from "vitest";
import { DEEP_CHAIN, FAST_CHAIN, type ProviderId } from "./ai-router.server";

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
    expect(DEEP_CHAIN.indexOf("huggingface")).toBeLessThan(
      DEEP_CHAIN.indexOf("bedrock"),
    );
    expect(DEEP_CHAIN[DEEP_CHAIN.length - 1]).toBe("bedrock");
  });

  it("both chains cover the full configured pool", () => {
    for (const chain of [FAST_CHAIN, DEEP_CHAIN]) {
      for (const p of ["groq", "gemini", "openrouter", "huggingface"] as ProviderId[])
        expect(chain).toContain(p);
    }
  });

  it("no provider appears twice in a chain", () => {
    for (const chain of [FAST_CHAIN, DEEP_CHAIN])
      expect(new Set(chain).size).toBe(chain.length);
  });
});
