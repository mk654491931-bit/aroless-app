/**
 * Servis rolü (service_role) anahtarı olan/olmayan ortamlarda çalışan Supabase
 * istemci seçimi.
 *
 * `supabaseAdmin` bir Proxy'dir ve `SUPABASE_SERVICE_ROLE_KEY` tanımlı değilse
 * ilk ÖZELLİK erişiminde throw eder. Bu modül o throw'u yakalayıp RLS'li
 * (kullanıcı kapsamlı) istemciye düşer; böylece:
 *   • affiliate başvurusu → apply_for_affiliate() SECURITY DEFINER RPC'si,
 *   • admin destek talebi listesi/cevabı → "Admins manage tickets" RLS politikası
 *     üzerinden çalışır ve panel service_role olmadan da dolu görünür.
 *
 * Yalnızca BAŞKA kullanıcıların satırlarına yazması gereken işlemler
 * (referral_events kaydı, kredi artırma) servis rolüne bağlı kalır.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type SupabaseLike = any;

export type AuthContext = { supabase: any; userId: string };

/**
 * Admin işlemi için: servis rolü varsa onu, yoksa RLS'li istemciyi döndürür.
 * Çağıran, ikisinin de yetmediği durumda `isServiceRole` bayrağını kontrol
 * edip kullanıcıya anlaşılır bir mesaj vermelidir.
 */
export async function adminOrUserClient(
  context: { supabase: any },
): Promise<{ client: SupabaseLike; isServiceRole: boolean }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  try {
    // Proxy tuzağını tetikle: ortam değişkeni yoksa burada throw eder.
    void supabaseAdmin.from;
    return { client: supabaseAdmin, isServiceRole: true };
  } catch {
    return { client: context.supabase, isServiceRole: false };
  }
}

/** Servis rolü anahtarı eksikken kullanıcıya gösterilecek net mesaj. */
export const MISSING_SERVICE_ROLE_MESSAGE =
  "Sunucu yapılandırması eksik: SUPABASE_SERVICE_ROLE_KEY tanımlı değil. " +
  "Bu özelliği kullanmak için Ayarlar → Environment bölümünden bu anahtarı ekleyin.";

/** Servis rolü anahtarı eksikken 503 hatalı bir isteğin gövdesi. */
export function missingServiceRoleError(): Error & { statusCode: number } {
  const err = new Error(MISSING_SERVICE_ROLE_MESSAGE) as Error & { statusCode: number };
  err.statusCode = 503;
  return err;
}
