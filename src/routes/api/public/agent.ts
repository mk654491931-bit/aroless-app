import { createFileRoute } from "@tanstack/react-router";
import { guardAuthed, jsonError, readJsonBody } from "@/lib/api-guard.server";

/** İsteğin public origin'i — QStash faz devrinin hedefi buradan kurulur. */
function publicOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto");
  if (host) return `${proto ?? url.protocol.replace(":", "")}://${host}`;
  return url.origin;
}

/**
 * Velora 14 ajanlı yönlendirici uç noktası (oturum zorunlu).
 *
 * İki mod:
 *  - varsayılan: 14 ajanlı zincir tek blokta koşar (`velora-pipeline`).
 *  - `orchestrated: true`: 14 ajan 4 FAZA bölünür ve her faz QStash ile kendine
 *    yayınlanır (self-chaining fan-out). Her adım 8 sn tavanlıdır ve durumu
 *    Supabase geçici kovasında taşır. QStash yoksa fazlar aynı istek içinde
 *    koşar; toplam süre yine 4×8 sn ile sınırlıdır.
 */
export const Route = createFileRoute("/api/public/agent")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const guard = await guardAuthed(request, "agent", 6, 60);
        if ("response" in guard) return guard.response;

        try {
          const body = await readJsonBody<Record<string, unknown>>(request);
          if (!body) return jsonError(400, "Geçersiz veya çok büyük istek.");

          if (body["orchestrated"] === true) {
            const orchestrator = await import("@/lib/velora-orchestrator.server");
            const result = await orchestrator.startVeloraRun(body, {
              store: orchestrator.defaultVeloraStore(),
              handoff: orchestrator.veloraQStashHandoff(publicOrigin(request)),
            });
            return Response.json(result);
          }

          const { runVeloraAgentPipeline } = await import("@/lib/velora-pipeline.server");
          return Response.json(await runVeloraAgentPipeline(body));
        } catch (e) {
          return jsonError(500, "Analiz tamamlanamadı. Lütfen tekrar deneyin.", e);
        }
      },
    },
  },
});
