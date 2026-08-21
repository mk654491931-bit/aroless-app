import { createFileRoute } from "@tanstack/react-router";

/** Single AI endpoint powering all Aroless tool cards. */
export const Route = createFileRoute("/api/public/tool")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as { tool?: string; input?: Record<string, string> };
          const tool = String(body.tool ?? "") as import("@/lib/tools-prompts.server").ToolId;
          if (!tool) return new Response(JSON.stringify({ error: "tool required" }), { status: 400 });

          const raw = body.input ?? {};
          const input: Record<string, string> = {};
          for (const [k, v] of Object.entries(raw).slice(0, 20)) {
            input[String(k).slice(0, 40)] = String(v ?? "").slice(0, 6000);
          }

          const { buildPrompt, TOOL_PROVIDER } = await import("@/lib/tools-prompts.server");
          const { runTool, runConsensus } = await import("@/lib/tools-ai.server");
          const prompt = buildPrompt(tool, input);

          if (tool === "consensus") {
            return Response.json(await runConsensus(prompt));
          }
          if (tool === "news") {
            const { callGemini, extractJson } = await import("@/lib/ai.server");
            const key = process.env['GEMINI_API_KEY_1'] || process.env['GEMINI_1_API_KEY'] || process.env['GEMINI_API_KEY'];
            const text = await callGemini(prompt, key, 0.5, true);
            const parsed = extractJson<{ items?: unknown[] }>(text, {});
            return Response.json({ items: Array.isArray(parsed.items) ? parsed.items.slice(0, 8) : [] });
          }
          return Response.json(await runTool(prompt, TOOL_PROVIDER[tool] ?? "gemini"));
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
