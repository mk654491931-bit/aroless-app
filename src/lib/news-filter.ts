/** Haber akışını istemci tarafında filtrelemek için saf yardımcılar. */

export type NewsFilterItem = {
  title: string;
  summary: string;
  source: string;
  category: string;
  impact: "high" | "medium" | "low";
  url?: string;
  date?: string;
};

export type NewsFilterState = {
  query: string;
  category: string;
  impact: "all" | "high" | "medium" | "low";
  savedOnly: boolean;
};

export const EMPTY_NEWS_FILTER: NewsFilterState = {
  query: "",
  category: "all",
  impact: "all",
  savedOnly: false,
};

/** Kaydetme ve filtre için kararlı kimlik: URL varsa URL, yoksa normalize başlık. */
export function newsKey(item: Pick<NewsFilterItem, "title" | "url">): string {
  const url = String(item.url ?? "").trim();
  if (url) return url.slice(0, 500);
  return String(item.title ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .slice(0, 160);
}

/** Türkçe/İngilizce büyük harf farkını arama için normalize eder. */
function searchable(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function filterNews<T extends NewsFilterItem>(
  items: readonly T[],
  filter: NewsFilterState,
  savedKeys: ReadonlySet<string> = new Set(),
): T[] {
  const query = searchable(filter.query.trim());
  return items.filter((item) => {
    if (filter.savedOnly && !savedKeys.has(newsKey(item))) return false;
    if (filter.category !== "all" && item.category !== filter.category) return false;
    if (filter.impact !== "all" && item.impact !== filter.impact) return false;
    if (!query) return true;
    return searchable(`${item.title} ${item.summary} ${item.source} ${item.category}`).includes(
      query,
    );
  });
}

export function newsCategories(items: readonly NewsFilterItem[]): string[] {
  return [...new Set(items.map((item) => item.category).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "tr"),
  );
}

export function toggleSavedNews(saved: readonly string[], key: string): string[] {
  if (!key) return [...saved];
  return saved.includes(key) ? saved.filter((item) => item !== key) : [key, ...saved].slice(0, 60);
}
