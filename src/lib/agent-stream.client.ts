// ============================================================================
// Agent SSE stream consumer (client)
//
// Consumes `/api/public/agent` (Velora pipeline or `mode: "council"`) with
// `response.body.getReader()`. Heartbeat comments (`:ping`) are ignored, live
// agent statuses are surfaced as they arrive, and the promise resolves only
// once the final `complete` frame lands.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { CouncilReport } from "@/lib/council.server";

export type AgentStreamStatus = "status" | "complete" | "error";

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

/**
 * Reads a streamed agent run and resolves with the final `complete` payload.
 */
export async function streamAgentRun<T = unknown>(
  input: AgentStreamRequest,
  handlers: AgentStreamHandlers = {},
  signal?: AbortSignal,
): Promise<T> {
  const response = await apiFetch("/api/public/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(input),
    signal,
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
  let complete: T | undefined;

  const consumeFrame = (frame: string): void => {
    const event = parseAgentSseFrame(frame);
    if (!event) return; // heartbeat or comment
    handlers.onEvent?.(event);

    if (event.status === "error") {
      throw new Error(event.error ?? "Analiz tamamlanamadı.");
    }
    if (event.status === "complete") {
      complete = event.data as T;
      handlers.onComplete?.(event.data);
      return;
    }

    const mapped = mapAgentEvent(event);
    if (mapped.agent) handlers.onAgent?.(mapped.agent);
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
  } finally {
    reader.releaseLock();
  }

  if (complete === undefined) throw new Error("Analiz tamamlanmadan bağlantı kapandı.");
  return complete;
}

/** Typed helper for the 14-agent council run. */
export function streamCouncilAnalysis(
  input: { query: string; country?: string; category?: string; lang?: string },
  handlers: AgentStreamHandlers = {},
  signal?: AbortSignal,
): Promise<CouncilReport> {
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
};

const INITIAL_STATE: AgentStreamState = {
  running: false,
  agents: [],
  stages: [],
  error: null,
  result: null,
};

/** React binding for a streamed agent run (live agents + stages). */
export function useAgentStream(): AgentStreamState & {
  start: (input: AgentStreamRequest) => Promise<unknown>;
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

  const start = useCallback(async (input: AgentStreamRequest): Promise<unknown> => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({ ...INITIAL_STATE, running: true });

    try {
      const result = await streamAgentRun(
        input,
        {
          onAgent: (agent) => {
            setState((prev) => {
              const index = prev.agents.findIndex((a) => a.agent === agent.agent);
              const agents =
                index >= 0
                  ? prev.agents.map((a, i) => (i === index ? { ...a, ...agent } : a))
                  : [...prev.agents, agent];
              return { ...prev, agents };
            });
          },
          onStage: (stage) => {
            setState((prev) => ({ ...prev, stages: [...prev.stages, stage] }));
          },
        },
        controller.signal,
      );

      setState((prev) => ({ ...prev, result }));
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
