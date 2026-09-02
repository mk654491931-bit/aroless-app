import { defineConfig, loadEnv, type PluginOption } from "vite";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import viteReact from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

// Portable Vite config — no proprietary wrapper required.
// Works locally, in Codespaces, in CI and inside a hosted preview sandbox.

const isSandbox =
  process.env["LOVABLE_SANDBOX"] === "1" || !!process.env["DEV_SERVER__PROJECT_PATH"];

export default defineConfig(async ({ command, mode }) => {
  const plugins: PluginOption[] = [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      server: { entry: "server" },
      importProtection: {
        behavior: "error",
        client: { files: ["**/server/**"], specifiers: ["server-only"] },
      },
    }),
  ];

  // Nitro is intentionally disabled — Freebuff hosting serves static dist/ output.
  plugins.push(viteReact());

  // Optional hosted-preview helpers. Absent outside the sandbox; never required.
  if (command === "serve" && isSandbox) {
    for (const spec of [
      "@lovable.dev/vite-tanstack-config/hmr-gate",
      "@lovable.dev/vite-tanstack-config/dev-server-bridge",
    ]) {
      try {
        const mod: Record<string, unknown> = await import(/* @vite-ignore */ spec);
        const factory = (mod["hmrGatePlugin"] ?? mod["devServerBridgePlugin"]) as
          ((opts?: unknown) => PluginOption) | undefined;
        if (factory) plugins.push(factory({}));
      } catch {
        // not installed → skip
      }
    }
  }

  // Expose VITE_* values through import.meta.env even when the host injects
  // them as plain process env vars (Codespaces, Docker, CI).
  const define: Record<string, string> = {};
  for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), "VITE_"))) {
    define[`import.meta.env.${key}`] = JSON.stringify(value);
  }

  return {
    define,
    base: "./",
    css: { transformer: "lightningcss" as const },
    resolve: {
      alias: { "@": `${process.cwd()}/src` },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
    },
    server: {
      host: "::",
      port: 8080,
      ...(isSandbox ? { strictPort: true, hmr: { overlay: false } } : {}),
      watch: {
        ignored: [
          "**/.workspace/**",
          "**/.agents/**",
          "**/.claude/**",
          "**/.lovable/**",
          "**/.tanstack/tmp/**",
        ],
      },
    },
    plugins,
  };
});
