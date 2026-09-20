import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  callAiMesh,
  callPremiumAI,
  callSweepProvider,
  extractJson,
  withDeadline,
} from "@/lib/ai.server";
import { poolGroupAvailable } from "@/lib/ai-pool.server";
import { platformDurationSeconds } from "@/lib/host-runtime.server";
import {
  creativeKitCoverage,
  creativeKitHasContent,
  creativeKitPrompt,
  creativeRepairPrompt,
  emptyCreativeKit,
  mergeCreativeKits,
  normalizeCreativeKit,
  studioBudgetMs,
  type CreativeKit,
} from "@/lib/creative-studio.server";
import { withCreditRefund } from "@/lib/credit-guard.server";

const KitInput = z.object({
  product: z.string().min(2).max(160),
  platform: z.string().max(40).default("TikTok"),
  audience: z.string().max(200).optional().default(""),
  price: z.string().max(40).optional().default(""),
  tone: z.string().max(40).optional().default("energetic"),
  lang: z.string().max(8).optional().default("tr"),
});

/** Bu süreden az kaldıysa yeni motor turu başlatılmaz (yarım cevap = boşa kota). */
const MIN_TURN_MS = 12_000;

export type CreativeAssetRow = {
  id: string;
  product_name: string;
  platform: string;
  language: string;
  payload: CreativeKit;
  created_at: string;
};

type Engine = "premium" | "groq" | "openrouter" | "mesh";

function runnerFor(engine: Engine, prompt: string, temperature: number): Promise<string> {
  switch (engine) {
    case "premium":
      return callPremiumAI(prompt, temperature);
    case "groq":
      return callSweepProvider("groq", prompt, temperature);
    case "openrouter":
      return callSweepProvider("openrouter", prompt, temperature);
    case "mesh":
      return callAiMesh(prompt, { temperature, grounded: false });
  }
}

export const generateCreativeKit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => KitInput.parse(input))
  .handler(async ({ data, context }) => {
    const { error: deductErr } = await context.supabase.rpc("deduct_credit");
    if (deductErr) {
      if (String(deductErr.message).includes("no_credits")) throw new Error("NO_CREDITS");
      throw new Error(deductErr.message);
    }
    // Üretim başarısız olursa düşülen kredi iade edilir.
    return withCreditRefund(context.userId, async () => {
      const plan = creativeKitPrompt(data);
      const deadlineAt = Date.now() + studioBudgetMs(platformDurationSeconds());
      const drafts: { engine: string; kit: CreativeKit }[] = [];
      const timeLeft = () => deadlineAt - Date.now();

      /** Bir motorun cevabını pakete çevirir; boş/parse edilemezse `null`. */
      const collect = async (engine: Engine, prompt: string, temperature: number) => {
        try {
          const text = await withDeadline(
            runnerFor(engine, prompt, temperature),
            Math.max(1_000, timeLeft()),
            `studio:${engine}`,
          );
          const kit = normalizeCreativeKit(extractJson<unknown>(text, {}));
          if (creativeKitHasContent(kit)) drafts.push({ engine, kit });
        } catch {
          /* bu motor yanıt vermedi — sıradaki */
        }
      };

      // ---- Dalga 1: iki BAĞIMSIZ motor paralel ----
      // (ağ geçidi/premium yol + projenin kendi anahtar havuzundan ikinci motor)
      const second: Engine = poolGroupAvailable("groq") ? "groq" : "openrouter";
      await Promise.all([collect("premium", plan, 0.75), collect(second, plan, 0.7)]);

      // ---- Dalga 2: hâlâ yeterli taslak yoksa tüm havuza yayılan güvenlik ağı ----
      if (drafts.length < 2 && timeLeft() > MIN_TURN_MS) {
        await collect("mesh", plan, 0.7);
      }

      let kit = drafts.reduce<CreativeKit>(
        (acc, draft) => mergeCreativeKits(acc, draft.kit),
        emptyCreativeKit(),
      );
      let coverage = creativeKitCoverage(kit);
      let repaired = false;

      // ---- Onarım turu: paket var ama bölümler eksikse FARKLI bir motor
      // yalnızca eksikleri tamamlar. Böylece "yarım paket" kullanıcıya hiç
      // gitmez; tek bir tur da süreyi aşmaz. ----
      if (!coverage.complete && creativeKitHasContent(kit) && timeLeft() > MIN_TURN_MS + 5_000) {
        const used = new Set(drafts.map((d) => d.engine));
        const repairEngine: Engine =
          (["openrouter", "groq", "premium"] as Engine[]).find((e) => !used.has(e)) ?? "mesh";
        const before = drafts.length;
        await collect(repairEngine, creativeRepairPrompt(data, kit, coverage.missing), 0.4);
        if (drafts.length > before) {
          repaired = true;
          kit = drafts.reduce<CreativeKit>(
            (acc, draft) => mergeCreativeKits(acc, draft.kit),
            emptyCreativeKit(),
          );
          coverage = creativeKitCoverage(kit);
        }
      }

      // Boş paket ASLA kaydedilmez/gösterilmez: kredi iade edilir ve kullanıcı
      // "boş ekran" yerine gerçek nedeni görür.
      if (!creativeKitHasContent(kit)) {
        throw new Error(
          "Kreatif paket üretilemedi: AI motorları yanıt vermedi (kota/anahtar). Lütfen birkaç saniye sonra tekrar deneyin — krediniz iade edildi.",
        );
      }

      kit.meta = {
        engines: drafts.map((d) => d.engine),
        coverage: coverage.percent,
        missing_sections: coverage.missing,
        repaired,
      };

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
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await context.supabase.from("creative_assets").delete().eq("id", data.id);
    return { ok: true };
  });
