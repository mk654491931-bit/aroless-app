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
      // Redirect TanStack Start's bundled server entry to src/server.ts (SSR error wrapper).
      server: { entry: "server" },
      importProtection: {
        behavior: "error",
        client: { files: ["**/server/**"], specifiers: ["server-only"] },
      },
    }),
  ];

  // Nitro is only needed to produce the deployable server bundle.
  if (command === "build") {
    try {
      const { nitro } = await import("nitro/vite");
      plugins.push(
        nitro({
          preset: "vercel",
        }) as PluginOption,
      );
    } catch {
      // nitro not installed → plain Vite SSR build, still fine for local dev/preview.
    }
  }

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
      exclude: ["@lovable.dev/cloud-auth-js"],
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
    build: {
      target: "ES2020",
      minify: false,
      sourcemap: mode !== "production",
      rollupOptions: {
        output: {
          // Kod bölümlendirmesi (Code Splitting) - Daha küçük chunks
          manualChunks: (id) => {
            // Vendor chunks
            if (id.includes("node_modules/react") && !id.includes("react-dom")) {
              return "react-vendor";
            }
            if (id.includes("node_modules/react-dom")) {
              return "react-vendor";
            }
            if (id.includes("node_modules/@radix-ui")) {
              return "ui-vendor";
            }
            if (id.includes("node_modules/@tanstack")) {
              return "tanstack-vendor";
            }
            if (id.includes("node_modules/@supabase")) {
              return "supabase-vendor";
            }
            if (id.includes("node_modules/react-hook-form") || 
                id.includes("node_modules/@hookform")) {
              return "form-vendor";
            }
            if (id.includes("node_modules") && 
                (id.includes("clsx") || id.includes("tailwind-merge"))) {
              return "utils-vendor";
            }
            return undefined;
          },
          // Gzip compression için optimize edilmiş chunk boyutları
          entryFileNames: "js/[name].[hash:8].js",
          chunkFileNames: "js/[name].[hash:8].js",
          assetFileNames: (assetInfo) => {
            const info = assetInfo.name.split(".");
            const ext = info[info.length - 1];
            if (/png|jpe?g|gif|svg|webp|ico/.test(ext)) {
              return `images/[name].[hash:8][extname]`;
            } else if (/woff|woff2|eot|ttf|otf/.test(ext)) {
              return `fonts/[name].[hash:8][extname]`;
            }
            return `assets/[name].[hash:8][extname]`;
          },
        },
      },
      // Daha büyük chunk boyutu sınırı (çünkü daha iyi tree-shaking)
      chunkSizeWarningLimit: 600,
      // Gzip compression
      reportCompressedSize: true,
      cssCodeSplit: true,
      cssMinify: false, // Disable CSS minification to avoid lightningcss issues
    },
    plugins,
  };
});
