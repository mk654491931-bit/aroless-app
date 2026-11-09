import { describe, expect, it } from "vitest";
import { TOOL_PROVIDER, type ToolId } from "./tools-prompts.server";
import { TOOL_AI_PROFILES, TOOL_FREE_DATA, toolAiProfile } from "./tools-routing";

const TOOLS = Object.keys(TOOL_PROVIDER) as ToolId[];

describe("araç AI derinlik profili", () => {
  it("23 aracın hepsi için profil tanımlı", () => {
    expect(Object.keys(TOOL_AI_PROFILES).sort()).toEqual([...TOOLS].sort());
    expect(TOOLS).toHaveLength(23);
  });

  it("her profil geçerli motor bütçesi ve sıcaklık taşır", () => {
    for (const tool of TOOLS) {
      const profile = TOOL_AI_PROFILES[tool];
      expect(["fast", "balanced", "deep"], tool).toContain(profile.depth);
      expect([1, 2, 3], tool).toContain(profile.maxDrafts);
      expect(profile.temperature, tool).toBeGreaterThanOrEqual(0);
      expect(profile.temperature, tool).toBeLessThanOrEqual(1);
      expect(profile.reason.trim().length, tool).toBeGreaterThan(10);
      // Sentez yalnız en az iki taslakla anlamlıdır.
      if (profile.synthesize) expect(profile.maxDrafts, tool).toBeGreaterThanOrEqual(2);
    }
  });

  it("deterministik hesaplayıcılar tek motor, yüksek riskli kararlar üç motor", () => {
    for (const tool of [
      "reverse-cost",
      "landed-cost",
      "capital-planner",
      "desi-optimizer",
      "lead-time",
    ] as const) {
      expect(TOOL_AI_PROFILES[tool].depth, tool).toBe("fast");
      expect(TOOL_AI_PROFILES[tool].maxDrafts, tool).toBe(1);
      expect(TOOL_AI_PROFILES[tool].synthesize, tool).toBe(false);
    }
    for (const tool of [
      "legitimacy-detector",
      "compliance-check",
      "hs-classifier",
      "milestone-shield",
      "growth-plan",
      "competitor-intel",
    ] as const) {
      expect(TOOL_AI_PROFILES[tool].depth, tool).toBe("deep");
      expect(TOOL_AI_PROFILES[tool].maxDrafts, tool).toBe(3);
      expect(TOOL_AI_PROFILES[tool].synthesize, tool).toBe(true);
    }
  });

  it("ücretsiz canlı veri yalnız karar değiştiren araçlara bağlı", () => {
    expect(TOOL_FREE_DATA["landed-cost"]).toContain("fx");
    expect(TOOL_FREE_DATA["legitimacy-detector"]).toContain("supplier-page");
    expect(TOOL_FREE_DATA.news).toContain("rss-news");
    expect(TOOL_FREE_DATA["listing-seo"]).toBeUndefined();
    expect(toolAiProfile("landed-cost")?.depth).toBe("fast");
    expect(toolAiProfile("bilinmeyen")).toBeNull();
  });
});
