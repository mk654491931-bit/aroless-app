/**
 * AYARLAR → ABONELİK: "Aboneliği iptal et" akışının SAF (istemci-güvenli) kararı.
 *
 * ÜRÜN KURALI: iptal, dönem SONUNDA yürürlüğe girer.
 *   • Bu ay için ödenen ücret İADE EDİLMEZ.
 *   • Gelecek ay tahsilat YAPILMAZ.
 *   • Kullanıcı dönem sonuna kadar paketin tüm özelliklerini kullanmaya devam eder.
 *
 * Bu dosya ağ/DB'ye dokunmaz; sunucu tarafındaki gerçek çağrı
 * `paddle-cancel.server.ts` içindedir. Ayrı tutuldu çünkü aynı karar hem
 * düğmenin görünürlüğünü hem de "durum" metnini belirler ve test edilebilir
 * olması gerekir.
 */

/** Abonelik defteri satırından yalnız arayüzün ihtiyaç duyduğu alanlar. */
export type SubscriptionLedgerRowView = {
  paddle_subscription_id: string | null;
  status: string | null;
  tier: string | null;
  cancel_at_period_end: boolean | null;
  current_period_end: string | null;
  next_billed_at: string | null;
  updated_at: string | null;
};

/** Ayarlar kartının okuduğu birleşik görünüm (profil aynası + abonelik defteri). */
export type MySubscriptionView = {
  tier: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  nextBilledAt: string | null;
  subscriptionId: string | null;
};

/**
 * Profil aynası ile abonelik defterini birleştirir (SAF).
 *
 * İKİ TUZAK KAPATILIR:
 *  1. Profilde kayıtlı bir abonelik kimliği varsa YALNIZ o satır kullanılır;
 *     daha yeni tarihli BAŞKA bir aboneliğin "iptal edildi" bayrağı canlı
 *     aboneliğe taşınmaz.
 *  2. Defter satırı yoksa (webhook hiç yazmamış) tarihler profil aynasından
 *     gelir; uydurma tarih/bayrak basılmaz.
 */
export function mySubscriptionView(
  profile: {
    subscription_tier?: string | null;
    subscription_status?: string | null;
    current_period_end?: string | null;
    next_billed_at?: string | null;
    paddle_subscription_id?: string | null;
  } | null,
  rows: SubscriptionLedgerRowView[] | null | undefined,
): MySubscriptionView {
  const profileSubId = profile?.paddle_subscription_id ?? null;
  const list = rows ?? [];
  const matched = profileSubId
    ? list.find((row) => row.paddle_subscription_id === profileSubId)
    : undefined;
  // Profil bir abonelik işaret ediyorsa eşleşmeyen satıra DÜŞÜLMEZ.
  const row = matched ?? (profileSubId ? null : (list[0] ?? null));

  return {
    tier: profile?.subscription_tier ?? row?.tier ?? "Free",
    status: profile?.subscription_status ?? row?.status ?? "none",
    // Eşleşen satır yoksa `iptal edildi` DENMEZ.
    cancelAtPeriodEnd: Boolean(row?.cancel_at_period_end),
    currentPeriodEnd: row?.current_period_end ?? profile?.current_period_end ?? null,
    nextBilledAt: row?.next_billed_at ?? profile?.next_billed_at ?? null,
    subscriptionId: profileSubId ?? row?.paddle_subscription_id ?? null,
  };
}

export type SubscriptionCancelState =
  "free" | "active" | "scheduled" | "past_due" | "ended" | "unknown";

export type SubscriptionCancelView = {
  state: SubscriptionCancelState;
  /** "Aboneliği iptal et" düğmesi gösterilsin mi? */
  canCancel: boolean;
  /** İptal planlandı mı (dönem sonunda yenilenmeyecek)? */
  cancelScheduled: boolean;
  /** Erişimin bittiği / sıradaki tahsilatın tarihi (ISO). */
  endsAt: string | null;
};

const PAID_TIERS = new Set(["starter", "pro", "business"]);
/** Bu durumlarda abonelik artık yenilenmez; iptal düğmesi anlamsızdır. */
const ENDED_STATUSES = new Set(["canceled", "cancelled", "ended", "expired"]);

function normalize(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/** Tier ücretli bir paket mi? (`Free`/boş → false) */
export function isPaidTier(tier: string | null | undefined): boolean {
  return PAID_TIERS.has(normalize(tier));
}

/**
 * Profil + abonelik defterinden kartın durumunu üretir.
 *
 * `status` boş/"none" ama tier ücretli olabilir (eski kayıtlar): bu durumda
 * hesap AKTİF sayılır ve iptal denenebilir — Paddle'da abonelik yoksa sunucu
 * dürüstçe `no_live_subscription` döner, düğme sahte bir "başarı" göstermez.
 */
export function subscriptionCancelView(input: {
  tier?: string | null;
  status?: string | null;
  cancelAtPeriodEnd?: boolean | null;
  currentPeriodEnd?: string | null;
}): SubscriptionCancelView {
  const tier = normalize(input.tier);
  const status = normalize(input.status);
  const paid = PAID_TIERS.has(tier);
  const endsAt = input.currentPeriodEnd ?? null;

  if (!paid) {
    return {
      state: ENDED_STATUSES.has(status) ? "ended" : "free",
      canCancel: false,
      cancelScheduled: false,
      endsAt,
    };
  }

  const ended = ENDED_STATUSES.has(status);
  const scheduled = Boolean(input.cancelAtPeriodEnd) && !ended;

  if (scheduled) {
    return { state: "scheduled", canCancel: false, cancelScheduled: true, endsAt };
  }
  if (ended) {
    return { state: "ended", canCancel: false, cancelScheduled: false, endsAt };
  }

  const pastDue = status === "past_due";
  return {
    state: pastDue ? "past_due" : "active",
    // `past_due` için de iptal açıktır: kullanıcı tahsilat denemelerini
    // durdurabilmelidir.
    canCancel: true,
    cancelScheduled: false,
    endsAt,
  };
}

/**
 * Tarihi okunur biçime çevirir. Geçersiz/boş değerde `null` döner — arayüz
 * uydurma bir tarih basmaz.
 */
export function formatSubscriptionEnd(iso?: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return date.toLocaleDateString("tr-TR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return date.toISOString().slice(0, 10);
  }
}
