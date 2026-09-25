// ============================================================================
// SORGU ÖNBELLEĞİ — aynı nişi 24 saat içinde ikinci kez 14 ajana gönderme.
//
// NEDEN: bir kullanıcı aynı nişi/ülkeyi/kanalı tekrar çalıştırdığında 14 model
// çağrısı yeniden harcanır ve karne aynı kanıtla neredeyse aynı çıkar. Bunun
// yerine ÖNCEKİ KOŞUNUN `runId`si geri oynatılır; istemci aynı yoklama yolunu
// kullanır, karne kalıcı kazanan kayıtlarından geri kurulur.
//
// DÜRÜSTLÜK / SINIRLAR:
//   • Önbellek KİŞİYE ÖZELDİR — anahtar kullanıcı kimliğini içerir; bir kişinin
//     araştırması başkasına bedava gitmez.
//   • Yalnızca TAMAMLANMIŞ koşular yazılır; yarım/başarısız koşu asla önbelleğe girmez.
//   • Süre 24 saat: kanıt bu sürede bayatlar, sonra yeni kazıma yapılır.
//   • Kayıt `ai_cache` tablosunda tutulur → YENİ TABLO/MİGRASYON YOK.
// ============================================================================

import type { Json } from "@/integrations/supabase/types";
import { VELORA_QUERY_CACHE_TTL_MS, veloraQueryCacheKey } from "./velora-insights";

/** `ai_cache` içindeki kova adı; diğer önbelleklerle karışmasın. */
export const VELORA_QUERY_CACHE_SCOPE = "velora-query";

export type VeloraQueryCacheInput = {
  userId: string;
  query: string;
  country: string;
  platform: string;
};

/**
 * Bu niş için kayıtlı ve HÂLÂ GEÇERLİ bir koşu var mı?
 *
 * `expires_at` veritabanında karşılaştırılır; geçmiş kayıt kullanılmaz.
 * Hata/erişim sorunu `null` döner → yeni koşu başlatılır (güvenli varsayılan:
 * kullanıcı yanlışlıkla boş bir karne görmez).
 */
export async function readVeloraQueryCache(
  input: VeloraQueryCacheInput,
): Promise<{ runId: string; cachedAt: string } | null> {
  const key = veloraQueryCacheKey(input);
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("ai_cache")
      .select("payload, expires_at")
      .eq("cache_key", key)
      .eq("scope", VELORA_QUERY_CACHE_SCOPE)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (error || !data) return null;
    const payload = (data.payload ?? {}) as Record<string, unknown>;
    const runId = String(payload["runId"] ?? "").trim();
    if (runId.length < 3) return null;
    return { runId, cachedAt: String(payload["cachedAt"] ?? "") };
  } catch {
    return null;
  }
}

/**
 * Tamamlanan koşuyu önbelleğe yazar (aynı anahtarı temizleyerek).
 *
 * Yazma HATAYI YUTAR: önbellek bir kolaylık katmanıdır, koşunun kendisi
 * `radar_items`'a zaten yazıldı. Burada hata olursa sonraki koşu yalnızca
 * tekrar hesaplanır — kullanıcı hiçbir şey kaybetmez.
 */
export async function writeVeloraQueryCache(
  input: VeloraQueryCacheInput,
  runId: string,
): Promise<boolean> {
  const key = veloraQueryCacheKey(input);
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("ai_cache").delete().eq("cache_key", key);
    const { error } = await supabaseAdmin.from("ai_cache").insert({
      cache_key: key,
      scope: VELORA_QUERY_CACHE_SCOPE,
      payload: {
        runId,
        cachedAt: new Date().toISOString(),
        query: input.query,
        country: input.country,
        platform: input.platform,
      } as Json,
      expires_at: new Date(Date.now() + VELORA_QUERY_CACHE_TTL_MS).toISOString(),
    });
    return !error;
  } catch {
    return false;
  }
}
