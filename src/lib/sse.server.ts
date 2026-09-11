import type { AgentBusEvent } from "./agent-bus.server";

export type SsePayload = {
  status: "status" | "complete" | "error";
  data?: unknown;
  error?: string;
};

export type SseMessage = SsePayload & {
  traceId?: string;
  event?: AgentBusEvent["type"];
};

export function encodeSse(message: SseMessage): string {
  return `data: ${JSON.stringify(message)}\n\n`;
}

/** Named SSE frame: browsers/dispatchers surface these as `event: <name>`. */
export function encodeSseEvent(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export function encodeHeartbeat(): string {
  return ":ping\n\n";
}

export function sseHeaders(): Headers {
  return new Headers({
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream; charset=utf-8",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff",
  });
}

export type SseEmit = (frame: string) => void;

export type SseStreamOptions = {
  /** Request signal — aborting it cancels the producer and closes the stream. */
  signal?: AbortSignal;
  /** Heartbeat cadence. Must stay well under the Cloudflare 100s idle limit. */
  heartbeatMs?: number;
  /** Invoked when the client disconnects before the producer finishes. */
  onCancel?: () => void;
};

/**
 * Builds an SSE `Response` around a long-running producer.
 *
 * Guarantees:
 *  • First byte inside the same tick, before any scraper/LLM/DB work — the
 *    gateway response cap opens immediately and the 524 timer resets.
 *  • A comment heartbeat (`:ping`) on a fixed cadence so the connection never
 *    goes idle while an agent thinks.
 *  • Client aborts propagate to the producer through an `AbortController`, so
 *    scraper, LLM and DB work stops immediately (no orphaned connections).
 *  • Producer failures are contained: the stream always closes cleanly.
 *
 * Every emitted frame is a string the caller fully controls, so callers own
 * their payload schema (see `product-stream.shared.ts`).
 */
export function createSseResponse(
  run: (emit: SseEmit, signal: AbortSignal) => Promise<void>,
  options: SseStreamOptions = {},
): Response {
  const encoder = new TextEncoder();
  const heartbeatMs = options.heartbeatMs ?? 5_000;
  const abort = new AbortController();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let producer: Promise<void> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit: SseEmit = (frame) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          closed = true;
          abort.abort();
        }
      };

      // Instant flush — never wait for the pipeline before the first byte.
      emit(": initial-connect\n\n");

      if (options.signal?.aborted) abort.abort();
      else options.signal?.addEventListener("abort", () => abort.abort(), { once: true });

      heartbeat = setInterval(() => emit(encodeHeartbeat()), heartbeatMs);

      producer = run(emit, abort.signal)
        .catch((error) => {
          if (abort.signal.aborted) return;
          console.error("[sse] producer failed", error);
          emit(
            encodeSseEvent("error", {
              type: "error",
              scope: "stream",
              message: "Bağlantı beklenmedik şekilde kesildi.",
            }),
          );
        })
        .finally(() => {
          if (heartbeat) clearInterval(heartbeat);
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            // Client already went away.
          }
        });
    },
    cancel() {
      closed = true;
      abort.abort();
      if (heartbeat) clearInterval(heartbeat);
      options.onCancel?.();
      void producer?.catch(() => undefined);
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}
