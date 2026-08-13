// ============================================================================
// GitHub public repository trend signal ingestion for Velora Product Finder
//
// Uses the unauthenticated GitHub Search API (60 req/hr) or an optional
// GITHUB_PAT (5,000 req/hr).  Results are mapped into the same ScrapedTrend
// shape used by trend-radar.server.ts so the existing pipeline can consume
// them without any schema changes.
// ============================================================================
import { callGemini, callGroq, extractJson, mapWithConcurrency } from "./ai.server";

export type GitHubRepoTrend = {
  full_name: string;
  name: string;
  description: string;
  html_url: string;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  created_at: string;
  pushed_at: string;
  topics: string[];
  score: number;
};

export type GitHubSearchResult = {
  total_count: number;
  incomplete_results: boolean;
  items: GitHubRepoTrend[];
};

const GITHUB_API = "https://api.github.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Velora/1.0";

const cache = new Map<string, { at: number; data: GitHubRepoTrend[]; remaining: number; resetAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function authHeaders(): Record<string, string> {
  const pat = process.env["GITHUB_PAT"];
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (pat) headers.Authorization = `Bearer ${pat}`;
  return headers;
}

function cacheKey(query: string): string {
  return query.trim().toLowerCase();
}

/**
 * Search GitHub repositories with a query, respecting rate-limit headers and
 * caching results for a few minutes.  Returns an empty array on any error
 * so the pipeline always degrades gracefully.
 */
export async function searchGitHubRepos(query: string, perPage = 10): Promise<GitHubRepoTrend[]> {
  const key = cacheKey(query);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.data;
  }

  const url = `${GITHUB_API}/search/repositories?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=${perPage}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { headers: authHeaders(), signal: ctrl.signal });
    const remaining = Number(r.headers.get("x-ratelimit-remaining") ?? "0");
    const reset = Number(r.headers.get("x-ratelimit-reset") ?? "0") * 1000;

    if (r.status === 403 && remaining === 0) {
      // Rate limited — store empty result briefly so we don't hammer the API.
      cache.set(key, { at: Date.now(), data: [], remaining: 0, resetAt: reset || Date.now() + 3_600_000 });
      return [];
    }
    if (!r.ok) {
      cache.set(key, { at: Date.now(), data: [], remaining, resetAt: reset });
      return [];
    }

    const json = (await r.json()) as GitHubSearchResult;
    const items = (json.items ?? []).map((item) => ({
      full_name: item.full_name ?? "",
      name: item.name ?? "",
      description: item.description ?? "",
      html_url: item.html_url ?? "",
      language: item.language ?? null,
      stargazers_count: Number(item.stargazers_count ?? 0),
      forks_count: Number(item.forks_count ?? 0),
      created_at: item.created_at ?? "",
      pushed_at: item.pushed_at ?? "",
      topics: Array.isArray(item.topics) ? item.topics.slice(0, 8) : [],
      score: Number(item.score ?? 0),
    }));

    cache.set(key, { at: Date.now(), data: items, remaining, resetAt: reset });
    return items;
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

/**
 * Build several search queries for a niche so we cover:
 * - recently created repos with momentum
 * - repos pushed recently matching the niche
 * - topic-based searches
 */
export function buildGitHubQueries(niche: string): string[] {
  const base = niche.replace(/[^\w\s-]/g, "").trim().split(/\s+/).slice(0, 4).join(" ");
  if (!base) return [];
  const dateCutoff = new Date();
  dateCutoff.setMonth(dateCutoff.getMonth() - 12);
  const since = dateCutoff.toISOString().slice(0, 10);
  return [
    `${base} in:name,description,readme created:>${since} stars:>5`,
    `${base} in:topics pushed:>${since} stars:>3`,
    `${base} in:description,readme sort:updated`,
  ];
}

/**
 * Fetch and deduplicate GitHub repo trends for a niche.
 */
export async function fetchGitHubTrendsForNiche(niche: string): Promise<GitHubRepoTrend[]> {
  const queries = buildGitHubQueries(niche);
  if (!queries.length) return [];
  const results = await mapWithConcurrency(queries, 2, (q) => searchGitHubRepos(q, 10));
  const seen = new Set<string>();
  const out: GitHubRepoTrend[] = [];
  for (const batch of results) {
    for (const repo of batch) {
      if (!repo.full_name || seen.has(repo.full_name)) continue;
      seen.add(repo.full_name);
      out.push(repo);
    }
  }
  return out.slice(0, 12);
}

/**
 * Summarize a list of GitHub repo trends into a product-relevant paragraph.
 * Uses the existing key-rotated AI callers so the user's API keys are consumed
 * in round-robin order and rate-limit errors fall back to the Lovable gateway.
 */
export async function summarizeGitHubTrends(
  niche: string,
  repos: GitHubRepoTrend[],
  lang = "en",
): Promise<{ summary: string; top: GitHubRepoTrend[] }> {
  if (!repos.length) return { summary: "", top: [] };

  const top = repos.slice(0, 5);
  const lines = top
    .map(
      (r, i) =>
        `${i + 1}. ${r.full_name}: ${r.description || "no description"} | ${r.stargazers_count} stars | language: ${r.language || "unknown"} | topics: ${r.topics.join(", ")}`,
    )
    .join("\n");

  const prompt = `You are an e-commerce trend analyst. Below are recently trending GitHub repositories related to the niche "${niche}".
Write 1 short paragraph (max 120 words) explaining what these open-source projects reveal about emerging product opportunities, buyer pain points, or hardware/software demand in this niche.
Write in ${lang === "tr" ? "Turkish" : "English"}.

Repositories:
${lines}

Return STRICT JSON only: {"summary": string}`;

  const text = await callGemini(prompt, undefined, 0.5, false, ["gemini-flash-latest", "gemini-2.0-flash"]).catch(async () => {
    return callGroq(prompt, 0.5);
  });

  const parsed = extractJson<{ summary?: string }>(text, { summary: "" });
  return { summary: parsed.summary || "", top };
}

/** Format repo trends as a markdown-ish block for inclusion in product prompts. */
export function formatGitHubTrendsBlock(summary: string, repos: GitHubRepoTrend[]): string {
  if (!repos.length) return "";
  const lines = repos
    .slice(0, 5)
    .map(
      (r) =>
        `- ${r.full_name} (${r.stargazers_count} stars, ${r.language || "unknown"}): ${r.description || ""} [${r.topics.slice(0, 4).join(", ")}]`,
    )
    .join("\n");
  return `GITHUB TREND SIGNAL (open-source repository momentum):\n${summary ? `AI summary: ${summary}\n` : ""}Top repos:\n${lines}\n`;
}
