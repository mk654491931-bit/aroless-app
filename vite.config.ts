import { defineConfig, loadEnv, type PluginOption } from "vite";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import viteReact from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

// Portable Vite config — no proprietary wrapper required.
// Works locally, in Codespaces, in CI and inside a hosted preview sandbox.

const isSandbox =
  process.env["LOVABLE_SANDBOX"] === "1" || !!process.env["DEV_SERVER__PROJECT_PATH"];

export default defineConfig(async ({ command, mode }): Promise<import("vite").UserConfig> => {
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

  // Vercel exposes project variables through process.env during the build, while
  // local Vite values usually come from .env files. Prefer the VITE_* names for
  // browser configuration, but accept the existing unprefixed public Supabase /
  // app names as a migration bridge. Only this explicit public allowlist is
  // copied into the browser bundle; AI, Paddle and service-role secrets never are.
  const publicEnvSources = {
    VITE_SUPABASE_URL: ["VITE_SUPABASE_URL", "SUPABASE_URL"],
    VITE_SUPABASE_PUBLISHABLE_KEY: ["VITE_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEY"],
    VITE_TURNSTILE_SITE_KEY: ["VITE_TURNSTILE_SITE_KEY", "TURNSTILE_SITE_KEY"],
    VITE_API_BASE_URL: ["VITE_API_BASE_URL", "API_BASE_URL"],
    VITE_APP_URL: ["VITE_APP_URL", "APP_URL"],
    VITE_PADDLE_CLIENT_TOKEN: ["VITE_PADDLE_CLIENT_TOKEN"],
    VITE_PADDLE_ENV: ["VITE_PADDLE_ENV"],
    VITE_PADDLE_PRICE_STARTER_MONTHLY: ["VITE_PADDLE_PRICE_STARTER_MONTHLY"],
    VITE_PADDLE_PRICE_PRO_MONTHLY: ["VITE_PADDLE_PRICE_PRO_MONTHLY"],
    VITE_PADDLE_PRICE_BUSINESS_MONTHLY: ["VITE_PADDLE_PRICE_BUSINESS_MONTHLY"],
  } as const;
  const loadedEnv = loadEnv(mode, process.cwd(), "VITE_");
  const buildEnv: Record<string, string> = {};
  for (const [publicName, sources] of Object.entries(publicEnvSources)) {
    const value = sources
      .map((name) => process.env[name] ?? loadedEnv[name])
      .find(
        (candidate): candidate is string =>
          typeof candidate === "string" && candidate.trim().length > 0,
      );
    if (value) buildEnv[publicName] = value;
  }

  const define = {
    __AROLESS_PUBLIC_ENV__: JSON.stringify({
      supabaseUrl: buildEnv.VITE_SUPABASE_URL ?? "",
      supabasePublishableKey: buildEnv.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
      turnstileSiteKey: buildEnv.VITE_TURNSTILE_SITE_KEY ?? "",
      apiBaseUrl: buildEnv.VITE_API_BASE_URL ?? "",
      appUrl: buildEnv.VITE_APP_URL ?? "",
      paddleClientToken: buildEnv.VITE_PADDLE_CLIENT_TOKEN ?? "",
      paddleEnvironment: buildEnv.VITE_PADDLE_ENV === "production" ? "production" : "sandbox",
      paddlePriceStarterMonthly: buildEnv.VITE_PADDLE_PRICE_STARTER_MONTHLY ?? "",
      paddlePriceProMonthly: buildEnv.VITE_PADDLE_PRICE_PRO_MONTHLY ?? "",
      paddlePriceBusinessMonthly: buildEnv.VITE_PADDLE_PRICE_BUSINESS_MONTHLY ?? "",
      mode,
    }),
  };

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
      ...(isSandbox ? { strictPort: true } : {}),
      hmr: false,
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
      minify: "esbuild",
      sourcemap: false,
      rollupOptions: {
        output: {
          entryFileNames: "js/[name].[hash:8].js",
          chunkFileNames: "js/[name].[hash:8].js",
          assetFileNames: (assetInfo: { name?: string }) => {
            const info = (assetInfo.name ?? "").split(".");
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
      chunkSizeWarningLimit: 600,
      reportCompressedSize: true,
      cssCodeSplit: true,
      // CSS minification used to be off because the CSS minifier cannot read the
      // `ES2020` build target. Give it explicit browser targets instead, so the
      // stylesheet is also minified in production.
      cssMinify: true,
      cssTarget: ["chrome111", "edge111", "firefox111", "safari16"],
    },
    plugins,
  };
});
