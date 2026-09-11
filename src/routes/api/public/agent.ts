import { createFileRoute } from "@tanstack/react-router";
import { guardAuthed, jsonError, readJsonBody } from "@/lib/api-guard.server";
import { deductFinderCredit } from "@/lib/credits.server";
import { createSseResponse, encodeSse } from "@/lib/sse.server";
import type { AgentBusEvent } from "@/lib/agent-bus.server";

/**
 * Velora 14 ajanlı yönlendirici uç noktası (oturum zorunlu, SSE).
 *
 * `mode: "council"` verildiğinde aynı taşıma katmanı 14'lü AI Konsey koşusunu
 * (`council.server.ts`) canlı ajan olaylarıyla akıtır ve son paket olarak
 * `CouncilReport` gönderir. Varsayılan mod Velora hattıdır (geriye dönük uyumlu).
 *
 * Ortak garantiler: ilk byte anında flush edilir, 5 saniyede bir `:ping`
 * heartbeat gider, istemci ayrılırsa üretim iptal edilir.
 */
export const maxDuration = 1800;

function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

export const Route = createFileRoute("/api/public/agent")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const guard = await guardAuthed(request, "agent", 6, 60);
        if ("response" in guard) return guard.response;

        const body = await readJsonBody<Record<string, unknown>>(request);
        if (!body) return jsonError(400, "Geçersiz veya çok büyük istek.");

        const mode = body["mode"] === "council" ? "council" : "pipeline";

        return createSseResponse(
          async (emit) => {
            const sendEvent = (event: AgentBusEvent): void => {
              const payload = event.payload as Record<string, unknown>;
              emit(
                encodeSse({
                  status: "status",
                  event: event.type,
                  traceId: String(payload["traceId"] ?? ""),
                  data: payload,
                }),
              );
            };
            const sendComplete = (data: unknown): void =>
              emit(encodeSse({ status: "complete", data }));
            const sendError = (message: string): void =>
              emit(encodeSse({ status: "error", error: message }));

            try {
              if (mode === "council") {
                const query = String(body["userQuery"] ?? body["query"] ?? "")
                  .trim()
                  .slice(0, 140);
                if (query.length < 2) {
                  sendError("Lütfen bir ürün veya niş girin.");
                  return;
                }
                const country = String(body["country"] ?? "GLOBAL")
                  .toUpperCase()
                  .slice(0, 8);
                const category = String(body["category"] ?? "General").slice(0, 60);
                const lang = String(body["language"] ?? body["lang"] ?? "tr").slice(0, 5);

                const { peekCouncil, runCouncil } = await import("@/lib/council.server");

                // Cache hit: no credits are spent, exactly like the server function.
                const cachedReport = await peekCouncil(query, country, category, lang);
                if (cachedReport) {
                  sendComplete(cachedReport);
                  return;
                }

                const credit = await deductFinderCredit(bearerToken(request));
                if (!credit.ok) {
                  sendError(credit.message);
                  return;
                }

                sendComplete(await runCouncil(query, country, category, lang, sendEvent));
                return;
              }

              const { runVeloraAgentPipeline } = await import("@/lib/velora-pipeline.server");
              sendComplete(await runVeloraAgentPipeline(body, { onEvent: sendEvent }));
            } catch (error) {
              console.error("[api/public/agent] stream failed", error);
              sendError("Analiz tamamlanamadı. Lütfen tekrar deneyin.");
            }
          },
          { signal: request.signal, heartbeatMs: 5_000 },
        );
      },
    },
  },
});
