import { createFileRoute } from "@tanstack/react-router";
import { guardAuthed, jsonError, readJsonBody } from "@/lib/api-guard.server";
import { appOrigin } from "@/lib/discovery-jobs.server";

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
          // SAHİPLİK: `runId` bilinse bile başka kullanıcının karnesi dönmez.
          const status = await orchestrator.veloraRunStatus(
            runId,
            { store: orchestrator.defaultVeloraStore() },
            { requestedBy: guard.userId },
          );
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

        /**
         * JETON KAPISI: 14 ajanlı hat (retriever + 14 ajan + kanıt taraması) ve
         * hat bu üründe kaynak tüketimi en yüksek iştir. Fazlı (QStash) koşu
         * `council`, tek blok hızlı yol `agent-pipeline` fiyatındadır; `GET
         * ?runId=` durum yoklaması ÜCRETSİZDİR (yoksa panelin nihai karneyi
         * beklemesi kullanıcıya fatura olurdu). Koşu başlatılamaz/çökerse jeton
         * İADE edilir.
         */
        try {
          const body = await readJsonBody<Record<string, unknown>>(request);
          if (!body) return jsonError(400, "Geçersiz veya çok büyük istek.");

          const isOrchestrated = body["orchestrated"] === true;
          const feature = isOrchestrated ? ("council" as const) : ("agent-pipeline" as const);

          // SORGUL ÖNBELEĞİ: aynı nişi 24 saat içinde çalıştıran kullanıcıya 14 ajanı
          // yeniden ücretlemeden ÖNCEKİ koşunun karnesi geri oynatılır. Kontrol
          // jeton alınmadan yapılır → önbellek bir indirim değil, ücretsiz tekrar.
          if (isOrchestrated) {
            const { readVeloraQueryCache } = await import("@/lib/velora-query-cache.server");
            const cached = await readVeloraQueryCache({
              userId: guard.userId,
              query: String(body["userQuery"] ?? ""),
              country: String(body["country"] ?? "GLOBAL"),
              platform: String(body["platform"] ?? "General"),
            });
            if (cached) {
              // İstemci aynı yoklama yolunu kullanır; karne `radar_items`'tan geri kurulur.
              return Response.json({
                runId: cached.runId,
                status: "completed",
                completedPhases: 4,
                cached: true,
                cachedAt: cached.cachedAt,
              });
            }
          }

          const { featureCreditCost } = await import("@/lib/credit-costs");
          const { chargeOrRespond, refundFeatureCredits } =
            await import("@/lib/credit-charge.server");
          const cost = featureCreditCost(feature);

          const payment = await chargeOrRespond({
            userId: guard.userId,
            token: guard.token,
            feature,
          });
          if (!payment.ok) return payment.response;

          try {
            if (isOrchestrated) {
              const orchestrator = await import("@/lib/velora-orchestrator.server");
              // İstemcinin dayattığı `runId` ATILIR: aksi hâlde başka bir
              // kullanıcının koşu durumu ezilebilir veya tahmin edilebilir bir
              // kimlikle sonuç okunabilirdi. Kimlik sunucuda üretilir.
              const { runId: _clientRunId, ...safeBody } = body;
              void _clientRunId;
              const result = await orchestrator.startVeloraRun(
                { ...safeBody, requestedBy: guard.userId },
                {
                  store: orchestrator.defaultVeloraStore(),
                  handoff: orchestrator.veloraQStashHandoff(appOrigin(request)),
                },
              );
              // Koşu hiç başlayamadıysa jetonu iade et (kullanıcı boş sonuç almaz).
              if (result.status === "failed") {
                await refundFeatureCredits(guard.userId, cost, "velora_run_failed", null, feature);
              }
              return Response.json(result);
            }

            const { runVeloraAgentPipeline } = await import("@/lib/velora-pipeline.server");
            return Response.json(await runVeloraAgentPipeline(body));
          } catch (error) {
            await refundFeatureCredits(guard.userId, cost, "velora_agent_failed", null, feature);
            throw error;
          }
        } catch (e) {
          return jsonError(500, "Analiz tamamlanamadı. Lütfen tekrar deneyin.", e);
        }
      },
    },
  },
});
