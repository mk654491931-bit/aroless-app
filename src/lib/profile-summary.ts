import type { Database } from "@/integrations/supabase/types";

/**
 * İstemciye dönen profil özeti — BEYAZ LİSTE.
 *
 * `getFullProfile` satırı `*` ile okur (bir sütun eksikse bile PostgREST tüm
 * sorguyu düşürmez); burada yalnız arayüzün ihtiyaç duyduğu alanlar seçilir,
 * ödeme sağlayıcı kimlikleri gibi alanlar tarayıcıya hiç gitmez.
 */
export type ProfileSummary = {
  email: string | null;
  public_id: string | null;
  credits: number | null;
  finder_credits: number | null;
  sim_credits: number | null;
  credits_spent: number | null;
  subscription_tier: string | null;
  language: string | null;
  currency: string | null;
  notifications_enabled: boolean | null;
  created_at: string | null;
};

export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

/**
 * Ham satırı özete çevirir.
 *
 * Uygulanmamış bir migration'da `public_id`/`finder_credits` gibi sütunlar
 * veritabanında yoksa değer `undefined` gelir; tip `number` dese de `?? null`
 * bunu yakalar. Böylece tek bir eksik sütun kullanıcının bakiyesini gizlemez.
 */
export function profileSummary(row: Partial<ProfileRow>): ProfileSummary {
  return {
    email: row.email ?? null,
    public_id: row.public_id ?? null,
    credits: row.credits ?? null,
    finder_credits: row.finder_credits ?? null,
    sim_credits: row.sim_credits ?? null,
    credits_spent: row.credits_spent ?? null,
    subscription_tier: row.subscription_tier ?? null,
    language: row.language ?? null,
    currency: row.currency ?? null,
    notifications_enabled: row.notifications_enabled ?? null,
    created_at: row.created_at ?? null,
  };
}
