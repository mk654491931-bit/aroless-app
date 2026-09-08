import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  DEFAULT_COMMISSION_RATE_PCT,
  isAffiliateStatus,
  type AffiliateStatus,
} from "@/lib/affiliate";

/** 403 (not 500) for RBAC denials — TanStack Start serializes statusCode. */
function forbidden(): Error & { statusCode: number } {
  const err = new Error("Forbidden") as Error & { statusCode: number };
  err.statusCode = 403;
  return err;
}

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error || !data) throw forbidden();
}

export type AffiliateStatusRow = {
  user_id: string;
  status: AffiliateStatus | string;
  commission_rate_pct: number;
  verified_by: string | null;
  verified_at: string | null;
  created_at: string;
};

export type AffiliateSummary = {
  applied: boolean;
  status: AffiliateStatus | null;
  commission_rate_pct: number;
  referral_code: string;
  earned_cents: number;
  paid_transactions: number;
  recent: Array<{
    id: string;
    tier: string | null;
    gross_amount_cents: number;
    commission_cents: number;
    created_at: string;
  }>;
};

/** Kullanıcının affiliate başvurusu, durumu ve birikmiş komisyonları. */
export const getMyAffiliateStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AffiliateSummary> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [affiliateRes, profileRes, commissionsRes] = await Promise.all([
      supabaseAdmin
        .from("affiliates")
        .select("user_id, status, commission_rate_pct, verified_by, verified_at, created_at")
        .eq("user_id", context.userId)
        .maybeSingle(),
      supabaseAdmin
        .from("profiles")
        .select("referral_code")
        .eq("id", context.userId)
        .maybeSingle(),
      supabaseAdmin
        .from("affiliate_commissions")
        .select(
          "id, tier, gross_amount_cents, commission_cents, created_at",
        )
        .eq("affiliate_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    const row = affiliateRes.data as AffiliateStatusRow | null;
    const commissions = (commissionsRes.data ?? []) as AffiliateSummary["recent"];

    return {
      applied: !!row,
      status: row && isAffiliateStatus(row.status) ? row.status : null,
      commission_rate_pct: row?.commission_rate_pct ?? DEFAULT_COMMISSION_RATE_PCT,
      referral_code: ((profileRes.data as { referral_code?: string } | null)?.referral_code ?? "") as string,
      earned_cents: commissions.reduce((s, c) => s + (c.commission_cents ?? 0), 0),
      paid_transactions: commissions.length,
      recent: commissions.slice(0, 10).map((c) => ({
        id: c.id,
        tier: c.tier ?? null,
        gross_amount_cents: c.gross_amount_cents ?? 0,
        commission_cents: c.commission_cents ?? 0,
        created_at: c.created_at,
      })),
    };
  });

/**
 * Affiliate programına başvur. Idempotent: daha önce başvurmuşsa mevcut
 * durumunu döner, asla durumunu değiştirmez (yalnızca admin onaylayabilir).
 */
export const applyForAffiliate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: boolean; status: AffiliateStatus | null }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("affiliates")
      .select("status")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (existingError) return { ok: false, status: null };
    if (existing) {
      const status = isAffiliateStatus(existing.status) ? existing.status : null;
      return { ok: true, status };
    }

    const { error } = await supabaseAdmin.from("affiliates").insert({
      user_id: context.userId,
      status: "pending",
      commission_rate_pct: DEFAULT_COMMISSION_RATE_PCT,
    });
    if (error) return { ok: false, status: null };
    return { ok: true, status: "pending" };
  });

export type AdminAffiliateRow = {
  user_id: string;
  email: string | null;
  status: string;
  commission_rate_pct: number;
  verified_at: string | null;
  created_at: string;
  earned_cents: number;
  paid_transactions: number;
};

/** Tüm affiliate başvuruları + birikmiş komisyon özetleri (yalnızca admin). */
export const adminListAffiliates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminAffiliateRow[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [affiliatesRes, commissionsRes] = await Promise.all([
      supabaseAdmin
        .from("affiliates")
        .select(
          "user_id, status, commission_rate_pct, verified_at, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(200),
      supabaseAdmin
        .from("affiliate_commissions")
        .select("affiliate_id, commission_cents"),
    ]);

    const rows = (affiliatesRes.data ?? []) as Array<{
      user_id: string;
      status: string;
      commission_rate_pct: number;
      verified_at: string | null;
      created_at: string;
    }>;

    const totals = new Map<string, { earned: number; count: number }>();
    for (const c of (commissionsRes.data ?? []) as Array<{
      affiliate_id: string;
      commission_cents: number;
    }>) {
      const t = totals.get(c.affiliate_id) ?? { earned: 0, count: 0 };
      t.earned += c.commission_cents ?? 0;
      t.count += 1;
      totals.set(c.affiliate_id, t);
    }

    if (rows.length === 0) return [];

    const emailsRes = await supabaseAdmin
      .from("profiles")
      .select("id, email")
      .in(
        "id",
        rows.map((r) => r.user_id),
      );
    const emailById = new Map(
      ((emailsRes.data ?? []) as Array<{ id: string; email: string | null }>).map((p) => [
        p.id,
        p.email,
      ]),
    );

    return rows.map((r) => {
      const t = totals.get(r.user_id) ?? { earned: 0, count: 0 };
      return {
        user_id: r.user_id,
        email: emailById.get(r.user_id) ?? null,
        status: r.status,
        commission_rate_pct: r.commission_rate_pct,
        verified_at: r.verified_at,
        created_at: r.created_at,
        earned_cents: t.earned,
        paid_transactions: t.count,
      };
    });
  });

const SetStatusSchema = z.object({
  userId: z.string().uuid(),
  status: z.enum(["pending", "verified", "revoked"]),
  ratePct: z.number().int().min(0).max(100).optional(),
});

/**
 * Admin: affiliate'i onayla / askıya al / oranını değiştir.
 * RBAC, DB içinde SECURITY DEFINER verify_affiliate() tarafından da doğrulanır —
 * API katmanı atlansa bile yetkisiz çağrı imkânsız.
 */
export const adminSetAffiliateStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SetStatusSchema.parse(input))
  .handler(
    async ({ data, context }): Promise<{ ok: boolean; status: AffiliateStatus }> => {
      await assertAdmin(context);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const { data: result, error } = await supabaseAdmin.rpc("verify_affiliate", {
        _admin_id: context.userId,
        _user_id: data.userId,
        _status: data.status,
        _rate_pct: data.ratePct ?? null,
      });
      if (error || String(result) !== "ok") throw forbidden();
      return { ok: true, status: data.status };
    },
  );