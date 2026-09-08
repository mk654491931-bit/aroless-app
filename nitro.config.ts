// Server bundle configuration.
//
// Vercel is the only supported deploy target: every server function and every
// /api route ships as a Vercel function out of this build. Do not switch the
// preset without also revisiting vercel.json and the deployment doc.
//
// compatibilityDate is pinned rather than "latest" so a future default change
// cannot alter the runtime contract of an existing deploy.
export default {
  compatibilityDate: "2025-07-13",
  preset: "vercel",
};
