import { createFileRoute } from "@tanstack/react-router";
import { guardAuthed, jsonError, readJsonBody } from "@/lib/api-guard.server";

/** Velora 14 ajanlı yönlendirici uç noktası (oturum zorunlu). */
export const Route = createFileRoute("/api/public/agent")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const guard = await guardAuthed(request, "agent", 6, 60);
        if ("response" in guard) return guard.response;

        try {
          const body = await readJsonBody<Record<string, unknown>>(request);
          if (!body) return jsonError(400, "Geçersiz veya çok büyük istek.");
          const { runVeloraAgentPipeline } = await import("@/lib/velora-pipeline.server");
          return Response.json(await runVeloraAgentPipeline(body));
        } catch (e) {
          return jsonError(500, "Analiz tamamlanamadı. Lütfen tekrar deneyin.", e);
        }
      },
    },
  },
});
