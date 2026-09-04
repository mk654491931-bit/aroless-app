import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(context: { supabase: any; userId: string; claims: any }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error || !data) throw new Error("Forbidden");
}

export type AdminStats = {
  totalUsers: number;
  totalRevenueCents: number;
  monthRevenueCents: number;
  totalTransactions: number;
  totalCreditsSpent: number;
  isAdmin: true;
};

export const getAdminStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminStats> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [usersRes, txCountRes, txAllRes, creditsRes] = await Promise.all([
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("transactions").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("transactions").select("amount_cents, created_at"),
      supabaseAdmin.from("profiles").select("credits_spent"),
    ]);

    const totalUsers = usersRes.count ?? 0;
    const totalTransactions = txCountRes.count ?? 0;
    const totalRevenueCents = (txAllRes.data ?? []).reduce(
      (s, r: { amount_cents?: number | null }) => s + (r.amount_cents ?? 0),
      0,
    );
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const monthRevenueCents = (txAllRes.data ?? []).reduce((s, r: any) => {
      return new Date(r.created_at) >= monthStart ? s + (r.amount_cents ?? 0) : s;
    }, 0);
    const totalCreditsSpent = (creditsRes.data ?? []).reduce(
      (s, r: { credits_spent?: number | null }) => s + (r.credits_spent ?? 0),
      0,
    );

    return {
      totalUsers,
      totalRevenueCents,
      monthRevenueCents,
      totalTransactions,
      totalCreditsSpent,
      isAdmin: true,
    };
  });

export type AdminUserRow = {
  id: string;
  email: string | null;
  credits: number;
  credits_spent: number;
  subscription_tier: string;
  created_at: string;
};

export const listAdminUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminUserRow[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, email, credits, credits_spent, subscription_tier, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []) as AdminUserRow[];
  });

export type AdminTxRow = {
  id: string;
  email: string | null;
  tier: string | null;
  amount_cents: number;
  currency: string;
  payment_method: string | null;
  provider: string;
  created_at: string;
};

export const listAdminTransactions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminTxRow[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("transactions")
      .select("id, email, tier, amount_cents, currency, payment_method, provider, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []) as AdminTxRow[];
  });

export const checkIsAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ isAdmin: boolean }> => {
    try {
      await assertAdmin(context);
      return { isAdmin: true };
    } catch {
      return { isAdmin: false };
    }
  });

/**
 * Günlük admin kredisi: Admin rolündeki kullanıcıya her UTC günü 250 kredi yükler.
 *
 * Güvenlik/doğruluk:
 *  - Rol kontrolü önce yapılır (has_role RPC) — istek gövdesine güvenilmez.
 *  - Günlük teslimat `profiles.credits_reset_at` ile kayıt altına alınır; aynı gün
 *    içinde tekrar yükleme YAPILMAZ (günlük 250 kredidir, 250'ye tamamlama değil).
 *  - Rolü olmayan kullanıcı için: e-posta Supabase'deki is_admin_email allowlist'inde
 *    ise rol atanır (DB onayı olmadan admin yetkisi verilmez) ve kredi güncellenir.
 *  - Yeni kayıt akışına / signup kredilerine DOKUNMAZ.
 */
export const ensureDailyAdminCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{ updated: boolean; granted: boolean; credits: number; reason?: string }> => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      // 1) Kullanıcının admin rolü var mı?
      const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
        _user_id: context.userId,
        _role: "admin",
      });
      if (!isAdmin) {
        // 1b) DB allowlist onayı olmadan admin rolü asla verilmez.
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("email")
          .eq("id", context.userId)
          .maybeSingle();
        const email = String(profile?.email ?? context.claims?.email ?? "").toLowerCase();
        if (!email) return { updated: false, granted: false, credits: 0, reason: "no_email" };
        const { data: allowed, error: allowErr } = await supabaseAdmin.rpc("is_admin_email", {
          _email: email,
        });
        if (allowErr || !allowed) {
          return { updated: false, granted: false, credits: 0, reason: "not_allowlisted" };
        }
        const { data: hasRole } = await supabaseAdmin
          .from("user_roles")
          .select("id")
          .eq("user_id", context.userId)
          .eq("role", "admin")
          .maybeSingle();
        if (!hasRole) {
          const { error: roleErr } = await supabaseAdmin
            .from("user_roles")
            .insert({ user_id: context.userId, role: "admin" as const });
          if (roleErr) {
            console.error("[admin-bootstrap] role insert failed", roleErr);
            return { updated: false, granted: false, credits: 0, reason: "role_insert_failed" };
          }
        }
      }

      // 2) Bugün zaten yüklendiyse dokunma (günde bir kez).
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const todayIso = today.toISOString();
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("credits, credits_reset_at")
        .eq("id", context.userId)
        .maybeSingle();
      const last = profile?.credits_reset_at ? new Date(profile.credits_reset_at as string) : null;
      if (last && last.getTime() >= today.getTime()) {
        return {
          updated: false,
          granted: true,
          credits: profile?.credits ?? 0,
          reason: "already_today",
        };
      }

      // 3) Günlük 250 krediyi yükle (race guard: yalnızca bugün yüklenmemişse).
      const { data: updatedRow } = await supabaseAdmin
        .from("profiles")
        .update({ credits: 250, credits_reset_at: new Date().toISOString() })
        .eq("id", context.userId)
        .or(`credits_reset_at.is.null,credits_reset_at.lt.${todayIso}`)
        .select("credits")
        .maybeSingle();
      if (!updatedRow) {
        return {
          updated: false,
          granted: true,
          credits: profile?.credits ?? 0,
          reason: "concurrent_grant",
        };
      }
      return { updated: true, granted: true, credits: 250 };
    },
  );

/** @deprecated Eski tek seferlik kredi tamamlama; günlük sürüm: ensureDailyAdminCredits. */
export const ensureAdminCredits = ensureDailyAdminCredits;

export type FreeCreditAuditRow = {
  id: string;
  user_id: string | null;
  email: string | null;
  visitor_id: string | null;
  ip_hash: string | null;
  granted: boolean;
  credits: number;
  sim_credits: number;
  reason: string;
  source: string;
  created_at: string;
};

/** Ücretsiz kredi denetim logu (yalnızca admin). */
export const listFreeCreditAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{ rows: FreeCreditAuditRow[]; granted: number; blocked: number }> => {
      await assertAdmin(context);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data, error } = await supabaseAdmin
        .from("free_credit_audit")
        .select(
          "id, user_id, email, visitor_id, ip_hash, granted, credits, sim_credits, reason, source, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as FreeCreditAuditRow[];
      return {
        rows,
        granted: rows.filter((r) => r.granted).length,
        blocked: rows.filter((r) => !r.granted).length,
      };
    },
  );

export type AbuseAlertRow = {
  id: string;
  title: string;
  body: string | null;
  created_at: string;
  read: boolean;
  severity: "low" | "high";
  reasons: string[];
  suspect_email: string | null;
  visitor_id: string | null;
  ip_hash: string | null;
  blocked: boolean;
};

/** Ücretsiz kredi kötüye kullanım uyarıları (yalnızca admin). */
export const listAbuseAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ rows: AbuseAlertRow[]; high: number }> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("notifications")
      .select("id, title, body, data, read, created_at")
      .eq("type", "free_credit_abuse")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    const rows: AbuseAlertRow[] = (data ?? []).map((n) => {
      const d = (n.data ?? {}) as Record<string, unknown>;
      return {
        id: n.id,
        title: n.title,
        body: n.body,
        created_at: n.created_at,
        read: n.read,
        severity: d["severity"] === "high" ? "high" : "low",
        reasons: Array.isArray(d["reasons"]) ? (d["reasons"] as string[]) : [],
        suspect_email: (d["suspect_email"] as string | null) ?? null,
        visitor_id: (d["visitor_id"] as string | null) ?? null,
        ip_hash: (d["ip_hash"] as string | null) ?? null,
        blocked: !!d["blocked"],
      };
    });
    return { rows, high: rows.filter((r) => r.severity === "high").length };
  });
