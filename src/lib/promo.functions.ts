import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildAdminPromoUsers,
  summarizePromoByCode,
  type AdminPromoUser,
  type PromoCodeStat,
  type PromoProfileRow,
  type PromoRedemptionRow,
  type PromoTransactionRow,
} from "@/lib/promo-attribution";

async function assertAdmin(context: { supabase: any; userId: string; claims: any }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error || !data) throw new Error("Forbidden");
}

export type PromoCodeRow = {
  id: string;
  code: string;
  discount_pct: number;
  max_redemptions: number | null;
  times_redeemed: number;
  active: boolean;
  expires_at: string | null;
  created_at: string;
};

export const listPromoCodes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PromoCodeRow[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("promo_codes")
      .select(
        "id, code, discount_pct, max_redemptions, times_redeemed, active, expires_at, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (data ?? []) as PromoCodeRow[];
  });

const CreateInput = z.object({
  code: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/, "Only letters, numbers, - and _"),
  discount_pct: z.number().int().min(1).max(100),
  max_redemptions: z.number().int().min(1).max(100000).nullable().optional(),
  expires_at: z.string().nullable().optional(),
});

export const createPromoCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CreateInput.parse(i))
  .handler(async ({ data, context }): Promise<PromoCodeRow> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("promo_codes")
      .insert({
        code: data.code.toUpperCase(),
        discount_pct: data.discount_pct,
        max_redemptions: data.max_redemptions ?? null,
        expires_at: data.expires_at || null,
        created_by: context.userId,
      })
      .select(
        "id, code, discount_pct, max_redemptions, times_redeemed, active, expires_at, created_at",
      )
      .single();
    if (error)
      throw new Error(error.message.includes("duplicate") ? "Bu kod zaten var." : error.message);
    return row as PromoCodeRow;
  });

export const setPromoCodeActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid(), active: z.boolean() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("promo_codes")
      .update({ active: data.active })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deletePromoCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("promo_codes").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Checkout-time validation. Returns the discount percentage for a valid code. */
export const validatePromoCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ code: z.string().trim().min(1).max(32) }).parse(i))
  .handler(async ({ data }): Promise<{ valid: boolean; discount_pct: number; reason?: string }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("promo_codes")
      .select("discount_pct, active, expires_at, max_redemptions, times_redeemed")
      .eq("code", data.code.trim().toUpperCase())
      .maybeSingle();
    if (!row) return { valid: false, discount_pct: 0, reason: "Kod bulunamadı." };
    if (!row.active) return { valid: false, discount_pct: 0, reason: "Kod pasif." };
    if (row.expires_at && new Date(row.expires_at) < new Date())
      return { valid: false, discount_pct: 0, reason: "Kodun süresi dolmuş." };
    if (row.max_redemptions != null && row.times_redeemed >= row.max_redemptions) {
      return { valid: false, discount_pct: 0, reason: "Kod kullanım limitine ulaştı." };
    }
    return { valid: true, discount_pct: row.discount_pct };
  });

/** Kayıt sırasında girilen promosyon kodunu ödeme ekranında otomatik uygulamak için. */
export const getMyPromoCode = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ code: string | null; discount_pct: number }> => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("promo_code")
      .eq("id", context.userId)
      .maybeSingle();
    const code = (profile?.promo_code ?? "").toString().trim().toUpperCase();
    if (!code) return { code: null, discount_pct: 0 };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("promo_codes")
      .select("discount_pct, active, expires_at, max_redemptions, times_redeemed")
      .eq("code", code)
      .maybeSingle();
    if (!row || !row.active) return { code: null, discount_pct: 0 };
    if (row.expires_at && new Date(row.expires_at) < new Date())
      return { code: null, discount_pct: 0 };
    return { code, discount_pct: row.discount_pct };
  });

export type { PromoCodeStat, AdminPromoUser } from "@/lib/promo-attribution";

/** Admin panelde kullanılan ortak ham veri seti: redemptions + profil + ödemeler. */
async function loadPromoAttribution() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: redemptions } = await supabaseAdmin
    .from("promo_redemptions")
    .select("code, user_id, email, signed_up_at, purchased_tier, purchased_at")
    .order("signed_up_at", { ascending: false })
    .limit(2000);

  const rows = (redemptions ?? []) as PromoRedemptionRow[];
  const ids = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean)));

  const [profilesRes, txRes] = await Promise.all([
    ids.length
      ? supabaseAdmin
          .from("profiles")
          .select("id, email, subscription_tier, subscription_status")
          .in("id", ids)
      : Promise.resolve({ data: [] as PromoProfileRow[] }),
    ids.length
      ? supabaseAdmin
          .from("transactions")
          .select("user_id, tier, amount_cents, created_at")
          .in("user_id", ids)
          .order("created_at", { ascending: true })
          .limit(5000)
      : Promise.resolve({ data: [] as PromoTransactionRow[] }),
  ]);

  return {
    users: buildAdminPromoUsers(
      rows,
      (profilesRes.data ?? []) as PromoProfileRow[],
      (txRes.data ?? []) as PromoTransactionRow[],
    ),
  };
}

/**
 * Admin panel: hangi kullanıcı hangi promosyon kodundan geldi, hangi paketi
 * aldı, ne kadar ciro yaptı. (Kod bazlı özetle aynı veriden beslenir.)
 */
export const listAdminPromoUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminPromoUser[]> => {
    await assertAdmin(context);
    const { users } = await loadPromoAttribution();
    return users;
  });

/** Admin panel: hangi kodla kaç kişi kaydoldu, kaçı hangi paketi aldı. */
export const getPromoCodeStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PromoCodeStat[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: codes }, { users }] = await Promise.all([
      supabaseAdmin.from("promo_codes").select("code, discount_pct").limit(200),
      loadPromoAttribution(),
    ]);
    return summarizePromoByCode(users, {
      allCodes: (codes ?? []).map((c) => String(c.code ?? "")),
      discountByCode: Object.fromEntries(
        (codes ?? []).map((c) => [String(c.code ?? "").toUpperCase(), c.discount_pct ?? 0]),
      ),
    });
  });
