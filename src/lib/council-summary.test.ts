// Arayüzde "kaç ajan koştu" bilgisini dürüstçe gösteren özet. Eskiden ürün
// kartı `depth === "enrich"` etiketine bakıp her koşuda "6 uzman ekip + Müdür"
// yazıyordu; arka planda 14 ajan koşsa bile kullanıcı eksik görüyordu. Bu
// testler özetin fiili çıktıya (hakem motoru + denetçi puanı) baktığını sabitler.
import { describe, expect, it } from "vitest";
import { councilAgentSummary, type CouncilSummary } from "./consensus-types";

type Team = CouncilSummary["teams"][number];

function team(i: number, reviewed: boolean): Team {
  return {
    team: (["market", "finance", "marketing", "operations", "compliance", "creative"] as const)[
      i % 6
    ]!,
    title: `Ekip ${i + 1}`,
    score: 70,
    engine: "Groq",
    summary: "Özet",
    ...(reviewed ? { review_score: 65, reviewer_engine: "Gemini", review_note: "Teyit" } : {}),
  };
}

function council(overrides: Partial<CouncilSummary> = {}): CouncilSummary {
  return {
    velora_score: 72,
    verdict: "GİR",
    director_engine: "Aroless Premium",
    executive_report: "rapor",
    teams: [0, 1, 2, 3, 4, 5].map((i) => team(i, false)),
    action_plan: [],
    risks: [],
    cache_hit: false,
    ...overrides,
  };
}

describe("councilAgentSummary", () => {
  it("14 ajanın tamamı koştuysa 14 sayar ve '14 ajan' yazar", () => {
    const c = council({
      teams: [0, 1, 2, 3, 4, 5].map((i) => team(i, true)),
      auditor_score: 60,
      auditor_engine: "Gemini",
    });
    const summary = councilAgentSummary(c);
    expect(summary.full).toBe(true);
    expect(summary.agentCalls).toBe(14); // 6 ekip + 6 hakem + müdür + denetçi
    expect(summary.reviewerCount).toBe(6);
    expect(summary.hasAuditor).toBe(true);
    expect(summary.label).toContain("14 ajan");
  });

  it("hakem turu ve denetçi atlanmışsa dürüstçe '7 ajan' der (eski enrich davranışı)", () => {
    const summary = councilAgentSummary(council()); // 6 ekip + müdür, hakem yok
    expect(summary.full).toBe(false);
    expect(summary.agentCalls).toBe(7);
    expect(summary.reviewerCount).toBe(0);
    expect(summary.hasAuditor).toBe(false);
    expect(summary.label).toContain("7 ajan");
    expect(summary.label).not.toContain("14 ajan");
  });

  it("kısmi durumda (hakem var, denetçi yok) 13 sayar ve tam saymaz", () => {
    const c = council({
      teams: [0, 1, 2, 3, 4, 5].map((i) => team(i, true)),
    });
    const summary = councilAgentSummary(c);
    expect(summary.agentCalls).toBe(13);
    expect(summary.full).toBe(false);
    expect(summary.label).toContain("13 ajan");
  });

  it("müdür cevapsızsa (unavailable) onu saymaz", () => {
    const c = council({
      director_engine: "unavailable",
      teams: [0, 1, 2, 3, 4, 5].map((i) => team(i, true)),
      auditor_score: 55,
    });
    const summary = councilAgentSummary(c);
    expect(summary.agentCalls).toBe(13); // 6 ekip + 6 hakem + denetçi
    expect(summary.full).toBe(false);
  });

  it("boş/eksik karnede çökmez", () => {
    const summary = councilAgentSummary(council({ teams: [] }));
    expect(summary.agentCalls).toBe(1); // yalnızca müdür
    expect(summary.full).toBe(false);
  });
});
