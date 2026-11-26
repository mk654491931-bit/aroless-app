import { describe, expect, it } from "vitest";
import type { CompetitorReport, CompetitorSeller } from "./competitor.server";
import {
  buildCompetitorCsv,
  buildCompetitorMarkdown,
  competitorSummary,
  sortCompetitorSellers,
} from "./competitor-export";

function seller(overrides: Partial<CompetitorSeller>): CompetitorSeller {
  return {
    seller: "Satıcı A",
    platform: "Amazon",
    domain: "ornek.com",
    domain_rank: 7,
    price_usd: 29.9,
    price_trend: "sabit",
    est_monthly_sales: 500,
    est_stock: 120,
    rating: 4.4,
    traffic_sources: ["Meta Ads"],
    margin_note: "Marj orta.",
    ...overrides,
  };
}

const report: CompetitorReport = {
  query: "posture corrector",
  country: "US",
  sellers: [
    seller({ seller: "A", price_usd: 20, est_monthly_sales: 300, rating: 4.1, domain_rank: 4 }),
    seller({ seller: "B", price_usd: 50, est_monthly_sales: 1000, rating: 4.8, domain_rank: 8 }),
    seller({ seller: "C", price_usd: 35, est_monthly_sales: 700, rating: 4.5, domain_rank: 6 }),
  ],
  avg_price_usd: 35,
  weaknesses: [{ complaint: "Kemer kayıyor", frequency: "~%30", opportunity: "Kaymaz taban" }],
  sentiment_summary: "Konfor şikâyeti baskın.",
  strategy: {
    headline: "Kaymaz tabanla ayrış",
    positioning: "Daha iyi tutuş.",
    price_advice: "$39.90 bandında kal.",
    playbook: ["Kaymaz tabanı göster", "30 gün iade ver"],
    ad_angle: "Kaymıyor, gerçekten.",
  },
  trend_momentum_pct: 12,
  trend_monthly: [20, 30, 40],
  trend_source: "google-trends",
};

describe("competitor-export", () => {
  it("satıcıları seçilen ölçüte göre sıralar ve girdiyi değiştirmez", () => {
    const bySales = sortCompetitorSellers(report.sellers, "sales");
    expect(bySales.map((s) => s.seller)).toEqual(["B", "C", "A"]);
    expect(report.sellers.map((s) => s.seller)).toEqual(["A", "B", "C"]);
    expect(sortCompetitorSellers(report.sellers, "price").map((s) => s.seller)).toEqual([
      "B",
      "C",
      "A",
    ]);
    expect(sortCompetitorSellers(report.sellers, "authority")[0].seller).toBe("B");
  });

  it("fiyat aralığı, medyan ve toplam satışı özetler", () => {
    expect(competitorSummary(report.sellers)).toEqual({
      count: 3,
      minPrice: 20,
      maxPrice: 50,
      medianPrice: 35,
      totalMonthlySales: 2000,
    });
    expect(competitorSummary([]).medianPrice).toBe(0);
  });

  it("CSV'de Türkçe başlıkları ve satırları üretir", () => {
    const csv = buildCompetitorCsv(report);
    expect(csv).toContain("Satici,Platform,Domain");
    expect(csv).toContain("A,Amazon,ornek.com");
  });

  it("Markdown raporu özet, satıcı tablosu ve playbook içerir", () => {
    const md = buildCompetitorMarkdown(report, "ABD");
    expect(md).toContain("# Rakip Analizi — posture corrector");
    expect(md).toContain("- **Medyan fiyat:** $35.00");
    expect(md).toContain("| B | Amazon | $50.00 | 1000 |");
    expect(md).toContain("Kaymaz tabanla ayrış");
    expect(md).toContain("1. Kaymaz tabanı göster");
  });
});
