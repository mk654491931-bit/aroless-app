// @ts-nocheck
import { defineConfig, loadEnv, type PluginOption } from "vite";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import viteReact from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

// Portable Vite config — no proprietary wrapper required.
// Works locally, in Codespaces, in CI and inside a hosted preview sandbox.

const isSandbox =
  process.env["LOVABLE_SANDBOX"] === "1" || !!process.env["DEV_SERVER__PROJECT_PATH"];

// Hosted/isolated sandbox'lar (Freebuff) dinlenecek portu PORT ile enjekte eder.
// Sabit 8080 yazmak iki arıza üretiyordu: (1) enjekte edilen port yok sayılıyordu,
// (2) o portta bayat bir dinleyici varsa sunucu ya 8081/8082'ye sessizce kayıyor
// ya da "Port 8080 is already in use" ile hiç açılmıyordu → "dev server failed to
// start". Enjekte edilen port VARSA ona kesin bağlanırız (platform o portu izler
// ve restart'ta serbest bırakır); YOKSA 8080 denenir, doluysa Vite sıradaki boş
// porta geçer — böylece bayat bir dinleyici hiçbir zaman başlatmayı engellemez.
const injectedDevPort = Number(process.env["PORT"] ?? process.env["DEV_SERVER_PORT"]);
const hasInjectedDevPort = Number.isInteger(injectedDevPort) && injectedDevPort > 0;

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
      // Preset `nitro.config.ts` içinde sabit: Vercel Hobby.
      plugins.push(nitro() as PluginOption);
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
    VITE_SUPABASE_PUBLISHABLE_KEY: [
      "VITE_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_PUBLISHABLE_KEY",
    ],
    VITE_TURNSTILE_SITE_KEY: ["VITE_TURNSTILE_SITE_KEY", "TURNSTILE_SITE_KEY"],
    VITE_API_BASE_URL: ["VITE_API_BASE_URL", "API_BASE_URL"],
    VITE_APP_URL: ["VITE_APP_URL", "APP_URL"],
  } as const;
  const loadedEnv = loadEnv(mode, process.cwd(), "VITE_");
  const buildEnv: Record<string, string> = {};
  for (const [publicName, sources] of Object.entries(publicEnvSources)) {
    const value = sources.map((name) => process.env[name] ?? loadedEnv[name]).find(
      (candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0,
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
      // Platformun izlediği port: enjekte edilmişse o, yoksa 8080.
      host: "0.0.0.0",
      port: hasInjectedDevPort ? injectedDevPort : 8080,
      // Enjekte edilen portta KESİN bağlan: platform o portu izler. Port
      // enjekte edilmemişse sabit portta ısrar etme — bayat bir dinleyici
      // yüzünden sunucu hiç açılmazsa preview tamamen düşer.
      strictPort: hasInjectedDevPort,
      hmr: false,
      watch: {
        ignored: [
          "**/.workspace/**",
          "**/.agents/**",
          "**/.claude/**",
          "**/.lovable/**",
          "**/.tanstack/tmp/**",
          // Üretim derlemesi bu dizinlere yazıyor; dev sunucusunun onları
          // izlemesi gereksiz dönüşüm üretip makineyi doyuruyordu (ölçüm:
          // build sırasında load 8). Derleme çıktısı dev'e girdi değildir.
          "**/.vercel/**",
          "**/node_modules/.nitro/**",
          "**/dist/**",
        ],
      },
    },
    build: {
      target: "ES2020",
      minify: mode === "production" ? ("esbuild" as const) : false,
      sourcemap: false as const,
      rollupOptions: {
        output: {
          // Kod bölümlendirmesi (Code Splitting) - Daha küçük chunks
          manualChunks: (id: string) => {
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
      // Daha büyük chunk boyutu sınırı (çünkü daha iyi tree-shaking)
      chunkSizeWarningLimit: 600,
      // Gzip compression
      reportCompressedSize: false as const,
      cssCodeSplit: true,
      cssMinify: false as const,
    },
    plugins,
  };
});
