/**
 * GET /api/product-discovery/stream?runId=… — İlerleme için SSE.
 *
 * NEDEN VAR: Adımlar birbirinden AYRI QStash mesajlarıdır; aralarında canlı
 * bir bağ yoktur. Kullanıcı ilerlemeyi ancak kalıcı `searches` satırından
 * okuyarak görebilir. Bu uç o satırı periyodik yoklar ve `text/event-stream`
 * olarak yayar.
 *
 * GÜVENLİK (fail-closed):
 *   • Oturum zorunlu (`requireUser`) — herkese açık bir ilerleme ucu değil.
 *   • `runId` BAŞKA BİR KULLANICIYA AİTSE 403: kimlik gövdeden değil, satırın
 *     `user_id` alanından doğrulanır. Aksi halde bir kullanıcı başkasının
 *     iş kimliğini tahmin edip sonucunu dinleyebilirdi.
 *
 * SÜRE TAVANI: Akış, iş terminal duruma geçtiğinde ya da `MAX_STREAM_MS`
 * dolduğunda KAPANIR. Sunucusuz fonksiyonların süre sınırı nedeniyle akış
 * sonsuza kadar açık tutulmaz; istemci bittiğinde yeniden bağlanır ve
 * sonucu kaçırmaz (kayıt kalıcıdır).
 */
import { createFileRoute } from "@tanstack/react-router";

import { requireUser } from "@/lib/api-guard.server";
import { readDiscoveryJob } from "@/lib/product-discovery-jobs.server";

/** Akışın en uzun açık kalacağı süre (ms). Sunucusuz sınırların altında. */
const MAX_STREAM_MS = 55_000;
/** Yoklama aralığı (ms). */
const POLL_MS = 1_500;

export const Route = createFileRoute("/api/product-discovery/stream")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const guard = await requireUser(request);
        if ("response" in guard) return guard.response;
        const { userId } = guard;

        const runId = new URL(request.url).searchParams.get("runId")?.trim() ?? "";
        if (!runId) {
          return new Response(JSON.stringify({ error: "runId gerekli." }), {
            status: 400,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        }

        // SAHİPLİK — satırdan okunur, gövdeden değil.
        const job = await readDiscoveryJob(runId);
        if (!job) {
          return new Response(JSON.stringify({ error: "İş kaydı bulunamadı." }), {
            status: 404,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        }
        if (job.userId !== userId) {
          return new Response(JSON.stringify({ error: "Bu işe erişim yok." }), {
            status: 403,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        }

        const encoder = new TextEncoder();
        let closed = false;

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const send = (event: string, data: unknown) => {
              if (closed) return;
              controller.enqueue(
                encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
              );
            };

            const tick = async () => {
              const current = await readDiscoveryJob(runId);
              if (!current || closed) {
                closed = true;
                controller.close();
                return;
              }
              send("progress", {
                runId,
                status: current.discoveryStatus,
                step: current.discoveryStep,
                progress: current.discoveryProgress,
                stats: current.stats,
              });
              if (current.discoveryStatus === "completed" || current.discoveryStatus === "failed") {
                send("result", {
                  runId,
                  status: current.discoveryStatus,
                  error: current.error,
                });
                closed = true;
                controller.close();
              }
            };

            void tick();
            const timer = setInterval(() => {
              if (closed) {
                clearInterval(timer);
                return;
              }
              void tick();
            }, POLL_MS);

            // SÜRE TAVANI: fonksiyon süresi dolmadan akışı kapat.
            const cap = setTimeout(() => {
              clearInterval(timer);
              if (!closed) {
                closed = true;
                send("bye", { runId, reason: "stream_window_elapsed" });
                controller.close();
              }
            }, MAX_STREAM_MS);

            // İstemci ayrılırsa kaynaklar bırakılır (sızıntı olmaz).
            request.signal.addEventListener("abort", () => {
              clearInterval(timer);
              clearTimeout(cap);
              closed = true;
              try {
                controller.close();
              } catch {
                // zaten kapalı
              }
            });
          },
          cancel() {
            closed = true;
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-store, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
          },
        });
      },
    },
  },
});
