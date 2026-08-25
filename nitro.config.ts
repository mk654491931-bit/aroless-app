// Pin the Cloudflare compatibility date.
// With "latest", builds on/after 2026-08-04 emit `nodejs_compat`, which the
// runtime now rejects ("became the default ... does not need to be specified"),
// causing 502 / Internal server error responses on SSR.
export default {
  compatibilityDate: "2025-07-13",
  preset: "vercel"
};
