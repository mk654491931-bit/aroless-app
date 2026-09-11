// ============================================================================
// Product Discovery — SSE wire contract (client + server safe)
//
// This module is intentionally free of Node/DOM-only APIs so it can be imported
// by the streaming API route, the browser reader and unit tests alike.
//
// Frame format (one SSE frame per event):
//
//   event: product
//   data: {"type":"product","index":0,"product":{...},"saved":true}
//
// Comment-only frames (`:ping`, `: initial-connect`) are heartbeats. Readers
// must ignore them and never surface them to the UI.
// ============================================================================

import type { HotProduct, ProductSignals } from "./hot-products";

// The discovered-product shape is defined once, in the client-safe feed module.
// Streaming re-uses it verbatim so the wire payload can never drift from the UI.
export type { HotProduct, ProductSignals };

/** A single discovered product as it travels over the wire. */
export type StreamedProduct = HotProduct;

export type ProductStreamStage = "scan" | "normalize" | "persist" | "rank" | "done";
export type AgentProgressStatus = "running" | "complete" | "error";

export type ProductStreamEvent =
  | { type: "connected"; traceId: string; at: number }
  | { type: "stage"; stage: ProductStreamStage; label: string; ms?: number }
  | {
      type: "agent";
      agent: string;
      status: AgentProgressStatus;
      tier?: number;
      ms?: number;
      error?: string;
    }
  | {
      type: "product";
      index: number;
      product: StreamedProduct;
      /** `false` when the DB write failed or was skipped (anonymous caller). */
      saved: boolean;
      rowId?: string;
      saveError?: string;
    }
  | { type: "error"; scope: "product" | "stream"; message: string; productName?: string }
  | { type: "complete"; data: ProductStreamResult };

export type ProductStreamResult = {
  traceId: string;
  items: StreamedProduct[];
  count: number;
  persisted: number;
  failed: number;
  elapsedMs: number;
  nextRefreshAt?: string;
  /**
   * `true` when the run was cut by the gateway budget (Cloudflare 100s wall)
   * and the payload carries everything collected up to that moment. A partial
   * result is still a successful response — never an error state.
   */
  partial?: boolean;
  partialReason?: "gateway_budget";
};

const EVENT_TYPES = new Set([
  "connected",
  "stage",
  "agent",
  "product",
  "error",
  "complete",
] satisfies ProductStreamEvent["type"][]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Parses a single SSE frame into a typed event.
 *
 * Returns `null` (never throws) for comment/heartbeat frames, empty frames and
 * malformed payloads so a single bad chunk can never crash the reader.
 */
export function parseProductStreamFrame(frame: string): ProductStreamEvent | null {
  let eventName = "";
  const dataLines: string[] = [];

  for (const rawLine of frame.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line || line.startsWith(":")) continue; // `:ping` and friends
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }

  if (dataLines.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(dataLines.join("\n"));
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const type = typeof parsed["type"] === "string" ? parsed["type"] : eventName;
  if (!EVENT_TYPES.has(type as ProductStreamEvent["type"])) return null;

  // Normalise the named-event form (no `type` field) into the discriminated shape.
  return (parsed["type"] ? parsed : { ...parsed, type }) as unknown as ProductStreamEvent;
}

/** Human-readable fallback message for any streamed error payload. */
export function productStreamErrorMessage(payload: unknown, fallback: string): string {
  if (isRecord(payload) && typeof payload["error"] === "string" && payload["error"].trim()) {
    return payload["error"];
  }
  if (isRecord(payload) && typeof payload["message"] === "string" && payload["message"].trim()) {
    return payload["message"];
  }
  return fallback;
}
