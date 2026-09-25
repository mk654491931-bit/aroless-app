import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  isWithinClaimWindow,
  REFERRAL_CLAIM_WINDOW_MS,
  type ReferralClaimResult,
} from "@/lib/referral-rules";

export const REFERRER_BONUS = 1;
export const REFERRED_BONUS = 0;

export type { ReferralClaimCode, ReferralClaimResult } from "@/lib/referral-rules";
export { isTerminalClaim } from "@/lib/referral-rules";

export type ReferralSummary = {
  code: string;
  invited: number;
  credits_earned: number;
  referred_by_code: string | null;
  claimable: boolean;
  recent: Array<{ created_at: string; credits: number }>;
};

type ReferralEventRow = {
  id: string;
  referrer_id: string;
  referred_user_id: string;
  code: string;
  referrer_credits: number;
  created_at: string;
};

/**
 * Kullanıcının davet kodu + istatistikleri.
 *
 * referral_events iki taraflı bir defter: kullanıcı hem davet eden
 * (referrer_id) hem davet edilen (referred_user_id) taraftır. RLS politikası
 * genelde yalnızca bir tarafı görünür kıldığı için önce servis rolüyle
 * (kullanıcıya özel filtreyle) okunur; service role anahtarı yoksa RLS'li
 * istemciye düşülür. Böylece "Davet kodu kullanıldı: X" satırı ve "Davet
 * edilen" sayacı her zaman gerçek veriyi gösterir.
 */
export const getMyReferral = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ReferralSummary> => {
    const uid = context.userId;

    const { data: profile } = await context.supabase
      .from("profiles")
      .select("referral_code, referred_by, created_at")
      .eq("id", uid)
      .maybeSingle();

    const events = await readReferralEvents(context, uid);
    const invited = events.filter((e) => e.referrer_id === uid);
    const ownClaim = events.find((e) => e.referred_user_id === uid);

    const createdAt = (profile?.created_at as string | undefined) ?? null;
    const withinWindow = isWithinClaimWindow(
      createdAt ? Date.now() - new Date(createdAt).getTime() : null,
    );

    return {
      code: (profile?.referral_code as string) ?? "",
      invited: invited.length,
      credits_earned: invited.reduce((s, e) => s + (e.referrer_credits ?? 0), 0),
      referred_by_code: ownClaim?.code ?? null,
      // Yeni hesaplar (ilk 30 gün) hâlâ bir davet kodu kullanabilir.
      claimable: !ownClaim && withinWindow,
      recent: invited
        .slice(0, 10)
        .map((e) => ({ created_at: e.created_at as string, credits: e.referrer_credits ?? 0 })),
    };
  });

/** Kullanıcıya ait davet satırlarını iki taraftan da okur. */
async function readReferralEvents(
  context: { supabase: any; userId: string },
  uid: string,
): Promise<ReferralEventRow[]> {
  const columns = "id, referrer_id, referred_user_id, code, referrer_credits, created_at";
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("referral_events")
      .select(columns)
      .or(`referrer_id.eq.${uid},referred_user_id.eq.${uid}`)
      .order("created_at", { ascending: false })
      .limit(500);
    if (!error && data) return data as ReferralEventRow[];
  } catch {
    // SUPABASE_SERVICE_ROLE_KEY tanımlı değil → RLS'li istemciye düş.
  }
  const { data, error } = await context.supabase
    .from("referral_events")
    .select(columns)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return ((data ?? []) as ReferralEventRow[]).filter(
    (e) => e.referrer_id === uid || e.referred_user_id === uid,
  );
}

/** Davet kodunu kullan: hem davet edene hem yeni kullanıcıya kredi verir. */
export const claimReferral = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ code: z.string().trim().min(4).max(16) }).parse(i))
  .handler(async ({ data, context }): Promise<ReferralClaimResult> => {
    const code = data.code.trim().toUpperCase();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: me } = await supabaseAdmin
      .from("profiles")
      .select("id, credits, referral_code, created_at")
      .eq("id", context.userId)
      .maybeSingle();
    // Yeni kayıtta profil satırı (trigger) birkaç saniye geçebilir; çağıran
    // taraf bu kodda tekrar denemelidir, bu yüzden "kalıcı red" değil.
    if (!me)
      return { ok: false, code: "profile_missing", reason: "Profil hazırlanıyor, tekrar dene." };
    if (me.referral_code === code)
      return { ok: false, code: "self", reason: "Kendi kodunu kullanamazsın." };
    if (
      Date.now() - new Date(me.created_at as string).getTime() >
      REFERRAL_CLAIM_WINDOW_MS
    ) {
      return {
        ok: false,
        code: "window_closed",
        reason: "Davet kodu yalnızca ilk 30 gün içinde kullanılabilir.",
      };
    }

    const { data: existing } = await supabaseAdmin
      .from("referral_events")
      .select("id")
      .eq("referred_user_id", context.userId)
      .maybeSingle();
    if (existing) return { ok: false, code: "already_used", reason: "Zaten bir davet kodu kullandın." };

    const { data: referrer } = await supabaseAdmin
      .from("profiles")
      .select("id, credits")
      .eq("referral_code", code)
      .maybeSingle();
    if (!referrer) return { ok: false, code: "not_found", reason: "Kod bulunamadı." };

    const { count } = await supabaseAdmin
      .from("referral_events")
      .select("id", { count: "exact", head: true })
      .eq("referrer_id", referrer.id);
    if ((count ?? 0) >= 2)
      return {
        ok: false,
        code: "referrer_limit",
        reason: "En fazla 2 arkadaş davet edebilirsin.",
      };

    const { error: insErr } = await supabaseAdmin.from("referral_events").insert({
      referrer_id: referrer.id,
      referred_user_id: context.userId,
      code,
      referrer_credits: REFERRER_BONUS,
      referred_credits: REFERRED_BONUS,
    });
    if (insErr) return { ok: false, code: "insert_failed", reason: "Davet kaydedilemedi." };

    const { error: creditError } = await supabaseAdmin.rpc("increment_profile_credits", {
      _profile_id: referrer.id,
      _amount: REFERRER_BONUS,
    });
    if (creditError)
      return { ok: false, code: "credit_failed", reason: "Davet bonusu uygulanamadı." };
    await supabaseAdmin
      .from("profiles")
      .update({ credits: (me.credits ?? 0) + REFERRED_BONUS, referred_by: referrer.id })
      .eq("id", context.userId);

    return { ok: true, code: "ok", credits: REFERRER_BONUS };
  });
