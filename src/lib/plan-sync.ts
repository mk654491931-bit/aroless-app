/**
 * ÖDEME SONRASI PAKET TAZELEME — saf karar katmanı.
 *
 * ÖLÇÜLEN SORUN: kullanıcı ödemeyi yapıyor, uygulama bir süre (ve bazı
 * durumlarda kalıcı olarak) hâlâ "Free" gösteriyor:
 *   1. Webhook gecikir/kaçar → veritabanı gerçekten Free kalır; tazeleme
 *      (Paddle'ın kendi kaydından yazma) yalnız ödeme modalı açıkken denenirdi.
 *   2. Modal kapanınca/sayfa yenilenince bekleyen bir işaret kalmıyordu.
 *   3. Üst bar/sol bar profili 60 sn önbellekte tutuyor ve pencere odağında
 *      yenilemiyordu → paket yazılmış olsa bile ekran eski sayıyı gösteriyordu.
 *
 * ÇÖZÜM: ödeme başlatıldığında kalıcı bir "bekleyen ödeme" işareti bırakılır;
 * uygulama kabuğu bu işaret varken planı birkaç kez yoklar ve Paddle'dan
 * tazeleme ister. İşaret paket görününce silinir. Süre aşılırsa dürüstçe
 * vazgeçilir (sonsuz yoklama yok).
 */

export const PLAN_PENDING_KEY = "aroless.plan.pending";
export const PLAN_RECONCILE_KEY = "aroless.plan.reconciledAt";

/** Bekleyen işaret bu süreden eski ise artık yoklanmaz (10 dk). */
export const PLAN_PENDING_TTL_MS = 10 * 60 * 1000;

/** İki tazeleme denemesi arasındaki en kısa süre (Paddle API'si boşa yorulmasın). */
export const PLAN_RECONCILE_GAP_MS = 8_000;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function store(): StorageLike | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Ödeme başlatıldı — paket görünene kadar yoklanacak. */
export function markPlanPurchasePending(now: number = Date.now()): void {
  store()?.setItem(PLAN_PENDING_KEY, String(now));
}

/** Bekleyen ödemenin yaşı (ms) — yoksa/süresi geçmişse `null`. */
export function planPurchasePendingAge(now: number = Date.now()): number | null {
  const raw = store()?.getItem(PLAN_PENDING_KEY);
  if (!raw) return null;
  const at = Number(raw);
  if (!Number.isFinite(at) || at <= 0) return null;
  const age = now - at;
  if (age < 0 || age > PLAN_PENDING_TTL_MS) return null;
  return age;
}

export function clearPlanPurchasePending(): void {
  store()?.removeItem(PLAN_PENDING_KEY);
  store()?.removeItem(PLAN_RECONCILE_KEY);
}

/** Son tazeleme ne zaman denendi? (Yoksa `null`.) */
export function lastPlanReconcileAt(now: number = Date.now()): number | null {
  const raw = store()?.getItem(PLAN_RECONCILE_KEY);
  if (!raw) return null;
  const at = Number(raw);
  if (!Number.isFinite(at) || at <= 0 || now - at < 0) return null;
  return at;
}

export function markPlanReconcileAttempt(now: number = Date.now()): void {
  store()?.setItem(PLAN_RECONCILE_KEY, String(now));
}

/**
 * Şimdi tazeleme denenmeli mi? (SAF — test edilebilir.)
 *
 * KURALLAR:
 *   • Paket zaten ücretliyse bekleme biter (işaret temizlenir, tazeleme yok).
 *   • Bekleyen işaret yoksa hiçbir şey yapılmaz (arkada boş yere API çağrısı yok).
 *   • Aynı süreç içinde `attempts` sınırı aşılırsa durulur (sonsuz döngü yok).
 *   • İki deneme arasında `PLAN_RECONCILE_GAP_MS` kadar boşluk bırakılır.
 */
export function shouldReconcilePlan(args: {
  tier: string | null | undefined;
  pendingAgeMs: number | null;
  lastReconcileAt: number | null;
  attempts: number;
  maxAttempts?: number;
  now?: number;
}): boolean {
  const maxAttempts = args.maxAttempts ?? 4;
  if (args.pendingAgeMs === null) return false;
  if (args.attempts >= maxAttempts) return false;
  const tier = String(args.tier ?? "")
    .trim()
    .toLowerCase();
  if (tier && tier !== "free" && tier !== "null" && tier !== "undefined") return false;
  if (args.lastReconcileAt === null) return true;
  const now = args.now ?? Date.now();
  return now - args.lastReconcileAt >= PLAN_RECONCILE_GAP_MS;
}

/**
 * Bekleme sona erdi mi? (Paket göründü ya da süre/sınır doldu.)
 * `true` → işaret temizlenir, daha fazla yoklama yapılmaz.
 */
export function planPollingDone(args: {
  tier: string | null | undefined;
  pendingAgeMs: number | null;
  attempts: number;
  maxAttempts?: number;
}): boolean {
  if (args.pendingAgeMs === null) return true;
  const tier = String(args.tier ?? "")
    .trim()
    .toLowerCase();
  if (tier && tier !== "free" && tier !== "null" && tier !== "undefined") return true;
  return args.attempts >= (args.maxAttempts ?? 4);
}
