// Pin the Cloudflare compatibility date.
// With "latest", builds on/after 2026-08-04 emit `nodejs_compat`, which the
// runtime now rejects ("became the default ... does not need to be specified"),
// causing 502 / Internal server error responses on SSR.
export default {
  compatibilityDate: "2025-07-13",
  preset: "vercel",
  vercel: {
    // The Vercel preset emits one function, and TanStack Start's per-route
    // `export const maxDuration` is NOT carried into `.vc-config.json`. Nitro's
    // `functionRules` is the mechanism that actually sets the function budget.
    //
    // The Product Discovery worker is called by QStash (never by a browser), so
    // the 100s Cloudflare wall does not apply to it. It still needs enough time
    // to finish a live scan + the 14-agent council, so it gets a 300s budget
    // whose own internal deadline (WORKER_BUDGET_MS) commits partial results
    // and exits cleanly before the host can kill it.
    //
    // 300s requires a Vercel plan that allows it (Pro/Fluid compute). On a
    // lower plan, lower this value and the job will report partial results.
    functionRules: {
      "/api/product-discovery/worker": { maxDuration: 300 },
    },
  },
};
