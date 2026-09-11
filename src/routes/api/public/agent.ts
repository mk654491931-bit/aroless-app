import { createFileRoute } from "@tanstack/react-router";
import { guardAuthed, jsonError, readJsonBody } from "@/lib/api-guard.server";
import { deductFinderCredit } from "@/lib/credits.server";
import { consumeUsage, recordUsageWithToken } from "@/lib/usage.server";
import { quotaExceededMessage } from "@/lib/usage";
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
        const token = bearerToken(request);
        const started = Date.now();
        const streamTraceId = `agent_${started.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        /** Finished agents, kept so a budget cut can still return partial data. */
        const completedAgents: Array<{ agent: string; ms?: number; ok: boolean }> = [];

        return createSseResponse(
          async (emit) => {
            const sendEvent = (event: AgentBusEvent): void => {
              const payload = event.payload as Record<string, unknown>;
              if (event.type === "agent:complete") {
                const agent = String(payload["agent"] ?? "");
                if (agent) {
                  completedAgents.push({
                    agent,
                    ...(typeof payload["ms"] === "number" ? { ms: payload["ms"] } : {}),
                    ok: payload["ok"] !== false,
                  });
                }
              }
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

                // Council sessions have their own monthly allowance, so they are
                // counted there instead of draining the product-finder wallet.
                // Degrades open when the quota RPC is unavailable.
                const quota = await consumeUsage(token, "council");
                if (!quota.ok && quota.error === "limit_reached") {
                  sendError(quotaExceededMessage("council", quota.limit));
                  return;
                }

                sendComplete(await runCouncil(query, country, category, lang, sendEvent));
                return;
              }

              // The deep-analysis chain fans out to a retriever plus 14
              // sequential agents, so it keeps the product-finder credit gate.
              const credit = await deductFinderCredit(token);
              if (!credit.ok) {
                sendError(credit.message);
                return;
              }
              await recordUsageWithToken(token, "product_finder");

              const { runVeloraAgentPipeline } = await import("@/lib/velora-pipeline.server");
              sendComplete(await runVeloraAgentPipeline(body, { onEvent: sendEvent }));
            } catch (error) {
              console.error("[api/public/agent] stream failed", error);
              sendError("Analiz tamamlanamadı. Lütfen tekrar deneyin.");
            }
          },
          {
            signal: request.signal,
            heartbeatMs: 5_000,
            // The 14-agent chain can outlive Cloudflare's 100s wall. Instead of
            // letting the gateway answer 524, flush the agents that finished as
            // a successful `partial` payload and close the stream.
            onBudgetExhausted: (emit) => {
              emit(
                encodeSse({
                  status: "partial",
                  traceId: streamTraceId,
                  data: {
                    partial: true,
                    partialReason: "gateway_budget",
                    mode,
                    completed: completedAgents,
                    elapsedMs: Date.now() - started,
                  },
                }),
              );
            },
          },
        );
      },
    },
  },
});
