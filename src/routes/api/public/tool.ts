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
            const key = encodeURIComponent(String(k).trim().slice(0, 40));
            const val = encodeURIComponent(String(v ?? "").trim());
            input[key] = val.slice(0, 6000);
          }

          const { buildPrompt, TOOL_PROVIDER } = await import("@/lib/tools-prompts.server");
          const { runTool, runConsensus } = await import("@/lib/tools-ai.server");
          const prompt = buildPrompt(tool, input);

          try {
            if (tool === "consensus") {
              const result = await runConsensus(prompt);
              return Response.json({
                status: "success",
                results: result ?? {},
                error: null,
              });
            }
            if (tool === "news") {
              const { callGemini, extractJson } = await import("@/lib/ai.server");
              const key =
                process.env["GEMINI_API_KEY_1"] ||
                process.env["GEMINI_1_API_KEY"] ||
                process.env["GEMINI_API_KEY"];
              const text = await callGemini(prompt, key, 0.5, true);
              const parsed = extractJson<{ items?: unknown[] }>(text, {});
              return Response.json({
                status: "success",
                results: {
                  items: Array.isArray(parsed.items) ? parsed.items.slice(0, 8) : [],
                },
                error: null,
              });
            }
            const toolResult = await runTool(prompt, TOOL_PROVIDER[tool] ?? "gemini");
            return Response.json({
              status: "success",
              results: toolResult ?? {},
              error: null,
            });
          } catch (innerError) {
            console.error(`[api/tool] AI call failed for tool=${tool}:`, innerError);
            return Response.json({
              status: "success",
              results: {
                headline: "",
                metrics: [],
                bullets: [],
                table: null,
                document: null,
                risks: [],
                actions: [],
                assumptions: [],
                verdict: "Sonuç alınamadı.",
                score: 0,
                provider: "none",
              },
              error: null,
            });
          }
        } catch (e) {
          console.error("[api/tool] Unexpected error:", e);
          return Response.json({
            status: "success",
            results: {
              headline: "",
              metrics: [],
              bullets: [],
              table: null,
              document: null,
              risks: [],
              actions: [],
              assumptions: [],
              verdict: "Sunucu hatası oluştu.",
              score: 0,
              provider: "none",
            },
            error: null,
          });
        }
      },
    },
  },
});
