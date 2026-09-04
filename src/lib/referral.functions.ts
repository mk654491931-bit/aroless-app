import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const REFERRER_BONUS = 1;
export const REFERRED_BONUS = 0;

export type ReferralSummary = {
  code: string;
  invited: number;
  credits_earned: number;
  referred_by_code: string | null;
  claimable: boolean;
  recent: Array<{ created_at: string; credits: number }>;
};

/** Kullanıcının davet kodu + davet istatistikleri. */
export const getMyReferral = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ReferralSummary> => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("referral_code, referred_by, created_at")
      .eq("id", context.userId)
      .maybeSingle();

    const { data: events } = await context.supabase
      .from("referral_events")
      .select("created_at, referrer_credits, referrer_id, referred_user_id, code")
      .order("created_at", { ascending: false })
      .limit(100);

    const mine = (events ?? []).filter((e) => e.referrer_id === context.userId);
    const asReferred = (events ?? []).find((e) => e.referred_user_id === context.userId);

    return {
      code: (profile?.referral_code as string) ?? "",
      invited: mine.length,
      credits_earned: mine.reduce((s, e) => s + (e.referrer_credits ?? 0), 0),
      referred_by_code: asReferred?.code ?? null,
      // Yeni hesaplar (ilk 30 gün) hâlâ bir davet kodu kullanabilir.
      claimable:
        !asReferred &&
        !!profile?.created_at &&
        Date.now() - new Date(profile.created_at as string).getTime() < 30 * 24 * 60 * 60 * 1000,
      recent: mine
        .slice(0, 10)
        .map((e) => ({ created_at: e.created_at as string, credits: e.referrer_credits ?? 0 })),
    };
  });

/** Davet kodunu kullan: hem davet edene hem yeni kullanıcıya kredi verir. */
export const claimReferral = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ code: z.string().trim().min(4).max(16) }).parse(i))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ ok: boolean; reason?: string; credits?: number; affiliate?: boolean }> => {
      const code = data.code.trim().toUpperCase();
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const { data: me } = await supabaseAdmin
        .from("profiles")
        .select("id, credits, referral_code, created_at")
        .eq("id", context.userId)
        .maybeSingle();
      if (!me) return { ok: false, reason: "Profil bulunamadı." };
      if (me.referral_code === code) return { ok: false, reason: "Kendi kodunu kullanamazsın." };
      if (Date.now() - new Date(me.created_at as string).getTime() > 30 * 24 * 60 * 60 * 1000) {
        return { ok: false, reason: "Davet kodu yalnızca ilk 30 gün içinde kullanılabilir." };
      }

      const { data: existing } = await supabaseAdmin
        .from("referral_events")
        .select("id")
        .eq("referred_user_id", context.userId)
        .maybeSingle();
      if (existing) return { ok: false, reason: "Zaten bir davet kodu kullandın." };

      const { data: referrer } = await supabaseAdmin
        .from("profiles")
        .select("id, credits")
        .eq("referral_code", code)
        .maybeSingle();
      if (!referrer) return { ok: false, reason: "Kod bulunamadı." };

      // ---- Affiliate / partner ilişkilendirmesi (first-touch, backend) ----
      // Kod bir AFFILIATE (partner) kaydına aitse müşteri backend'de o
      // partner'e bağlanır. Kredi bonusu/2-davet sınırı partner akışında
      // uygulanmaz; attribution customer_id üzerinde benzersizdir ve sonradan
      // başka bir partnerle değiştirilemez.
      const { data: affRow } = await supabaseAdmin
        .from("affiliates")
        .select("id, referral_code, status")
        .eq("user_id", referrer.id)
        .maybeSingle();
      if (affRow?.status === "active") {
        if (me.referral_code === code) {
          return { ok: false, reason: "Kendi kodunu kullanamazsın." };
        }
        const { error: attErr } = await supabaseAdmin.from("affiliate_referrals").upsert(
          {
            affiliate_id: affRow.id,
            customer_id: context.userId,
            referral_code: code,
            source: "link",
            visitor_id: null,
            status: "referred",
          },
          { onConflict: "customer_id", ignoreDuplicates: true },
        );
        if (attErr) {
          console.error("[affiliate] attribution failed", attErr);
        }
        return { ok: true, credits: 0, affiliate: true };
      }

      const { count } = await supabaseAdmin
        .from("referral_events")
        .select("id", { count: "exact", head: true })
        .eq("referrer_id", referrer.id);
      if ((count ?? 0) >= 2) return { ok: false, reason: "En fazla 2 arkadaş davet edebilirsin." };

      const { error: insErr } = await supabaseAdmin.from("referral_events").insert({
        referrer_id: referrer.id,
        referred_user_id: context.userId,
        code,
        referrer_credits: REFERRER_BONUS,
        referred_credits: REFERRED_BONUS,
      });
      if (insErr) return { ok: false, reason: "Davet kaydedilemedi." };

      const { error: creditError } = await supabaseAdmin.rpc("increment_profile_credits", {
        _profile_id: referrer.id,
        _amount: REFERRER_BONUS,
      });
      if (creditError) return { ok: false, reason: "Davet bonusu uygulanamadı." };
      await supabaseAdmin
        .from("profiles")
        .update({ credits: (me.credits ?? 0) + REFERRED_BONUS, referred_by: referrer.id })
        .eq("id", context.userId);

      return { ok: true, credits: REFERRER_BONUS, affiliate: false };
    },
  );
