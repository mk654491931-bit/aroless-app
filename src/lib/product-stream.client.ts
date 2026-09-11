// ============================================================================
// Product Discovery — streaming consumer (client)
//
// `streamProductDiscovery` is the framework-agnostic reader: it uses
// `response.body.getReader()` on the SSE endpoint, ignores `:ping` heartbeats,
// and resolves only once the final `complete` frame arrives.
//
// `useProductStream` is the type-safe React wrapper for the M-Agent progress
// panel: live agent statuses, live products, and a clean AbortController on
// unmount.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import {
  parseProductStreamFrame,
  productStreamErrorMessage,
  type AgentProgressStatus,
  type ProductStreamEvent,
  type ProductStreamResult,
  type ProductStreamStage,
  type StreamedProduct,
} from "@/lib/product-stream.shared";

export type ProductDiscoveryInput = {
  niche?: string;
  target_country?: string;
};

export type ProductStreamHandlers = {
  onEvent?: (event: ProductStreamEvent) => void;
  onAgent?: (event: Extract<ProductStreamEvent, { type: "agent" }>) => void;
  onProduct?: (event: Extract<ProductStreamEvent, { type: "product" }>) => void;
  onStage?: (event: Extract<ProductStreamEvent, { type: "stage" }>) => void;
  onComplete?: (result: ProductStreamResult) => void;
};

/**
 * Reads the discovery stream and resolves with the final result.
 *
 * `:ping` heartbeats and malformed frames are dropped silently so a long scan
 * can survive gateway keep-alives without polluting UI state.
 */
export async function streamProductDiscovery(
  input: ProductDiscoveryInput,
  handlers: ProductStreamHandlers = {},
  signal?: AbortSignal,
): Promise<ProductStreamResult> {
  const response = await apiFetch("/api/public/hot-products", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(input),
    signal,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(productStreamErrorMessage(payload, "Ürün taraması başlatılamadı."));
  }
  if (!response.body) throw new Error("Ürün taraması akışı başlatılamadı.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let complete: ProductStreamResult | undefined;

  const consumeFrame = (frame: string): void => {
    const event = parseProductStreamFrame(frame);
    if (!event) return; // heartbeat or unsupported frame
    handlers.onEvent?.(event);

    switch (event.type) {
      case "stage":
        handlers.onStage?.(event);
        break;
      case "agent":
        handlers.onAgent?.(event);
        break;
      case "product":
        handlers.onProduct?.(event);
        break;
      case "error":
        // Per-product failures are non-fatal: log and keep consuming.
        console.warn("[product-stream] error frame", event.scope, event.message);
        break;
      case "complete":
        complete = event.data;
        handlers.onComplete?.(event.data);
        break;
      default:
        break;
    }
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

  if (!complete) throw new Error("Tarama tamamlanmadan bağlantı kapandı.");
  return complete;
}

export type AgentProgress = {
  agent: string;
  status: AgentProgressStatus;
  tier?: number;
  ms?: number;
  error?: string;
};

export type ProductStreamState = {
  running: boolean;
  products: StreamedProduct[];
  agents: AgentProgress[];
  stage: ProductStreamStage | null;
  stageLabel: string;
  error: string | null;
  result: ProductStreamResult | null;
};

const INITIAL_STATE: ProductStreamState = {
  running: false,
  products: [],
  agents: [],
  stage: null,
  stageLabel: "",
  error: null,
  result: null,
};

/** React binding for the discovery stream (live progress + live products). */
export function useProductStream(): ProductStreamState & {
  start: (input: ProductDiscoveryInput) => Promise<ProductStreamResult | null>;
  cancel: () => void;
  reset: () => void;
} {
  const [state, setState] = useState<ProductStreamState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const upsertAgent = useCallback((agent: AgentProgress) => {
    setState((prev) => {
      const index = prev.agents.findIndex((a) => a.agent === agent.agent);
      const agents =
        index >= 0
          ? prev.agents.map((a, i) => (i === index ? { ...a, ...agent } : a))
          : [...prev.agents, agent];
      return { ...prev, agents };
    });
  }, []);

  const start = useCallback(
    async (input: ProductDiscoveryInput): Promise<ProductStreamResult | null> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({ ...INITIAL_STATE, running: true });
      let finalResult: ProductStreamResult | null = null;

      try {
        finalResult = await streamProductDiscovery(
          input,
          {
            onStage: (event) => {
              setState((prev) => ({ ...prev, stage: event.stage, stageLabel: event.label }));
            },
            onAgent: (event) => {
              upsertAgent({
                agent: event.agent,
                status: event.status,
                ...(event.tier !== undefined ? { tier: event.tier } : {}),
                ...(event.ms !== undefined ? { ms: event.ms } : {}),
                ...(event.error ? { error: event.error } : {}),
              });
            },
            onProduct: (event) => {
              setState((prev) =>
                prev.products.some((p) => p.id === event.product.id)
                  ? prev
                  : { ...prev, products: [...prev.products, event.product] },
              );
            },
            onComplete: (result) => {
              finalResult = result;
            },
          },
          controller.signal,
        );
        return finalResult;
      } catch (error) {
        if (controller.signal.aborted) return null;
        const message = error instanceof Error ? error.message : "Ürün taraması başarısız oldu.";
        setState((prev) => ({ ...prev, error: message }));
        throw error;
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        if (!controller.signal.aborted) {
          setState((prev) => ({ ...prev, running: false, result: finalResult ?? prev.result }));
        }
      }
    },
    [upsertAgent],
  );

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
