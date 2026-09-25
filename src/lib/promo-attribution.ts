/**
 * Promosyon kodu → kullanıcı → paket ilişkisinin saf (I/O'suz) kuralları.
 *
 * Admin paneli iki soruyu yanıtlamak zorunda:
 *   1. Bu kullanıcı hangi promosyon kodundan geldi?
 *   2. Bu kullanıcı hangi planı / paketleri aldı, ne kadar ciro yaptı?
 *
 * Ham satırlar (promo_redemptions + profiles + transactions) burada tek bir
 * tabloya indirgenir. Saf fonksiyonlar sayesinde DB olmadan birim testi
 * yazılabilir ve hem "Kullanıcı bazlı" tablo hem de kod bazlı özet aynı
 * sayılardan beslenir (iki ekran birbirinden asla ayrışmaz).
 */

/** promo_redemptions tablosundan gelen ham satır. */
export type PromoRedemptionRow = {
  code: string | null;
  user_id: string;
  email: string | null;
  signed_up_at: string | null;
  purchased_tier: string | null;
  purchased_at: string | null;
  amount_cents?: number | null;
};

/** profiles tablosundan gelen ham satır. */
export type PromoProfileRow = {
  id: string;
  email: string | null;
  subscription_tier: string | null;
  subscription_status: string | null;
};

/** transactions tablosundan gelen ham satır. */
export type PromoTransactionRow = {
  user_id: string | null;
  tier: string | null;
  amount_cents: number | null;
  created_at: string;
};

/** Admin "Kullanıcı bazlı promo & plan" tablosunun tek satırı. */
export type AdminPromoUser = {
  user_id: string;
  email: string;
  /** Kullanıcının kaydolurken kullandığı promosyon kodu. */
  code: string;
  signed_up_at: string | null;
  /** Ödeme anında koda bağlanan paket (varsa). */
  purchased_tier: string | null;
  purchased_at: string | null;
  /** transactions'tan türetilen, kullanıcının aldığı TÜM paketler ( kronolojik). */
  plans: string[];
  /** Kullanıcının toplam ödediği tutar (minör birim). */
  revenue_cents: number;
  first_purchase_at: string | null;
  /** Profildeki güncel paket. */
  current_tier: string;
  subscription_status: string;
  /** Promo kodundan gelip herhangi bir ödeme yapan kullanıcı. */
  converted: boolean;
  /** Ödeme yapan ama henüz pakete yansıtılmamış kullanıcı (veri tutarsızlığı). */
  pending_activation: boolean;
};

/** Kod bazlı özet (admin promo tablosundaki sütunlar). */
export type PromoCodeStat = {
  code: string;
  discount_pct: number;
  signups: number;
  purchases: number;
  revenue_cents: number;
  by_tier: Record<string, number>;
};

const normalizeCode = (value: string | null | undefined): string =>
  String(value ?? "")
    .trim()
    .toUpperCase();

const normalizeTier = (value: string | null | undefined): string | null => {
  const t = String(value ?? "").trim();
  return t.length > 0 ? t : null;
};

const earliest = (a: string, b: string): string => (a <= b ? a : b);

/**
 * Ham satırları kullanıcı bazlı promo kayıtlarına çevirir.
 *
 * - Kodsuz (boş/boşluk) redemptions atlanır.
 * - Aynı kullanıcı birden fazla kodla görünüyorsa en eski kayıt esas alınır
 *   (promo_redemptions.user_id UNIQUE olduğu için normalde tek satır olur).
 * - Ciro yalnızca `amount_cents > 0` olan gerçek ödemelerden toplanır; 0
 *   tutarlı admin paket tanımlamaları "harcama" sayılmaz.
 */
export function buildAdminPromoUsers(
  redemptions: PromoRedemptionRow[],
  profiles: PromoProfileRow[],
  transactions: PromoTransactionRow[],
): AdminPromoUser[] {
  const profileById = new Map(profiles.map((p) => [p.id, p]));

  // Kullanıcı bazında ödeme özeti: paketler (sıra korumalı) + ciro + ilk ödeme.
  const paidByUser = new Map<
    string,
    { plans: string[]; revenue: number; firstAt: string | null }
  >();
  for (const tx of transactions) {
    const uid = tx.user_id;
    if (!uid) continue;
    const amount = tx.amount_cents ?? 0;
    if (amount <= 0) continue;
    const entry = paidByUser.get(uid) ?? { plans: [], revenue: 0, firstAt: null };
    entry.revenue += amount;
    const tier = normalizeTier(tx.tier);
    if (tier && !entry.plans.includes(tier)) entry.plans.push(tier);
    entry.firstAt = entry.firstAt ? earliest(entry.firstAt, tx.created_at) : tx.created_at;
    paidByUser.set(uid, entry);
  }

  const byUser = new Map<string, AdminPromoUser>();
  for (const r of redemptions) {
    const code = normalizeCode(r.code);
    if (!code || !r.user_id) continue;
    const existing = byUser.get(r.user_id);
    if (existing) {
      // Aynı kullanıcı birden fazla satırda görünüyorsa en eski kaydı koru.
      if (r.signed_up_at && (!existing.signed_up_at || r.signed_up_at < existing.signed_up_at)) {
        existing.signed_up_at = r.signed_up_at;
        existing.code = code;
      }
      continue;
    }
    byUser.set(r.user_id, {
      user_id: r.user_id,
      email: "",
      code,
      signed_up_at: r.signed_up_at ?? null,
      purchased_tier: normalizeTier(r.purchased_tier),
      purchased_at: r.purchased_at ?? null,
      plans: [],
      revenue_cents: 0,
      first_purchase_at: null,
      current_tier: "Free",
      subscription_status: "inactive",
      converted: false,
      pending_activation: false,
    });
  }

  for (const user of byUser.values()) {
    const profile = profileById.get(user.user_id);
    const paid = paidByUser.get(user.user_id);

    user.email = profile?.email ?? "";
    if (user.purchased_tier) user.plans.push(user.purchased_tier);
    if (paid) {
      for (const plan of paid.plans) if (!user.plans.includes(plan)) user.plans.push(plan);
      user.revenue_cents = paid.revenue;
      user.first_purchase_at = paid.firstAt;
    }

    const profileTier = normalizeTier(profile?.subscription_tier);
    user.current_tier = profileTier ?? user.purchased_tier ?? "Free";
    user.subscription_status = profile?.subscription_status?.trim() || "inactive";

    user.converted = user.revenue_cents > 0 || !!user.purchased_tier;
    // Ödeme var ama profilde hâlâ ücretsiz görünüyor → admin'in fark etmesi gerekir.
    user.pending_activation = user.revenue_cents > 0 && user.current_tier === "Free";
  }

  // Profil e-postası yoksa redemptions e-postasına düş.
  const emailByUser = new Map<string, string>();
  for (const r of redemptions) {
    const mail = r.email?.trim();
    if (mail && r.user_id && !emailByUser.has(r.user_id)) emailByUser.set(r.user_id, mail);
  }

  const rows = Array.from(byUser.values());
  for (const row of rows) if (!row.email) row.email = emailByUser.get(row.user_id) ?? "—";

  // En yeni kayıtlar önce; aynı tarihte kod eşitliğinde sabit sıra.
  return rows.sort(
    (a, b) =>
      (b.signed_up_at ?? "").localeCompare(a.signed_up_at ?? "") || a.code.localeCompare(b.code),
  );
}

/**
 * Kullanıcı bazlı satırları kod bazlı özete indirger. Satır sayımı
 * "Kaydolan" (her kullanıcı bir kayıt) ve "Alınan paketler" (her satır bir
 * kullanıcının paketleri) toplamlarıdır; ciro yalnızca gerçek ödemeleri
 * içerir. `allCodes` verilirse hiç kullanılmamış kodlar da 0 değerleriyle
 * listeye dahil edilir.
 */
export function summarizePromoByCode(
  users: AdminPromoUser[],
  options: { allCodes?: string[]; discountByCode?: Record<string, number> } = {},
): PromoCodeStat[] {
  const discountByCode = options.discountByCode ?? {};
  const map = new Map<string, PromoCodeStat>();
  // Henüz kimse kullanmamış kodlar da tabloda görünsün (0 kayıt).
  for (const code of options.allCodes ?? []) {
    const key = normalizeCode(code);
    if (!key || map.has(key)) continue;
    map.set(key, {
      code: key,
      discount_pct: discountByCode[key] ?? 0,
      signups: 0,
      purchases: 0,
      revenue_cents: 0,
      by_tier: {},
    });
  }
  const ensure = (code: string): PromoCodeStat => {
    const key = normalizeCode(code);
    const stat = map.get(key) ?? {
      code: key,
      discount_pct: discountByCode[key] ?? 0,
      signups: 0,
      purchases: 0,
      revenue_cents: 0,
      by_tier: {},
    };
    map.set(key, stat);
    return stat;
  };

  for (const user of users) {
    const stat = ensure(user.code);
    stat.signups += 1;
    if (user.converted) stat.purchases += 1;
    stat.revenue_cents += user.revenue_cents;
    for (const plan of user.plans) stat.by_tier[plan] = (stat.by_tier[plan] ?? 0) + 1;
  }

  return Array.from(map.values()).sort(
    (a, b) => b.signups - a.signups || a.code.localeCompare(b.code),
  );
}
