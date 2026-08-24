import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** KVKK/GDPR: kullanıcının kendi verilerini tek dosyada dışa aktarması. */
export const exportMyData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const [
      profile,
      favorites,
      history,
      products,
      sims,
      tickets,
      usage,
      notifications,
      transactions,
    ] = await Promise.all([
      sb.from("profiles").select("*").eq("id", context.userId).maybeSingle(),
      sb.from("favorites").select("*").limit(1000),
      sb.from("analysis_history").select("*").limit(500),
      sb.from("products").select("*").limit(1000),
      sb.from("sim_runs").select("*").limit(500),
      sb.from("support_tickets").select("*").limit(200),
      sb.from("credit_usage_log").select("*").limit(1000),
      sb.from("notifications").select("*").limit(500),
      sb.from("transactions").select("*").limit(500),
    ]);
    return {
      exported_at: new Date().toISOString(),
      user_id: context.userId,
      email: String(context.claims?.email ?? ""),
      profile: profile.data ?? null,
      favorites: favorites.data ?? [],
      analysis_history: history.data ?? [],
      products: products.data ?? [],
      simulation_runs: sims.data ?? [],
      support_tickets: tickets.data ?? [],
      credit_usage: usage.data ?? [],
      notifications: notifications.data ?? [],
      transactions: transactions.data ?? [],
    };
  });

/** Hesabı ve bağlı tüm verileri kalıcı olarak siler. */
export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ confirm: z.literal("DELETE") }).parse(i))
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const uid = context.userId;
    await Promise.all([
      supabaseAdmin.from("favorites").delete().eq("user_id", uid),
      supabaseAdmin.from("analysis_history").delete().eq("user_id", uid),
      supabaseAdmin.from("products").delete().eq("user_id", uid),
      supabaseAdmin.from("notifications").delete().eq("user_id", uid),
      supabaseAdmin.from("notification_preferences").delete().eq("user_id", uid),
      supabaseAdmin.from("support_tickets").delete().eq("user_id", uid),
      supabaseAdmin.from("credit_usage_log").delete().eq("user_id", uid),
    ]);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(uid);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type UsageRow = {
  id: string;
  tool: string;
  credits: number;
  model: string | null;
  success: boolean;
  created_at: string;
};

/** Kullanıcının kredi harcama günlüğü. */
export const listMyUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<UsageRow[]> => {
    const { data, error } = await context.supabase
      .from("credit_usage_log")
      .select("id, tool, credits, model, success, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (data ?? []) as UsageRow[];
  });
