/**
 * AFFILIATE ÖDEME KURALLARI (saf katman — DB/React yok).
 *
 * Bu modül üç işi çözer ve üçü de para ile ilgili olduğu için testlerle
 * kilitlenir:
 *
 *   1. BEKLEME SÜRESİ (hold): bir komisyon ödenebilir hâle gelmeden önce
 *      N gün bekler. NEDEN: iade/chargeback ödemeden SONRA gelirse, satır
 *      `reversed` olsa bile para çoktan gönderilmiş olur ve affiliate'ten geri
 *      alınamaz. 30 günlük bekleme, iade penceresini ödemeden önce kapatır.
 *      (Paddle ayrıca kendi iade süresini uygular; bu kural bizim tarafımızdaki
 *      ikinci koruma katmanıdır.)
 *
 *   2. YAPILANDIRILMIŞ ÖDEME BİLGİSİ: yalnız serbest metin değil; yöntem,
 *      hesap sahibi, IBAN (mod-97 doğrulaması) veya Wise e-postası. Vergi
 *      numarası alanı vardır ama OPSİYONELDİR: şirket olmayan (şahıs)
 *      affiliate boş bırakabilir ve bu ödemeyi ENGELLEMEZ. Alan, bazı
 *      ülkelerde banka/Wise'ın yüksek tutarlı transferde sorduğu bilgi için
 *      tutulur; eksikse UI söyler, böylece "ödeme yapılamıyor" sürprizi
 *      yaşanmaz.
 *
 *   3. ÖDEME LİSTESİ (CSV): manuel Wise/IBAN ödemesi için tek seferde
 *      bankaya/panel'e girilecek listeyi üretir. CSV kaçış kuralları
 *      (virgül/tırnak/satır sonu) testlidir; aksi hâlde bir e-posta adresindeki
 *      virgül tüm satırı kaydırır ve YANLIŞ kişiye ödeme yapılır.
 */

import { MIN_PAYOUT_CENTS } from "./affiliate";

/** Ödeme öncesi bekleme süresi (gün). */
export const PAYOUT_HOLD_DAYS = 30;

/** Bekleme süresi (ms) — `PAYOUT_HOLD_DAYS`den türetilir. */
export const PAYOUT_HOLD_MS = PAYOUT_HOLD_DAYS * 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* 1) Komisyon satırlarını ödenebilir / beklemede / ödenmiş ayır       */
/* ------------------------------------------------------------------ */

/** Hold hesabı için gereken minimum satır alanları. */
export type CommissionRow = {
  commission_cents: number | null;
  status: string | null;
  created_at: string | null;
};

export type CommissionSplit = {
  /** Bekleme süresi dolmuş, ödenmeye hazır birikim (minor units). */
  payableCents: number;
  /** Bekleme süresi dolmamış birikim (henüz ödenmez). */
  heldCents: number;
  /** Ödenmiş toplam. */
  paidCents: number;
  payableCount: number;
  heldCount: number;
  paidCount: number;
  /** Ödenebilir satırların en eskisi (yoksa null). */
  oldestPayableAt: string | null;
  /** Beklemedeki en eski satırın tarihi (yoksa null). */
  oldestHeldAt: string | null;
};

const EMPTY_SPLIT: CommissionSplit = {
  payableCents: 0,
  heldCents: 0,
  paidCents: 0,
  payableCount: 0,
  heldCount: 0,
  paidCount: 0,
  oldestPayableAt: null,
  oldestHeldAt: null,
};

const earlier = (a: string | null, b: string): string | null => (a === null || b < a ? b : a);

/**
 * Satırları duruma ve bekleme süresine göre ayırır.
 *
 * GÜVENLİ TARAF KURALI: `created_at` okunamıyorsa satır ÖDENEBİLİR SAYILMAZ
 * (beklemede kalır). Tarihi doğrulanamayan bir komisyonu ödemek, iade riskini
 * geri getirir; eksik bilgi asla ödeme lehine yorumlanmaz.
 */
export function splitCommissionsByHold(
  rows: readonly CommissionRow[],
  opts: { now?: number; holdMs?: number } = {},
): CommissionSplit {
  const now = Number.isFinite(opts.now) ? (opts.now as number) : Date.now();
  const holdMs = Number.isFinite(opts.holdMs) ? (opts.holdMs as number) : PAYOUT_HOLD_MS;
  const split: CommissionSplit = { ...EMPTY_SPLIT };

  for (const row of rows) {
    if (row.status === "reversed") continue;
    const cents = row.commission_cents ?? 0;

    if (row.status === "paid") {
      split.paidCents += cents;
      split.paidCount += 1;
      continue;
    }

    const createdMs = row.created_at ? new Date(row.created_at).getTime() : Number.NaN;
    const knownAge = Number.isFinite(createdMs);
    const matured = knownAge && createdMs + holdMs <= now;

    if (matured) {
      split.payableCents += cents;
      split.payableCount += 1;
      if (row.created_at) split.oldestPayableAt = earlier(split.oldestPayableAt, row.created_at);
    } else {
      split.heldCents += cents;
      split.heldCount += 1;
      if (row.created_at) split.oldestHeldAt = earlier(split.oldestHeldAt, row.created_at);
    }
  }

  return split;
}

/**
 * Beklemedeki bakiyenin ne zaman ödenebilir olacağı (tahmin).
 * En eski beklemedeki satır + bekleme süresi. Panelde "şu tarihte ödenebilir"
 * demek için kullanılır; veri yoksa null.
 */
export function nextPayoutUnlockAt(
  split: Pick<CommissionSplit, "oldestHeldAt" | "heldCents">,
  opts: { holdMs?: number } = {},
): string | null {
  if (!split.oldestHeldAt || split.heldCents <= 0) return null;
  const start = new Date(split.oldestHeldAt).getTime();
  if (!Number.isFinite(start)) return null;
  return new Date(start + (opts.holdMs ?? PAYOUT_HOLD_MS)).toISOString();
}

/* ------------------------------------------------------------------ */
/* 2) Yapılandırılmış ödeme bilgisi                                    */
/* ------------------------------------------------------------------ */

export type PayoutProfile = {
  method?: string | null;
  accountHolder?: string | null;
  iban?: string | null;
  wiseEmail?: string | null;
  /**
   * OPSİYONEL vergi kimlik no. `payoutProfileState` bunu ZORUNLU alanlar
   * listesine EKLEMEZ: şirket olmayan affiliate ödeme almaya devam eder.
   */
  taxId?: string | null;
};

/** IBAN'ı karşılaştırılabilir biçime getirir (boşluk yok, büyük harf). */
export function normalizeIban(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

/** TR IBAN'ları 26, genel IBAN'lar 15-34 karakterdir. */
const IBAN_MIN = 15;
const IBAN_MAX = 34;

/**
 * IBAN doğrulaması — ISO 13616 / ISO 7064 mod-97.
 *
 * NEDEN mod-97: yanlış yazılmış TEK karakterli bir IBAN bankada reddedilir ama
 * sistemde geçerli görünür; affiliate ödeme beklerken admin "gönderdim" sanır.
 * Mod-97, yazım hatalarının tamamına yakınını yakalar.
 */
export function isValidIban(value: string | null | undefined): boolean {
  const iban = normalizeIban(value);
  if (iban.length < IBAN_MIN || iban.length > IBAN_MAX) return false;
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(iban)) return false;

  // İlk 4 karakteri sona taşı, harfleri sayıya çevir (A=10 … Z=35).
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const numeric = ch >= "0" && ch <= "9" ? ch : String(ch.charCodeAt(0) - 55);
    for (const digit of numeric) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

/** IBAN'ı ekranda/logda göstermek için maskeler (ilk 4 + son 4). */
export function maskIban(value: string | null | undefined): string {
  const iban = normalizeIban(value);
  if (iban.length <= 8) return iban ? "•".repeat(iban.length) : "";
  return `${iban.slice(0, 4)}${"•".repeat(Math.min(iban.length - 8, 16))}${iban.slice(-4)}`;
}

export type PayoutProfileState = {
  /** Zorunlu alanların tamamı dolu mu? */
  ready: boolean;
  /** Eksik/geçersiz alanların Türkçe adları. */
  missing: string[];
};

const isFilled = (v: string | null | undefined) => String(v ?? "").trim().length > 0;

/**
 * Ödeme yapılabilmesi için gereken bilgiler.
 *
 * KURAL: yöntem seçilmiş olmalı ve O YÖNTEME ait hedef bilgisi bulunmalı.
 *   `wise`    → Wise e-postası (alıcının Wise hesabı) veya IBAN
 *   `iban`    → IBAN (mod-97 doğrulaması şart)
 *   `other`   → serbest; hesap sahibi adı yeterli (banka/transfer notu elle)
 * Hesap sahibi adı her yöntemde zorunludur: alıcı kimliği olmadan yapılan
 * transfer yanlış kişiye gitme riski taşır.
 */
export function payoutProfileState(profile: PayoutProfile): PayoutProfileState {
  const missing: string[] = [];
  const method = String(profile.method ?? "")
    .trim()
    .toLowerCase();

  if (!method) missing.push("ödeme yöntemi");
  if (!isFilled(profile.accountHolder)) missing.push("hesap sahibi adı");

  if (method === "iban") {
    if (!isFilled(profile.iban)) missing.push("IBAN");
    else if (!isValidIban(profile.iban)) missing.push("geçerli IBAN (mod-97 kontrolü)");
  } else if (method === "wise") {
    if (!isFilled(profile.wiseEmail) && !isFilled(profile.iban)) {
      missing.push("Wise e-postası veya IBAN");
    } else if (isFilled(profile.iban) && !isValidIban(profile.iban)) {
      missing.push("geçerli IBAN (mod-97 kontrolü)");
    }
    if (isFilled(profile.wiseEmail) && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(profile.wiseEmail!)) {
      missing.push("geçerli Wise e-postası");
    }
  } else if (method === "other") {
    // Diğer yöntemlerde hedef bilgisi serbest; hesap sahibi adı yeterli.
  } else if (method) {
    missing.push("geçerli ödeme yöntemi (wise/iban/other)");
  }

  return { ready: missing.length === 0, missing };
}

/* ------------------------------------------------------------------ */
/* 3) Ödeme listesi (CSV)                                              */
/* ------------------------------------------------------------------ */

export type PayoutRunRow = {
  email: string | null;
  method: string | null;
  accountHolder?: string | null;
  iban?: string | null;
  wiseEmail?: string | null;
  taxId?: string | null;
  payableCents: number;
  payableCount: number;
  oldestPayableAt: string | null;
  /** Eksik ödeme bilgisi varsa nedeni (CSV'de görünür). */
  missing?: string[];
};

/** CSV alanını güvenli biçimde kaçırır (virgül/tırnak/satır sonu). */
export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Minor units → "12.34" (CSV'de sayı olarak okunabilsin). */
export function centsToDecimal(cents: number): string {
  const safe = Number.isFinite(cents) ? Math.round(cents) : 0;
  return (safe / 100).toFixed(2);
}

/** Deterministik ödeme referansı: PAY-YYYYMMDD-<e-posta yerel parçası>. */
export function payoutReference(email: string | null | undefined, isoDate: string): string {
  const day = (isoDate.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "0000-00-00").replace(/-/g, "");
  const local = String(email ?? "")
    .split("@")[0]
    ?.toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
  return `PAY-${day}-${local || "AFFILIATE"}`;
}

export const PAYOUT_CSV_HEADER = [
  "referans",
  "email",
  "yontem",
  "hesap_sahibi",
  "iban",
  "wise_email",
  // Opsiyonel: boş bırakılmışsa sütun boş gelir (ödeme engellenmez).
  "vergi_no",
  "odenecek_usd",
  "komisyon_sayisi",
  "en_eski_komisyon",
  "eksik_bilgi",
] as const;

/**
 * Ödenecek affiliate'ler için CSV üretir.
 *
 * KURALLAR: yalnız `payableCents >= minPayoutCents` ve `payableCount > 0` olan
 * satırlar girer (eşiğin altındaki bakiye devreder). Ödeme bilgisi eksikse satır
 * ATILMAZ ama `eksik_bilgi` sütununda nedeni yazılır — admin karar verir.
 * `vergi_no` opsiyoneldir; girilmemişse boş kalır.
 */
export function buildPayoutRunCsv(
  rows: readonly PayoutRunRow[],
  opts: { generatedAt: string; minPayoutCents?: number },
): string {
  const min = opts.minPayoutCents ?? MIN_PAYOUT_CENTS;
  const lines: string[] = [PAYOUT_CSV_HEADER.join(",")];

  for (const row of rows) {
    if (row.payableCount <= 0 || row.payableCents < min) continue;
    lines.push(
      [
        payoutReference(row.email, opts.generatedAt),
        row.email ?? "",
        row.method ?? "",
        row.accountHolder ?? "",
        normalizeIban(row.iban),
        row.wiseEmail ?? "",
        row.taxId ?? "",
        centsToDecimal(row.payableCents),
        String(row.payableCount),
        row.oldestPayableAt ?? "",
        (row.missing ?? []).join(" | "),
      ]
        .map(csvCell)
        .join(","),
    );
  }

  return `${lines.join("\n")}\n`;
}

/** CSV'ye giren satırların özeti (panelde "X affiliate · $Y" için). */
export function payoutRunSummary(
  rows: readonly PayoutRunRow[],
  opts: { minPayoutCents?: number } = {},
): { affiliates: number; totalCents: number; blockedCount: number } {
  const min = opts.minPayoutCents ?? MIN_PAYOUT_CENTS;
  let affiliates = 0;
  let totalCents = 0;
  let blockedCount = 0;
  for (const row of rows) {
    if (row.payableCount <= 0 || row.payableCents < min) continue;
    affiliates += 1;
    totalCents += row.payableCents;
    if ((row.missing ?? []).length > 0) blockedCount += 1;
  }
  return { affiliates, totalCents, blockedCount };
}

/* ------------------------------------------------------------------ */
/* 3b) ÖDEME GEÇMİŞİ (payout runs) — "hesabıma para atıldı mı?"          */
/* ------------------------------------------------------------------ */

/**
 * Ödeme geçmişi için gereken satır alanları.
 *
 * NEDEN AYRI TİP: `splitCommissionsByHold` yalnız tutar/durum/tarih ister;
 * geçmiş için partiyi tanımlayan `payout_ref`, yöntem ve gerçek ödeme tarihi
 * (`paid_at`) de gerekir. Bunlar olmadan "ödendi" bilgisini tek tek satır
 * olarak göstermek gerekirdi ki kullanıcı 40 ayrı satır görüp "bana ne kadar
 * gönderildi?" sorusunun cevabını bulamazdı.
 */
export type PaidCommissionRow = {
  commission_cents: number | null;
  status: string | null;
  paid_at?: string | null;
  paid_method?: string | null;
  payout_ref?: string | null;
};

/** Tek bir ödeme partisi (bir transferde gönderilen komisyonların toplamı). */
export type PayoutRun = {
  /**
   * Parti referansı (Wise transfer no / dekont no).
   * Boş dize = kayıtta referans YOK — uydurulmaz, arayüz bunu söyler.
   */
  ref: string;
  /** Ödeme tarihi (partideki en GEÇ `paid_at`); bilinmiyorsa null. */
  paidAt: string | null;
  /** Partide gönderilen toplam komisyon (minor units). */
  cents: number;
  /** Partideki komisyon satırı sayısı. */
  count: number;
  /** Ödeme yöntemi (wise/iban/other) — kayıtta yoksa null. */
  method: string | null;
};

export type PayoutHistory = {
  runs: PayoutRun[];
  paidCents: number;
  paidCount: number;
  /**
   * Okuma sınırına takıldı mı? true ise geçmiş EKSİKTİR ve arayüz bunu
   * söylemek zorundadır (sessiz eksik toplam, "bana az ödediler" sanısı yaratır).
   */
  truncated: boolean;
};

/**
 * Ödenmiş komisyon satırlarını TRANSFER BAZINDA gruplar.
 *
 * KURAL (ölçülebilir, testlidir):
 *   1. Yalnız `status === "paid"` satırlar sayılır. `pending` ödeme değildir,
 *      `reversed` mahsuptur — ikisi de geçmişe girmez.
 *   2. Grup anahtarı önce `payout_ref`, yoksa `paid_at`'tir: aynı partideki
 *      satırlar `admin_mark_affiliate_paid` içinde AYNI `now()` ve AYNI
 *      referansla yazılır, dolayısıyla ikisi de partiyi doğru temsil eder.
 *      İkisi de boşsa satırlar TEK "bilinmeyen" partide toplanır ve arayüz
 *      referansı olmadığını söyler (tarih uydurulmaz).
 *   3. Partiler en YENİden eskiye sıralanır; `paidAt` bilinmeyen parti sona düşer.
 */
export function groupPayoutRuns(
  rows: readonly PaidCommissionRow[],
  opts: { truncated?: boolean } = {},
): PayoutHistory {
  const buckets = new Map<string, PayoutRun>();
  let paidCents = 0;
  let paidCount = 0;

  for (const row of rows) {
    if (row.status !== "paid") continue;
    const cents = Number.isFinite(row.commission_cents)
      ? Math.max(0, row.commission_cents ?? 0)
      : 0;
    paidCents += cents;
    paidCount += 1;

    const ref = String(row.payout_ref ?? "").trim();
    const paidAt = row.paid_at ? String(row.paid_at) : null;
    // Referans yoksa parti kimliği ödeme ZAMANIDIR; o da yoksa tek kova.
    const key = ref || paidAt || "__unknown__";

    const existing = buckets.get(key);
    if (existing) {
      existing.cents += cents;
      existing.count += 1;
      // Parti tarihi = en GEÇ ödeme anı (aynı partide eşit olur; olmazsa
      // geçmişi erkene çekmemek için en yeni an alınır).
      if (paidAt && (!existing.paidAt || paidAt > existing.paidAt)) existing.paidAt = paidAt;
      if (!existing.method && row.paid_method) existing.method = String(row.paid_method);
      continue;
    }

    buckets.set(key, {
      ref,
      paidAt,
      cents,
      count: 1,
      method: row.paid_method ? String(row.paid_method) : null,
    });
  }

  const runs = [...buckets.values()].sort((a, b) => {
    if (a.paidAt && b.paidAt) return a.paidAt < b.paidAt ? 1 : a.paidAt > b.paidAt ? -1 : 0;
    if (a.paidAt) return -1;
    if (b.paidAt) return 1;
    return a.ref < b.ref ? 1 : -1;
  });

  return { runs, paidCents, paidCount, truncated: opts.truncated === true };
}

/* ------------------------------------------------------------------ */
/* 3c) "PARA ATILDI MI?" — tek cümlelik dürüst durum kararı             */
/* ------------------------------------------------------------------ */

/** Ödeme beklemesinin SEBEBİ (yoksa null = bekleyen bir engel kalmadı). */
export type PayoutBlocker = "threshold" | "hold" | "details" | null;

export type PayoutStatusView = {
  /** Hesabına şimdiye kadar para gönderildi mi? */
  state: "paid" | "not_paid";
  /** Kısa başlık (panel üstünde rozet/başlık olarak gösterilir). */
  label: string;
  /** Neden bekliyor / sıradaki adım — ölçülen sayılarla. */
  detail: string;
  blocker: PayoutBlocker;
};

/**
 * AFFILIATE'İN ASIL SORUSU: "ne kadar kazandım, hesabıma para atıldı mı?"
 *
 * Bu fonksiyon ikinci yarıyı YANITLAR ve beklemenin SEBEBİNİ tek cümlede söyler.
 * NEDEN SAF VE AYRI: sıra önemlidir ve yanlış sıra yanıltıcı mesaj üretir —
 * örneğin ödeme bilgisi eksikken "eşiğe $12 kaldı" demek, affiliate'i
 * beklemeye iter ama para HİÇ gelmez (IBAN olmadan transfer yapılamaz).
 *
 * SIRA (en sert engelden yumuşağa):
 *   1. Ödeme bilgisi eksik  → para gönderilemez, affiliate'in aksiyonu gerekir.
 *   2. Bekleme süresi       → para henüz ödenebilir değil (30 gün iade penceresi).
 *   3. Eşik ($75)           → ödenebilir bakiye küçük; devreder.
 *   4. Engel yok            → ödeme listesinde; admin tek tıkla işaretler.
 */
export function payoutStatusView(input: {
  paidAny: boolean;
  paidCents: number;
  payableCents: number;
  heldCents: number;
  minPayoutCents?: number;
  /** Affiliate'in ödeme bilgisi tam mı (IBAN/Wise + hesap sahibi). */
  profileReady: boolean;
  profileMissing?: readonly string[];
  nextUnlockAt?: string | null;
}): PayoutStatusView {
  const min = Number.isFinite(input.minPayoutCents)
    ? Math.max(0, Math.floor(input.minPayoutCents as number))
    : MIN_PAYOUT_CENTS;
  const paidCents = Math.max(0, Math.floor(input.paidCents || 0));
  const payable = Math.max(0, Math.floor(input.payableCents || 0));
  const held = Math.max(0, Math.floor(input.heldCents || 0));
  const state: PayoutStatusView["state"] = input.paidAny && paidCents > 0 ? "paid" : "not_paid";
  const label = state === "paid" ? "Hesabına para gönderildi" : "Henüz hesabına para gönderilmedi";

  // 1) Ödeme bilgisi eksikse diğer sebepler KONUŞULMAZ: para gönderilemez.
  if (!input.profileReady) {
    const missing = (input.profileMissing ?? []).filter(Boolean).join(", ");
    return {
      state,
      label,
      detail: missing
        ? `Ödeme yapılabilmesi için şunları tamamla: ${missing}.`
        : "Ödeme bilgilerini tamamla; eksik bilgiyle transfer yapılamaz.",
      blocker: "details",
    };
  }

  // 2) Bekleme süresi: para var ama iade penceresi kapanmadı.
  if (held > 0 && payable < min) {
    const when = input.nextUnlockAt
      ? ` İlk tutar ${new Date(input.nextUnlockAt).toLocaleDateString()} tarihinde ödenebilir olur.`
      : "";
    return {
      state,
      label,
      detail: `Beklemedeki ${(held / 100).toFixed(2)}$ iade penceresi (30 gün) kapanınca ödenir.${when}`,
      blocker: "hold",
    };
  }

  // 3) Eşik: ödenebilir bakiye $75'in altında — devreder.
  if (payable < min) {
    return {
      state,
      label,
      detail: `Ödeme eşiği ${(min / 100).toFixed(2)}$: ${((min - payable) / 100).toFixed(2)}$ daha birikince ödenir.`,
      blocker: "threshold",
    };
  }

  // 4) Engel kalmadı: sıradaki ödeme listesinde.
  return {
    state,
    label,
    detail: `${(payable / 100).toFixed(2)}$ ödemeye hazır ve ödeme listesinde — yönetici transferi işaretlediğinde geçmişe düşer.`,
    blocker: null,
  };
}

/* ------------------------------------------------------------------ */
/* 4) Komisyon bildirimi kararı                                        */
/* ------------------------------------------------------------------ */

/**
 * Affiliate'e "komisyon kazandın" e-postası gönderilmeli mi?
 *
 * SADECE yeni yazılmış (result = 'ok') bir komisyon satırı ve `pending`
 * durumu için true döner. Böylece Paddle'ın aynı ödeme için gönderdiği ikinci
 * olay (`duplicate`) veya iade ile mahsup edilmiş satır kullanıcıya "kazandın"
 * demez.
 */
export function shouldNotifyCommission(args: {
  /** `process_paddle_event` / `record_affiliate_commission` dönüşü. */
  result: string | null | undefined;
  /** Komisyon satırının durumu. */
  status?: string | null;
  eventType?: string | null;
}): boolean {
  if (args.result !== "ok") return false;
  if ((args.status ?? "pending") !== "pending") return false;
  const type = String(args.eventType ?? "");
  if (type && !type.startsWith("transaction.")) return false;
  return true;
}
