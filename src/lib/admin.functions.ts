import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ADMIN_EMAIL = "mryetenek@gmail.com";

async function assertAdmin(context: { supabase: any; userId: string; claims: any }) {
  const email = String(context.claims?.email ?? "").toLowerCase();
  if (email === ADMIN_EMAIL) return;
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
    const totalRevenueCents = (txAllRes.data ?? []).reduce((s, r: any) => s + (r.amount_cents ?? 0), 0);
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const monthRevenueCents = (txAllRes.data ?? []).reduce((s, r: any) => {
      return new Date(r.created_at) >= monthStart ? s + (r.amount_cents ?? 0) : s;
    }, 0);
    const totalCreditsSpent = (creditsRes.data ?? []).reduce((s, r: any) => s + (r.credits_spent ?? 0), 0);

    return { totalUsers, totalRevenueCents, monthRevenueCents, totalTransactions, totalCreditsSpent, isAdmin: true };
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
    const email = String(context.claims?.email ?? "").toLowerCase();
    if (email === ADMIN_EMAIL) return { isAdmin: true };
    const { data } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    return { isAdmin: !!data };
  });
