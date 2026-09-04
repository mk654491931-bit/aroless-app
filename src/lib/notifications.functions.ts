import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, string | number | boolean | null>;
  read: boolean;
  created_at: string;
};

export const listNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<NotificationRow[]> => {
    const { data, error } = await context.supabase
      .from("notifications")
      .select("id, type, title, body, data, read, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []) as NotificationRow[];
  });

const MarkReadInput = z.object({ id: z.string().uuid() });

export const markNotificationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => MarkReadInput.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("notifications")
      .update({ read: true })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const MarkAllReadInput = z.object({ type: z.string().optional() });

export const markAllNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => MarkAllReadInput.parse(input))
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", context.userId)
      .eq("read", false);
    if (data.type) query = query.eq("type", data.type);
    const { error } = await query;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type NotificationPreferences = {
  low_credit: boolean;
  trend_alert: boolean;
  payment_success: boolean;
  marketing: boolean;
};

export const getNotificationPreferences = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<NotificationPreferences> => {
    const { data, error } = await context.supabase
      .from("notification_preferences")
      .select("low_credit, trend_alert, payment_success, marketing")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      low_credit: data?.low_credit ?? true,
      trend_alert: data?.trend_alert ?? true,
      payment_success: data?.payment_success ?? true,
      marketing: data?.marketing ?? false,
    };
  });

const PreferencesInput = z.object({
  low_credit: z.boolean().optional(),
  trend_alert: z.boolean().optional(),
  payment_success: z.boolean().optional(),
  marketing: z.boolean().optional(),
});

export const updateNotificationPreferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => PreferencesInput.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("notification_preferences")
      .upsert({ user_id: context.userId, ...data }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
