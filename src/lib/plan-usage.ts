/**
 * PAKET KULLANIMI — "aylık hak" kavramının TEK KAYNAĞI (saf, ağsız).
 *
 * SORUN (ölçülen): `plans.ts` dört ayrı aylık hak tanımlıyor (Finder kredisi,
 * AI araç çalıştırma, Konsey, Radar) ama bu haklar hiçbir yerde SAYILMIYORDU:
 *   • `credit_usage_log` tablosu vardı, ona HİÇBİR satır yazılmıyordu →
 *     "kullanım günlüğü" her zaman boş, sol bardaki modül kullanımı hiç eksilmiyordu;
 *   • `toolRuns / councilRuns / radarScans` yalnız ekranda yazan sayılardı,
 *     tüketimle ilgisi yoktu (yani "30 araç/ay" sınırsız demekti);
 *   • paket yükseltince ekranda yeni limit görünse de hiçbir şey ENGELLEMİYORDU.
 *
 * BU DOSYA üç şeyi tek yerde tanımlar:
 *   1. Bir AI işinin hangi hakka yazılacağı (`usageKindForFeature`),
 *   2. Ayın sınırları (`monthRange`), böylece sayaç ay başında kendiliğinden sıfırlanır,
 *   3. `kullanılan / limit / kalan / yüzde` ölçüsü (`usageMeter`) — arayüz ve
 *      sunucu kapısı AYNI sayıyı konuşur.
 *
 * KURAL: limitler `plans.ts`ten gelir; burada ikinci bir fiyat listesi yoktur.
 */

import { ADMIN_QUOTA, quotaFor, tierLevel, type PlanId } from "./plans";

/** Aylık hak türleri — `Plan` alanlarıyla BİREBİR aynı adlar. */
export type UsageKind = "credits" | "toolRuns" | "councilRuns" | "radarScans";

export type UsageCounts = Record<UsageKind, number>;

export type UsageKindMeta = {
  kind: UsageKind;
  label: string;
  /** Plan ekranındaki açıklama (tek cümle). */
  hint: string;
};

/** Arayüz sırası: Finder → araç → konsey → radar. */
export const USAGE_KIND_META: readonly UsageKindMeta[] = [
  {
    kind: "credits",
    label: "Bulucu + derin analiz",
    hint: "Ürün bulucu araması ve derin ürün analizi",
  },
  { kind: "toolRuns", label: "AI araç", hint: "22 AI aracının her çalıştırması" },
  { kind: "councilRuns", label: "AI Konsey", hint: "14 ajanlı konsey oturumu" },
  { kind: "radarScans", label: "Trend radar", hint: "Trend radar taraması" },
];

/**
 * Bir AI işini hangi aylık hakka yazar?
 *
 * EŞLEME GEREKÇESİ (plans.ts ile birebir):
 *   • `tool:<id>`      → AI araç çalıştırma (22 araç, konsey aracı dahil)
 *   • `council`        → AI Konsey oturumu
 *   • `agent-pipeline` → Bulucu + derin analiz (ürün keşfi ve Velora derin hattı;
 *                        plans.ts bu havuzu "ürün bulucu / derin analiz kredisi"
 *                        diye tanımlıyor)
 *   • `trend-analysis` → Bulucu + derin analiz (ürün başına derin analiz)
 *   • `radar-scan`     → Trend radar
 *
 * Bilinmeyen iş → en geniş hak (AI araç): bilinmeyen bir özellik yüzünden
 * kullanıcının hakkı sessizce "sınırsız" olmasın.
 */
export function usageKindForFeature(feature: string): UsageKind {
  const id = String(feature ?? "");
  if (id.startsWith("tool:")) return "toolRuns";
  if (id === "council") return "councilRuns";
  if (id === "radar-scan") return "radarScans";
  if (id === "agent-pipeline" || id === "trend-analysis") return "credits";
  return "toolRuns";
}

export function emptyUsageCounts(): UsageCounts {
  return { credits: 0, toolRuns: 0, councilRuns: 0, radarScans: 0 };
}

/** "2026-10" — ay kovası (raporlama/log için). */
export function monthKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/**
 * Ayın başlangıcı (ISO). Sayaç bu tarihten sonrasını sayar; ay dönünce
 * kendiliğinden sıfırlanır. UTC kullanılır: sunucu saat dilimi değişse de
 * kullanıcıya gösterilen "bu ay" ile sayaç aynı olur.
 */
export function monthRange(now: Date = new Date()): { startIso: string; key: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { startIso: start.toISOString(), key: monthKey(now) };
}

/** Kullanıcının seviyesine göre bu hakkın aylık limiti (tek kaynak: plans.ts). */
export function limitFor(level: 0 | 1 | 2 | 3, kind: UsageKind, isAdmin = false): number {
  if (isAdmin) return ADMIN_QUOTA[kind];
  return quotaFor(level)[kind];
}

/**
 * ÜCRETSİZ PLANIN GERÇEK TAVANI = bu ay kullanılan + harcanabilir bakiye.
 *
 * NEDEN `max(limit, bakiye)` DEĞİL (ölçülen hata): kullanıcı 2 hoş geldin
 * jetonunu harcadıktan sonra davet/referral ile 2 jeton kazandığında
 * `used=2`, `bakiye=2` oluyor; eski formül `max(2, 2) = 2` verip
 * `used >= limit` ile işi ENGELLİYORDU — yani kazanılan jeton harcanamıyordu.
 * Doğru tavan, geçmiş tüketim + kalan bakiyedir; böylece her kazanılan jeton
 * harcanabilir kalır ve hoş geldin jetonu hâlâ tek seferliktir (bakiye bitince
 * tavan da biter).
 *
 * `used`/`balance` okunamıyorsa `null` döner: "bilinmiyor" demek, "0" demek
 * değildir; çağıran bu durumda ENGELLEMEZ (fail-open) ve kararı gerçek düşme
 * çağrısı verir.
 */
export function freeUsageCeiling(used: number | null, balance: number | null): number | null {
  if (used === null || balance === null) return null;
  const safeUsed = Number.isFinite(used) && used > 0 ? Math.floor(used) : 0;
  const safeBalance = Number.isFinite(balance) && balance > 0 ? Math.floor(balance) : 0;
  return safeUsed + safeBalance;
}

/**
 * Tahsilat kapısının kullanacağı ETKİN aylık limit (tek karar noktası).
 *
 * • Admin → her kalemde 250 (`plans.ts` ADMIN_QUOTA). Paket seviyesi ne olursa
 *   olsun admin 250'dir; eskiden yalnız `level === 0` iken admin sayılıyordu ve
 *   ücretli paketteki admin 50/90 gibi paket limitine düşüyordu.
 * • Ücretsiz → kullanılan + bakiye (yukarıdaki açıklama).
 * • Ücretli → paketin aylık hakkı.
 *
 * `null` = bilinmiyor → engelleme yok.
 */
export function effectiveUsageLimit(args: {
  level: 0 | 1 | 2 | 3;
  kind: UsageKind;
  isAdmin: boolean;
  used: number | null;
  balance: number | null;
}): number | null {
  if (args.isAdmin) return ADMIN_QUOTA[args.kind];
  if (args.level === 0) return freeUsageCeiling(args.used, args.balance);
  return limitFor(args.level, args.kind, false);
}

/**
 * Sayaç okunamadığında "kullanılan" yerine yazılan işaret.
 *
 * "0" yazmak YANLIŞ beyandır: 0 "hiç kullanmadım" demektir, burada ise
 * "ölçemedim" durumu vardır. Bu yüzden kullanılan tarafı `?` olur.
 */
export const UNKNOWN_USAGE_LABEL = "?";

/**
 * Bir kullanım satırının görünen değeri: `3/8`, `—`, `…` ya da `?/8`.
 *
 * ÖLÇÜLEN SORUN: sayaç okunamadığında satır "bilinmiyor" yazıyordu — yani
 * kullanıcı hem kullanımını hem de ABONELİĞİNİN aylık hakkını kaybediyordu.
 * Oysa limit abonelikten gelir ve HER ZAMAN bilinir. Artık ölçülemeyen
 * sayaçta limit gösterilir (`?/8` = "kullanım okunamadı, hakkın 8").
 *
 * SAF fonksiyon: sol bar, üst bar ve ayarlar AYNI kuralı kullansın diye burada.
 */
export function usageLabelFor(args: {
  used: number;
  limit: number;
  disabled?: boolean;
  measured?: boolean;
  loading?: boolean;
}): string {
  if (args.loading) return "…";
  if (args.disabled) return "—";
  if (args.measured === false)
    return args.limit > 0 ? `${UNKNOWN_USAGE_LABEL}/${args.limit}` : UNKNOWN_USAGE_LABEL;
  return `${args.used}/${args.limit}`;
}

export type UsageMeter = {
  used: number;
  limit: number;
  remaining: number;
  /** 0-100; limit 0 ise 0 (bölme yok). */
  pct: number;
  exhausted: boolean;
  /** Limit yok (0) → bu hak kapalı. */
  disabled: boolean;
};

export function usageMeter(used: number, limit: number): UsageMeter {
  const safeUsed = Number.isFinite(used) && used > 0 ? Math.floor(used) : 0;
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
  if (safeLimit === 0) {
    return { used: safeUsed, limit: 0, remaining: 0, pct: 100, exhausted: true, disabled: true };
  }
  const remaining = Math.max(0, safeLimit - safeUsed);
  return {
    used: safeUsed,
    limit: safeLimit,
    remaining,
    pct: Math.min(100, Math.round((safeUsed / safeLimit) * 100)),
    exhausted: remaining === 0,
    disabled: false,
  };
}

export type UsageRow = UsageMeter & UsageKindMeta;

/** Arayüz satırları — sol bar ve üst bar aynı listeyi okur. */
export function planUsageRows(
  level: 0 | 1 | 2 | 3,
  counts: UsageCounts,
  isAdmin = false,
): UsageRow[] {
  return USAGE_KIND_META.map((meta) => ({
    ...meta,
    ...usageMeter(counts[meta.kind] ?? 0, limitFor(level, meta.kind, isAdmin)),
  }));
}

/**
 * Paket adı — GÖRÜNEN etiket.
 *
 * ÖLÇÜLEN HATA: veritabanı `subscription_tier` değeri bazen küçük harfle
 * ("pro") ya da eşanlamlıyla ("enterprise", "ultra") yazılıyor; arayüz değeri
 * olduğu gibi bastığı için kullanıcı "Pro" yerine "pro" ya da hiç görmediği bir
 * ad görüyordu. Burada tek yerde kanonik etikete çevrilir.
 */
export function planLabelFor(tier: string | null | undefined): string {
  const level = tierLevel(tier);
  if (level === 1) return "Starter";
  if (level === 2) return "Pro";
  if (level === 3) return "Business";
  return "Free";
}

/** Seviye → kanonik paket kimliği (ücretsizde null). */
export function planIdFor(level: 0 | 1 | 2 | 3): PlanId | null {
  if (level === 1) return "Starter";
  if (level === 2) return "Pro";
  if (level === 3) return "Business";
  return null;
}

/**
 * Limit dolduğunda kullanıcıya söylenecek dürüst mesaj.
 *
 * "Kota doldu" demek yetmez: hangi hak, kaç, hangi paket olduğu yazılır ki
 * kullanıcı ne yapacağını bilsin.
 */
export function planLimitMessage(
  kind: UsageKind,
  limit: number,
  tier: string | null | undefined,
): string {
  const meta = USAGE_KIND_META.find((m) => m.kind === kind);
  const name = meta?.label ?? "AI kullanımı";
  const plan = planLabelFor(tier);
  return (
    `${plan} paketinde aylık ${name} hakkın doldu (${limit}). ` +
    `Daha yüksek pakete geçerek limiti artırabilirsin.`
  );
}
