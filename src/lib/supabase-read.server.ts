/**
 * OKUMA İSTEMCİSİ SEÇİMİ — servis anahtarı OLMADAN da çalışır.
 *
 * ÖLÇÜLEN HATA: üst bar/sol bardaki "bu ay" sayaçları ve paket adı yalnız
 * `supabaseAdmin` (servis anahtarı) ile okunuyordu. Servis anahtarı tanımlı
 * değilse bu istemci İLK ÖZELLİK ERİŞİMİNDE hata fırlatıyor; sonuç:
 *   • `monthUsage` → null → `measured:false` → ekranda "bilinmiyor",
 *   • `planUsageSnapshot` → tier okunamadı → ücretli kullanıcı **Free**
 *     limitlerini (2/3/0/1) görüyor.
 * Yani kullanıcı kendi aboneliğinin jeton hakkını hiç göremiyordu.
 *
 * KURAL: kullanıcının KENDİ verisi (profil, rol, kullanım defteri) için
 * istekteki JWT ile kurulmuş istemci yeterlidir — RLS zaten yalnız kendi
 * satırlarını gösterir. Servis anahtarı yalnız BAŞKA kullanıcıların verisi
 * gerektiğinde (webhook, admin paneli) zorunludur.
 *
 * Bu yardımcı, servis anahtarı yokken `null` döner; çağıran kendi (kullanıcı)
 * istemcisine düşer. Böylece eksik anahtar "bilinmiyor" ekranına dönüşmez.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Okuma için gereken en küçük istemci yüzeyi (kullanıcı ya da servis). */
export type ReadDb = SupabaseClient;

/**
 * Servis anahtarı varsa yönetici istemcisi; yoksa `null`.
 *
 * `supabaseAdmin` tembel bir Proxy'dir: anahtar eksikse hata `from` erişiminde
 * fırlar. Bu yüzden burada bir kez dokunup ölçeriz — çağıranlar böylece
 * try/catch yazmadan güvenle `db ?? userDb` diyebilir.
 */
export function serviceReadDb(): ReadDb | null {
  try {
    const db = supabaseAdmin as unknown as ReadDb;
    if (typeof db.from !== "function") return null;
    return db;
  } catch {
    return null;
  }
}
