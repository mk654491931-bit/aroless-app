import { createFileRoute } from "@tanstack/react-router";

/** Velora 14 ajanlı yönlendirici uç noktası. */
export const Route = createFileRoute("/api/public/agent")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const { runVeloraAgentPipeline } = await import("@/lib/velora-pipeline.server");
          return Response.json(await runVeloraAgentPipeline(body));
        } catch (e) {
          return new Response(JSON.stringify({ error: (e as Error).message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
