/**
 * Partner (affiliate) sunucu fonksiyonları.
 *
 * Güvenlik: Her istek önce oturumdaki kullanıcının KENDİ affiliate kaydını
 * çözer; hiçbir fonksiyon istemciden affiliate_id kabul etmez (IDOR/BOLA
 * kapalı). Müşteri e-postaları partner panele ham olarak asla gönderilmez —
 * maskelenir. Tüm sorgular service role ile sunucuda çalışır.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { maskEmail } from "@/lib/affiliate/affiliate-core";
import {
  countClicksForAffiliate,
  listCommissionsForAffiliate,
  listReferralsForAffiliate,
  resolveAffiliateByUserId,
  type AffDb,
  type CommissionRow,
  type ReferralRow,
} from "@/lib/affiliate/affiliate.service";

export type PartnerCustomerRow = {
  customerId: string;
  email: string; // maskeli
  plan: string | null;
  status: string;
  monthlyRevenueCents: number;
  commissionRatePct: number | null;
  monthlyCommissionCents: number;
  commissionStart: string | null;
  commissionEnd: string | null;
  totalEarnedCents: number;
  referredAt: string;
};

export type PartnerEarningRow = {
  id: string;
  customerEmail: string; // maskeli
  plan: string;
  subscriptionAmountCents: number;
  commissionAmountCents: number;
  commissionRatePct: number;
  status: string;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
  paidAt: string | null;
};

export type PartnerDashboardPayload = {
  affiliate: {
    id: string;
    displayName: string;
    referralCode: string;
    commissionRatePct: number;
    commissionDurationMonths: number;
    status: string;
    createdAt: string;
    link: string;
  } | null;
  stats: {
    totalEarnedCents: number;
    pendingCents: number;
    paidCents: number;
    reversedCents: number;
    activeCustomers: number;
    totalCustomers: number;
    clicks: number;
    paidCustomers: number;
    conversionRate: number | null;
    mrrCents: number;
  };
  customers: PartnerCustomerRow[];
  earnings: PartnerEarningRow[];
  generatedAt: string;
};

/** Aktif affiliate'lerin URL tabanı (çevreye göre). */
function linkOrigin(): string {
  return process.env["APP_URL"] || "https://aroless.tech";
}

/** Müşteri e-posta haritası (maskeli). */
async function customerEmails(db: AffDb, customerIds: string[]): Promise<Record<string, string>> {
  if (!customerIds.length) return {};
  const unique = [...new Set(customerIds)];
  const map: Record<string, string> = {};
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const { data } = await db.from("profiles").select("id,email").in("id", chunk);
    for (const row of data ?? []) map[row.id] = maskEmail(row.email);
  }
  return map;
}

export const getPartnerDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PartnerDashboardPayload> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as AffDb;

    const affiliate = await resolveAffiliateByUserId(db, context.userId);
    if (!affiliate) {
      return {
        affiliate: null,
        stats: {
          totalEarnedCents: 0,
          pendingCents: 0,
          paidCents: 0,
          reversedCents: 0,
          activeCustomers: 0,
          totalCustomers: 0,
          clicks: 0,
          paidCustomers: 0,
          conversionRate: null,
          mrrCents: 0,
        },
        customers: [],
        earnings: [],
        generatedAt: new Date().toISOString(),
      };
    }

    const [referrals, commissions, clicks] = await Promise.all([
      listReferralsForAffiliate(db, affiliate.id, { limit: 1000 }),
      listCommissionsForAffiliate(db, affiliate.id, { limit: 2000 }),
      countClicksForAffiliate(db, affiliate.id),
    ]);

    const emails = await customerEmails(
      db,
      referrals.map((r) => r.customer_id),
    );

    // ---- Earnings tablosu (en yeni üstte) ----
    const earnings: PartnerEarningRow[] = commissions.map((c: CommissionRow) => ({
      id: c.id,
      customerEmail: emails[c.customer_id] ?? "gizli",
      plan: c.plan,
      subscriptionAmountCents: c.subscription_amount_cents,
      commissionAmountCents: c.commission_amount_cents,
      commissionRatePct: c.commission_rate_pct,
      status: c.status,
      periodStart: c.period_start,
      periodEnd: c.period_end,
      createdAt: c.created_at,
      paidAt: c.paid_at,
    }));

    // ---- Müşteri tablosu (atıf başına özet) ----
    const byCustomer = new Map<string, CommissionRow[]>();
    for (const c of commissions) {
      const arr = byCustomer.get(c.customer_id) ?? [];
      arr.push(c);
      byCustomer.set(c.customer_id, arr);
    }

    const customers: PartnerCustomerRow[] = referrals.map((r: ReferralRow) => {
      const rows = (byCustomer.get(r.customer_id) ?? []).filter((c) => c.status !== "reversed");
      const active = rows.filter((c) => c.status === "paid" || c.status === "pending");
      const last = active[active.length - 1];
      const periodStarts = active.map((c) => c.period_start).sort();
      const monthlyRevenueCents = last?.subscription_amount_cents ?? 0;
      const monthlyCommissionCents =
        last?.commission_amount_cents ??
        (r.first_paid_at
          ? Math.round((monthlyRevenueCents * (r.commission_rate_pct ?? 0)) / 100)
          : 0);
      return {
        customerId: r.customer_id,
        email: emails[r.customer_id] ?? "gizli",
        plan: r.plan ?? null,
        status: r.status,
        monthlyRevenueCents,
        commissionRatePct: r.commission_rate_pct,
        monthlyCommissionCents,
        commissionStart: periodStarts[0] ? `${periodStarts[0]}T00:00:00.000Z` : null,
        commissionEnd: periodStarts[periodStarts.length - 1]
          ? `${periodStarts[periodStarts.length - 1]}T00:00:00.000Z`
          : null,
        totalEarnedCents: active.reduce((s, c) => s + c.commission_amount_cents, 0),
        referredAt: r.created_at,
      };
    });

    const pendingCents = commissions
      .filter((c) => c.status === "pending")
      .reduce((s, c) => s + c.commission_amount_cents, 0);
    const paidCents = commissions
      .filter((c) => c.status === "paid")
      .reduce((s, c) => s + c.commission_amount_cents, 0);
    const reversedCents = commissions
      .filter((c) => c.status === "reversed")
      .reduce((s, c) => s + c.commission_amount_cents, 0);
    const paidCustomers = customers.filter(
      (c) => c.status === "active" && c.monthlyRevenueCents > 0,
    ).length;
    const mrrCents = customers
      .filter((c) => c.status === "active")
      .reduce((s, c) => s + c.monthlyRevenueCents, 0);

    return {
      affiliate: {
        id: affiliate.id,
        displayName: affiliate.display_name || "Partner",
        referralCode: affiliate.referral_code,
        commissionRatePct: affiliate.commission_rate_pct,
        commissionDurationMonths: affiliate.commission_duration_months,
        status: affiliate.status,
        createdAt: affiliate.created_at,
        link: `${linkOrigin()}/?ref=${affiliate.referral_code}`,
      },
      stats: {
        totalEarnedCents: paidCents + pendingCents,
        pendingCents,
        paidCents,
        reversedCents,
        activeCustomers: customers.filter((c) => c.status === "active").length,
        totalCustomers: customers.length,
        clicks,
        paidCustomers,
        conversionRate: clicks > 0 ? Math.round((paidCustomers / clicks) * 1000) / 10 : null,
        mrrCents,
      },
      customers,
      earnings,
      generatedAt: new Date().toISOString(),
    };
  });
