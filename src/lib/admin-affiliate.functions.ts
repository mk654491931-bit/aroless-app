/**
 * Admin → Affiliate/Partner yönetimi sunucu fonksiyonları.
 * Her fonksiyon `ensureAffiliateAdmin` ile korunur; istemci tarafı rol/veri
 * güveni yoktur. Oran, süre, kod ve durum değişiklikleri yalnızca buradan yapılır.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateReferralCode, maskEmail, normalizeCode } from "@/lib/affiliate/affiliate-core";
import {
  ensureAffiliateAdmin,
  listCommissionsForAffiliate,
  listReferralsForAffiliate,
  payCommissions,
  reverseCommissionsByIds,
  type AffDb,
  type AffiliateRow,
  type CommissionRow,
  type ReferralRow,
} from "@/lib/affiliate/affiliate.service";

async function adminDb(context: { supabase: unknown; userId: string }): Promise<AffDb> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await ensureAffiliateAdmin(supabaseAdmin as unknown as AffDb, context.userId);
  return supabaseAdmin as unknown as AffDb;
}

const CODE_RE = /^[A-Z0-9]{4,16}$/;

/* --------------------------------------------------------------------------
 * Liste + detay
 * -------------------------------------------------------------------------- */

export type AdminAffiliateRow = {
  id: string;
  userId: string;
  email: string | null;
  displayName: string;
  referralCode: string;
  commissionRatePct: number;
  commissionDurationMonths: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  customerCount: number;
  pendingCents: number;
  paidCents: number;
  reversedCents: number;
};

async function emailsFor(db: AffDb, userIds: string[]): Promise<Record<string, string | null>> {
  const map: Record<string, string | null> = {};
  if (!userIds.length) return map;
  for (let i = 0; i < userIds.length; i += 50) {
    const chunk = userIds.slice(i, i + 50);
    const { data } = await db.from("profiles").select("id,email").in("id", chunk);
    for (const row of data ?? []) map[row.id] = row.email ?? null;
  }
  return map;
}

/** Arama + tarih aralığı filtreli affiliate listesi (özet değerlerle). */
export const listAdminAffiliates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        search: z.string().trim().max(80).optional().default(""),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<AdminAffiliateRow[]> => {
    const db = await adminDb(context);
    let query = db
      .from("affiliates")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(300);
    if (data.dateFrom) query = query.gte("created_at", new Date(data.dateFrom).toISOString());
    if (data.dateTo) query = query.lte("created_at", new Date(data.dateTo).toISOString());
    const { data: rows } = await query;
    const affiliates = (rows ?? []) as AffiliateRow[];

    const emails = await emailsFor(
      db,
      affiliates.map((a) => a.user_id),
    );
    const search = data.search.toLowerCase();

    const allCommissions = new Map<string, CommissionRow[]>();
    const allReferrals = new Map<string, ReferralRow[]>();
    // Arama filtreli küçük veriyle özet için komisyonları çek.
    const { data: commissionRows } = await db
      .from("commissions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5000);
    const { data: referralRows } = await db
      .from("affiliate_referrals")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5000);
    for (const c of (commissionRows ?? []) as CommissionRow[]) {
      const arr = allCommissions.get(c.affiliate_id) ?? [];
      arr.push(c);
      allCommissions.set(c.affiliate_id, arr);
    }
    for (const r of (referralRows ?? []) as ReferralRow[]) {
      const arr = allReferrals.get(r.affiliate_id) ?? [];
      arr.push(r);
      allReferrals.set(r.affiliate_id, arr);
    }

    const out: AdminAffiliateRow[] = [];
    for (const a of affiliates) {
      const email = emails[a.user_id] ?? "";
      if (
        search &&
        !a.referral_code.toLowerCase().includes(search) &&
        !String(a.display_name ?? "")
          .toLowerCase()
          .includes(search) &&
        !(email ?? "").toLowerCase().includes(search)
      ) {
        continue;
      }
      const commissions = allCommissions.get(a.id) ?? [];
      const referrals = allReferrals.get(a.id) ?? [];
      out.push({
        id: a.id,
        userId: a.user_id,
        email,
        displayName: a.display_name || "Partner",
        referralCode: a.referral_code,
        commissionRatePct: Number(a.commission_rate_pct),
        commissionDurationMonths: Number(a.commission_duration_months),
        status: a.status,
        createdAt: a.created_at,
        updatedAt: a.updated_at,
        customerCount: referrals.filter((r) => r.status !== "canceled").length,
        pendingCents: commissions
          .filter((c) => c.status === "pending")
          .reduce((s, c) => s + c.commission_amount_cents, 0),
        paidCents: commissions
          .filter((c) => c.status === "paid")
          .reduce((s, c) => s + c.commission_amount_cents, 0),
        reversedCents: commissions
          .filter((c) => c.status === "reversed")
          .reduce((s, c) => s + c.commission_amount_cents, 0),
      });
    }
    return out;
  });

export type AdminAffiliateDetail = {
  affiliate: AdminAffiliateRow | null;
  customers: Array<{
    customerId: string;
    email: string;
    plan: string | null;
    status: string;
    subscriptionId: string | null;
    referredAt: string;
    firstPaidAt: string | null;
    earnedCents: number;
  }>;
  commissions: CommissionRow[];
};

export const getAdminAffiliateDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ affiliateId: z.string().min(8) }).parse(i))
  .handler(async ({ data, context }): Promise<AdminAffiliateDetail> => {
    const db = await adminDb(context);
    const { data: affiliateRow } = await db
      .from("affiliates")
      .select("*")
      .eq("id", data.affiliateId)
      .maybeSingle();
    if (!affiliateRow) return { affiliate: null, customers: [], commissions: [] };
    const affiliate = affiliateRow as AffiliateRow;

    const [commissions, referrals] = await Promise.all([
      listCommissionsForAffiliate(db, affiliate.id, { limit: 2000 }),
      listReferralsForAffiliate(db, affiliate.id, { limit: 1000 }),
    ]);
    const emails = await emailsFor(db, [affiliate.user_id]);
    const customerEmails = await emailsFor(
      db,
      referrals.map((r) => r.customer_id),
    );

    return {
      affiliate: {
        id: affiliate.id,
        userId: affiliate.user_id,
        email: emails[affiliate.user_id] ?? null,
        displayName: affiliate.display_name || "Partner",
        referralCode: affiliate.referral_code,
        commissionRatePct: Number(affiliate.commission_rate_pct),
        commissionDurationMonths: Number(affiliate.commission_duration_months),
        status: affiliate.status,
        createdAt: affiliate.created_at,
        updatedAt: affiliate.updated_at,
        customerCount: referrals.filter((r) => r.status !== "canceled").length,
        pendingCents: commissions
          .filter((c) => c.status === "pending")
          .reduce((s, c) => s + c.commission_amount_cents, 0),
        paidCents: commissions
          .filter((c) => c.status === "paid")
          .reduce((s, c) => s + c.commission_amount_cents, 0),
        reversedCents: commissions
          .filter((c) => c.status === "reversed")
          .reduce((s, c) => s + c.commission_amount_cents, 0),
      },
      customers: referrals.map((r) => ({
        customerId: r.customer_id,
        email: maskEmail(customerEmails[r.customer_id] ?? null),
        plan: r.plan,
        status: r.status,
        subscriptionId: r.subscription_id,
        referredAt: r.created_at,
        firstPaidAt: r.first_paid_at,
        earnedCents: commissions
          .filter((c) => c.customer_id === r.customer_id && c.status !== "reversed")
          .reduce((s, c) => s + c.commission_amount_cents, 0),
      })),
      commissions,
    };
  });

/* --------------------------------------------------------------------------
 * Oluştur / güncelle / durum
 * -------------------------------------------------------------------------- */

async function uniqueCode(db: AffDb, preferred?: string): Promise<string> {
  const normalized = preferred ? normalizeCode(preferred) : "";
  if (normalized && CODE_RE.test(normalized)) {
    const { data: dup } = await db
      .from("affiliates")
      .select("id")
      .eq("referral_code", normalized)
      .maybeSingle();
    if (!dup) return normalized;
    throw new Error("Bu referans kodu zaten kullanılıyor.");
  }
  // Benzersiz kod üret (mevcut kodlarla çakışmayı kontrol et).
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = generateReferralCode();
    const { data: dup } = await db
      .from("affiliates")
      .select("id")
      .eq("referral_code", candidate)
      .maybeSingle();
    if (!dup) return candidate;
  }
  throw new Error("Kod üretilemedi — lütfen tekrar deneyin.");
}

export const createAdminAffiliate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        email: z.string().email().optional(),
        userId: z.string().optional(),
        displayName: z.string().trim().max(80).optional().default(""),
        code: z.string().trim().max(16).optional(),
        commissionRatePct: z.coerce.number().min(0).max(100).optional(),
        commissionDurationMonths: z.coerce.number().int().min(1).max(24).optional(),
      })
      .refine((v) => !!v.email || !!v.userId, { message: "E-posta veya kullanıcı ID gerekli." })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<{ ok: true; affiliateId: string; code: string }> => {
    const db = await adminDb(context);

    let profile: { id: string; referral_code: string | null } | null = null;
    if (data.userId) {
      const { data: p } = await db
        .from("profiles")
        .select("id,referral_code")
        .eq("id", data.userId)
        .maybeSingle();
      profile = p as typeof profile;
    } else {
      const { data: p } = await db
        .from("profiles")
        .select("id,referral_code")
        .eq("email", String(data.email ?? "").toLowerCase())
        .maybeSingle();
      profile = p as typeof profile;
      if (!profile) {
        // E-posta eşleşmezse auth üzerinden büyük/küçük harf duyarlı arama.
        const { data: rows } = await db.from("profiles").select("id,referral_code").limit(5000);
        profile =
          (rows ?? []).find(
            (r: { id?: string; referral_code?: string | null; email?: string | null }) =>
              String(r.email ?? "").toLowerCase() === String(data.email ?? "").toLowerCase(),
          ) ?? null;
      }
    }
    if (!profile) throw new Error("Bu e-posta ile kayıtlı kullanıcı bulunamadı.");

    const { data: existingAff } = await db
      .from("affiliates")
      .select("id")
      .eq("user_id", profile.id)
      .maybeSingle();
    if (existingAff) throw new Error("Bu kullanıcı zaten affiliate partneridir.");

    const code = await uniqueCode(db, data.code);
    const rate = data.commissionRatePct ?? 30;
    const duration = data.commissionDurationMonths ?? 12;
    const affiliateId = crypto.randomUUID();

    // Kod ad alanını senkron tut: davet kodu olarak da çalışsın.
    if (profile.referral_code !== code) {
      await db.from("profiles").update({ referral_code: code }).eq("id", profile.id);
    }

    const { error } = await db.from("affiliates").insert({
      id: affiliateId,
      user_id: profile.id,
      display_name: data.displayName,
      referral_code: code,
      commission_rate_pct: rate,
      commission_duration_months: duration,
      status: "active",
    });
    if (error) throw new Error("Affiliate oluşturulamadı.");
    return { ok: true, affiliateId, code };
  });

export const updateAdminAffiliate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        affiliateId: z.string().min(8),
        displayName: z.string().trim().max(80).optional(),
        code: z.string().trim().max(16).optional(),
        commissionRatePct: z.coerce.number().min(0).max(100).optional(),
        commissionDurationMonths: z.coerce.number().int().min(1).max(24).optional(),
        status: z.enum(["active", "inactive"]).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<{ ok: true; code: string }> => {
    const db = await adminDb(context);
    const { data: affiliateRow } = await db
      .from("affiliates")
      .select("*")
      .eq("id", data.affiliateId)
      .maybeSingle();
    if (!affiliateRow) throw new Error("Affiliate bulunamadı.");
    const affiliate = affiliateRow as AffiliateRow;

    let code = affiliate.referral_code;
    if (data.code) {
      code = await uniqueCode(db, data.code);
      // Kod değiştiyse profil tarafı da senkronlanır (davet akışı aynı kodu kullanır).
      await db.from("profiles").update({ referral_code: code }).eq("id", affiliate.user_id);
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (data.displayName !== undefined) patch["display_name"] = data.displayName;
    if (code !== affiliate.referral_code) patch["referral_code"] = code;
    if (data.commissionRatePct !== undefined) patch["commission_rate_pct"] = data.commissionRatePct;
    if (data.commissionDurationMonths !== undefined)
      patch["commission_duration_months"] = data.commissionDurationMonths;
    if (data.status !== undefined) patch["status"] = data.status;

    const { error } = await db.from("affiliates").update(patch).eq("id", data.affiliateId);
    if (error) throw new Error("Güncelleme başarısız: " + error.message);
    return { ok: true, code };
  });

/* --------------------------------------------------------------------------
 * Payout & reversal
 * -------------------------------------------------------------------------- */

export const markCommissionsPaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ ids: z.array(z.string().min(1)).min(1).max(500) }).parse(i),
  )
  .handler(async ({ data, context }): Promise<{ ok: true; paid: number }> => {
    const db = await adminDb(context);
    const res = await payCommissions(db, { ids: data.ids, paidAt: new Date() });
    return { ok: true, paid: res.paid };
  });

export const reverseAdminCommission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        id: z.string().min(1),
        reason: z.string().trim().max(200).optional().default("admin_reversal"),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<{ ok: true; reversed: number }> => {
    const db = await adminDb(context);
    const res = await reverseCommissionsByIds(db, { ids: [data.id], reason: data.reason });
    return { ok: true, reversed: res.reversed };
  });
