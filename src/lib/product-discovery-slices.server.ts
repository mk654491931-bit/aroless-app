// ============================================================================
// PRODUCT DISCOVERY — DİLİM (SLICE) BÜTÇESİ.
//
// SORUN (kullanıcının istediği davranış): hat "bir adım = bir QStash mesajı"
// diye kurulmuştu ve TEK bir teslimat kendi adımının tamamını koşuyordu. Vercel
// Hobby'de bu, fonksiyonun dakikalarca açık kalması demektir: en kötü hâlde
// `deep` adımı 14 rolü sırayla konuşturup ~240 sn, `gemini` adımı anahtar
// rotasyonuyla ~240 sn sürebiliyordu. Platform süre tavanına dayanan bir istek
// `504 FUNCTION_INVOCATION_TIMEOUT` olarak ölür ve elimizde ne kısmi sonuç ne
// de açıklama kalır.
//
// ÇÖZÜM: her teslimat EN FAZLA bir DİLİM kadar çalışır (`DISCOVERY_SLICE_MS`,
// varsayılan 10 sn). Adım dilim içinde bitmezse:
//   • o ana kadarki ilerleme ARA NOKTaya yazılır (hangi roller konuştu, hangi
//     kaynaklar okundu), 
//   • aynı adım için SIRADAKİ dilim QStash'e yayınlanır,
//   • zincir böylece adım adım ilerler ve hiçbir fonksiyon uzun koşmaz.
//
// NEDEN DİLİM BAŞINA AYRI QSTASH KİMLİĞİ: QStash `Upstash-Deduplication-Id`
// aynı kimliği 5 dakika boyunca tekrar etmez. Eskiden kimlik `runId:step`
// idi; dilimlemede aynı adımı yeniden yayınlamak ZORUNDA olduğumuz için kimlik
// `runId:step:slice` olur. Böylece "aynı dilim iki kez koşmasın" garantisi
// korunurken devam dilimleri geçebilir.
//
// NEDEN AYRI DOSYA: hem yayıncı (`product-discovery-qstash.server.ts`) hem
// sürücü (`product-discovery-runner.server.ts`) hem de adım yürütücüsü aynı
// sayıları okur. Tek kaynak olmazsa yayınlanan süre ile koşan dilim birbirinden
// kayar ve istek yine platform tavanına dayanır. Bu modül SAF'tır (ağ, veritabanı
// ve AI yok) — bu yüzden testlerde tek tek ölçülebilir.
// ============================================================================

import { readEnvValue } from "./host-runtime.server";

type EnvMap = Record<string, string | undefined>;

/** Bir dilimin üst sınırı (ms). Kullanıcı isteği: "her işlemi 10 saniyelik böl". */
export const DEFAULT_SLICE_MS = 10_000;

/** Dilim alt sınırı: bundan kısası işe yaramaz (bir model çağrısı bile sığmaz). */
export const MIN_SLICE_MS = 3_000;

/**
 * Dilim üst sınırı (ms) — 30 sn.
 *
 * NEDEN SINIR VAR: ayar yanlışlıkla `120000` yazılırsa dilimlemenin TÜM amacı
 * (fonksiyonun kısa koşması) kaybolurdu. Bu tavan, ayarı hatalı bir ortam
 * değişkeninin sunucusuz tavan davranışını geri getirmesini yapısal olarak
 * engeller.
 */
export const MAX_SLICE_MS = 30_000;

const SLICE_ENV = "DISCOVERY_SLICE_MS";

/** Bu kurulumdaki dilim süresi (ms) — ortam değişkeniyle ayarlanabilir. */
export function discoverySliceMs(env: EnvMap = process.env): number {
  const raw = Number(readEnvValue(env, SLICE_ENV) ?? "");
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_SLICE_MS;
  // Kısıtlama tek yerde: 3 sn'den kısa dilime model çağrısı sığmaz, 30 sn'den
  // uzunu sunucusuz fonksiyon tavanına takılır.
  return Math.min(MAX_SLICE_MS, Math.max(MIN_SLICE_MS, Math.round(raw)));
}

/**
 * Bir dilimin İŞE harcayabileceği süre (ms).
 *
 * Dönüş payı kritik: dilim tam 10 sn'de bitmezse yanıt (ara nokta yazımı +
 * sıradaki dilimin yayını) platform kesmesinden SONRA kalır ve zincir o
 * halkada kopar. Bu yüzden işe 10 sn değil, 10 sn − 3 sn ayrılır; 3 sn ara
 * nokta yazımı, QStash yayını ve soğuk başlangıç içindir.
 */
export const SLICE_RETURN_MARGIN_MS = 3_000;

/** Dilimden işe kalan süre: dilim − geri dönüş payı (ara nokta yazımı + QStash yayını). */
export function sliceWorkMs(env: EnvMap = process.env): number {
  return Math.max(1_000, discoverySliceMs(env) - SLICE_RETURN_MARGIN_MS);
}

/**
 * Bu dilimin bitmesi gereken an (epoch ms).
 *
 * İKİ SINIRIN MİNİMUMU alınır: dilimin kendi bütçesi ve zincirin mutlak bitiş
 * anı. Zincir sözü (280 sn) dilimleme yüzünden uzayamaz; süre bittiğinde
 * adımlar kalan işi deterministiğe düşürerek BİTİRİR (dürüst yedek).
 */
export function sliceDeadlineAt(args: {
  now?: number;
  chainDeadlineAt?: number;
  env?: EnvMap;
} = {}): number {
  const now = args.now ?? Date.now();
  // Dilim kendi süresi kadar sürer; zincir bitiş anı daha yakınsa o an biter.
  return Math.min(now + sliceWorkMs(args.env), args.chainDeadlineAt ?? Number.POSITIVE_INFINITY);
}

/** QStash'e verilen teslimat penceresi için ek pay (sn) — soğuk başlangıç. */
export const SLICE_DELIVERY_GRACE_SECONDS = 20;

/**
 * QStash `Upstash-Timeout` değeri (sn) — DİLİM BAŞINA.
 *
 * Eskiden her teslimat 298 sn (Vercel fonksiyon tavanı − 2) bekliyordu. Dilim
 * 10 sn olduğu için 30 sn yeterlidir ve üst sınır 120 sn'dir: QStash, ölmüş bir
 * fonksiyonu dakikalarca beklemez; kısa sürede anlar ve yeniden dener
 * (`Upstash-Retries: 3`). "Vercel'i zorlama" kuralının altyapı tarafı budur.
 */
export function sliceDeliveryTimeoutSeconds(env: EnvMap = process.env): number {
  // QStash'e dilim süresi + soğuk başlangıç payı kadar süre verilir (üst sınır 120 sn).
  return Math.min(120, Math.ceil(discoverySliceMs(env) / 1000) + SLICE_DELIVERY_GRACE_SECONDS);
}

/**
 * Bir adım için en fazla kaç dilim koşar.
 *
 * NEDEN SINIR: dilim mantığı "bitmediyse sıradakini yayınla" der. Bir adım
 * herhangi bir sebeple ilerleme kaydedemezse (ör. model hep aynı hatayı verir)
 * zincir sonsuza kadar kendini besler ve kullanıcı hiç sonuç görmez.
 * 16 dilim, 14 rollü konseyin en yavaş kurulumunda (eşzamanlılık 1 → 14 dalga)
 * bile yetecek genişliktedir; son dilim adımı ZORLA bitirir.
 */
export const MAX_STEP_SLICES = 16;

/** Bu, adımın son dilimi mi? (Evet → adım kalan işi deterministiğe düşürüp biter.) */
export function lastStepSlice(slice: number, max = MAX_STEP_SLICES): boolean {
  // Bu, son dilim midir? Evet → adım bitir.
  // max - 1: çünkü dilimler 0'dan başlar, 0, 1, 2 ... max-1'dir.
  return Math.floor(slice) >= max - 1;
}

/** Dilimler arasında TAŞINAN kısmi ilerleme (adım başına). */
export type DiscoverySliceState = {
  /** Bu adım için SIRADAKİ dilim numarası (0 = hiç koşmadı). */
  next: number;
  /** Adıma özel kısmi durum (konsey: konuşan roller + puanları). */
  partial?: unknown;
};

export type SliceBook = Record<string, DiscoverySliceState>;

/** Ara noktadaki dilim defterinden bir adımın durumunu okur (bozuksa 0). */
export function readSliceState(book: SliceBook | undefined, step: string): DiscoverySliceState {
  const raw = book?.[step];
  const next = Number(raw?.next);
  // Bir sonraki dilim numarası: eğer yoksa 0 (başlangıç), varsa aşağıdaki sayı.
  return {
    next: Number.isFinite(next) && next > 0 ? Math.floor(next) : 0,
    partial: raw?.partial,
  };
}

/** Bir adımın defterini günceller (saf; yeni nesne döner). */
export function writeSliceState(
  book: SliceBook | undefined,
  step: string,
  patch: Partial<DiscoverySliceState>,
): SliceBook {
  const current = readSliceState(book, step);
  // Yeni defter: eski kitapları koru, bu adıma yeni sayı/resmi ekle.
  return { ...(book ?? {}), [step]: { ...current, ...patch, next: patch.next ?? current.next } };
}

export type SliceClaimDecision =
  /** Bu dilim koşmalı. */
  | "run"
  /** Bu dilim ZATEN koştu (defter ileride) — yalnız tekrar teslimat. */
  | "already-done"
  /** Defter bu dilime henüz gelmedi (sıra dışı teslimat) — beklenir. */
  | "not-yet";

/**
 * Gelen dilim, defterdeki sıraya uygun mu?
 *
 * NEDEN GEREKLİ: devam dilimleri için satırın YAŞINA bakılamaz (önceki dilim
 * biteli saniyeler olmuştur ve satır taze görünür). Doğru ölçüt defterdir:
 * yalnız `next === slice` olan dilim koşar. Bu kural üç durumu tek yerde
 * çözer:
 *   • sıradaki dilim → koşar,
 *   • gecikmiş bir tekrar teslimat (`next > slice`) → hiçbir şey yapmaz,
 *   • erken gelen teslimat (`next < slice`) → beklemede kalır.
 * `slice = 0` her zaman koşabilir: adımın ilk dilimidir ve sahipliği atomik
 * CAS (`advanceDiscoveryStatus`) belirler.
 */
export function decideSliceClaim(next: number, slice: number): SliceClaimDecision {
  const index = Number.isFinite(slice) && slice > 0 ? Math.floor(slice) : 0;
  // İlk dilim (0) her zaman koşabilir.
  if (index === 0) return "run";
  // Eğer bir sonraki beklenen dilim, gelen dilimden büyükse → zaten yapıldı (tekrar gelme).
  if (next > index) return "already-done";
  // Eğer bir sonraki beklenen dilim, gelen dilimden küçükse → henüz yerinde değil, bekle.
  if (next < index) return "not-yet";
  // Eşitse → kendi sırası bu, run et.
  return "run";
}

/**
 * Bu ara nokta, adımın dilim defterini taşıyor mu?
 *
 * Eski koşularda (bu sürümden önce yazılmış ara noktalar) alan yoktur; o
 * durumda defter boş kabul edilir ve adım baştan dener. Ara nokta kaybı işi
 * öldürmez, yalnız ilerlemeyi geri alır — dürüst davranış budur.
 */
export function readSliceBook(raw: unknown): SliceBook | undefined {
  // Eğer boş, nesne değil veya dizi ise → yok.
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: SliceBook = {};
  for (const [step, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const next = Number(record["next"]);
    // Bir sonraki dilim: 0 veya pozitif tam sayı.
    out[step] = {
      next: Number.isFinite(next) && next > 0 ? Math.floor(next) : 0,
      partial: record["partial"],
    };
  }
  // Eğer kitap boş değilse döndür, yoksa tanımsız.
  return Object.keys(out).length ? out : undefined;
}
