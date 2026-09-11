// ============================================================================
// Agent SSE stream consumer (browser-oriented)
//
// NOTE: this file deliberately does NOT use the `.client.` suffix. Route files
// are isomorphic (bundled for the server too), and TanStack Start's
// import-protection denies any server-environment import of `**/*.client.*`,
// which broke the production build. Every export here is safe to *evaluate* on
// the server; the hooks simply never run there.
//
// Consumes `/api/public/agent` (Velora pipeline or `mode: "council"`) with
// `response.body.getReader()`. Heartbeat comments (`:ping`) are ignored, live
// agent statuses are surfaced as they arrive, and the promise resolves only
// once the final `complete` frame lands.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { CouncilReport } from "@/lib/council.server";

export type AgentStreamStatus = "status" | "complete" | "partial" | "error";

/**
 * Payload of the `partial` frame the server sends when the run was cut at the
 * gateway budget (Cloudflare 100s wall) — a successful answer, not an error.
 */
export type AgentPartialInfo = {
  partial: true;
  mode?: string;
  completed: AgentProgress[];
  elapsedMs: number;
  reason: "gateway_budget" | string;
};

/** Client-side watchdog: stop reading just before the server's own budget. */
export const CLIENT_AGENT_TIMEOUT_MS = 99_000;

/** Raw SSE payload as emitted by the backend. */
export type AgentStreamEvent = {
  status: AgentStreamStatus;
  /** Bus event name (`agent:start`, `tier:complete`, …) for status frames. */
  event?: string;
  traceId?: string;
  data?: unknown;
  error?: string;
};

export type AgentProgressStatus = "running" | "complete" | "error";

export type AgentProgress = {
  agent: string;
  status: AgentProgressStatus;
  tier?: number;
  ms?: number;
  error?: string;
};

export type StageProgress = {
  stage: string;
  ms?: number;
};

export type AgentStreamRequest = {
  /** `pipeline` (default) runs the Velora chain, `council` the 14-agent council. */
  mode?: "pipeline" | "council";
  userQuery: string;
  country?: string;
  category?: string;
  language?: string;
};

export type AgentStreamHandlers = {
  onEvent?: (event: AgentStreamEvent) => void;
  onAgent?: (agent: AgentProgress) => void;
  onStage?: (stage: StageProgress) => void;
  onComplete?: (data: unknown) => void;
  /** Fired when the run was cut at the budget; live progress stays valid. */
  onPartial?: (info: AgentPartialInfo) => void;
};

export type AgentStreamOptions = {
  /** Client watchdog for the whole read. Defaults to 99s. */
  timeoutMs?: number;
};

/**
 * Parses one SSE frame. Comment-only frames (including `:ping`) intentionally
 * return null, so heartbeats never reach the UI state machine.
 */
export function parseAgentSseFrame(frame: string): AgentStreamEvent | null {
  const data = frame
    .split("\n")
    .filter((line) => !line.startsWith(":"))
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");

  if (!data) return null;

  try {
    const parsed = JSON.parse(data) as AgentStreamEvent;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/**
 * Maps a bus event onto UI progress. Unknown events map to nothing, so the UI
 * can never be knocked over by a new backend event type.
 */
export function mapAgentEvent(event: AgentStreamEvent): {
  agent?: AgentProgress;
  stage?: StageProgress;
} {
  const payload = asRecord(event.data);
  const agent = typeof payload["agent"] === "string" ? payload["agent"] : "";
  const tier = typeof payload["tier"] === "number" ? payload["tier"] : undefined;
  const ms = typeof payload["ms"] === "number" ? payload["ms"] : undefined;

  switch (event.event) {
    case "agent:start":
      return agent
        ? { agent: { agent, status: "running", ...(tier !== undefined ? { tier } : {}) } }
        : {};
    case "agent:complete":
      return agent
        ? {
            agent: {
              agent,
              status: payload["ok"] === false ? "error" : "complete",
              ...(tier !== undefined ? { tier } : {}),
              ...(ms !== undefined ? { ms } : {}),
            },
          }
        : {};
    case "agent:error":
      return agent
        ? {
            agent: {
              agent,
              status: "error",
              ...(tier !== undefined ? { tier } : {}),
              ...(typeof payload["error"] === "string" ? { error: payload["error"] } : {}),
            },
          }
        : {};
    case "pipeline:start":
      return { stage: { stage: "pipeline:start" } };
    case "signals:collected":
      return { stage: { stage: "signals:collected", ...(ms !== undefined ? { ms } : {}) } };
    case "tier:start":
      return tier !== undefined ? { stage: { stage: `tier:${tier}:start` } } : {};
    case "tier:complete":
      return tier !== undefined
        ? { stage: { stage: `tier:${tier}:complete`, ...(ms !== undefined ? { ms } : {}) } }
        : {};
    case "pipeline:complete":
      return { stage: { stage: "pipeline:complete", ...(ms !== undefined ? { ms } : {}) } };
    default:
      return {};
  }
}

function upsertProgress(list: AgentProgress[], update: AgentProgress): AgentProgress[] {
  const index = list.findIndex((a) => a.agent === update.agent);
  return index < 0
    ? [...list, update]
    : list.map((a, i) => (i === index ? { ...a, ...update } : a));
}

/**
 * Reads a streamed agent run and resolves with the final `complete` payload.
 *
 * Resolves `null` (never throws) when the run is cut at the gateway budget: the
 * agents that finished are delivered through `handlers.onPartial`, so the UI
 * keeps its live progress instead of dying on a timeout.
 */
export async function streamAgentRun<T = unknown>(
  input: AgentStreamRequest,
  handlers: AgentStreamHandlers = {},
  signal?: AbortSignal,
  options: AgentStreamOptions = {},
): Promise<T | null> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? CLIENT_AGENT_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;

  const abort = (): void => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let completed: AgentProgress[] = [];
  let partialInfo: AgentPartialInfo | null = null;
  let complete: T | undefined;

  try {
    const response = await apiFetch("/api/public/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const message = asRecord(payload)["error"];
      throw new Error(
        typeof message === "string" && message.trim() ? message : "Analiz başlatılamadı.",
      );
    }
    if (!response.body) throw new Error("Analiz akışı başlatılamadı.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const consumeFrame = (frame: string): void => {
      const event = parseAgentSseFrame(frame);
      if (!event) return; // heartbeat or comment
      handlers.onEvent?.(event);

      if (event.status === "error") {
        throw new Error(event.error ?? "Analiz tamamlanamadı.");
      }
      if (event.status === "partial") {
        const payload = asRecord(event.data);
        const reported = Array.isArray(payload["completed"])
          ? (payload["completed"] as AgentProgress[])
          : completed;
        partialInfo = {
          partial: true,
          mode: typeof payload["mode"] === "string" ? payload["mode"] : input.mode,
          completed: reported,
          elapsedMs:
            typeof payload["elapsedMs"] === "number"
              ? payload["elapsedMs"]
              : Date.now() - startedAt,
          reason:
            typeof payload["partialReason"] === "string"
              ? payload["partialReason"]
              : "gateway_budget",
        };
        return;
      }
      if (event.status === "complete") {
        complete = event.data as T;
        handlers.onComplete?.(event.data);
        return;
      }

      const mapped = mapAgentEvent(event);
      if (mapped.agent) {
        completed = upsertProgress(completed, mapped.agent);
        handlers.onAgent?.(mapped.agent);
      }
      if (mapped.stage) handlers.onStage?.(mapped.stage);
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          consumeFrame(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
        }
      }

      buffer += decoder.decode();
      if (buffer.trim()) consumeFrame(buffer);
    } catch (error) {
      // A watchdog abort is expected; everything consumed so far stays usable.
      if (!timedOut && !signal?.aborted) throw error;
    } finally {
      reader.releaseLock();
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }

  if (complete !== undefined) return complete;

  const info: AgentPartialInfo = partialInfo ?? {
    partial: true,
    mode: input.mode,
    completed,
    elapsedMs: Date.now() - startedAt,
    reason: timedOut ? "gateway_budget" : "stream_closed",
  };

  // The server named the agents that finished, so mirror them into local state.
  for (const agent of info.completed) completed = upsertProgress(completed, agent);

  if (info.completed.length > 0 || partialInfo) {
    handlers.onPartial?.(info);
    return null;
  }

  if (timedOut) throw new Error("Analiz zaman aşımına uğradı.");
  throw new Error("Analiz tamamlanmadan bağlantı kapandı.");
}

/** Typed helper for the 14-agent council run. */
export function streamCouncilAnalysis(
  input: { query: string; country?: string; category?: string; lang?: string },
  handlers: AgentStreamHandlers = {},
  signal?: AbortSignal,
): Promise<CouncilReport | null> {
  return streamAgentRun<CouncilReport>(
    {
      mode: "council",
      userQuery: input.query,
      ...(input.country ? { country: input.country } : {}),
      ...(input.category ? { category: input.category } : {}),
      ...(input.lang ? { language: input.lang } : {}),
    },
    handlers,
    signal,
  );
}

export type AgentStreamState = {
  running: boolean;
  agents: AgentProgress[];
  stages: StageProgress[];
  error: string | null;
  result: unknown;
  /** `true` when the last run ended on the gateway budget with partial data. */
  partial: boolean;
};

const INITIAL_STATE: AgentStreamState = {
  running: false,
  agents: [],
  stages: [],
  error: null,
  result: null,
  partial: false,
};

/** React binding for a streamed agent run (live agents + stages). */
export function useAgentStream(): AgentStreamState & {
  start: (input: AgentStreamRequest) => Promise<unknown | null>;
  cancel: () => void;
  reset: () => void;
} {
  const [state, setState] = useState<AgentStreamState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      abortRef.current = null;
    },
    [],
  );

  const start = useCallback(async (input: AgentStreamRequest): Promise<unknown | null> => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({ ...INITIAL_STATE, running: true });

    try {
      const result = await streamAgentRun(
        input,
        {
          onAgent: (agent) => {
            setState((prev) => ({ ...prev, agents: upsertProgress(prev.agents, agent) }));
          },
          onStage: (stage) => {
            setState((prev) => ({ ...prev, stages: [...prev.stages, stage] }));
          },
          onPartial: (info) => {
            setState((prev) => ({
              ...prev,
              partial: true,
              agents: info.completed.reduce(upsertProgress, prev.agents),
            }));
          },
        },
        controller.signal,
      );

      setState((prev) => ({ ...prev, result: result ?? prev.result }));
      return result;
    } catch (error) {
      if (controller.signal.aborted) return null;
      const message = error instanceof Error ? error.message : "Analiz başarısız oldu.";
      setState((prev) => ({ ...prev, error: message }));
      throw error;
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (!controller.signal.aborted) setState((prev) => ({ ...prev, running: false }));
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState((prev) => ({ ...prev, running: false }));
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  return { ...state, start, cancel, reset };
}
