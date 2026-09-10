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

export function encodeHeartbeat(): string {
  return ":ping\n\n";
}

export function sseHeaders(): Headers {
  return new Headers({
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream; charset=utf-8",
    "X-Accel-Buffering": "no",
  });
}
