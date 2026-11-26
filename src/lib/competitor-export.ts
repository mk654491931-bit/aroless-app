import type { CompetitorReport, CompetitorSeller } from "./competitor.server";
import { markdownTable, rowsToCsv } from "./module-export";

export type CompetitorSort = "sales" | "price" | "rating" | "authority";

/** Satıcıları seçilen ölçüte göre büyükten küçüğe sıralar; girdiyi değiştirmez. */
export function sortCompetitorSellers(
  sellers: readonly CompetitorSeller[],
  sort: CompetitorSort,
): CompetitorSeller[] {
  const value = (seller: CompetitorSeller): number => {
    if (sort === "price") return seller.price_usd;
    if (sort === "rating") return seller.rating;
    if (sort === "authority") return seller.domain_rank ?? 0;
    return seller.est_monthly_sales;
  };
  return [...sellers].sort((a, b) => value(b) - value(a));
}

export type CompetitorSummary = {
  count: number;
  minPrice: number;
  maxPrice: number;
  medianPrice: number;
  totalMonthlySales: number;
};

/** Fiyat aralığını ve toplam aylık satışı tek yerde özetler. */
export function competitorSummary(sellers: readonly CompetitorSeller[]): CompetitorSummary {
  const prices = sellers
    .map((seller) => seller.price_usd)
    .filter((price) => Number.isFinite(price) && price > 0)
    .sort((a, b) => a - b);
  const median =
    prices.length === 0
      ? 0
      : prices.length % 2 === 1
        ? prices[Math.floor(prices.length / 2)]
        : (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2;
  return {
    count: sellers.length,
    minPrice: prices[0] ?? 0,
    maxPrice: prices[prices.length - 1] ?? 0,
    medianPrice: Math.round(median * 100) / 100,
    totalMonthlySales: sellers.reduce(
      (sum, seller) =>
        sum + (Number.isFinite(seller.est_monthly_sales) ? seller.est_monthly_sales : 0),
      0,
    ),
  };
}

export function buildCompetitorCsv(report: CompetitorReport): string {
  return rowsToCsv([
    [
      "Satici",
      "Platform",
      "Domain",
      "Domain yetkisi",
      "Fiyat USD",
      "Fiyat trendi",
      "Aylik satis",
      "Stok",
      "Puan",
      "Trafik",
      "Marj notu",
      "URL",
    ],
    ...report.sellers.map((seller) => [
      seller.seller,
      seller.platform,
      seller.domain ?? "",
      seller.domain_rank ?? "",
      seller.price_usd,
      seller.price_trend,
      seller.est_monthly_sales,
      seller.est_stock,
      seller.rating,
      seller.traffic_sources.join(" + "),
      seller.margin_note,
      seller.url ?? "",
    ]),
  ]);
}

export function buildCompetitorMarkdown(report: CompetitorReport, countryLabel: string): string {
  const summary = competitorSummary(report.sellers);
  const lines = [
    `# Rakip Analizi — ${report.query}`,
    "",
    `- **Pazar:** ${countryLabel} (${report.country})`,
    `- **Satıcı:** ${summary.count}`,
    `- **Ortalama fiyat:** $${report.avg_price_usd.toFixed(2)}`,
    `- **Fiyat aralığı:** $${summary.minPrice.toFixed(2)} – $${summary.maxPrice.toFixed(2)}`,
    `- **Medyan fiyat:** $${summary.medianPrice.toFixed(2)}`,
    `- **Toplam tahmini aylık satış:** ${summary.totalMonthlySales.toLocaleString("tr-TR")}`,
  ];
  if (typeof report.trend_momentum_pct === "number") {
    lines.push(
      `- **Arama momentumu:** ${report.trend_momentum_pct > 0 ? "+" : ""}${report.trend_momentum_pct}%`,
    );
  }
  lines.push("");

  if (report.sellers.length) {
    lines.push(
      "## Satıcılar",
      "",
      markdownTable(
        ["Satıcı", "Platform", "Fiyat", "Aylık satış", "Puan", "Domain yetkisi", "Marj notu"],
        report.sellers.map((seller) => [
          seller.seller,
          seller.platform,
          `$${seller.price_usd.toFixed(2)}`,
          seller.est_monthly_sales,
          seller.rating.toFixed(1),
          seller.domain_rank ?? "—",
          seller.margin_note,
        ]),
      ),
      "",
    );
  }

  if (report.weaknesses.length) {
    lines.push("## Zayıflıklar ve fırsatlar", "");
    for (const weakness of report.weaknesses) {
      lines.push(`- **${weakness.complaint}** (${weakness.frequency}) → ${weakness.opportunity}`);
    }
    lines.push("");
  }

  if (report.strategy) {
    lines.push(
      "## Karşı strateji",
      "",
      `**${report.strategy.headline}**`,
      "",
      report.strategy.positioning,
      "",
      `**Fiyat tavsiyesi:** ${report.strategy.price_advice}`,
      "",
      ...report.strategy.playbook.map((step, index) => `${index + 1}. ${step}`),
    );
    if (report.strategy.ad_angle) lines.push("", `**Reklam açısı:** ${report.strategy.ad_angle}`);
    lines.push("");
  }

  lines.push(
    "---",
    "Aroless Rakip Analizi — satıcı verileri tahmini/derlenmiştir; karar öncesi canlı ilanları doğrulayın.",
  );
  return lines.join("\n");
}
