import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { addMonths, adminGrantFor, daysLeft, isPlanExpired, type PlanId } from "@/lib/plans";

async function assertAdmin(context: { supabase: any; userId: string; claims: any }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error || !data) {
    // 403, not 500 — TanStack Start serializes statusCode into the response.
    const err = new Error("Forbidden") as Error & { statusCode: number };
    err.statusCode = 403;
    throw err;
  }
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
  subscription_status: string;
  current_period_end: string | null;
  /** Kayıt anında kullanılan promosyon kodu (yoksa null). */
  promo_code: string | null;
  created_at: string;
};

export const listAdminUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminUserRow[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select(
        "id, email, credits, credits_spent, subscription_tier, subscription_status, current_period_end, promo_code, created_at",
      )
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

/* ------------------------------------------------------------------ */
/* Admin paket tanımlama: seçilen kullanıcı/e-postaya Starter, Pro veya */
/* Business paketini 1/2/3/6/12 ay süreyle verme ve iptal etme.         */
/* ------------------------------------------------------------------ */

export type AdminPlanSnapshot = {
  id: string;
  email: string | null;
  tier: string;
  status: string;
  credits: number;
  finder_credits: number;
  sim_credits: number;
  period_start: string | null;
  period_end: string | null;
  days_left: number | null;
  /** Paket aktif sayılır mı? (ücretsiz veya süresi dolmuş → false) */
  active: boolean;
};

const EmailInput = z.object({
  email: z.string().trim().toLowerCase().email("Geçerli bir e-posta adresi girin.").max(200),
});

const AssignPlanInput = EmailInput.extend({
  plan: z.enum(["Starter", "Pro", "Business"]),
  months: z.number().int().min(1).max(36),
  /** false ise mevcut kredi bakiyesi korunur, yalnızca paket + süre yazılır. */
  grantCredits: z.boolean().optional().default(true),
  note: z.string().trim().max(200).optional(),
});

const PROFILE_PLAN_FIELDS =
  "id, email, subscription_tier, subscription_status, credits, finder_credits, sim_credits, current_period_start, current_period_end";

function toSnapshot(row: {
  id: string;
  email: string | null;
  subscription_tier: string | null;
  subscription_status: string | null;
  credits: number | null;
  finder_credits: number | null;
  sim_credits: number | null;
  current_period_start: string | null;
  current_period_end: string | null;
}): AdminPlanSnapshot {
  const tier = row.subscription_tier ?? "Free";
  const paid = tier === "Starter" || tier === "Pro" || tier === "Business";
  const status = row.subscription_status ?? "inactive";
  const left = daysLeft(row.current_period_end);
  return {
    id: row.id,
    email: row.email,
    tier,
    status,
    credits: row.credits ?? 0,
    finder_credits: row.finder_credits ?? 0,
    sim_credits: row.sim_credits ?? 0,
    period_start: row.current_period_start ?? null,
    period_end: row.current_period_end ?? null,
    days_left: left,
    active: paid && !isPlanExpired(row.current_period_end) && status === "active",
  };
}

/** Tek bir kullanıcıyı e-posta ile bulur ve paket durumunu döner. */
export const findAdminPlanTarget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => EmailInput.parse(input))
  .handler(async ({ data, context }): Promise<AdminPlanSnapshot> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("profiles")
      .select(PROFILE_PLAN_FIELDS)
      .ilike("email", data.email)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) {
      const err = new Error("Bu e-posta ile kayıtlı kullanıcı bulunamadı.") as Error & {
        statusCode: number;
      };
      err.statusCode = 404;
      throw err;
    }
    return toSnapshot(row);
  });

/**
 * Seçilen kullanıcıya paket tanımlar: paket + başlangıç/bitiş tarihi + kredi.
 * Ödeme sağlayıcısına dokunmaz, yalnızca erişim hakkını (entitlement) yazar ve
 * işlemi `transactions` tablosuna "admin" kaynağıyla işler (denetim izi).
 */
export const assignAdminPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AssignPlanInput.parse(input))
  .handler(async ({ data, context }): Promise<AdminPlanSnapshot> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row, error: findError } = await supabaseAdmin
      .from("profiles")
      .select(PROFILE_PLAN_FIELDS)
      .ilike("email", data.email)
      .maybeSingle();
    if (findError) throw new Error(findError.message);
    if (!row) {
      const err = new Error("Bu e-posta ile kayıtlı kullanıcı bulunamadı.") as Error & {
        statusCode: number;
      };
      err.statusCode = 404;
      throw err;
    }

    const plan = data.plan as PlanId;
    const startIso = new Date().toISOString();
    const endIso = addMonths(startIso, data.months);
    const grant = adminGrantFor(plan);

    const update: Record<string, unknown> = {
      subscription_tier: plan,
      subscription_status: "active",
      current_period_start: startIso,
      current_period_end: endIso,
      next_billed_at: endIso,
    };
    if (data.grantCredits) {
      update["credits"] = grant.credits;
      update["finder_credits"] = grant.credits;
      update["sim_credits"] = grant.simCredits;
      update["credits_reset_at"] = startIso;
    }

    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update(update as never)
      .eq("id", row.id);
    if (updateError) throw new Error(updateError.message);

    await supabaseAdmin.from("transactions").insert({
      user_id: row.id,
      email: row.email ?? data.email,
      tier: plan,
      amount_cents: 0,
      currency: "USD",
      payment_method: "admin",
      provider: "admin",
      provider_event: "admin.assign_plan",
      external_id: context.userId,
    } as never);

    // Bildirim yalnızca bilgilendirme amaçlıdır: başarısız olsa bile paket
    // tanımlaması geçerli kalır, bu yüzden hata yutulur.
    try {
      await supabaseAdmin.from("notifications").insert({
        user_id: row.id,
        type: "plan_assigned",
        title: "Paketiniz tanımlandı",
        body: `${plan} paketi ${data.months} ay süreyle tanımlandı. Bitiş: ${new Date(endIso).toLocaleDateString("tr-TR")}`,
        data: {
          tier: plan,
          months: data.months,
          period_end: endIso,
          granted_credits: data.grantCredits ? grant.credits : 0,
          note: data.note ?? null,
        },
      } as never);
    } catch {
      /* bildirim gönderilemedi */
    }

    const { data: fresh, error: freshError } = await supabaseAdmin
      .from("profiles")
      .select(PROFILE_PLAN_FIELDS)
      .eq("id", row.id)
      .single();
    if (freshError) throw new Error(freshError.message);
    return toSnapshot(fresh);
  });

/** Kullanıcının paketini iptal eder: ücretsiz sürüme döner, süre kapatılır. */
export const cancelAdminPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => EmailInput.parse(input))
  .handler(async ({ data, context }): Promise<AdminPlanSnapshot> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row, error: findError } = await supabaseAdmin
      .from("profiles")
      .select(PROFILE_PLAN_FIELDS)
      .ilike("email", data.email)
      .maybeSingle();
    if (findError) throw new Error(findError.message);
    if (!row) {
      const err = new Error("Bu e-posta ile kayıtlı kullanıcı bulunamadı.") as Error & {
        statusCode: number;
      };
      err.statusCode = 404;
      throw err;
    }

    const nowIso = new Date().toISOString();
    const wasTier = row.subscription_tier ?? "Free";

    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({
        subscription_tier: "Free",
        subscription_status: "canceled",
        current_period_end: nowIso,
        next_billed_at: null,
      } as never)
      .eq("id", row.id);
    if (updateError) throw new Error(updateError.message);

    await supabaseAdmin.from("transactions").insert({
      user_id: row.id,
      email: row.email ?? data.email,
      tier: wasTier,
      amount_cents: 0,
      currency: "USD",
      payment_method: "admin",
      provider: "admin",
      provider_event: "admin.cancel_plan",
      external_id: context.userId,
    } as never);

    try {
      await supabaseAdmin.from("notifications").insert({
        user_id: row.id,
        type: "plan_canceled",
        title: "Paketiniz iptal edildi",
        body: `${wasTier} paketi iptal edildi; hesabınız ücretsiz sürüme geçti.`,
        data: { previous_tier: wasTier, canceled_at: nowIso },
      } as never);
    } catch {
      /* bildirim gönderilemedi */
    }

    const { data: fresh, error: freshError } = await supabaseAdmin
      .from("profiles")
      .select(PROFILE_PLAN_FIELDS)
      .eq("id", row.id)
      .single();
    if (freshError) throw new Error(freshError.message);
    return toSnapshot(fresh);
  });

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
