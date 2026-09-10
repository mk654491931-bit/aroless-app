import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COUNCIL_AGENTS,
  normalizeCouncilOutput,
  relaxSearchQuery,
  runStrictCouncilChain,
} from "./council-chain.server";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("strict council chain", () => {
  it("runs all 14 members sequentially and preserves prior JSON", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const calls: string[] = [];
    const prompts: string[] = [];

    const result = await runStrictCouncilChain({
      query: "şarjlı masa lambası",
      candidates: [{ name: "Şarjlı masa lambası", category: "Aydınlatma" }],
      run: async (agent, prompt) => {
        calls.push(agent.key);
        prompts.push(prompt);
        if (agent.key === "cfo") {
          return {
            ok: true,
            raw: {
              cfo_score: 80,
              unit_economics_valid: true,
              margin_ratio: 2.4,
              flag: "verified",
            },
          };
        }
        if (agent.key === "cmo") {
          return { ok: true, raw: { cmo_score: 0, target_roas: 0, audience_fit: null } };
        }
        return { ok: true, raw: {} };
      },
    });

    expect(calls).toEqual(COUNCIL_AGENTS.map((agent) => agent.key));
    expect(prompts[1]).toContain('"cfo_score":80');
    expect(result.logs).toHaveLength(14);
    expect(result.outputs.cfo?.cfo_score).toBe(80);
    expect(result.outputs.cmo?.cmo_score).toBe(50);
    expect(result.outputs.independent_data_auditor?.auditor_score).toBe(50);
    expect(result.logs.filter((log) => log.status === "EMPTY").length).toBe(12);
    expect(result.logs.filter((log) => log.status === "FALLBACK_TRIGGERED").length).toBe(1);
    expect(result.finalScore).toBe(
      Math.round(result.councilAverage * 0.7 + result.productFingerprint * 0.3),
    );
  });

  it("turns null, zero, invalid enums, and extra fields into strict neutral JSON", () => {
    const normalized = normalizeCouncilOutput("cro", {
      cro_score: null,
      ip_risk_level: "UNKNOWN",
      trademark_cleared: "yes",
      extra: "must be removed",
    });

    expect(normalized.usedFallback).toBe(true);
    expect(normalized.output).toEqual({
      cro_score: 50,
      ip_risk_level: "MEDIUM",
      trademark_cleared: false,
    });
    expect("extra" in normalized.output).toBe(false);
  });
});

describe("council search recovery", () => {
  it("relaxes a query from exact phrase to broad terms and keyword", () => {
    expect(relaxSearchQuery("  ev için akıllı taşınabilir kahve makinesi  ")).toEqual([
      "ev için akıllı taşınabilir kahve makinesi",
      "ev akıllı taşınabilir",
      "ev",
    ]);
  });

  it("does not create an empty search query", () => {
    expect(relaxSearchQuery("   ")).toEqual([]);
  });
});
