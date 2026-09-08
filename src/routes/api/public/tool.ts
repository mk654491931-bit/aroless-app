import { createFileRoute } from "@tanstack/react-router";
import { guardAuthed, jsonError, readJsonBody } from "@/lib/api-guard.server";
import { sanitizeToolId, sanitizeToolInputMap } from "@/lib/api-request-sanitizers";

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
          const tool = sanitizeToolId(body.tool) as import("@/lib/tools-prompts.server").ToolId;
          if (!tool) return jsonError(400, "Araç seçilmedi.");

          const input = sanitizeToolInputMap(body.input ?? {});

          const { buildPrompt, TOOL_PROVIDER } = await import("@/lib/tools-prompts.server");
          const { runTool, runConsensus } = await import("@/lib/tools-ai.server");
          const prompt = buildPrompt(tool, input);

          if (tool === "consensus") {
            return Response.json(await runConsensus(prompt));
          }
          if (tool === "news") {
            const { callGemini, extractJson } = await import("@/lib/ai.server");
            // apiKey bilinçli olarak verilmez: 5'li Gemini havuzu round-robin kullanılır.
            const text = await callGemini(prompt, undefined, 0.5, true);
            const parsed = extractJson<{ items?: unknown[] }>(text, {});
            return Response.json({
              items: Array.isArray(parsed.items) ? parsed.items.slice(0, 8) : [],
            });
          }
          return Response.json(await runTool(prompt, TOOL_PROVIDER[tool] ?? "gemini"));
        } catch (e) {
          return jsonError(500, "İşlem tamamlanamadı. Lütfen tekrar deneyin.", e);
        }
      },
    },
  },
});
