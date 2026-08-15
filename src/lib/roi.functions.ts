import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { RoiEntry } from "@/lib/roi-math";

const EntryInput = z.object({
  id: z.string().uuid().optional(),
  product_name: z.string().min(1).max(160),
  platform: z.string().max(40).default("Shopify"),
  country: z.string().max(8).default("US"),
  currency: z.string().max(8).default("USD"),
  cost_price: z.number().min(0).max(1e6).default(0),
  sell_price: z.number().min(0).max(1e6).default(0),
  shipping_cost: z.number().min(0).max(1e6).default(0),
  other_cost: z.number().min(0).max(1e6).default(0),
  ad_spend: z.number().min(0).max(1e9).default(0),
  orders: z.number().int().min(0).max(1e7).default(0),
  refunds: z.number().int().min(0).max(1e7).default(0),
  expected_margin_pct: z.number().min(0).max(100).nullable().optional(),
  notes: z.string().max(600).nullable().optional(),
});

export const listRoiEntries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("roi_entries")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as RoiEntry[];
  });

export const saveRoiEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => EntryInput.parse(input))
  .handler(async ({ data, context }) => {
    const { id, ...rest } = data;
    const row = { ...rest, user_id: context.userId };
    const q = id
      ? context.supabase.from("roi_entries").update(row).eq("id", id).select("*").single()
      : context.supabase.from("roi_entries").insert(row).select("*").single();
    const { data: saved, error } = await q;
    if (error) throw new Error(error.message);
    return saved as unknown as RoiEntry;
  });

export const deleteRoiEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("roi_entries").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
