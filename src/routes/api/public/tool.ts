import { createFileRoute } from "@tanstack/react-router";
import { guardAuthed, jsonError, readJsonBody } from "@/lib/api-guard.server";

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

          // Vercel Hobby: 60sn hard limit — tüm işi 42sn içinde bitir, aşılırsa 504 değil anlamlı hata dön.
          const withBudget = <T>(p: Promise<T>, ms = 42_000): Promise<T> =>
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
            const { callGemini, extractJson } = await import("@/lib/ai.server");
            const text = await withBudget(callGemini(prompt, undefined, 0.5, true));
            const parsed = extractJson<{ items?: unknown[] }>(text, {});
            return Response.json({
              items: Array.isArray(parsed.items) ? parsed.items.slice(0, 8) : [],
            });
          }
          return Response.json(
            await withBudget(runTool(prompt, TOOL_PROVIDER[tool] ?? "gemini")),
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e ?? "");
          if (msg === "TOOL_TIMEOUT") {
            return jsonError(
              504,
              "AI yanıtı zaman aşımına uğradı (42sn). Lütfen tekrar deneyin — bir sonraki deneme farklı bir anahtarla yapılır.",
              e,
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
