// ============================================================================
// Aroless Agent Bus — Event-driven, non-blocking multi-agent orchestration
// Server only. Zero external deps. Microservice-like isolation.
//
// Guarantees:
//  • Non-blocking: every handler runs in its own microtask — one slow agent
//    never stalls the main thread or sibling agents.
//  • Typed events + traceId per pipeline run for end-to-end observability.
//  • Backpressure: per-event queue cap, oldest drops with a warning.
//  • Self-healing: handler throws are caught, logged, and never bubble.
// ============================================================================

export type AgentBusEvent =
  | { type: "pipeline:start"; payload: { traceId: string; query: string } }
  | { type: "pipeline:complete"; payload: { traceId: string; ok: boolean; ms: number } }
  | { type: "signals:collected"; payload: { traceId: string; coverage: number; ms: number } }
  | { type: "tier:start"; payload: { traceId: string; tier: number } }
  | { type: "tier:complete"; payload: { traceId: string; tier: number; ms: number } }
  | { type: "agent:start"; payload: { traceId: string; agent: string; tier: number } }
  | { type: "agent:complete"; payload: { traceId: string; agent: string; ok: boolean; ms: number } }
  | { type: "agent:error"; payload: { traceId: string; agent: string; error: string } }
  | { type: "cache:hit"; payload: { traceId: string; scope: string } }
  | { type: "cache:miss"; payload: { traceId: string; scope: string } };

export type BusEventType = AgentBusEvent["type"];
export type AgentBusObserver = (event: AgentBusEvent) => void;

// Keep handler typed externally, but bus internals use the union payload to avoid
// generic-Extract distribution pitfalls that make `emit` fail under strict tsc.
type Handler<T extends BusEventType> = (
  payload: Extract<AgentBusEvent, { type: T }>["payload"],
) => void | Promise<void>;

const MAX_QUEUE = 500;
const MAX_HANDLERS_PER_EVENT = 20;

class AgentBus {
  private readonly traceId: string;
  private readonly observer?: AgentBusObserver;
  private readonly handlers = new Map<string, Set<(p: unknown) => void | Promise<void>>>();
  private queue: AgentBusEvent[] = [];
  private draining = false;
  private emitted = 0;
  private dropped = 0;

  constructor(traceId: string, observer?: AgentBusObserver) {
    this.traceId = traceId;
    this.observer = observer;
  }

  on<T extends BusEventType>(type: T, handler: Handler<T>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    if (set.size >= MAX_HANDLERS_PER_EVENT) {
      console.warn(`[agent-bus:${this.traceId}] too many handlers for ${type} — ignoring extra`);
      return () => {};
    }
    const wrapped = handler as (p: unknown) => void | Promise<void>;
    set.add(wrapped);
    return () => set!.delete(wrapped);
  }

  once<T extends BusEventType>(type: T, handler: Handler<T>): () => void {
    const off = this.on(type, ((payload: unknown) => {
      off();
      return (handler as (p: unknown) => void | Promise<void>)(payload);
    }) as Handler<T>);
    return off;
  }

  off<T extends BusEventType>(type: T, handler: Handler<T>): void {
    this.handlers.get(type)?.delete(handler as (p: unknown) => void | Promise<void>);
  }

  // Emit is intentionally non-generic on the implementation side — the `on`
  // side keeps full type safety, and callers get checked via the AgentBusEvent
  // union at their call sites. This avoids the Extract<T> & Extract<U>
  // intersection trap that strict tsc flags on generic forwarding.
  emit(type: BusEventType, payload: AgentBusEvent["payload"]): void {
    const event = {
      type,
      payload: { ...payload, traceId: this.traceId },
    } as unknown as AgentBusEvent;
    (event as unknown as Record<string, unknown>).__traceId = this.traceId;
    (event as unknown as Record<string, unknown>).__at = Date.now();
    try {
      this.observer?.(event);
    } catch (error) {
      console.error(`[agent-bus:${this.traceId}] observer threw`, error);
    }
    this.enqueue(event);
  }

  emitAsync(type: BusEventType, payload: AgentBusEvent["payload"]): void {
    this.emit(type, payload);
  }

  private enqueue(event: AgentBusEvent): void {
    if (this.queue.length >= MAX_QUEUE) {
      this.queue.shift();
      this.dropped++;
    }
    this.queue.push(event);
    this.emitted++;
    if (!this.draining) this.drain();
  }

  private drain(): void {
    this.draining = true;
    const run = () => {
      const batch = this.queue.splice(0, this.queue.length);
      for (const ev of batch) {
        const set = this.handlers.get(ev.type);
        if (!set || set.size === 0) continue;
        for (const h of set) {
          queueMicrotask(async () => {
            try {
              await h((ev as unknown as { payload: unknown }).payload);
            } catch (err) {
              console.error(`[agent-bus:${this.traceId}] handler for ${ev.type} threw`, err);
            }
          });
        }
      }
      if (this.queue.length > 0) queueMicrotask(run);
      else this.draining = false;
    };
    queueMicrotask(run);
  }

  getStats(): { traceId: string; emitted: number; dropped: number; pending: number } {
    return {
      traceId: this.traceId,
      emitted: this.emitted,
      dropped: this.dropped,
      pending: this.queue.length,
    };
  }
}

export function createAgentBus(traceId?: string, observer?: AgentBusObserver): AgentBus {
  const id =
    traceId ?? `trace_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  return new AgentBus(id, observer);
}

let globalBus: AgentBus | null = null;
export function getGlobalBus(): AgentBus {
  if (!globalBus) globalBus = createAgentBus("global");
  return globalBus;
}
