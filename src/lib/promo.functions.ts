import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildAdminPromoUsers,
  promoClaimDecision,
  summarizePromoByCode,
  type AdminPromoUser,
  type PromoCodeStat,
  type PromoProfileRow,
  type PromoRedemptionRow,
  type PromoTransactionRow,
} from "@/lib/promo-attribution";
import { REFERRAL_CLAIM_WINDOW_MS, type ReferralClaimCode } from "@/lib/referral-rules";
import { adminOrUserClient, missingServiceRoleError } from "@/lib/service-client";
import { isValidAffiliateCode } from "@/lib/affiliate";

async function assertAdmin(context: { supabase: any; userId: string; claims: any }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error || !data) throw new Error("Forbidden");
}

export type PromoCodeRow = {
  id: string;
  code: string;
  discount_pct: number;
  max_redemptions: number | null;
  times_redeemed: number;
  active: boolean;
  expires_at: string | null;
  created_at: string;
  /** Kodun sahibi influencer (yoksa null) — komisyon ona gider. */
  affiliate_id: string | null;
};

export const listPromoCodes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PromoCodeRow[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("promo_codes")
      .select(
        "id, code, discount_pct, max_redemptions, times_redeemed, active, expires_at, created_at, affiliate_id",
      )
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (data ?? []) as PromoCodeRow[];
  });

const CreateInput = z.object({
  code: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/, "Only letters, numbers, - and _"),
  // 0 = indirim yok. İndirimler Paddle panelinde tanımlanır; bir kod yalnız
  // atıf/sayım için kullanılabilir (affiliate kodları hep 0'dır).
  discount_pct: z.number().int().min(0).max(100),
  max_redemptions: z.number().int().min(1).max(100000).nullable().optional(),
  expires_at: z.string().nullable().optional(),
  /** Kod sahibi influencer hesabı (auth.users.id) — opsiyonel. */
  affiliate_id: z.string().uuid().nullable().optional(),
});

export const createPromoCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => CreateInput.parse(i))
  .handler(async ({ data, context }): Promise<PromoCodeRow> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("promo_codes")
      .insert({
        code: data.code.toUpperCase(),
        discount_pct: data.discount_pct,
        max_redemptions: data.max_redemptions ?? null,
        expires_at: data.expires_at || null,
        created_by: context.userId,
        affiliate_id: data.affiliate_id ?? null,
      })
      .select(
        "id, code, discount_pct, max_redemptions, times_redeemed, active, expires_at, created_at, affiliate_id",
      )
      .single();
    if (error)
      throw new Error(error.message.includes("duplicate") ? "Bu kod zaten var." : error.message);
    return row as PromoCodeRow;
  });

export const setPromoCodeActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => z.object({ id: z.string().uuid(), active: z.boolean() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("promo_codes")
      .update({ active: data.active })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deletePromoCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("promo_codes").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Checkout-time validation. Returns the discount percentage for a valid code. */
export const validatePromoCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => z.object({ code: z.string().trim().min(1).max(32) }).parse(i))
  .handler(async ({ data, context }): Promise<{ valid: boolean; discount_pct: number; reason?: string }> => {
    // Sınır: kod denemeleri kaba kuvvetle kod avlamak için kullanılmasın.
    const { rateLimit } = await import("@/lib/api-guard.server");
    const limited = await rateLimit(`promo:validate:${context.userId}`, 20, 60);
    if (limited)
      return { valid: false, discount_pct: 0, reason: "Çok fazla deneme, biraz sonra dene." };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("promo_codes")
      .select("discount_pct, active, expires_at, max_redemptions, times_redeemed")
      .eq("code", data.code.trim().toUpperCase())
      .maybeSingle();
    if (!row) return { valid: false, discount_pct: 0, reason: "Kod bulunamadı." };
    if (!row.active) return { valid: false, discount_pct: 0, reason: "Kod pasif." };
    if (row.expires_at && new Date(row.expires_at) < new Date())
      return { valid: false, discount_pct: 0, reason: "Kodun süresi dolmuş." };
    if (row.max_redemptions != null && row.times_redeemed >= row.max_redemptions) {
      return { valid: false, discount_pct: 0, reason: "Kod kullanım limitine ulaştı." };
    }
    return { valid: true, discount_pct: row.discount_pct };
  });

/**
 * KAYIT SONRASI KOD SAHİPLENME — `?promo=KOD` linkiyle gelen kullanıcının
 * hesabı, kayıt formu görülmeden açılmış olsa bile koda bağlanır.
 *
 * NEDEN GEREKLİ (ölçülen atıf kaybı): kod yalnız kayıt formundaki
 * `promoCode` alanından yakalanıyordu. Google ile veya doğrudan OTP akışıyla
 * hesap açan kullanıcı formu hiç görmediği için affiliate'in paylaştığı kod
 * kayboluyor, influencer o müşteriden HİÇ komisyon alamıyordu. Ayrıca `?promo=`
 * URL'de kaldığı için sayfa değişince de kayboluyordu; artık localStorage'da
 * saklanır (bkz. `__root.tsx`) ve burada bir kez sahiplenilir.
 *
 * KURALLAR (saf karar: `promoClaimDecision`):
 *   • Kod yalnız hesabın İLK 30 GÜNÜ içinde bağlanır.
 *   • Hesaba zaten BAŞKA bir kod bağlıysa atıf değiştirilmez (sonradan
 *     "kod yazdırıp komisyon kaçırma" yolu kapalı).
 *   • Referral (`referred_by`) yalnız boşsa yazılır; böylece davet programı
 *     ile affiliate kodu birbirini Ezmez.
 *   • Kendi kodunu kullanmak reddedilir.
 */
export type PromoClaimResult = {
  ok: boolean;
  code: ReferralClaimCode;
  reason?: string;
  /** Kod bir affiliate'e bağlı mı? (komisyon üretir) */
  affiliate?: boolean;
};

export const claimPromoCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => z.object({ code: z.string().trim().min(3).max(32) }).parse(i))
  .handler(async ({ data, context }): Promise<PromoClaimResult> => {
    const code = String(data.code ?? "")
      .trim()
      .toUpperCase();
    if (!isValidAffiliateCode(code)) {
      return { ok: false, code: "not_found", reason: "Kod geçersiz." };
    }

    const { rateLimit } = await import("@/lib/api-guard.server");
    const limited = await rateLimit(`promo:claim:${context.userId}`, 10, 600);
    if (limited) {
      return { ok: false, code: "insert_failed", reason: "Çok fazla deneme, biraz sonra dene." };
    }

    // `profiles.referred_by` yazımı istemciye kapalıdır (komisyon güvenliği):
    // bu yüzden işlem servis rolüyle yapılır — başka kullanıcının satırına
    // dokunulduğu için RLS'li istemciyle mümkün değildir.
    const { client: admin, isServiceRole } = await adminOrUserClient(context);
    if (!isServiceRole) throw missingServiceRoleError();

    const { data: profile } = await admin
      .from("profiles")
      .select("id, promo_code, referred_by, created_at")
      .eq("id", context.userId)
      .maybeSingle();
    if (!profile) {
      // Yeni kayıtta profil satırı (DB trigger) gecikebilir → geçici hata.
      return { ok: false, code: "profile_missing", reason: "Profil hazırlanıyor, tekrar dene." };
    }
    const row = profile as {
      promo_code?: string | null;
      referred_by?: string | null;
      created_at?: string | null;
    };

    const decision = promoClaimDecision({
      existingPromoCode: row.promo_code,
      code,
      accountAgeMs: row.created_at ? Date.now() - new Date(row.created_at).getTime() : null,
      windowMs: REFERRAL_CLAIM_WINDOW_MS,
    });
    if (!decision.ok) {
      const reasons: Record<typeof decision.code, string> = {
        already_used: "Hesabına zaten bir promosyon kodu bağlı.",
        window_closed: "Kod yalnızca hesabın ilk 30 günü içinde bağlanabilir.",
        not_found: "Kod bulunamadı.",
      };
      return { ok: false, code: decision.code, reason: reasons[decision.code] };
    }

    const { data: promoRow } = await admin
      .from("promo_codes")
      .select("id, code, active, expires_at, max_redemptions, times_redeemed, affiliate_id")
      .eq("code", code)
      .maybeSingle();
    if (!promoRow || !promoRow.active) {
      return { ok: false, code: "not_found", reason: "Kod bulunamadı ya da pasif." };
    }
    if (promoRow.expires_at && new Date(promoRow.expires_at) < new Date()) {
      return { ok: false, code: "not_found", reason: "Kodun süresi dolmuş." };
    }
    if (promoRow.max_redemptions != null && promoRow.times_redeemed >= promoRow.max_redemptions) {
      return { ok: false, code: "not_found", reason: "Kod kullanım limitine ulaştı." };
    }

    const affiliateId = (promoRow.affiliate_id as string | null) ?? null;
    if (affiliateId && affiliateId === context.userId) {
      return { ok: false, code: "self", reason: "Kendi affiliate kodunu kullanamazsın." };
    }

    // Kod zaten bağlıysa yazım yok (idempotent başarı).
    if (decision.idempotent) {
      return {
        ok: true,
        code: "ok",
        reason: "Kod zaten hesabına bağlı.",
        affiliate: !!affiliateId,
      };
    }

    try {
      await admin
        .from("profiles")
        .update({
          promo_code: code,
          ...(affiliateId && !row.referred_by ? { referred_by: affiliateId } : {}),
        })
        .eq("id", context.userId);
      await admin.from("promo_redemptions").upsert(
        {
          promo_code_id: promoRow.id,
          code,
          user_id: context.userId,
        },
        { onConflict: "user_id" },
      );
      await admin
        .from("promo_codes")
        .update({ times_redeemed: (promoRow.times_redeemed ?? 0) + 1 })
        .eq("id", promoRow.id);
    } catch (e) {
      console.warn("[promo] claim write failed", e);
      return { ok: false, code: "insert_failed", reason: "Kod kaydedilemedi, tekrar dene." };
    }

    return { ok: true, code: "ok", affiliate: !!affiliateId };
  });

/** Kayıt sırasında girilen promosyon kodunu ödeme ekranında otomatik uygulamak için. */
export const getMyPromoCode = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ code: string | null; discount_pct: number }> => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("promo_code")
      .eq("id", context.userId)
      .maybeSingle();
    const code = (profile?.promo_code ?? "").toString().trim().toUpperCase();
    if (!code) return { code: null, discount_pct: 0 };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("promo_codes")
      .select("discount_pct, active, expires_at, max_redemptions, times_redeemed")
      .eq("code", code)
      .maybeSingle();
    if (!row || !row.active) return { code: null, discount_pct: 0 };
    if (row.expires_at && new Date(row.expires_at) < new Date())
      return { code: null, discount_pct: 0 };
    return { code, discount_pct: row.discount_pct };
  });

export type { PromoCodeStat, AdminPromoUser } from "@/lib/promo-attribution";

/**
 * Admin panelde kullanılan ortak ham veri seti: redemptions + profil + ödemeler.
 *
 * İhracat (export) sebebi: affiliate KOD RAPORU da aynı atıf verisinden
 * beslenmek zorundadır — kendi sorgusunu yazsaydı iki ekran zamanla ayrışır ve
 * "aynı kod iki farklı sayı" gösterirdi.
 */
export async function loadPromoAttribution() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: redemptions } = await supabaseAdmin
    .from("promo_redemptions")
    .select("code, user_id, email, signed_up_at, purchased_tier, purchased_at")
    .order("signed_up_at", { ascending: false })
    .limit(2000);

  const rows = (redemptions ?? []) as PromoRedemptionRow[];
  const ids = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean)));

  const [profilesRes, txRes] = await Promise.all([
    ids.length
      ? supabaseAdmin
          .from("profiles")
          .select("id, email, subscription_tier, subscription_status")
          .in("id", ids)
      : Promise.resolve({ data: [] as PromoProfileRow[] }),
    ids.length
      ? supabaseAdmin
          .from("transactions")
          .select("user_id, tier, amount_cents, created_at")
          .in("user_id", ids)
          .order("created_at", { ascending: true })
          .limit(5000)
      : Promise.resolve({ data: [] as PromoTransactionRow[] }),
  ]);

  return {
    users: buildAdminPromoUsers(
      rows,
      (profilesRes.data ?? []) as PromoProfileRow[],
      (txRes.data ?? []) as PromoTransactionRow[],
    ),
  };
}

/**
 * Admin panel: hangi kullanıcı hangi promosyon kodundan geldi, hangi paketi
 * aldı, ne kadar ciro yaptı. (Kod bazlı özetle aynı veriden beslenir.)
 */
export const listAdminPromoUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminPromoUser[]> => {
    await assertAdmin(context);
    const { users } = await loadPromoAttribution();
    return users;
  });

/** Admin panel: hangi kodla kaç kişi kaydoldu, kaçı hangi paketi aldı. */
export const getPromoCodeStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PromoCodeStat[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: codes }, { users }] = await Promise.all([
      supabaseAdmin.from("promo_codes").select("code, discount_pct").limit(200),
      loadPromoAttribution(),
    ]);
    return summarizePromoByCode(users, {
      allCodes: (codes ?? []).map((c) => String(c.code ?? "")),
      discountByCode: Object.fromEntries(
        (codes ?? []).map((c) => [String(c.code ?? "").toUpperCase(), c.discount_pct ?? 0]),
      ),
    });
  });
