import { createFileRoute } from "@tanstack/react-router";
import { guardAuthed, jsonError, readJsonBody } from "@/lib/api-guard.server";
import { interactiveRequestBudgetMs } from "@/lib/host-runtime.server";

/** Single AI endpoint powering all Aroless tool cards. Requires a signed-in user. */
export const Route = createFileRoute("/api/public/tool")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const guard = await guardAuthed(request, "tool", 20, 60);
        if ("response" in guard) return guard.response;

        try {
          const body = await readJsonBody<{ tool?: string; input?: Record<string, string> }>(
            request,
          );
          if (!body) return jsonError(400, "Geçersiz veya çok büyük istek.");
          const tool = String(body.tool ?? "") as import("@/lib/tools-prompts.server").ToolId;
          if (!tool) return jsonError(400, "Araç seçilmedi.");

          const raw = body.input ?? {};
          const input: Record<string, string> = {};
          for (const [k, v] of Object.entries(raw).slice(0, 20)) {
            input[String(k).slice(0, 40)] = String(v ?? "").slice(0, 6000);
          }

          // Fail-fast: anahtar yoksa 25sn'lik havuz taramasına hiç girme — anında 503 dön.
          const { hasAnyAiProvider } = await import("@/lib/ai.server");
          if (!hasAnyAiProvider()) {
            return jsonError(
              503,
              "AI servisi şu anda yapılandırılmadı (anahtar yok). Yönetici panelinden AI anahtarlarını ekleyin.",
            );
          }

          const { buildPrompt, TOOL_PROVIDER } = await import("@/lib/tools-prompts.server");
          const { runTool, runConsensus } = await import("@/lib/tools-ai.server");
          const prompt = buildPrompt(tool, input);

          // Bütçe platformdan gelir (Vercel 300 sn → 90 sn'lik araç bütçesi),
          // yani çok motorlu tur koşabilir; üst sınır yine de 90 sn'dir ki
          // proxy'nin kesmesi beklenmeden anlamlı bir yanıt çıksın.
          const budgetMs = Math.max(25_000, Math.min(90_000, interactiveRequestBudgetMs() - 4_000));
          const withBudget = <T>(p: Promise<T>, ms = budgetMs): Promise<T> =>
            Promise.race([
              p,
              new Promise<never>((_, rej) =>
                setTimeout(() => rej(new Error("TOOL_TIMEOUT")), ms),
              ),
            ]);

          if (tool === "consensus") {
            return Response.json(await withBudget(runConsensus(prompt)));
          }
          if (tool === "news") {
            const { callGemini, callLovableAI, extractJson } = await import("@/lib/ai.server");
            const readItems = (text: string) => {
              const parsed = extractJson<{ items?: unknown[] }>(text, {});
              return Array.isArray(parsed.items) ? parsed.items.slice(0, 8) : [];
            };
            // Önce zeminli (arama yapabilen) Gemini; cevap vermezse tüm anahtar
            // havuzunu süpüren yol — araç yine boş dönmez.
            try {
              return Response.json({
                items: readItems(
                  await withBudget(
                    callGemini(prompt, undefined, 0.5, true),
                    Math.round(budgetMs * 0.6),
                  ),
                ),
              });
            } catch {
              return Response.json({
                items: readItems(await withBudget(callLovableAI(prompt, 0.5))),
              });
            }
          }
          return Response.json(
            await withBudget(
              runTool(prompt, TOOL_PROVIDER[tool] ?? "gemini", 0.5, budgetMs - 2_000),
            ),
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e ?? "");
          if (msg === "TOOL_TIMEOUT") {
            // BİLİNÇLİ OLARAK 504 DEĞİL: bu bir altyapı zaman aşımı değil, "bu
            // istekte bitmedi" durumudur ve iş yeniden denendiğinde (başka bir
            // anahtar/motor ile) tipik olarak tamamlanır. 504 dönersek izleme
            // araçları bunu gateway arızası sayar, bazı proxy'ler yanıtı
            // yeniden yazar ve kullanıcı gördüğü sayıyı hata sanır. 503 +
            // `Retry-After` doğru anlamı verir.
            return new Response(
              JSON.stringify({
                error:
                  "AI yanıtı bu istekte yetişmedi. Birkaç saniye sonra tekrar deneyin — sonraki deneme farklı bir anahtarla yapılır.",
                retryable: true,
                code: "TOOL_WARMING",
              }),
              {
                status: 503,
                headers: {
                  "content-type": "application/json; charset=utf-8",
                  "cache-control": "no-store",
                  "retry-after": "4",
                },
              },
            );
          }
          if (/AI anahtar\u0131|AI gateway|not configured|no api key/i.test(msg)) {
            return jsonError(
              503,
              "AI servisi yapılandırılmadı veya tüm anahtarlar kotada. Biraz bekleyip tekrar deneyin.",
              e,
            );
          }
          if (/T\u00fcm motorlar|\u015fu anda yo\u011fun/i.test(msg)) {
            return jsonError(503, msg || "Tüm motorlar yoğun, birkaç saniye sonra tekrar deneyin.", e);
          }
          return jsonError(500, "İşlem tamamlanamadı. Lütfen tekrar deneyin.", e);
        }
      },
    },
  },
});
