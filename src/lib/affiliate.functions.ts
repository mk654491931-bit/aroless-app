import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  COMMISSION_MAX_MONTHS,
  DEFAULT_COMMISSION_RATE_PCT,
  MIN_PAYOUT_CENTS,
  isAffiliateStatus,
  isCommissionStatus,
  isPayoutMethod,
  payoutEligibility,
  type AffiliateStatus,
  type CommissionStatus,
  type PayoutMethod,
} from "@/lib/affiliate";
import {
  buildPayoutRunCsv,
  groupPayoutRuns,
  isValidIban,
  maskIban,
  nextPayoutUnlockAt,
  PAYOUT_HOLD_DAYS,
  payoutProfileState,
  payoutRunSummary,
  splitCommissionsByHold,
  type CommissionRow,
  type PaidCommissionRow,
  type PayoutProfile,
  type PayoutProfileState,
  type PayoutRun,
  type PayoutRunRow,
} from "@/lib/affiliate-payout";
import {
  buildAdminPromoUsers,
  myPromoPerformance,
  summarizePromoByCode,
  type PromoProfileRow,
  type PromoRedemptionRow,
  type PromoTransactionRow,
} from "@/lib/promo-attribution";
import { loadPromoAttribution } from "@/lib/promo.functions";
import {
  buildAffiliateCodeReport,
  type AffiliateBalance,
  type AffiliateCodeReport,
} from "@/lib/affiliate-code-report";
import { adminOrUserClient, missingServiceRoleError } from "@/lib/service-client";

/** 403 (not 500) for RBAC denials — TanStack Start serializes statusCode. */
function forbidden(): Error & { statusCode: number } {
  const err = new Error("Forbidden") as Error & { statusCode: number };
  err.statusCode = 403;
  return err;
}

/** 4xx (validation/admission) hatası — sunucu hatası değil, kullanıcı girdisi. */
function badRequest(message: string, statusCode = 400): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
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
  /** Affiliate'in SAHİP olduğu promo kodu (varsa) — paylaşacağı kod. */
  promo_code: string | null;
  /** Toplam kazanç (ödenmemiş + ödenmiş; mahsup hariç). */
  earned_cents: number;
  /** Ödenmemiş TOPLAM birikim (ödenebilir + beklemede). */
  pending_cents: number;
  /** Bekleme süresi (30 gün) dolmuş, ödenmeye hazır birikim. */
  payable_cents: number;
  /** Henüz bekleme süresi dolmamış birikim (ödeme yapılmaz). */
  held_cents: number;
  /** Beklemedeki bakiyenin ödenebilir olacağı tarih (yoksa null). */
  next_unlock_at: string | null;
  /** Şimdiye kadar ödenmiş toplam. */
  paid_cents: number;
  /**
   * KOMİSYON PENCERESİ: bir müşteri için komisyon en fazla bu kadar ay yazılır
   * (`COMMISSION_MAX_MONTHS`, ürün kararı: 12). Müşteri kaç ay ücretli kaldıysa
   * o kadar; 12 ay dolunca yeni komisyon doğmaz.
   */
  commission_max_months: number;
  /** Ödeme eşiği (varsayılan $75). */
  min_payout_cents: number;
  /** ÖDENEBİLİR birikim >= eşik mi? (ödemeye hazır) */
  payout_eligible: boolean;
  /** Eşiğe kalan tutar (ödenebilir bakiyeye göre). */
  payout_remaining_cents: number;
  /** Kayıtlı ödeme bilgisi (maskeli) — affiliate kendi bilgisini doğrular. */
  payout: {
    method: PayoutMethod | null;
    account_holder: string | null;
    iban_masked: string | null;
    wise_email: string | null;
    tax_id_set: boolean;
    ready: boolean;
    missing: string[];
  };
  /** Komisyon yazan (mahsup edilmemiş) ödeme sayısı — TÜM geçmiş. */
  paid_transactions: number;
  /**
   * ÖDEME GEÇMİŞİ — "hesabıma para atıldı mı?" sorusunun doğrudan cevabı.
   * Her satır bir TRANSFER partisidir (referans · tarih · tutar · yöntem),
   * tek tek komisyon satırları değil. Yalnız `paid` durumundaki satırlar girer.
   */
  payouts: PayoutRun[];
  /** En son yapılan ödeme (hiç ödeme yoksa null). */
  last_payout: PayoutRun | null;
  /** Ödeme geçmişi okuma sınırına takıldı mı (true ise liste EKSİKTİR). */
  payouts_truncated: boolean;
  /** Hiç ödeme yapılmış mı? Panel "henüz ödeme yapılmadı" diyebilsin diye. */
  paid_any: boolean;
  /**
   * Toplamlar TAM mı? Sayfalı okuma 10.000 satırı aşarsa false olur ve
   * rakamlar alt sınır olarak gösterilir (uydurma bir toplam yazılmaz).
   */
  totals_exact: boolean;
  recent: Array<{
    id: string;
    tier: string | null;
    gross_amount_cents: number;
    commission_cents: number;
    status: CommissionStatus;
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
    const { client, isServiceRole } = await adminOrUserClient(context);

    const [affiliateRes, profileRes, commissionsRes, ownedCodeRes, totals, historyRes] =
      await Promise.all([
        client
          .from("affiliates")
          .select(
            "user_id, status, commission_rate_pct, verified_by, verified_at, created_at, " +
              "payout_method, payout_account_holder, payout_iban, payout_wise_email, payout_tax_id",
          )
          .eq("user_id", uid)
          .maybeSingle(),
        client.from("profiles").select("referral_code").eq("id", uid).maybeSingle(),
        client
          .from("affiliate_commissions")
          .select("id, tier, gross_amount_cents, commission_cents, status, created_at")
          .eq("affiliate_id", uid)
          .order("created_at", { ascending: false })
          .limit(50),
        client
          .from("promo_codes")
          .select("code")
          .eq("affiliate_id", uid)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        readAffiliateTotals(client, isServiceRole, uid),
        // Ödeme GEÇMİŞİ: partiyi tanımlayan alanlar (`payout_ref`, `paid_at`,
        // `paid_method`) yalnız `paid` satırlarda dolu olur. Sınırlı okunur ve
        // sınıra takılırsa `truncated` ile DÜRÜSTÇE bildirilir.
        client
          .from("affiliate_commissions")
          .select("commission_cents, status, paid_at, paid_method, payout_ref")
          .eq("affiliate_id", uid)
          .eq("status", "paid")
          .order("paid_at", { ascending: false })
          .limit(PAYOUT_HISTORY_LIMIT),
      ]);

    const row = affiliateRes.data as AffiliateStatusRow | null;
    const commissions = (commissionsRes.data ?? []) as AffiliateSummary["recent"];
    const paidHistory = groupPayoutRuns((historyRes.data ?? []) as PaidCommissionRow[], {
      truncated: (historyRes.data?.length ?? 0) >= PAYOUT_HISTORY_LIMIT,
    });

    const pendingCents = totals.pendingCents;
    const paidCents = totals.paidCents;
    // EŞİK ÖDENEBİLİR bakiyeye göre değerlendirilir: bekleme süresindeki para
    // ödenemez, dolayısıyla "hazır" göstergesi yanıltıcı olmamalıdır.
    const eligibility = payoutEligibility(totals.payableCents);
    const ownedCode = (ownedCodeRes.data as { code?: string | null } | null)?.code ?? null;

    const payoutRow = (row ?? {}) as unknown as Record<string, unknown>;
    const profileInput: PayoutProfile = {
      method: (payoutRow["payout_method"] as string | null) ?? null,
      accountHolder: (payoutRow["payout_account_holder"] as string | null) ?? null,
      iban: (payoutRow["payout_iban"] as string | null) ?? null,
      wiseEmail: (payoutRow["payout_wise_email"] as string | null) ?? null,
      taxId: (payoutRow["payout_tax_id"] as string | null) ?? null,
    };
    const payoutState = payoutProfileState(profileInput);
    const nextUnlockAt = nextPayoutUnlockAt({
      oldestHeldAt: totals.oldestHeldAt,
      heldCents: totals.heldCents,
    });

    return {
      applied: !!row,
      status: row && isAffiliateStatus(row.status) ? row.status : null,
      commission_rate_pct: row?.commission_rate_pct ?? DEFAULT_COMMISSION_RATE_PCT,
      referral_code: ((profileRes.data as { referral_code?: string } | null)?.referral_code ??
        "") as string,
      promo_code: ownedCode ? ownedCode.toUpperCase() : null,
      earned_cents: pendingCents + paidCents,
      pending_cents: pendingCents,
      payable_cents: totals.payableCents,
      held_cents: totals.heldCents,
      next_unlock_at: nextUnlockAt,
      paid_cents: paidCents,
      commission_max_months: COMMISSION_MAX_MONTHS,
      min_payout_cents: MIN_PAYOUT_CENTS,
      payout_eligible: eligibility.eligible,
      payout_remaining_cents: eligibility.remainingCents,
      payout: {
        method: isPayoutMethod(profileInput.method) ? profileInput.method : null,
        account_holder: profileInput.accountHolder ?? null,
        iban_masked: isPayoutMethod(profileInput.method) ? maskIban(profileInput.iban) : null,
        wise_email: profileInput.wiseEmail ?? null,
        tax_id_set: Boolean(profileInput.taxId),
        ready: payoutState.ready,
        missing: payoutState.missing,
      },
      paid_transactions: totals.commissionedCount,
      payouts: paidHistory.runs,
      last_payout: paidHistory.runs[0] ?? null,
      payouts_truncated: paidHistory.truncated,
      paid_any: paidCents > 0,
      totals_exact: totals.exact,
      recent: commissions.slice(0, 10).map((c) => ({
        id: c.id,
        tier: c.tier ?? null,
        gross_amount_cents: c.gross_amount_cents ?? 0,
        commission_cents: c.commission_cents ?? 0,
        status: isCommissionStatus(c.status) ? c.status : "pending",
        created_at: c.created_at,
      })),
    };
  });

/**
 * Affiliate'in TÜM geçmişe ait komisyon toplamları.
 *
 * ÖLÇÜLEN HATA: panel toplamları yalnız en yeni 50 komisyon satırından
 * hesaplanıyordu (`limit(50)`). Aylık yinelenen komisyonda bu sınır kısa sürede
 * aşıldığı için "Birikmiş" ve "Ödenen" rakamları EKSİK görünüyor, $75'lik ödeme
 * eşiği de yanlış değerlendiriliyordu (affiliate ödemeye hazır olduğu hâlde
 * panel "hazır değil" diyordu). Toplamlar artık veritabanında toplanır.
 *
 * İki yol:
 *   1. Servis rolü varsa `affiliate_payout_summary()` — tek gruplu sorgu.
 *   2. Yoksa RLS'li istemciyle sayfalı okuma (kullanıcı yalnız kendi satırlarını
 *      görür) — 10.000 satıra kadar tam; üstünde `exact: false` döner ve panel
 *      rakamı "alt sınır" olarak işaretler.
 */
type AffiliateTotals = {
  /** Ödenmemiş toplam (ödenebilir + beklemede). */
  pendingCents: number;
  /** Bekleme süresi dolmuş birikim. */
  payableCents: number;
  /** Bekleme süresindeki birikim. */
  heldCents: number;
  paidCents: number;
  /** Ödeme yazılmış (paid) satır sayısı. */
  paidCount: number;
  /** Mahsup edilmemiş (komisyon yazan) satır sayısı. */
  commissionedCount: number;
  /** Beklemedeki en eski komisyonun tarihi (yoksa null). */
  oldestHeldAt: string | null;
  exact: boolean;
};

const TOTALS_PAGE_SIZE = 1000;
const TOTALS_MAX_PAGES = 10;

/**
 * Ödeme geçmişinde okunacak azami satır. 200 ödenmiş komisyon, gerçekçi bir
 * affiliate geçmişinin tamamını kapsar; daha fazlası varsa panel `truncated`
 * bayrağıyla bunu söyler (sessiz eksik toplam gösterilmez).
 */
const PAYOUT_HISTORY_LIMIT = 200;

async function readAffiliateTotals(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  isServiceRole: boolean,
  uid: string,
): Promise<AffiliateTotals> {
  if (isServiceRole) {
    const { data, error } = await client.rpc("affiliate_payout_summary");
    if (!error) {
      const rows = (data ?? []) as Array<Record<string, unknown> & { affiliate_id: string }>;
      const mine = rows.find((r) => r.affiliate_id === uid);
      // v2 özet (bekleme süresi ayrımı) uygulanmamışsa alanlar `undefined`
      // gelir; o durumda ÖDENEBİLİR kabul etmek yerine sayfalı hesaba düşülür
      // (yanlış "ödemeye hazır" göstergesi güven kaybı yaratır).
      if (mine && mine["payable_cents"] !== undefined) {
        const num = (key: string) => Number(mine[key] ?? 0);
        const pending = num("pending_cents");
        const payable = num("payable_cents");
        const held = num("held_cents");
        return {
          pendingCents: Number.isFinite(pending) ? pending : 0,
          payableCents: Number.isFinite(payable) ? payable : 0,
          heldCents: Number.isFinite(held) ? held : 0,
          paidCents: num("paid_cents"),
          paidCount: num("paid_count"),
          commissionedCount: num("pending_count") + num("paid_count"),
          oldestHeldAt: (mine["oldest_held_at"] as string | null) ?? null,
          exact: true,
        };
      }
    }
    // Migration uygulanmamışsa sayfalı yola düş (panel çalışmaya devam eder).
    if (error) {
      console.warn(
        `[affiliate] payout özeti okunamadı, sayfalı toplama geçiliyor: ${error.message}`,
      );
    }
  }

  const collected: CommissionRow[] = [];
  let complete = false;
  for (let page = 0; page < TOTALS_MAX_PAGES; page++) {
    const { data, error } = await client
      .from("affiliate_commissions")
      .select("commission_cents, status, created_at")
      .eq("affiliate_id", uid)
      .order("created_at", { ascending: false })
      .range(page * TOTALS_PAGE_SIZE, page * TOTALS_PAGE_SIZE + TOTALS_PAGE_SIZE - 1);
    if (error) break;
    const rows = (data ?? []) as CommissionRow[];
    collected.push(...rows);
    if (rows.length < TOTALS_PAGE_SIZE) {
      complete = true;
      break;
    }
  }

  // Bekleme süresi ayrımı TEK kural dosyasından gelir (SQL ile aynı 30 gün).
  const split = splitCommissionsByHold(collected);
  return {
    pendingCents: split.payableCents + split.heldCents,
    payableCents: split.payableCents,
    heldCents: split.heldCents,
    paidCents: split.paidCents,
    paidCount: split.paidCount,
    commissionedCount: split.payableCount + split.heldCount + split.paidCount,
    oldestHeldAt: split.oldestHeldAt,
    exact: complete,
  };
}

/* ------------------------------------------------------------------ */
/* ÜST MENÜ ROZETİ — "bu hesap affiliate mi?" (hafif uç)                */
/* ------------------------------------------------------------------ */

export type AffiliateBadge = {
  /** Admin tarafından affiliate olarak TANIMLANDI ve onaylı mı? */
  is_affiliate: boolean;
  /** Ham durum (`pending` başvuru da rozette rozetsiz görünür). */
  status: AffiliateStatus | null;
  /** Ödenmemiş birikim (ödenebilir + beklemede). */
  pending_cents: number;
  /** Ödemeye hazır (bekleme süresi dolmuş) birikim. */
  payable_cents: number;
  /** Şimdiye kadar ödenmiş toplam. */
  paid_cents: number;
  /** Ödenebilir birikim eşiği geçti mi (artık ödenebilir)? */
  eligible: boolean;
  /** Eşiğe kalan tutar. */
  remaining_cents: number;
  min_payout_cents: number;
};

/**
 * ÜST MENÜ için HAFİF affiliate rozeti.
 *
 * NEDEN AYRI UÇ: üst menü her sayfada çizilir. Tam özet ucu (`getMyAffiliateStatus`)
 * beş sorgu + sayfalı toplam okuması yapar; her sayfa açılışında onu çağırmak
 * gereksiz maliyettir. Bu uç yalnız İKİ şey sorar: (1) satır var mı ve durumu ne,
 * (2) ödenmemiş/ödenmiş toplam ne kadar. Ağır sorgu yalnız affiliate paneli
 * açıldığında koşar.
 *
 * DÜRÜSTLÜK: rozet, HİÇBİR durumda "affiliate" göstermez — yalnız `verified`
 * hesapta `is_affiliate: true` döner (admin tanımlamadıysa buton çıkmaz).
 */
export const getMyAffiliateBadge = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AffiliateBadge> => {
    const uid = context.userId;
    const { client, isServiceRole } = await adminOrUserClient(context);

    const { data: row } = await client
      .from("affiliates")
      .select("status")
      .eq("user_id", uid)
      .maybeSingle();

    const status = (row as { status?: string } | null)?.status ?? null;
    const normalized = isAffiliateStatus(status) ? status : null;

    // Onaylı DEĞİLse toplamları hiç okumayız: buton çıkmayacak, sorgu boşa gider.
    if (normalized !== "verified") {
      return {
        is_affiliate: false,
        status: normalized,
        pending_cents: 0,
        payable_cents: 0,
        paid_cents: 0,
        eligible: false,
        remaining_cents: MIN_PAYOUT_CENTS,
        min_payout_cents: MIN_PAYOUT_CENTS,
      };
    }

    const totals = await readAffiliateTotals(client, isServiceRole, uid);
    const eligibility = payoutEligibility(totals.payableCents);
    return {
      is_affiliate: true,
      status: normalized,
      pending_cents: totals.pendingCents,
      payable_cents: totals.payableCents,
      paid_cents: totals.paidCents,
      eligible: eligibility.eligible,
      remaining_cents: eligibility.remainingCents,
      min_payout_cents: MIN_PAYOUT_CENTS,
    };
  });

/**
 * Affiliate programına başvur. Idempotent: daha önce başvurmuşsa mevcut
 * durumunu döner, asla durumunu değiştirmez (yalnızca admin onaylayabilir).
 */
/**
 * Başvuru formu girdisi.
 *
 * `termsAccepted` ZORUNLUDUR: komisyon oranı, ödeme takvimi (30 gün bekleme) ve
 * iade mahsubu kurallarının kabul edildiği kanıtlanmadan başvuru kaydedilmez.
 * Kitle/kanal bilgisi adminin başvuruyu DEĞERLENDİREBİLMESİ için istenir (kodsuz
 * hesaba kod vermek yerine kimin kime ulaştığı görülür).
 */
const ApplyInput = z.object({
  audience: z.string().trim().max(300).optional().default(""),
  channels: z.string().trim().max(300).optional().default(""),
  socialHandle: z.string().trim().max(160).optional().default(""),
  termsAccepted: z.boolean(),
});

export const applyForAffiliate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ApplyInput.parse(i ?? {}))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ ok: boolean; status: AffiliateStatus | null; reason?: string }> => {
      const { rateLimit } = await import("@/lib/api-guard.server");

      // Basit kötüye kullanım koruması: aynı hesap 1 saatte en fazla 5 kez.
      const limited = await rateLimit(`affiliate:apply:${context.userId}`, 5, 3600);
      if (limited) {
        return {
          ok: false,
          status: null,
          reason: "Çok fazla deneme yaptın, biraz sonra tekrar dene.",
        };
      }

      if (!data.termsAccepted) {
        return {
          ok: false,
          status: null,
          reason: "Başvurmak için affiliate program şartlarını kabul etmelisin.",
        };
      }

      const { client, isServiceRole } = await adminOrUserClient(context);

      const details = {
        audience: data.audience || null,
        channels: data.channels || null,
        social_handle: data.socialHandle || null,
      };

      const { data: existing, error: existingError } = await client
        .from("affiliates")
        .select("status")
        .eq("user_id", context.userId)
        .maybeSingle();
      if (existingError)
        return { ok: false, status: null, reason: "Başvuru durumu okunamadı, tekrar dene." };
      if (existing) {
        const status = isAffiliateStatus(existing.status) ? existing.status : null;
        // Bekleyen başvuruda beyan güncellenebilir; onaylı/askı satıra dokunulmaz.
        if (status === "pending" && isServiceRole) {
          await client
            .from("affiliates")
            .update({ ...details, terms_accepted_at: new Date().toISOString() })
            .eq("user_id", context.userId)
            .eq("status", "pending");
        }
        return { ok: true, status };
      }

      if (isServiceRole) {
        const { error } = await client.from("affiliates").insert({
          user_id: context.userId,
          status: "pending",
          commission_rate_pct: DEFAULT_COMMISSION_RATE_PCT,
          ...details,
          terms_accepted_at: new Date().toISOString(),
        });
        if (!error) return { ok: true, status: "pending" };
        // Migration uygulanmadıysa yeni kolonlar yoktur: başvuruyu KAYBETMEK
        // yerine temel alanlarla yaz (kullanıcı beyanını sonra tamamlayabilir).
        if (/column|schema cache/i.test(error.message)) {
          const { error: minimal } = await client.from("affiliates").insert({
            user_id: context.userId,
            status: "pending",
            commission_rate_pct: DEFAULT_COMMISSION_RATE_PCT,
          });
          if (!minimal) return { ok: true, status: "pending" };
        }
        return { ok: false, status: null, reason: "Başvuru kaydedilemedi, tekrar dene." };
      }

      // Servis rolü anahtarı yok: SECURITY DEFINER apply_for_affiliate() kendi
      // başvurusunu kullanıcı oturumuyla oluşturur (durum/oran sunucuda sabit).
      // Yeni arite yoksa eski sıfır argümanlı sürüme düşülür.
      const modern = await context.supabase.rpc("apply_for_affiliate", {
        _audience: details.audience,
        _channels: details.channels,
        _social_handle: details.social_handle,
        _terms_accepted: true,
      });
      if (!modern.error && modern.data === "terms_required")
        return {
          ok: false,
          status: null,
          reason: "Başvurmak için affiliate program şartlarını kabul etmelisin.",
        };
      if (!modern.error && isAffiliateStatus(modern.data)) return { ok: true, status: modern.data };

      const legacy = await context.supabase.rpc("apply_for_affiliate", {});
      if (legacy.error || !isAffiliateStatus(legacy.data))
        return { ok: false, status: null, reason: "Başvuru kaydedilemedi, tekrar dene." };
      return { ok: true, status: legacy.data };
    },
  );

/* ------------------------------------------------------------------ */
/* Affiliate: KENDİ ödeme bilgisini gir/güncelle                        */
/* ------------------------------------------------------------------ */

const MyPayoutInput = z.object({
  method: z.enum(["wise", "iban", "other"]),
  accountHolder: z.string().trim().min(1, "Hesap sahibi adı gerekli.").max(160),
  iban: z.string().trim().max(64).nullable().optional().default(null),
  wiseEmail: z.string().trim().max(200).nullable().optional().default(null),
  taxId: z.string().trim().max(64).nullable().optional().default(null),
});

/**
 * Affiliate KENDİ ödeme bilgisini kaydeder.
 *
 * NEDEN ayrı bir yol: `affiliates` tablosunda authenticated kullanıcı için
 * UPDATE politikası YOKTUR (IBAN/vergi no kişisel veri). İki yol vardır:
 *   1. Servis rolü varsa doğrudan güncelleme (RLS'in ötesinden).
 *   2. Yoksa `set_my_affiliate_payout()` SECURITY DEFINER RPC'si — yalnız
 *      çağıranın (auth.uid()) satırını güncelleyebilir.
 *
 * IBAN KAYDETMEDEN ÖNCE mod-97 ile doğrulanır: yanlış yazım yalnız bankada
 * reddedilir, sistemde geçerli görünür ve affiliate ödeme beklerken admin
 * "gönderdim" sanır. Eksik alanlar (ör. Wise e-postası) ENGELLENMEZ; kayıt
 * kısmi olabilir ve panel eksikleri açıkça söyler.
 */
export const updateMyPayoutProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => MyPayoutInput.parse(i))
  .handler(async ({ data, context }): Promise<{ ok: true; state: PayoutProfileState }> => {
    if (data.iban && !isValidIban(data.iban)) {
      throw badRequest("IBAN geçersiz (mod-97 kontrolü başarısız). Kontrol edip tekrar dene.");
    }

    const state = payoutProfileState({
      method: data.method,
      accountHolder: data.accountHolder,
      iban: data.iban,
      wiseEmail: data.wiseEmail,
      taxId: data.taxId,
    });

    const { client, isServiceRole } = await adminOrUserClient(context);

    if (isServiceRole) {
      const { data: existing, error: readError } = await client
        .from("affiliates")
        .select("user_id")
        .eq("user_id", context.userId)
        .maybeSingle();
      if (readError) throw new Error(readError.message);
      if (!existing) {
        throw badRequest("Önce affiliate başvurusu yapmalısın.", 409);
      }
      const { error } = await client
        .from("affiliates")
        .update({
          payout_method: data.method,
          payout_account_holder: data.accountHolder,
          payout_iban: data.iban ? data.iban.replace(/\s+/g, "").toUpperCase() : null,
          payout_wise_email: data.wiseEmail,
          payout_tax_id: data.taxId,
        })
        .eq("user_id", context.userId);
      if (error) throw new Error(error.message);
      return { ok: true, state };
    }

    // Servis rolü yok: SECURITY DEFINER RPC (yalnız kendi satırı).
    const { data: result, error } = await context.supabase.rpc("set_my_affiliate_payout", {
      _method: data.method,
      _account_holder: data.accountHolder,
      _iban: data.iban,
      _wise_email: data.wiseEmail,
      _tax_id: data.taxId,
    });
    if (error) {
      // Migration uygulanmadıysa özellik sessizce çalışmıyor gibi görünmesin.
      if (/function|schema cache/i.test(error.message)) {
        throw badRequest(
          "Ödeme bilgisi kaydı bu kurulumda etkin değil (migration uygulanmamış). Yöneticiye bildir.",
          503,
        );
      }
      throw new Error(error.message);
    }
    const code = String(result);
    if (code === "unauthorized") throw forbidden();
    if (code === "no_application") throw badRequest("Önce affiliate başvurusu yapmalısın.", 409);
    if (code === "revoked")
      throw badRequest("Askıya alınmış hesap ödeme bilgisi güncelleyemez.", 409);
    if (code === "invalid_method") throw badRequest("Geçerli bir ödeme yöntemi seç.");
    if (code !== "ok") throw badRequest("Ödeme bilgisi kaydedilemedi, tekrar dene.", 400);
    return { ok: true, state };
  });

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
      .select("subscription_tier")
      .eq("id", uid)
      .maybeSingle();

    // Affiliate'in SAHİP OLDUĞU kod: admin'in ona bağladığı promo kodu.
    // (Kullanıcının kaydolurken KULLANDIĞI kod değil — bu ayrım önemli.)
    const { data: owned } = await client
      .from("promo_codes")
      .select("code")
      .eq("affiliate_id", uid)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const normalized = String((owned as { code?: string | null } | null)?.code ?? "")
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
        .select("user_id, status, commission_rate_pct, verified_at, created_at")
        .order("created_at", { ascending: false })
        .limit(200),
      supabaseAdmin.from("affiliate_commissions").select("affiliate_id, commission_cents"),
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
  .inputValidator((input: unknown) => SetStatusSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: boolean; status: AffiliateStatus }> => {
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
  });

/* ------------------------------------------------------------------ */
/* Admin: ÖDEME (payout) paneli — kime ne kadar borçluyuz, ödendi mi?   */
/* Ödemeler manuel yapılır (Wise / IBAN); sistem eşiği ve kaydı tutar.  */
/* ------------------------------------------------------------------ */

export type AdminAffiliatePayout = {
  user_id: string;
  email: string | null;
  status: string;
  commission_rate_pct: number;
  payout_method: PayoutMethod | null;
  payout_note: string | null;
  /** Yapılandırılmış ödeme bilgisi (IBAN ekranda gösterilmez, maskelenir). */
  payout_account_holder: string | null;
  payout_iban_masked: string | null;
  payout_iban_valid: boolean;
  payout_wise_email: string | null;
  payout_tax_id_set: boolean;
  /** Ödeme için eksik alanlar (boşsa ödeme yapılabilir). */
  payout_missing: string[];
  /** Başvuruda beyan edilen kitle/kanallar (adminin değerlendirmesi için). */
  audience: string | null;
  channels: string | null;
  social_handle: string | null;
  terms_accepted_at: string | null;
  /** Ödenmemiş TOPLAM birikim (ödenebilir + beklemede). */
  pending_cents: number;
  pending_count: number;
  /** Bekleme süresi (30 gün) dolmuş, ödenebilir birikim. */
  payable_cents: number;
  payable_count: number;
  /** Bekleme süresindeki birikim (henüz ödenmez). */
  held_cents: number;
  held_count: number;
  /** Ödenebilir birikimin en eski komisyon tarihi. */
  oldest_payable_at: string | null;
  paid_cents: number;
  paid_count: number;
  reversed_cents: number;
  last_paid_at: string | null;
  /** ÖDENEBİLİR birikim >= ödeme eşiği ($75) */
  eligible: boolean;
  /** Eşiğe kalan tutar (ödenebilir bakiyeye göre). */
  remaining_cents: number;
  /** Affiliate'e bağlı promo kodları. */
  promo_codes: string[];
};

/**
 * Ödeme ekranı: affiliate başına birikmiş (pending) / ödenmiş (paid) toplamlar,
 * ödeme bilgisi ve eşik durumu. Toplamlar tek sorguda (affiliate_payout_summary)
 * hesaplanır — tüm komisyon satırlarını istemciye çekmek yerine optimize edilmiştir.
 */
export const adminListAffiliatePayouts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminAffiliatePayout[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [affRes, summaryRes, promoRes] = await Promise.all([
      supabaseAdmin
        .from("affiliates")
        .select(
          "user_id, status, commission_rate_pct, payout_method, payout_note, " +
            "payout_account_holder, payout_iban, payout_wise_email, payout_tax_id, " +
            "audience, channels, social_handle, terms_accepted_at",
        )
        .order("created_at", { ascending: false })
        .limit(500),
      supabaseAdmin.rpc("affiliate_payout_summary"),
      supabaseAdmin.from("promo_codes").select("code, affiliate_id").limit(500),
    ]);

    // Seçim dizesi iki parçadan birleştirildiği için PostgREST tip çözümleyicisi
    // satır tipini çıkaramaz (GenericStringError[]); gerçek satır şeklini biz
    // bildiğimiz için `unknown` üzerinden daraltılır.
    const affiliates = (affRes.data ?? []) as unknown as Array<
      Record<string, unknown> & { user_id: string }
    >;
    if (affiliates.length === 0) return [];

    const summaries = new Map<string, Record<string, unknown>>(
      ((summaryRes.data ?? []) as Array<Record<string, unknown> & { affiliate_id: string }>).map(
        (s) => [s.affiliate_id, s],
      ),
    );
    // v2 özet (bekleme süresi) uygulanmadıysa ödenebilir/ beklemede alanları
    // yoktur; o durumda tüm birikim "beklemede" kabul edilir. Yanlışlıkla
    // "ödemeye hazır" göstermek, ödeme reddiyle sonuçlanacağı için yeğlenmez.
    const summaryHasHold = ((summaryRes.data ?? []) as unknown[]).some(
      (row) => (row as Record<string, unknown>)?.payable_cents !== undefined,
    );

    const codesByAffiliate = new Map<string, string[]>();
    for (const r of (promoRes.data ?? []) as Array<{
      code: string;
      affiliate_id: string | null;
    }>) {
      if (!r.affiliate_id) continue;
      const list = codesByAffiliate.get(r.affiliate_id) ?? [];
      list.push(r.code);
      codesByAffiliate.set(r.affiliate_id, list);
    }

    const emailsRes = await supabaseAdmin
      .from("profiles")
      .select("id, email")
      .in(
        "id",
        affiliates.map((a) => a.user_id),
      );
    const emailById = new Map(
      ((emailsRes.data ?? []) as Array<{ id: string; email: string | null }>).map((p) => [
        p.id,
        p.email,
      ]),
    );

    return affiliates
      .map((a) => {
        const s = summaries.get(a.user_id) ?? {};
        const num = (key: string) => Number(s[key] ?? 0);
        const pending = num("pending_cents");
        const payable = summaryHasHold ? num("payable_cents") : 0;
        const held = summaryHasHold ? num("held_cents") : pending;
        // Eşik ÖDENEBİLİR bakiyeye göre (beklemedeki para ödenemez).
        const eligibility = payoutEligibility(payable);

        const payoutInput: PayoutProfile = {
          method: (a["payout_method"] as string | null) ?? null,
          accountHolder: (a["payout_account_holder"] as string | null) ?? null,
          iban: (a["payout_iban"] as string | null) ?? null,
          wiseEmail: (a["payout_wise_email"] as string | null) ?? null,
          taxId: (a["payout_tax_id"] as string | null) ?? null,
        };
        const payoutState = payoutProfileState(payoutInput);

        return {
          user_id: a.user_id,
          email: emailById.get(a.user_id) ?? null,
          status: String(a["status"] ?? "pending"),
          commission_rate_pct: Number(a["commission_rate_pct"] ?? DEFAULT_COMMISSION_RATE_PCT),
          payout_method: isPayoutMethod(payoutInput.method) ? payoutInput.method : null,
          payout_note: (a["payout_note"] as string | null) ?? null,
          payout_account_holder: payoutInput.accountHolder ?? null,
          payout_iban_masked: payoutInput.iban ? maskIban(payoutInput.iban) : null,
          payout_iban_valid: payoutInput.iban ? isValidIban(payoutInput.iban) : false,
          payout_wise_email: payoutInput.wiseEmail ?? null,
          payout_tax_id_set: Boolean(payoutInput.taxId),
          payout_missing: payoutState.missing,
          audience: (a["audience"] as string | null) ?? null,
          channels: (a["channels"] as string | null) ?? null,
          social_handle: (a["social_handle"] as string | null) ?? null,
          terms_accepted_at: (a["terms_accepted_at"] as string | null) ?? null,
          pending_cents: pending,
          pending_count: num("pending_count"),
          payable_cents: payable,
          payable_count: num("payable_count"),
          held_cents: held,
          held_count: summaryHasHold ? num("held_count") : num("pending_count"),
          oldest_payable_at: (s["oldest_payable_at"] as string | null) ?? null,
          paid_cents: num("paid_cents"),
          paid_count: num("paid_count"),
          reversed_cents: num("reversed_cents"),
          last_paid_at: (s["last_paid_at"] as string | null) ?? null,
          eligible: eligibility.eligible,
          remaining_cents: eligibility.remainingCents,
          promo_codes: codesByAffiliate.get(a.user_id) ?? [],
        };
      })
      .sort((x, y) => y.payable_cents - x.payable_cents || y.pending_cents - x.pending_cents);
  });

/**
 * Admin: KOD BAZLI RAPOR — hangi affiliate kodu kaç abonelik getirdi ve o
 * hesapta ne kadar ÖDENEBİLİR bakiye birikti (tek ekran).
 *
 * NEDEN TEK UÇ: abonelik sayısı `promo_redemptions`tan (KOD bazlı), bakiye ise
 * `affiliate_commissions` özetinden (HESAP bazlı) gelir. İki tabloyu ayrı
 * ekranlarda göstermek, "kodu çok çalışan ama parası az" ile "parası çok ama
 * kodu yok" durumlarını gizler. Bu uç ikisini tek satır listesinde birleştirir;
 * bakiyenin çift sayılmaması `buildAffiliateCodeReport` içinde kilitlidir.
 */
export const adminAffiliateCodeReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AffiliateCodeReport> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [codesRes, affRes, summaryRes, attribution] = await Promise.all([
      supabaseAdmin.from("promo_codes").select("code, affiliate_id").limit(500),
      supabaseAdmin
        .from("affiliates")
        .select(
          "user_id, status, commission_rate_pct, payout_method, payout_account_holder, " +
            "payout_iban, payout_wise_email, payout_tax_id",
        )
        .limit(500),
      supabaseAdmin.rpc("affiliate_payout_summary"),
      loadPromoAttribution(),
    ]);

    const codes = (codesRes.data ?? []) as Array<{ code: string; affiliate_id: string | null }>;
    const affiliates = (affRes.data ?? []) as unknown as Array<
      Record<string, unknown> & { user_id: string }
    >;

    // v2 özeti (bekleme süresi) uygulanmadıysa ödenebilir/beklemede alanları
    // yoktur; o durumda tüm birikim "beklemede" sayılır — yanlışlıkla "ödemeye
    // hazır" göstermek, ödeme reddiyle sonuçlanacağı için yeğlenmez.
    const summaryHasHold = ((summaryRes.data ?? []) as unknown[]).some(
      (row) => (row as Record<string, unknown>)?.payable_cents !== undefined,
    );
    const summaries = new Map<string, Record<string, unknown>>(
      ((summaryRes.data ?? []) as Array<Record<string, unknown> & { affiliate_id: string }>).map(
        (s) => [String(s.affiliate_id), s],
      ),
    );

    const codesByAffiliate = new Map<string, string[]>();
    for (const row of codes) {
      if (!row.affiliate_id) continue;
      const list = codesByAffiliate.get(row.affiliate_id) ?? [];
      list.push(String(row.code ?? ""));
      codesByAffiliate.set(row.affiliate_id, list);
    }

    const emailsRes = affiliates.length
      ? await supabaseAdmin
          .from("profiles")
          .select("id, email")
          .in(
            "id",
            affiliates.map((a) => a.user_id),
          )
      : { data: [] as Array<{ id: string; email: string | null }> };
    const emailById = new Map(
      ((emailsRes.data ?? []) as Array<{ id: string; email: string | null }>).map((p) => [
        p.id,
        p.email,
      ]),
    );

    const balances: AffiliateBalance[] = affiliates.map((a) => {
      const s = summaries.get(a.user_id) ?? {};
      const count = (key: string) => Number(s[key] ?? 0);
      const pending = count("pending_cents");
      const payable = summaryHasHold ? count("payable_cents") : 0;
      const eligibility = payoutEligibility(payable);
      const payoutState = payoutProfileState({
        method: (a["payout_method"] as string | null) ?? null,
        accountHolder: (a["payout_account_holder"] as string | null) ?? null,
        iban: (a["payout_iban"] as string | null) ?? null,
        wiseEmail: (a["payout_wise_email"] as string | null) ?? null,
        taxId: (a["payout_tax_id"] as string | null) ?? null,
      });
      return {
        user_id: a.user_id,
        email: emailById.get(a.user_id) ?? null,
        status: String(a["status"] ?? "pending"),
        commission_rate_pct: Number(a["commission_rate_pct"] ?? DEFAULT_COMMISSION_RATE_PCT),
        payable_cents: payable,
        held_cents: summaryHasHold ? count("held_cents") : pending,
        paid_cents: count("paid_cents"),
        eligible: eligibility.eligible,
        remaining_cents: eligibility.remainingCents,
        payout_missing: payoutState.missing,
        codes: codesByAffiliate.get(a.user_id) ?? [],
      };
    });

    const allCodes = codes.map((c) => String(c.code ?? ""));
    return buildAffiliateCodeReport({
      // Kod bazlı atıf özeti: `purchases` = ödeme yapan kullanıcı = ABONELİK.
      stats: summarizePromoByCode(attribution.users, { allCodes }).map((s) => ({
        code: s.code,
        signups: s.signups,
        subscriptions: s.purchases,
        revenue_cents: s.revenue_cents,
        by_tier: s.by_tier,
      })),
      affiliates: balances,
      allCodes,
    });
  });

export type AffiliatePayoutCsvExport = {
  csv: string;
  generatedAt: string;
  affiliates: number;
  totalCents: number;
  blockedCount: number;
};

/**
 * Admin: manuel ödeme listesi (CSV).
 *
 * NEDEN: Wise/IBAN ödemeleri tek tek elle yapılamaz; bankaya/panel'e tek seferde
 * girilecek liste gerekir. Liste ÖDENEBİLİR (bekleme süresi dolmuş) bakiyesi
 * eşiği geçen affiliate'leri içerir; eşik altındaki bakiye devreder.
 *
 * GÜVENLİK: IBAN/vergi no yalnız admin'e (assertAdmin) döner ve bu yanıt
 * ekranda gösterilmez — dosya olarak indirilir.
 */
export const adminExportAffiliatePayoutCsv = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AffiliatePayoutCsvExport> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const generatedAt = new Date().toISOString();

    const [affRes, summaryRes] = await Promise.all([
      supabaseAdmin
        .from("affiliates")
        .select(
          "user_id, payout_method, payout_account_holder, payout_iban, payout_wise_email, payout_tax_id",
        )
        .order("created_at", { ascending: false })
        .limit(500),
      supabaseAdmin.rpc("affiliate_payout_summary"),
    ]);

    const affiliates = (affRes.data ?? []) as unknown as Array<
      Record<string, unknown> & { user_id: string }
    >;
    if (affiliates.length === 0) {
      return {
        csv: buildPayoutRunCsv([], { generatedAt }),
        generatedAt,
        ...payoutRunSummary([]),
      };
    }

    const summaries = new Map<string, Record<string, unknown>>(
      ((summaryRes.data ?? []) as Array<Record<string, unknown> & { affiliate_id: string }>).map(
        (s) => [s.affiliate_id, s],
      ),
    );
    // Migration uygulanmamışsa ödenebilir/ beklemede alanları yoktur: o hâlde
    // ödenebilir varsaymak yerine hiçbir satırı ödenebilir saymayız.
    const summaryHasHold = ((summaryRes.data ?? []) as unknown[]).some(
      (row) => (row as Record<string, unknown>)?.payable_cents !== undefined,
    );

    const emailsRes = await supabaseAdmin
      .from("profiles")
      .select("id, email")
      .in(
        "id",
        affiliates.map((a) => a.user_id),
      );
    const emailById = new Map(
      ((emailsRes.data ?? []) as Array<{ id: string; email: string | null }>).map((p) => [
        p.id,
        p.email,
      ]),
    );

    const rows: PayoutRunRow[] = affiliates.map((a) => {
      const s = summaries.get(a.user_id) ?? {};
      const num = (key: string) => Number(s[key] ?? 0);
      const profile: PayoutProfile = {
        method: (a["payout_method"] as string | null) ?? null,
        accountHolder: (a["payout_account_holder"] as string | null) ?? null,
        iban: (a["payout_iban"] as string | null) ?? null,
        wiseEmail: (a["payout_wise_email"] as string | null) ?? null,
        taxId: (a["payout_tax_id"] as string | null) ?? null,
      };
      return {
        email: emailById.get(a.user_id) ?? null,
        method: profile.method ?? null,
        accountHolder: profile.accountHolder ?? null,
        iban: profile.iban ?? null,
        wiseEmail: profile.wiseEmail ?? null,
        taxId: profile.taxId ?? null,
        payableCents: summaryHasHold ? num("payable_cents") : 0,
        payableCount: summaryHasHold ? num("payable_count") : 0,
        oldestPayableAt: (s["oldest_payable_at"] as string | null) ?? null,
        missing: payoutProfileState(profile).missing,
      };
    });

    const summary = payoutRunSummary(rows);
    return {
      csv: buildPayoutRunCsv(rows, { generatedAt }),
      generatedAt,
      ...summary,
    };
  });

const MarkPaidInput = z.object({
  userId: z.string().uuid(),
  method: z.enum(["wise", "iban", "other"]),
  reference: z.string().trim().max(120).optional(),
});

/**
 * Bir affiliate'in TÜM bekleyen komisyonlarını "ödendi" işaretler.
 * Ödeme eşiği ($75) veritabanında da zorlanır: eşiğin altındaysa 409 döner.
 */
export const adminMarkAffiliatePaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => MarkPaidInput.parse(i))
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      ok: true;
      paid_cents: number;
      paid_count: number;
      reference: string;
      /** "Ödemen yapıldı" bildirimi gönderildi mi? (gönderilemediyse admin uyarılır) */
      notified: boolean;
    }> => {
      await assertAdmin(context);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      // ÖN KOŞUL: ödeme bilgisi kayıtlı olmalı. IBAN/Wise hedefi olmadan
      // "ödendi işaretle" demek, kaydı tutarsız bırakır (para nereye gitti?).
      const { data: affiliateRow, error: readError } = await supabaseAdmin
        .from("affiliates")
        .select(
          "payout_method, payout_account_holder, payout_iban, payout_wise_email, payout_tax_id",
        )
        .eq("user_id", data.userId)
        .maybeSingle();
      if (readError) throw new Error(readError.message);
      if (!affiliateRow) throw forbidden();

      const payoutState = payoutProfileState({
        method: (affiliateRow.payout_method as string | null) ?? data.method,
        accountHolder: (affiliateRow.payout_account_holder as string | null) ?? null,
        iban: (affiliateRow.payout_iban as string | null) ?? null,
        wiseEmail: (affiliateRow.payout_wise_email as string | null) ?? null,
        taxId: (affiliateRow.payout_tax_id as string | null) ?? null,
      });
      if (!payoutState.ready) {
        const missingError = new Error(
          `Önce ödeme bilgisini kaydet — eksik: ${payoutState.missing.join(", ")}.`,
        ) as Error & { statusCode: number };
        missingError.statusCode = 409;
        throw missingError;
      }

      // Referans verilmediyse partiyi tek bir dekont no ile etiketle.
      const reference =
        data.reference?.trim() ||
        `PAY-${new Date()
          .toISOString()
          .replace(/[-:.TZ]/g, "")
          .slice(0, 14)}`;

      const { data: result, error } = await supabaseAdmin.rpc("admin_mark_affiliate_paid", {
        _admin_id: context.userId,
        _affiliate_id: data.userId,
        _method: data.method,
        _reference: reference,
      });
      if (error) {
        if (/hold_not_elapsed/i.test(error.message)) {
          // Toplam birikim yeterli ama komisyonlar henüz 30 günlük bekleme
          // süresini doldurmadı: iade riski kapanmadan ödeme yapılmaz.
          const err = new Error(
            `Bekleme süresi dolmadı: komisyonlar ödemeden önce ${PAYOUT_HOLD_DAYS} gün bekler. ` +
              `Panelde "beklemede" görünen tutar süresi dolunca ödenebilir olur.`,
          ) as Error & { statusCode: number };
          err.statusCode = 409;
          throw err;
        }
        if (/below_threshold/i.test(error.message)) {
          const err = new Error(
            `Ödeme eşiği: ödenebilir komisyon en az $${MIN_PAYOUT_CENTS / 100} olmalı.`,
          ) as Error & { statusCode: number };
          err.statusCode = 409;
          throw err;
        }
        if (/forbidden/i.test(error.message)) throw forbidden();
        throw new Error(error.message);
      }
      const row = (Array.isArray(result) ? result[0] : result) as {
        paid_cents: number;
        paid_count: number;
      } | null;
      const paidCents = Number(row?.paid_cents ?? 0);
      const paidCount = Number(row?.paid_count ?? 0);

      // ÖDEME BİLDİRİMİ — "para gerçekten gönderildi mi?" sorusu programın en
      // kritik güven anıdır; affiliate panele bakmadığı sürece bunu göremez.
      //
      // SIRA ÖNEMLİ: e-posta, RPC başarılı olduktan SONRA gönderilir ve hatası
      // yukarı fırlatılmaz. Bildirimi kaydın ön koşulu yapmak, kayıtlı bir
      // ödemeyi e-posta servisi yüzünden "başarısız" gösterirdi; burada para
      // kaydı esastır, bildirim onun ardından gelen bir yan etkidir.
      let notified = false;
      try {
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("email")
          .eq("id", data.userId)
          .maybeSingle();
        const to = ((profile as { email?: string | null } | null)?.email ?? "").trim();
        if (!to) {
          console.warn("[affiliate] ödeme bildirimi atlandı: profil e-postası yok");
        } else {
          // Beklemede kalan birikim: ödemenin "tamamı" olmadığını affiliate
          // kendi görebilsin (aksi hâlde sonraki ödeme sürpriz olur).
          let heldCents: number | undefined;
          try {
            const { data: summary } = await supabaseAdmin.rpc("affiliate_payout_summary");
            const summaryRow = ((summary ?? []) as Array<Record<string, unknown>>).find(
              (r) => r["affiliate_id"] === data.userId,
            );
            if (summaryRow) heldCents = Number(summaryRow["held_cents"] ?? 0);
          } catch {
            /* bakiye okunamazsa bildirim yine gider (tutar ve referans esas) */
          }
          const { sendAffiliatePayoutEmail } = await import("@/lib/email-service");
          const outcome = await sendAffiliatePayoutEmail(to, {
            paidCents,
            paidCount,
            method: data.method,
            reference,
            ...(heldCents === undefined ? {} : { heldCents }),
          });
          notified = outcome.sent;
          if (!outcome.sent) {
            console.warn(`[affiliate] ödeme bildirimi gönderilemedi: ${outcome.reason}`);
          }
        }
      } catch (e) {
        console.error("[affiliate] ödeme bildirimi hatası", e);
      }

      return {
        ok: true,
        paid_cents: paidCents,
        paid_count: paidCount,
        reference,
        notified,
      };
    },
  );

const ReverseCommissionInput = z.object({
  commissionId: z.string().uuid(),
  reason: z.string().trim().max(200).optional(),
});

/** Admin: tek bir komisyon satırını mahsup et (iade/chargeback/düzeltme). */
export const adminReverseCommission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ReverseCommissionInput.parse(i))
  .handler(async ({ data, context }): Promise<{ ok: boolean; result: string }> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await supabaseAdmin.rpc("admin_reverse_commission", {
      _admin_id: context.userId,
      _commission_id: data.commissionId,
      _reason: data.reason ?? "manual",
    });
    if (error) {
      if (/forbidden/i.test(error.message)) throw forbidden();
      throw new Error(error.message);
    }
    return { ok: String(result) === "ok", result: String(result) };
  });

const PayoutDetailsInput = z.object({
  userId: z.string().uuid(),
  method: z.enum(["wise", "iban", "other"]).nullable(),
  /**
   * Alanlar İSTEĞE BAĞLIdır ve `undefined` "DOKUNMA" demektir.
   *
   * NEDEN: admin bir satırı açıp yalnız Wise e-postasını düzeltseydi, boş
   * gönderilen IBAN silinirdi. Ödeme verisini sessizce silmek, para nereye
   * gitti sorusunu yanıtsız bırakır; bu yüzden yalnız GÖNDERİLEN alan yazılır.
   */
  note: z.string().trim().max(500).nullable().optional(),
  accountHolder: z.string().trim().max(160).nullable().optional(),
  iban: z.string().trim().max(64).nullable().optional(),
  wiseEmail: z.string().trim().max(200).nullable().optional(),
  taxId: z.string().trim().max(64).nullable().optional(),
});

/**
 * Admin: influencer'ın ödeme bilgisini kaydeder.
 *
 * DOĞRULAMA: IBAN mod-97 ile kontrol edilir. Yanlış yazılmış bir IBAN bankada
 * reddedilir ama sistemde geçerli görünür; bu yüzden kaydetmeden ÖNCE reddedilir
 * ve admin'e hangi alanın bozuk olduğu söylenir.
 */
export const adminUpdateAffiliatePayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => PayoutDetailsInput.parse(i))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ ok: true; state: { ready: boolean; missing: string[] } }> => {
      await assertAdmin(context);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      if (data.iban && !isValidIban(data.iban)) {
        const err = new Error(
          "IBAN geçersiz (mod-97 kontrolü başarısız). Kontrol edip tekrar dene.",
        ) as Error & {
          statusCode: number;
        };
        err.statusCode = 400;
        throw err;
      }

      // Yalnız GÖNDERİLEN alanlar yazılır (`undefined` → dokunma).
      const patch: Record<string, unknown> = { payout_method: data.method };
      if (data.note !== undefined) patch.payout_note = data.note;
      if (data.accountHolder !== undefined) patch.payout_account_holder = data.accountHolder;
      if (data.iban !== undefined)
        patch.payout_iban = data.iban ? data.iban.replace(/\s+/g, "").toUpperCase() : null;
      if (data.wiseEmail !== undefined) patch.payout_wise_email = data.wiseEmail;
      if (data.taxId !== undefined) patch.payout_tax_id = data.taxId;

      const { error } = await supabaseAdmin
        .from("affiliates")
        .update(patch as never)
        .eq("user_id", data.userId);
      if (error) {
        // Migration uygulanmadıysa yeni kolonlar yoktur: eski davranışa düş.
        if (/column|schema cache/i.test(error.message)) {
          const { error: fallback } = await supabaseAdmin
            .from("affiliates")
            .update({ payout_method: data.method, payout_note: data.note ?? null } as never)
            .eq("user_id", data.userId);
          if (fallback) throw new Error(fallback.message);
          return {
            ok: true,
            state: payoutProfileState({
              method: data.method,
              note: data.note ?? null,
            } as PayoutProfile),
          };
        }
        throw new Error(error.message);
      }

      // Kaydettikten SONRA güncel durumu oku: gönderilmeyen alanların gerçek
      // değeri ancak böyle bilinir (aksi hâlde "hazır" yanlış hesaplanır).
      const { data: after } = await supabaseAdmin
        .from("affiliates")
        .select(
          "payout_method, payout_account_holder, payout_iban, payout_wise_email, payout_tax_id",
        )
        .eq("user_id", data.userId)
        .maybeSingle();
      const saved = (after ?? {}) as unknown as Record<string, unknown>;
      return {
        ok: true,
        state: payoutProfileState({
          method: (saved["payout_method"] as string | null) ?? data.method,
          accountHolder: (saved["payout_account_holder"] as string | null) ?? null,
          iban: (saved["payout_iban"] as string | null) ?? null,
          wiseEmail: (saved["payout_wise_email"] as string | null) ?? null,
          taxId: (saved["payout_tax_id"] as string | null) ?? null,
        }),
      };
    },
  );
