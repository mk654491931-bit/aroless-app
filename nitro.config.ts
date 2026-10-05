/**
 * Vercel fonksiyon süresi çözümü.
 *
 * Neden ayrı fonksiyon: `VERCEL_FUNCTION_MAX_DURATION` Vercel'de **build
 * ortamında** okunur ve `vercel.functions.maxDuration` alanına doğrudan yazılır.
 * Değer boş (`""`) veya sayı olmayan bir metin olduğunda `Number(...)` sırasıyla
 * `0` ve `NaN` üretir; Nitro bunu `functions` yapılandırmasına geçirdiğinde
 * Vercel build'i **yapılandırma doğrulamasında** reddeder — kurulum/derleme
 * başlamadan, ~30 sn'de düşer. Bu, kodla ilgisi olmayan bir hatayı kod
 * yüzünden göstermek demektir.
 *
 * Bu yüzden değer burada **savunmacı** biçimde çözülür: okunabilir sayı yoksa
 * Vercel'in varsayılanına (300 sn) düşülür, okunabiliyorsa plan tavanına
 * kırpılır. Aynı değişken `host-runtime.server.ts` tarafından da okunur, yani
 * build ve runtime bütçesi tek kaynaktan yönetilmeye devam eder.
 */

/** Vercel Hobby'nin fonksiyon süresi tavanı (fluid compute). */
export const VERCEL_MAX_FUNCTION_SECONDS = 300;

/** Vercel'in kabul ettiği en düşük anlamlı fonksiyon süresi. */
const MIN_FUNCTION_SECONDS = 10;

/**
 * `VERCEL_FUNCTION_MAX_DURATION` değerini güvenli bir tam sayıya çevirir.
 *
 * Boş/whitespace, sayı olmayan, sıfır veya negatif değerler **geçersiz** sayılır:
 * hepsi Vercel'in 300 sn varsayılanına döner. Böylece tek bir hatalı env
 * girdisi tüm dağıtımları düşüremez.
 */
export function resolveFunctionMaxDuration(raw: string | undefined): number {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return VERCEL_MAX_FUNCTION_SECONDS;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < MIN_FUNCTION_SECONDS) {
    return VERCEL_MAX_FUNCTION_SECONDS;
  }
  return Math.min(Math.round(parsed), VERCEL_MAX_FUNCTION_SECONDS);
}

export default {
  compatibilityDate: "2025-07-13",
  // Tek dağıtım hedefi Vercel Hobby'dir: ağır işler QStash kuyruğuna verilir,
  // kalıcı bir servis (kendi Node sunucumuz) preset'i değiştirmez.
  preset: "vercel",
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
      maxDuration: resolveFunctionMaxDuration(process.env["VERCEL_FUNCTION_MAX_DURATION"]),
    },
  },
};
