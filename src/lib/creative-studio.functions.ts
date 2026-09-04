import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callPremiumAI, extractJson } from "@/lib/ai.server";
import { creativeKitPrompt, type CreativeKit } from "@/lib/creative-studio.server";

const KitInput = z.object({
  product: z.string().min(2).max(160),
  platform: z.string().max(40).default("TikTok"),
  audience: z.string().max(200).optional().default(""),
  price: z.string().max(40).optional().default(""),
  tone: z.string().max(40).optional().default("energetic"),
  lang: z.string().max(8).optional().default("tr"),
});

export type CreativeAssetRow = {
  id: string;
  product_name: string;
  platform: string;
  language: string;
  payload: CreativeKit;
  created_at: string;
};

const EMPTY: CreativeKit = {
  positioning: "",
  audience: "",
  hooks: [],
  ugc_script: { title: "", duration_seconds: 30, scenes: [], cta: "" },
  ad_copies: [],
  image_prompts: [],
  hashtags: [],
  ab_tests: [],
  email_sms: { subject: "", body: "", sms: "" },
};

export const generateCreativeKit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => KitInput.parse(input))
  .handler(async ({ data, context }) => {
    const { error: deductErr } = await context.supabase.rpc("deduct_credit");
    if (deductErr) {
      if (String(deductErr.message).includes("no_credits")) throw new Error("NO_CREDITS");
      throw new Error(deductErr.message);
    }
    const text = await callPremiumAI(creativeKitPrompt(data), 0.75);
    const kit = extractJson<CreativeKit>(text, EMPTY);

    const { data: saved } = await context.supabase
      .from("creative_assets")
      .insert({
        user_id: context.userId,
        product_name: data.product,
        platform: data.platform,
        language: data.lang,
        payload: kit as unknown as never,
      })
      .select("id, product_name, platform, language, payload, created_at")
      .single();

    return (saved ?? {
      id: "",
      product_name: data.product,
      platform: data.platform,
      language: data.lang,
      payload: kit,
      created_at: new Date().toISOString(),
    }) as unknown as CreativeAssetRow;
  });

export const listCreativeAssets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("creative_assets")
      .select("id, product_name, platform, language, payload, created_at")
      .order("created_at", { ascending: false })
      .limit(30);
    return (data ?? []) as unknown as CreativeAssetRow[];
  });

export const deleteCreativeAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await context.supabase.from("creative_assets").delete().eq("id", data.id);
    return { ok: true };
  });
