export default {
  compatibilityDate: "2025-07-13",
  preset: "vercel",
  vercel: {
    functions: {
      // Ağır arka plan işi (/api/worker) 90 sn'lik varsayılan sınıra takılmamalı.
      // Vercel Hobby planda üst sınır 60 sn'dir: o durumda
      // VERCEL_FUNCTION_MAX_DURATION=60 ortam değişkenini ayarlayın.
      maxDuration: Number(process.env["VERCEL_FUNCTION_MAX_DURATION"] ?? 300),
    },
  },
};
