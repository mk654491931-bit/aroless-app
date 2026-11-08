import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children?: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

import { DiscoveryWinnerCard } from "./discovery-winner-card";
import type { DiscoveryWinner } from "@/lib/product-discovery.functions";

function winner(over: Partial<DiscoveryWinner> = {}): DiscoveryWinner {
  return {
    name: "Philips Airfryer",
    brand: "Philips",
    seller: "",
    category: "",
    priceUsd: 99,
    rating: 4.5,
    ratingCount: 20,
    inStock: true,
    salesVolume: null,
    viewed90d: null,
    sources: ["ebay-browse", "tavily-search"],
    url: "https://www.ebay.com/itm/1",
    supplier: null,
    grossMarginPct: null,
    feeBudgetUsd: null,
    cohortCompetitors: null,
    launch: null,
    notes: "",
    preScore: 70,
    dataCompleteness: 5,
    fingerprint: "philips-airfryer",
    signals: { demand: 60, competition: 40, margin: 50, rating: 80, availability: 60 },
    councilScore: 72,
    confidenceScore: 80,
    votes: 14,
    agreement: 1,
    evidence: [],
    qualityGate: null,
    scoreSource: "council",
    ...over,
  } as DiscoveryWinner;
}

describe("DiscoveryWinnerCard — kaynak kanıtı", () => {
  it("kaynakları ham kimlik yerine okunabilir adlarla gösterir", () => {
    const html = renderToStaticMarkup(<DiscoveryWinnerCard winner={winner()} rank={1} />);

    expect(html).toContain('data-testid="source-evidence"');
    expect(html).toContain("Kaynak kanıtı");
    expect(html).toContain("eBay");
    expect(html).toContain("Tavily");
    expect(html).toContain("2 kaynak");
  });

  it("kaynak adı yoksa ölçülmedi der, boş çip basmaz", () => {
    const html = renderToStaticMarkup(
      <DiscoveryWinnerCard winner={winner({ sources: [] })} rank={1} />,
    );

    expect(html).toContain("Kaynak adı ölçülmedi");
    expect(html).not.toContain("0 kaynak");
  });
});
