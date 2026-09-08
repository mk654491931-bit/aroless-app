import { sanitizeLine, sanitizeText } from "@/lib/request-hygiene";
import type { ToolId } from "@/lib/tools-prompts.server";

export type TrendView = "now" | "next" | "season";

export function sanitizeCountry(raw: unknown, fallback = "GLOBAL", maxLength = 8): string {
  const value = sanitizeLine(raw, maxLength).toUpperCase();
  return value || fallback;
}

export function sanitizeTrendView(raw: unknown): TrendView {
  const value = sanitizeLine(raw, 10);
  return value === "next" || value === "season" ? value : "now";
}

export function sanitizeHotProductsNiche(raw: unknown): string {
  return sanitizeLine(raw, 60);
}

export function sanitizeProductImageQuery(raw: unknown): string {
  return sanitizeLine(raw, 120);
}

export function sanitizeTrendAnalysisInput(body: Record<string, unknown>) {
  const name = sanitizeLine(body["name"], 120);
  return {
    name,
    keyword: sanitizeLine(body["keyword"] ?? name, 90),
    country: sanitizeCountry(body["country"]),
    category: sanitizeLine(body["category"], 80),
    peak_month: sanitizeLine(body["peak_month"], 20),
    spike_window: sanitizeLine(body["spike_window"], 40),
    why: sanitizeText(body["why"], 400),
    marketplace: sanitizeLine(body["marketplace"], 40),
    audience: sanitizeLine(body["audience"], 160),
    competition: sanitizeLine(body["competition"] ?? "Medium", 12),
    score: Number(body["score"]) || 0,
  };
}

export function sanitizeToolInputMap(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const entries = Object.entries((raw ?? {}) as Record<string, unknown>).slice(0, 20);
  for (const [k, v] of entries) {
    out[sanitizeLine(k, 40)] = sanitizeText(v, 6000);
  }
  return out;
}

export function sanitizeToolId(raw: unknown): ToolId | "" {
  return sanitizeLine(raw, 40) as ToolId | "";
}

export function sanitizeTrendRadarAction(raw: unknown): string {
  return sanitizeLine(raw ?? "scrape", 24);
}

export function sanitizeTrendRadarCategory(raw: unknown): string {
  return sanitizeLine(raw ?? "General", 40);
}

export function sanitizeTrendRadarMode(raw: unknown): "fast" | "deep" | "strategy" {
  const mode = sanitizeLine(raw, 12);
  return mode === "deep" || mode === "strategy" ? mode : "fast";
}

export function sanitizeStringArray(raw: unknown, maxItems: number, maxLength: number): string[] {
  return (Array.isArray(raw) ? raw : []).slice(0, maxItems).map((v) => sanitizeLine(v, maxLength));
}
