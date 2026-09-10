import { createFileRoute } from "@tanstack/react-router";
import { guardAuthed, jsonError, readJsonBody } from "@/lib/api-guard.server";
import { encodeHeartbeat, encodeSse, sseHeaders } from "@/lib/sse.server";
import type { AgentBusEvent } from "@/lib/agent-bus.server";

/** Velora 14 ajanlı yönlendirici uç noktası (oturum zorunlu, SSE). */
export const Route = createFileRoute("/api/public/agent")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const guard = await guardAuthed(request, "agent", 6, 60);
        if ("response" in guard) return guard.response;

        const body = await readJsonBody<Record<string, unknown>>(request);
        if (!body) return jsonError(400, "Geçersiz veya çok büyük istek.");

        const encoder = new TextEncoder();
        let heartbeat: ReturnType<typeof setInterval> | undefined;
        let cancelled = false;
        let run: Promise<void> | undefined;

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const enqueue = (chunk: string): void => {
              if (cancelled) return;
              try {
                controller.enqueue(encoder.encode(chunk));
              } catch {
                cancelled = true;
              }
            };

            const sendEvent = (event: AgentBusEvent): void => {
              const payload = event.payload as Record<string, unknown>;
              enqueue(
                encodeSse({
                  status: "status",
                  event: event.type,
                  traceId: String(payload["traceId"] ?? ""),
                  data: payload,
                }),
              );
            };

            enqueue(": connected\n\n");
            heartbeat = setInterval(() => enqueue(encodeHeartbeat()), 5_000);

            run = (async () => {
              try {
                const { runVeloraAgentPipeline } = await import("@/lib/velora-pipeline.server");
                const result = await runVeloraAgentPipeline(body, { onEvent: sendEvent });
                enqueue(encodeSse({ status: "complete", data: result }));
              } catch (error) {
                console.error("[api/public/agent] stream failed", error);
                enqueue(
                  encodeSse({
                    status: "error",
                    error: "Analiz tamamlanamadı. Lütfen tekrar deneyin.",
                  }),
                );
              } finally {
                if (heartbeat) clearInterval(heartbeat);
                if (!cancelled) {
                  try {
                    controller.close();
                  } catch {
                    // Client disconnected before the final close.
                  }
                }
              }
            })();
          },
          cancel() {
            cancelled = true;
            if (heartbeat) clearInterval(heartbeat);
            void run?.catch(() => undefined);
          },
        });

        return new Response(stream, { headers: sseHeaders() });
      },
    },
  },
});
