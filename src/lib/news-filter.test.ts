import { describe, expect, it } from "vitest";
import {
  EMPTY_NEWS_FILTER,
  filterNews,
  newsCategories,
  newsKey,
  toggleSavedNews,
} from "./news-filter";

const ITEMS = [
  {
    title: "Amazon referral fee update",
    summary: "Apparel commission changes in 2027.",
    source: "Retail Dive",
    category: "Pazaryeri",
    impact: "high" as const,
    url: "https://example.com/amazon",
  },
  {
    title: "Port congestion eases",
    summary: "Transit times improve on Asia-US lanes.",
    source: "Supply Chain Dive",
    category: "Lojistik",
    impact: "medium" as const,
    date: "2026-11-24",
  },
  {
    title: "TikTok Shop expands",
    summary: "New seller tools launch in the US.",
    source: "Modern Retail",
    category: "Pazaryeri",
    impact: "low" as const,
  },
];

describe("news-filter", () => {
  it("ürün kimliğini URL veya normalize başlıktan üretir", () => {
    expect(newsKey(ITEMS[0]!)).toBe("https://example.com/amazon");
    expect(newsKey(ITEMS[1]!)).toBe("portcongestioneases");
  });

  it("kategori, etki ve arama metnini birlikte uygular", () => {
    expect(filterNews(ITEMS, { ...EMPTY_NEWS_FILTER, category: "Pazaryeri" })).toHaveLength(2);
    expect(filterNews(ITEMS, { ...EMPTY_NEWS_FILTER, impact: "high" })).toHaveLength(1);
    expect(filterNews(ITEMS, { ...EMPTY_NEWS_FILTER, query: "TRANSIT" })).toHaveLength(1);
    expect(
      filterNews(ITEMS, { ...EMPTY_NEWS_FILTER, category: "Pazaryeri", impact: "low" }),
    ).toHaveLength(1);
  });

  it("kaydedilenler filtresi yalnız seçili haberleri bırakır", () => {
    const saved = new Set([newsKey(ITEMS[1]!)]);
    const result = filterNews(ITEMS, { ...EMPTY_NEWS_FILTER, savedOnly: true }, saved);
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("Port congestion eases");
  });

  it("kategorileri tekilleştirip Türkçe sıralar", () => {
    expect(newsCategories(ITEMS)).toEqual(["Lojistik", "Pazaryeri"]);
  });

  it("kaydet/çıkar işlemi en yeni kaydı başa alır", () => {
    const first = toggleSavedNews([], "a");
    expect(first).toEqual(["a"]);
    expect(toggleSavedNews(first, "b")).toEqual(["b", "a"]);
    expect(toggleSavedNews(["b", "a"], "b")).toEqual(["a"]);
  });
});
