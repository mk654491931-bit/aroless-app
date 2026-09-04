import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock supabase so auth is a no-op
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
  },
}));

// Mock fetch globally
const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// apiPost tests (exercises apiFetch internally)
// ---------------------------------------------------------------------------
import { apiPost } from "./api-client";

describe("apiPost", () => {
  it("parses JSON successfully", async () => {
    const body = { status: "success", results: { headline: "test" } };
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await apiPost("/api/test", { q: "hello" }, 5000);
    expect(result).toEqual(body);
  });

  it("throws on non-OK status with error message", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Rate limited" }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(apiPost("/api/test", {}, 5000)).rejects.toThrow("Rate limited");
  });

  it("returns fallback error message when body has no error field", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("Server Error", { status: 500 }));

    await expect(apiPost("/api/test", {}, 5000)).rejects.toThrow(
      "İstek başarısız oldu. Lütfen tekrar deneyin.",
    );
  });
});

// ---------------------------------------------------------------------------
// callTool response normalization tests
// ---------------------------------------------------------------------------

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api-client")>();
  return {
    ...actual,
    apiFetch: vi.fn(),
  };
});

import { callTool } from "@/components/tools/tool-card";
import { apiFetch as mockedApiFetch } from "@/lib/api-client";

const mockFetch = vi.mocked(mockedApiFetch);

describe("callTool response normalization", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes a valid new-format response", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "success",
          results: {
            headline: "Great product",
            verdict: "GİRİLİR",
            score: 85,
            metrics: [{ label: "Margin", value: "31%", tone: "profit" }],
            bullets: ["Insight 1"],
            table: { columns: ["A"], rows: [["B"]] },
            document: "Full report",
            risks: ["Risk 1"],
            actions: ["Action 1"],
            assumptions: ["Assumption 1"],
            provider: "hibrit: gemini + groq",
            providers: ["gemini", "groq"],
            confidence: 78,
          },
          error: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await callTool("listing-seo", { product: "test" });

    expect(result.headline).toBe("Great product");
    expect(result.verdict).toBe("GİRİLİR");
    expect(result.score).toBe(85);
    expect(result.metrics).toHaveLength(1);
    expect(result.metrics[0].label).toBe("Margin");
    expect(result.bullets).toEqual(["Insight 1"]);
    expect(result.table).toEqual({ columns: ["A"], rows: [["B"]] });
    expect(result.document).toBe("Full report");
    expect(result.risks).toEqual(["Risk 1"]);
    expect(result.actions).toEqual(["Action 1"]);
    expect(result.assumptions).toEqual(["Assumption 1"]);
    expect(result.provider).toBe("hibrit: gemini + groq");
    expect(result.providers).toEqual(["gemini", "groq"]);
    expect(result.confidence).toBe(78);
  });

  it("normalizes a legacy direct-format response (no wrapper)", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          headline: "Legacy format",
          metrics: [],
          bullets: [],
          table: null,
          document: null,
          provider: "gemini",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await callTool("listing-seo", { product: "test" });

    expect(result.headline).toBe("Legacy format");
    expect(result.provider).toBe("gemini");
    expect(result.metrics).toEqual([]);
    expect(result.bullets).toEqual([]);
  });

  it("handles null results from backend gracefully", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "success", results: null, error: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await callTool("listing-seo", { product: "test" });

    expect(result.headline).toBe("");
    expect(result.metrics).toEqual([]);
    expect(result.bullets).toEqual([]);
    expect(result.table).toBeNull();
    expect(result.document).toBeNull();
    expect(result.risks).toEqual([]);
    expect(result.score).toBe(0);
  });

  it("handles empty object from backend", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await callTool("listing-seo", { product: "test" });

    expect(result.headline).toBe("");
    expect(result.metrics).toEqual([]);
    expect(result.provider).toBe("unknown");
  });

  it("normalizes malformed table — rows not array → null", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "success",
          results: {
            headline: "test",
            metrics: [],
            bullets: [],
            table: { columns: ["A"], rows: "not-an-array" },
            document: null,
            provider: "gemini",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await callTool("listing-seo", { product: "test" });
    expect(result.table).toBeNull();
  });

  it("normalizes malformed table — columns not array → null", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "success",
          results: {
            headline: "test",
            metrics: [],
            bullets: [],
            table: { columns: "not-array", rows: [[]] },
            document: null,
            provider: "gemini",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await callTool("listing-seo", { product: "test" });
    expect(result.table).toBeNull();
  });

  it("throws on HTTP error with error message", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "AI isteği başarısız" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(callTool("listing-seo", { product: "test" })).rejects.toThrow(
      "AI isteği başarısız",
    );
  });

  it("throws on HTTP error without error message", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({}), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(callTool("listing-seo", { product: "test" })).rejects.toThrow(
      "AI isteği başarısız",
    );
  });

  it("handles provider as null → falls back to 'unknown'", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "success",
          results: {
            headline: "test",
            metrics: [],
            bullets: [],
            table: null,
            document: null,
            provider: null,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await callTool("listing-seo", { product: "test" });
    expect(result.provider).toBe("unknown");
  });

  it("handles all array fields as null/undefined → safe defaults", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "success",
          results: {
            headline: "test",
            metrics: null,
            bullets: undefined,
            table: null,
            document: undefined,
            risks: null,
            actions: undefined,
            assumptions: null,
            providers: undefined,
            confidence: undefined,
            provider: "gemini",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await callTool("listing-seo", { product: "test" });
    expect(result.metrics).toEqual([]);
    expect(result.bullets).toEqual([]);
    expect(result.risks).toEqual([]);
    expect(result.actions).toEqual([]);
    expect(result.assumptions).toEqual([]);
    expect(result.providers).toBeUndefined();
    expect(result.confidence).toBeUndefined();
  });
});
