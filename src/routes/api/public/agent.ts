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
 * POST — koşuyu başlatır. İki mod:
 *  - varsayılan: 14 ajanlı zincir tek blokta koşar (`velora-pipeline`).
 *  - `orchestrated: true`: ORTAK kanıt toplanır, finalist ürünler belirlenir ve
 *    14 ajan 4 FAZA bölünerek koşar. Her faz QStash ile KENDİNE yayınlanır
 *    (self-chaining fan-out), her adım 8 sn tavanlıdır ve durum ortak `runId`
 *    altında Supabase geçici kovasında taşınır. QStash yoksa fazlar aynı istek
 *    içinde koşar; toplam süre yine faz tavanlarıyla sınırlıdır.
 *    Yanıt ilk adımın sonucudur (`dispatched`), nihai karne DEĞİL.
 *
 * GET — `?runId=` ile koşu durumunu döner. Panel nihai karneyi bu uçtan yoklar;
 * böylece istemci yalnızca ilk dağıtım yanıtına mahkûm kalmaz. Durum okuma
 * nihai karneyi saf olarak koşu durumundan kurar; geçici kova silinmişse sonuç
 * kalıcı kazanan kayıtlarından geri kurulur (`recovered: true`).
 */
export const Route = createFileRoute("/api/public/agent")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const guard = await guardAuthed(request, "agent-status", 60, 60);
        if ("response" in guard) return guard.response;

        const runId = (new URL(request.url).searchParams.get("runId") ?? "").trim();
        if (runId.length < 3 || runId.length > 120) {
          return jsonError(400, "Geçerli bir runId gerekli.");
        }

        try {
          const orchestrator = await import("@/lib/velora-orchestrator.server");
          const status = await orchestrator.veloraRunStatus(runId, {
            store: orchestrator.defaultVeloraStore(),
          });
          return new Response(JSON.stringify(status), {
            status: 200,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (e) {
          return jsonError(500, "Koşu durumu okunamadı. Lütfen tekrar deneyin.", e);
        }
      },

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
