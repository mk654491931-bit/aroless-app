export default {
  compatibilityDate: "2025-07-13",
  // Keep Vercel as the default while allowing Render's Blueprint to select the
  // persistent Node-compatible preset at build time.
  preset: process.env["NITRO_PRESET"] ?? "vercel",
  vercel: {
    functions: {
      // Vercel HOBBY planı: bir fonksiyon en fazla 60 sn çalışabilir; daha
      // yüksek bir değer deploy'u reddettirir. Bu yüzden varsayılan 60'tır.
      // Pro/Enterprise plana geçildiğinde tek yapmanız gereken
      // VERCEL_FUNCTION_MAX_DURATION=300 ortam değişkenini eklemektir;
      // arka plan işçisi ve bekleme süreleri otomatik olarak genişler.
      maxDuration: Number(process.env["VERCEL_FUNCTION_MAX_DURATION"] ?? 60),
    },
  },
};
