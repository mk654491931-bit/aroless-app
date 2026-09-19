export default {
  compatibilityDate: "2025-07-13",
  // Keep Vercel as the default while allowing Render's Blueprint to select the
  // persistent Node-compatible preset at build time.
  preset: process.env["NITRO_PRESET"] ?? "vercel",
  vercel: {
    functions: {
      // Vercel'in güncel süre limitleri (fluid compute varsayılan):
      //   Hobby      → varsayılan 300 sn, üst sınır 300 sn
      //   Pro/Ent.   → varsayılan 300 sn, üst sınır 800 sn
      // Eski "Hobby 60 sn" kuralı geçersizdir; 60 sn bırakmak ağır analizleri
      // fonksiyon ortasında keser ve kullanıcı 504 görür. Bu yüzden varsayılan
      // 300'dür ve `VERCEL_FUNCTION_MAX_DURATION` ile (build zamanında) ezilir.
      //
      // ÖNEMLİ: aynı değişken `host-runtime.server.ts` tarafından okunup tüm
      // istek/işçi/yoklama bütçelerini türettiği için build ve runtime bütçesi
      // tek kaynaktan yönetilir: değeri düşürürseniz her şey tutarlı daralır.
      maxDuration: Number(process.env["VERCEL_FUNCTION_MAX_DURATION"] ?? 300),
    },
  },
};
