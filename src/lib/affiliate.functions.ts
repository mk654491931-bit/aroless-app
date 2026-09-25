import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  DEFAULT_COMMISSION_RATE_PCT,
  isAffiliateStatus,
  type AffiliateStatus,
} from "@/lib/affiliate";
import {
  buildAdminPromoUsers,
  myPromoPerformance,
  type PromoProfileRow,
  type PromoRedemptionRow,
  type PromoTransactionRow,
} from "@/lib/promo-attribution";
import { adminOrUserClient, missingServiceRoleError } from "@/lib/service-client";

/** 403 (not 500) for RBAC denials — TanStack Start serializes statusCode. */
function forbidden(): Error & { statusCode: number } {
  const err = new Error("Forbidden") as Error & { statusCode: number };
  err.statusCode = 403;
  return err;
}

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error || !data) throw forbidden();
}

export type AffiliateStatusRow = {
  user_id: string;
  status: AffiliateStatus | string;
  commission_rate_pct: number;
  verified_by: string | null;
  verified_at: string | null;
  created_at: string;
};

export type AffiliateSummary = {
  applied: boolean;
  status: AffiliateStatus | null;
  commission_rate_pct: number;
  referral_code: string;
  earned_cents: number;
  paid_transactions: number;
  recent: Array<{
    id: string;
    tier: string | null;
    gross_amount_cents: number;
    commission_cents: number;
    created_at: string;
  }>;
};

/**
 * Kullanıcının affiliate başvurusu, durumu ve birikmiş komisyonları.
 *
 * Önce servis rolü (RLS'in ötesinden) okunur; SUPABASE_SERVICE_ROLE_KEY
 * tanımlı değilse aynı sorgular kullanıcının KENDİ satırlarıyla RLS'li
 * istemci üzerinden çalışır — panel bu durumda da çalışır durumda kalır.
 */
export const getMyAffiliateStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AffiliateSummary> => {
    const uid = context.userId;
    const { client } = await adminOrUserClient(context);

    const [affiliateRes, profileRes, commissionsRes] = await Promise.all([
      client
        .from("affiliates")
        .select("user_id, status, commission_rate_pct, verified_by, verified_at, created_at")
        .eq("user_id", uid)
        .maybeSingle(),
      client.from("profiles").select("referral_code").eq("id", uid).maybeSingle(),
      client
        .from("affiliate_commissions")
        .select("id, tier, gross_amount_cents, commission_cents, created_at")
        .eq("affiliate_id", uid)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    const row = affiliateRes.data as AffiliateStatusRow | null;
    const commissions = (commissionsRes.data ?? []) as AffiliateSummary["recent"];

    return {
      applied: !!row,
      status: row && isAffiliateStatus(row.status) ? row.status : null,
      commission_rate_pct: row?.commission_rate_pct ?? DEFAULT_COMMISSION_RATE_PCT,
      referral_code: ((profileRes.data as { referral_code?: string } | null)?.referral_code ?? "") as string,
      earned_cents: commissions.reduce((s, c) => s + (c.commission_cents ?? 0), 0),
      paid_transactions: commissions.length,
      recent: commissions.slice(0, 10).map((c) => ({
        id: c.id,
        tier: c.tier ?? null,
        gross_amount_cents: c.gross_amount_cents ?? 0,
        commission_cents: c.commission_cents ?? 0,
        created_at: c.created_at,
      })),
    };
  });

/**
 * Affiliate programına başvur. Idempotent: daha önce başvurmuşsa mevcut
 * durumunu döner, asla durumunu değiştirmez (yalnızca admin onaylayabilir).
 */
export const applyForAffiliate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{ ok: boolean; status: AffiliateStatus | null; reason?: string }> => {
      const { rateLimit } = await import("@/lib/api-guard.server");

      // Basit kötüye kullanım koruması: aynı hesap 1 saatte en fazla 5 kez.
      const limited = await rateLimit(`affiliate:apply:${context.userId}`, 5, 3600);
      if (limited) {
        return { ok: false, status: null, reason: "Çok fazla deneme yaptın, biraz sonra tekrar dene." };
      }

      const { client, isServiceRole } = await adminOrUserClient(context);

      const { data: existing, error: existingError } = await client
        .from("affiliates")
        .select("status")
        .eq("user_id", context.userId)
        .maybeSingle();
      if (existingError)
        return { ok: false, status: null, reason: "Başvuru durumu okunamadı, tekrar dene." };
      if (existing) {
        const status = isAffiliateStatus(existing.status) ? existing.status : null;
        return { ok: true, status };
      }

      if (isServiceRole) {
        const { error } = await client.from("affiliates").insert({
          user_id: context.userId,
          status: "pending",
          commission_rate_pct: DEFAULT_COMMISSION_RATE_PCT,
        });
        if (error) return { ok: false, status: null, reason: "Başvuru kaydedilemedi, tekrar dene." };
        return { ok: true, status: "pending" };
      }

      // Servis rolü anahtarı yok: SECURITY DEFINER apply_for_affiliate() kendi
      // başvurusunu kullanıcı oturumuyla oluşturur (durum/oran sunucuda sabit).
      const { data: status, error: rpcError } = await context.supabase.rpc("apply_for_affiliate");
      if (rpcError || !isAffiliateStatus(status))
        return { ok: false, status: null, reason: "Başvuru kaydedilemedi, tekrar dene." };
      return { ok: true, status };
    },
  );

/* ------------------------------------------------------------------ */
/* Affiliate hesabı performansı: admin'in görevlendirdiği hesaplar     */
/* KENDİ promo kodunun rakamlarını görür (başka kodların verisi       */
/* sorgulanmaz; toplam ve paket dağılımı dışında kimlik sızmaz).        */
/* ------------------------------------------------------------------ */

export type MyPromoPerformance = {
  code: string;
  signups: number;
  purchases: number;
  conversion_pct: number;
  revenue_cents: number;
  by_tier: Array<{ tier: string; users: number }>;
  first_signup_at: string | null;
  last_signup_at: string | null;
  own_tier: string;
};

/** Onaylı affiliate'in kendi promo kodunun performansı. */
export const getMyPromoPerformance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyPromoPerformance | null> => {
    const uid = context.userId;
    const { client } = await adminOrUserClient(context);

    // Yalnızca admin'in görevlendirdiği (verified) hesaplar kendi kodunu görür.
    const { data: affiliate } = await client
      .from("affiliates")
      .select("status")
      .eq("user_id", uid)
      .maybeSingle();
    if (!affiliate || affiliate.status !== "verified") return null;

    const { data: profile } = await client
      .from("profiles")
      .select("promo_code, subscription_tier")
      .eq("id", uid)
      .maybeSingle();

    // Hesabın kendi kodu: profilde kayıtlı kod, yoksa redemptions kaydı.
    let code = (profile as { promo_code?: string | null } | null)?.promo_code ?? null;
    if (!code) {
      const { data: own } = await client
        .from("promo_redemptions")
        .select("code")
        .eq("user_id", uid)
        .maybeSingle();
      code = (own as { code?: string | null } | null)?.code ?? null;
    }
    const normalized = String(code ?? "")
      .trim()
      .toUpperCase();
    if (!normalized) return null;

    // Yalnızca BU kodun kayıtları okunur.
    const { data: redemptions } = await client
      .from("promo_redemptions")
      .select("code, user_id, email, signed_up_at, purchased_tier, purchased_at")
      .eq("code", normalized)
      .order("signed_up_at", { ascending: false })
      .limit(2000);
    const rows = (redemptions ?? []) as PromoRedemptionRow[];
    const ids = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean)));

    const [profilesRes, txRes] = await Promise.all([
      ids.length
        ? client
            .from("profiles")
            .select("id, email, subscription_tier, subscription_status")
            .in("id", ids)
        : Promise.resolve({ data: [] as PromoProfileRow[] }),
      ids.length
        ? client
            .from("transactions")
            .select("user_id, tier, amount_cents, created_at")
            .in("user_id", ids)
            .order("created_at", { ascending: true })
            .limit(5000)
        : Promise.resolve({ data: [] as PromoTransactionRow[] }),
    ]);

    const users = buildAdminPromoUsers(
      rows,
      (profilesRes.data ?? []) as PromoProfileRow[],
      (txRes.data ?? []) as PromoTransactionRow[],
    );

    return myPromoPerformance(
      users,
      normalized,
      (profile as { subscription_tier?: string | null } | null)?.subscription_tier,
    );
  });

/* ------------------------------------------------------------------ */
/* Admin: bir hesabı affiliate olarak GÖREVLENDİRME (başvuru beklemez)  */
/* ------------------------------------------------------------------ */

const DesignateInput = z.object({
  email: z.string().trim().toLowerCase().email("Geçerli bir e-posta adresi girin.").max(200),
  /** null → program varsayılanı (%30). */
  ratePct: z.number().int().min(0).max(100).nullable().optional(),
});

export type AdminAffiliateTarget = {
  id: string;
  email: string | null;
  tier: string;
  referral_code: string | null;
  promo_code: string | null;
  affiliate_status: string | null;
};

/** Görevlendirilecek hesabı e-posta ile bulur. */
export const findAdminAffiliateTarget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DesignateInput.pick({ email: true }).parse(input))
  .handler(async ({ data, context }): Promise<AdminAffiliateTarget> => {
    await assertAdmin(context);
    const { client: supabaseAdmin } = await adminOrUserClient(context);
    const { data: row, error } = await supabaseAdmin
      .from("profiles")
      .select("id, email, subscription_tier, referral_code, promo_code")
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
    const { data: affiliate } = await supabaseAdmin
      .from("affiliates")
      .select("status")
      .eq("user_id", row.id as string)
      .maybeSingle();
    return {
      id: row.id as string,
      email: (row.email as string | null) ?? null,
      tier: (row.subscription_tier as string | null) ?? "Free",
      referral_code: (row.referral_code as string | null) ?? null,
      promo_code: (row.promo_code as string | null) ?? null,
      affiliate_status: (affiliate as { status?: string } | null)?.status ?? null,
    };
  });

/**
 * Hesabı affiliate olarak görevlendirir — başvuru yapmış olması gerekmez.
 * Satır yoksa oluşturulur, sonra RBAC'yi veritabanında da doğrulayan
 * SECURITY DEFINER `verify_affiliate()` ile onaylanır.
 */
export const designateAdminAffiliate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DesignateInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true; target: AdminAffiliateTarget }> => {
    await assertAdmin(context);
    const { client: supabaseAdmin, isServiceRole } = await adminOrUserClient(context);
    if (!isServiceRole) throw missingServiceRoleError();

    const { data: row, error } = await supabaseAdmin
      .from("profiles")
      .select("id, email, subscription_tier, referral_code, promo_code")
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
    const userId = row.id as string;

    // Satır yoksa oluştur (başvuru yapmamış hesaplar da görevlendirilebilsin).
    const { data: existing } = await supabaseAdmin
      .from("affiliates")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!existing) {
      const { error: insertError } = await supabaseAdmin.from("affiliates").insert({
        user_id: userId,
        status: "pending",
        commission_rate_pct: data.ratePct ?? DEFAULT_COMMISSION_RATE_PCT,
      });
      // Eşzamanlı iki istek olursa unique ihlali yutulur; RPC zaten satırı bulur.
      if (insertError && !/duplicate|already exists/i.test(insertError.message)) {
        throw new Error(insertError.message);
      }
    }

    const { data: result, error: rpcError } = await supabaseAdmin.rpc("verify_affiliate", {
      _admin_id: context.userId,
      _user_id: userId,
      _status: "verified",
      _rate_pct: data.ratePct ?? null,
    });
    if (rpcError || String(result) !== "ok") throw forbidden();

    return {
      ok: true,
      target: {
        id: userId,
        email: (row.email as string | null) ?? null,
        tier: (row.subscription_tier as string | null) ?? "Free",
        referral_code: (row.referral_code as string | null) ?? null,
        promo_code: (row.promo_code as string | null) ?? null,
        affiliate_status: "verified",
      },
    };
  });

export type AdminAffiliateRow = {
  user_id: string;
  email: string | null;
  status: string;
  commission_rate_pct: number;
  verified_at: string | null;
  created_at: string;
  earned_cents: number;
  paid_transactions: number;
};

/** Tüm affiliate başvuruları + birikmiş komisyon özetleri (yalnızca admin). */
export const adminListAffiliates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminAffiliateRow[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [affiliatesRes, commissionsRes] = await Promise.all([
      supabaseAdmin
        .from("affiliates")
        .select(
          "user_id, status, commission_rate_pct, verified_at, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(200),
      supabaseAdmin
        .from("affiliate_commissions")
        .select("affiliate_id, commission_cents"),
    ]);

    const rows = (affiliatesRes.data ?? []) as Array<{
      user_id: string;
      status: string;
      commission_rate_pct: number;
      verified_at: string | null;
      created_at: string;
    }>;

    const totals = new Map<string, { earned: number; count: number }>();
    for (const c of (commissionsRes.data ?? []) as Array<{
      affiliate_id: string;
      commission_cents: number;
    }>) {
      const t = totals.get(c.affiliate_id) ?? { earned: 0, count: 0 };
      t.earned += c.commission_cents ?? 0;
      t.count += 1;
      totals.set(c.affiliate_id, t);
    }

    if (rows.length === 0) return [];

    const emailsRes = await supabaseAdmin
      .from("profiles")
      .select("id, email")
      .in(
        "id",
        rows.map((r) => r.user_id),
      );
    const emailById = new Map(
      ((emailsRes.data ?? []) as Array<{ id: string; email: string | null }>).map((p) => [
        p.id,
        p.email,
      ]),
    );

    return rows.map((r) => {
      const t = totals.get(r.user_id) ?? { earned: 0, count: 0 };
      return {
        user_id: r.user_id,
        email: emailById.get(r.user_id) ?? null,
        status: r.status,
        commission_rate_pct: r.commission_rate_pct,
        verified_at: r.verified_at,
        created_at: r.created_at,
        earned_cents: t.earned,
        paid_transactions: t.count,
      };
    });
  });

const SetStatusSchema = z.object({
  userId: z.string().uuid(),
  status: z.enum(["pending", "verified", "revoked"]),
  ratePct: z.number().int().min(0).max(100).optional(),
});

/**
 * Admin: affiliate'i onayla / askıya al / oranını değiştir.
 * RBAC, DB içinde SECURITY DEFINER verify_affiliate() tarafından da doğrulanır —
 * API katmanı atlansa bile yetkisiz çağrı imkânsız.
 */
export const adminSetAffiliateStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SetStatusSchema.parse(input))  .handler(async ({ data, context }): Promise<{ ok: boolean; status: AffiliateStatus }> => {
    await assertAdmin(context);
    const { client: supabaseAdmin, isServiceRole } = await adminOrUserClient(context);
    // verify_affiliate() bilinçli olarak service_role'a açıktır; anahtar yoksa
    // kullanıcıya ham bir ortam hatası yerine ne yapması gerektiğini söyle.
    if (!isServiceRole) throw missingServiceRoleError();

      const { data: result, error } = await supabaseAdmin.rpc("verify_affiliate", {
        _admin_id: context.userId,
        _user_id: data.userId,
        _status: data.status,
        _rate_pct: data.ratePct ?? null,
      });
      if (error || String(result) !== "ok") throw forbidden();
      return { ok: true, status: data.status };
    },
  );