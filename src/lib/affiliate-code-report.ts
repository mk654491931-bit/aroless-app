/**
 * AFFILIATE KOD RAPORU (saf katman — DB/React yok).
 *
 * Admin'in tek ekranda yanıtlaması gereken iki soru:
 *   1. Hangi affiliate kodu kaç ABONELİK getirdi? (`promo_redemptions` →
 *      ödeme yapan kullanıcı = abonelik)
 *   2. O koda/affiliate'e ne kadar ÖDENEBİLİR bakiye birikti?
 *
 * İKİ AYRI KAYNAK, İKİ FARKLI TANE:
 *   • Abonelik sayısı KOD bazlıdır (kullanıcının kaydolurken kullandığı kod).
 *   • Ödenebilir bakiye HESAP bazlıdır (`affiliate_commissions`), kod bazlı
 *     değildir: bir affiliate'in iki kodu varsa komisyonlar tek hesaba yazılır.
 *
 * Bu yüzden bakiye, affiliate'in kodlarından YALNIZ BİR satırda gösterilir
 * (`balance_owned`); diğer satırlar bakiyeyi tekrar yazmaz, "aynı hesapta"
 * olarak işaretlenir. Aksi hâlde toplam ödenecek tutar iki kez sayılır ve
 * admin olmayan bir parayı ödemeye çalışırdı.
 *
 * Kodu olmayan affiliate (bakiye birikmiş ama kod verilmemiş) da rapora girer:
 * aksi hâlde borçlu olduğumuz para ekranda hiç görünmezdi.
 */

const normalizeCode = (value: string | null | undefined): string =>
  String(value ?? "")
    .trim()
    .toUpperCase();

const num = (value: unknown): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** `summarizePromoByCode` çıktısının bu raporun ihtiyaç duyduğu alanları. */
export type CodeAttributionStat = {
  code: string;
  /** Kodu kullanan kayıtlı kullanıcı sayısı. */
  signups: number;
  /** Ödeme yapan (abonelik alan) kullanıcı sayısı. */
  subscriptions: number;
  revenue_cents: number;
  by_tier?: Record<string, number>;
};

/** Affiliate hesabının ödeme özeti (bakiye HESAP bazlıdır). */
export type AffiliateBalance = {
  user_id: string;
  email: string | null;
  status: string;
  commission_rate_pct: number;
  /** Bekleme süresi dolmuş, ödenebilir birikim. */
  payable_cents: number;
  /** Henüz bekleme süresi dolmamış birikim. */
  held_cents: number;
  paid_cents: number;
  /** Ödenebilir bakiye eşiği ($75) geçti mi? */
  eligible: boolean;
  remaining_cents: number;
  payout_missing: string[];
  /** Affiliate'in sahip olduğu kodlar (sahipsiz kodlar burada yer almaz). */
  codes: string[];
};

export type AffiliateCodeReportRow = {
  /** Kod; affiliate'e kod verilmemişse null. */
  code: string | null;
  affiliate_id: string | null;
  affiliate_email: string | null;
  affiliate_status: string | null;
  commission_rate_pct: number | null;
  signups: number;
  /** Ödeme yapan kullanıcı = "abonelik". */
  subscriptions: number;
  conversion_pct: number;
  revenue_cents: number;
  by_tier: Array<{ tier: string; users: number }>;
  /**
   * ÖDENEBİLİR bakiye — yalnız affiliate'in İLK satırında dolu; aynı hesabın
   * diğer kod satırlarında 0 ve `balance_owned = false` (çift sayım yok).
   */
  payable_cents: number;
  held_cents: number;
  paid_cents: number;
  eligible: boolean;
  remaining_cents: number;
  payout_missing: string[];
  /** Bakiye bu satırda mı gösteriliyor? */
  balance_owned: boolean;
};

export type AffiliateCodeReportTotals = {
  /** Raporda listelenen kod sayısı (kodsuz affiliate satırları hariç). */
  codes: number;
  /** Bakiyesi olan affiliate hesabı sayısı. */
  affiliates: number;
  signups: number;
  subscriptions: number;
  revenue_cents: number;
  /** Ödenebilir toplam — çift sayılmaz (yalnız `balance_owned` satırlar). */
  payable_cents: number;
  held_cents: number;
  paid_cents: number;
  /** Ödemeye hazır (eşiği geçmiş) hesap sayısı. */
  payable_affiliates: number;
  /** Hiçbir affiliate'e bağlı olmayan kodlar (abonelik getirir, komisyon doğurmaz). */
  unlinked_codes: number;
  /** Bakiyesi aynı affiliate'in başka satırında gösterilen kod sayısı. */
  shared_balance_codes: number;
};

export type AffiliateCodeReport = {
  rows: AffiliateCodeReportRow[];
  totals: AffiliateCodeReportTotals;
};

type Group = {
  key: string;
  affiliate: AffiliateBalance | null;
  codes: string[];
};

const emptyStat = (code: string): CodeAttributionStat => ({
  code,
  signups: 0,
  subscriptions: 0,
  revenue_cents: 0,
  by_tier: {},
});

/**
 * Kod bazlı atıf istatistikleri ile hesap bazlı bakiyeleri TEK satır listesinde
 * birleştirir. Saf fonksiyon: DB olmadan test edilebilir, bu yüzden "iki ekran
 * ayrışmasın" kuralı burada kilitlenir.
 */
export function buildAffiliateCodeReport(input: {
  stats: readonly CodeAttributionStat[];
  affiliates: readonly AffiliateBalance[];
  /** `promo_codes` tablosundaki TÜM kodlar — hiç kullanılmamışlar 0 ile görünür. */
  allCodes?: readonly string[];
}): AffiliateCodeReport {
  const statByCode = new Map<string, CodeAttributionStat>();
  for (const raw of input.allCodes ?? []) {
    const code = normalizeCode(raw);
    if (code && !statByCode.has(code)) statByCode.set(code, emptyStat(code));
  }
  for (const s of input.stats) {
    const code = normalizeCode(s.code);
    if (!code) continue;
    statByCode.set(code, {
      code,
      signups: num(s.signups),
      subscriptions: num(s.subscriptions),
      revenue_cents: num(s.revenue_cents),
      by_tier: s.by_tier ?? {},
    });
  }

  // Affiliate başına gruplar: kodu olmayan affiliate de grup olarak durur.
  const groups = new Map<string, Group>();
  for (const a of input.affiliates) {
    const codes = Array.from(new Set(a.codes.map(normalizeCode).filter((c) => c.length > 0)));
    // Grup anahtarı affiliate_id'dir; sahipsiz kodlar `code:` önekiyle ayrılır.
    groups.set(a.user_id, { key: a.user_id, affiliate: a, codes });
  }
  for (const code of statByCode.keys()) {
    const owner = input.affiliates.find((a) => a.codes.some((c) => normalizeCode(c) === code));
    if (owner) continue;
    groups.set(`code:${code}`, { key: `code:${code}`, affiliate: null, codes: [code] });
  }

  const subsOf = (code: string) => statByCode.get(code)?.subscriptions ?? 0;
  const groupSubs = (g: Group) => g.codes.reduce((sum, c) => sum + subsOf(c), 0);

  // Sıra: en çok ödenecek para önce, sonra en çok abonelik. Bakiyesi olmayan
  // kodlar böylece listenin sonuna düşer ama hiçbir satır gizlenmez.
  const ordered = Array.from(groups.values()).sort(
    (a, b) =>
      (b.affiliate?.payable_cents ?? 0) - (a.affiliate?.payable_cents ?? 0) ||
      groupSubs(b) - groupSubs(a) ||
      a.key.localeCompare(b.key),
  );

  const rows: AffiliateCodeReportRow[] = [];
  for (const g of ordered) {
    const affiliate = g.affiliate;
    const codes = [...g.codes].sort((a, b) => subsOf(b) - subsOf(a) || a.localeCompare(b));
    const balanceOwned = affiliate !== null;
    const build = (code: string | null, ownsBalance: boolean): AffiliateCodeReportRow => {
      const stat = code ? (statByCode.get(code) ?? emptyStat(code)) : emptyStat("");
      const signups = stat.signups;
      const subscriptions = stat.subscriptions;
      const byTier = Object.entries(stat.by_tier ?? {})
        .map(([tier, users]) => ({ tier, users: num(users) }))
        .filter((t) => t.users > 0)
        .sort((a, b) => b.users - a.users || a.tier.localeCompare(b.tier));
      return {
        code,
        affiliate_id: affiliate?.user_id ?? null,
        affiliate_email: affiliate?.email ?? null,
        affiliate_status: affiliate?.status ?? null,
        commission_rate_pct: affiliate ? affiliate.commission_rate_pct : null,
        signups,
        subscriptions,
        conversion_pct: signups === 0 ? 0 : Math.round((subscriptions / signups) * 100),
        revenue_cents: stat.revenue_cents,
        by_tier: byTier,
        payable_cents: ownsBalance ? num(affiliate?.payable_cents) : 0,
        held_cents: ownsBalance ? num(affiliate?.held_cents) : 0,
        paid_cents: ownsBalance ? num(affiliate?.paid_cents) : 0,
        eligible: ownsBalance ? Boolean(affiliate?.eligible) : false,
        remaining_cents: ownsBalance ? num(affiliate?.remaining_cents) : 0,
        payout_missing: ownsBalance ? (affiliate?.payout_missing ?? []) : [],
        balance_owned: ownsBalance,
      };
    };

    if (codes.length === 0) {
      // Bakiye var, kod yok: satır yine görünür, aksi hâlde borç gizlenirdi.
      rows.push(build(null, balanceOwned));
      continue;
    }
    codes.forEach((code, index) => rows.push(build(code, balanceOwned && index === 0)));
  }

  const sumBy = (pick: (r: AffiliateCodeReportRow) => number) =>
    rows.reduce((total, r) => total + pick(r), 0);
  const owned = rows.filter((r) => r.balance_owned);

  return {
    rows,
    totals: {
      codes: rows.filter((r) => r.code !== null).length,
      affiliates: new Set(rows.map((r) => r.affiliate_id).filter(Boolean)).size,
      signups: sumBy((r) => r.signups),
      subscriptions: sumBy((r) => r.subscriptions),
      revenue_cents: sumBy((r) => r.revenue_cents),
      payable_cents: owned.reduce((t, r) => t + r.payable_cents, 0),
      held_cents: owned.reduce((t, r) => t + r.held_cents, 0),
      paid_cents: owned.reduce((t, r) => t + r.paid_cents, 0),
      payable_affiliates: owned.filter((r) => r.eligible).length,
      unlinked_codes: rows.filter((r) => r.code !== null && !r.affiliate_id).length,
      shared_balance_codes: rows.filter(
        (r) => r.code !== null && r.affiliate_id && !r.balance_owned,
      ).length,
    },
  };
}
