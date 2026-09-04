import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
  .validator((i: unknown) => CreateInput.parse(i))
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
  .validator((i: unknown) => z.object({ id: z.string().uuid(), active: z.boolean() }).parse(i))
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
  .validator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
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
  .validator((i: unknown) => z.object({ code: z.string().trim().min(1).max(32) }).parse(i))
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
    if (
      row.max_redemptions !== null &&
      row.max_redemptions !== undefined &&
      row.times_redeemed >= row.max_redemptions
    ) {
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

export type PromoCodeStat = {
  code: string;
  discount_pct: number;
  signups: number;
  purchases: number;
  revenue_cents: number;
  by_tier: Record<string, number>;
};

/** Admin panel: hangi kodla kaç kişi kaydoldu, kaçı hangi paketi aldı. */
export const getPromoCodeStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PromoCodeStat[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: codes }, { data: reds }] = await Promise.all([
      supabaseAdmin.from("promo_codes").select("code, discount_pct").limit(200),
      supabaseAdmin
        .from("promo_redemptions")
        .select("code, purchased_tier, amount_cents")
        .limit(5000),
    ]);
    const map = new Map<string, PromoCodeStat>();
    for (const c of codes ?? []) {
      map.set(c.code, {
        code: c.code,
        discount_pct: c.discount_pct,
        signups: 0,
        purchases: 0,
        revenue_cents: 0,
        by_tier: {},
      });
    }
    for (const r of reds ?? []) {
      const key = String(r.code ?? "").toUpperCase();
      if (!key) continue;
      const stat = map.get(key) ?? {
        code: key,
        discount_pct: 0,
        signups: 0,
        purchases: 0,
        revenue_cents: 0,
        by_tier: {},
      };
      stat.signups += 1;
      if (r.purchased_tier) {
        stat.purchases += 1;
        stat.revenue_cents += r.amount_cents ?? 0;
        stat.by_tier[r.purchased_tier] = (stat.by_tier[r.purchased_tier] ?? 0) + 1;
      }
      map.set(key, stat);
    }
    return Array.from(map.values()).sort(
      (a, b) => b.signups - a.signups || a.code.localeCompare(b.code),
    );
  });
