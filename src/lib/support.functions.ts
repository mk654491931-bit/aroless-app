import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ADMIN_EMAIL = "omnic.111111@gmail.com";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertAdmin(context: { supabase: any; userId: string; claims: any }) {
  const email = String(context.claims?.email ?? "").toLowerCase();
  if (email === ADMIN_EMAIL) return;
  const { data, error } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (error || !data) throw new Error("Forbidden");
}

export type TicketRow = {
  id: string;
  email: string | null;
  category: string;
  subject: string;
  message: string;
  status: string;
  admin_note: string | null;
  created_at: string;
};

export const CATEGORIES = ["general", "billing", "bug", "feature", "data"] as const;

export const createTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        category: z.enum(CATEGORIES).default("general"),
        subject: z.string().trim().min(3).max(140),
        message: z.string().trim().min(10).max(4000),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    // Basit kötüye kullanım koruması: son 10 dakikada en fazla 3 talep.
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count } = await context.supabase
      .from("support_tickets")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since);
    if ((count ?? 0) >= 3) throw new Error("Çok fazla talep gönderdin, lütfen biraz bekle.");

    const { error } = await context.supabase.from("support_tickets").insert({
      user_id: context.userId,
      email: String(context.claims?.email ?? "") || null,
      category: data.category,
      subject: data.subject,
      message: data.message,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listMyTickets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TicketRow[]> => {
    const { data, error } = await context.supabase
      .from("support_tickets")
      .select("id, email, category, subject, message, status, admin_note, created_at")
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);
    return (data ?? []) as TicketRow[];
  });

export const adminListTickets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TicketRow[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("support_tickets")
      .select("id, email, category, subject, message, status, admin_note, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as TicketRow[];
  });

export const adminUpdateTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["open", "in_progress", "resolved", "closed"]).optional(),
        admin_note: z.string().max(2000).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, unknown> = {};
    if (data.status) patch.status = data.status;
    if (data.admin_note !== undefined) patch.admin_note = data.admin_note;
    const { error } = await supabaseAdmin.from("support_tickets").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
