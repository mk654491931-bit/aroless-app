// ============================================================================
// PRODUCT DISCOVERY — KAZANAN ÜRÜN KARTI.
//
// Bu kart iki SAYI gösterir ve bu ikisi BİRBİRİNİN YERİNE GEÇMEZ:
//
//   • `councilScore`  → "14 ajan bu ürüne ortalama kaç puan verdi?"
//   • `confidenceScore` → "bu puana ne kadar güvenebiliriz?"
//
// Neden ayrı: 14 ajanın hepsinin 78 verdiği bir ürün, oyları 40'a düşen
// bir ürünle aynı councilScore'u taşıyabilir ama güveni tamamen farklıdır.
// Güven skoru eşitlik bozucudur (tie-breaker) ve aynı zamanda "kanıt ne kadar
// doluydu" bilgisini taşır — kartın altında bu yüzden ayrı bir satır var.
//
// ÖLÇÜLEMEYEN ALAN `—` GÖSTERİLİR, 0 DEĞİL. "Bilmıyorum" ile "sıfır" farklı
// bilgidir; sayı uydurmak bu kartın var oluş sebebini çürütürdü.
// ============================================================================

import { AlertTriangle, BadgeCheck, ExternalLink, ShieldCheck, TrendingUp } from "lucide-react";

import type { DiscoveryWinner } from "@/lib/product-discovery.functions";

/** Kanıt seviyesi — güven + bütünlükten türetilir, asla puanı ezmez. */
export function evidenceLevel(w: Pick<DiscoveryWinner, "confidenceScore" | "dataCompleteness" | "votes">): {
  label: string;
  cls: string;
} {
  if (w.confidenceScore >= 70 && w.dataCompleteness >= 4)
    return {
      label: "Güçlü kanıt",
      cls: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
    };
  if (w.confidenceScore >= 50 && w.dataCompleteness >= 3)
    return {
      label: "Kısmi kanıt",
      cls: "border-amber-400/30 bg-amber-400/10 text-amber-300",
    };
  return { label: "Zayıf kanıt — dikkat", cls: "border-red-400/30 bg-red-400/10 text-red-300" };
}

/** Konseydeki ajan sayısı — payda sabittir. */
const TOTAL_AGENTS = 14;

/** Ölçülebilir alan sayısı; eksik alan uyarısı bu sayıya göre yazılır. */
const MEASURABLE_FIELDS = 5;

/** Sinyallerin insan dili karşılıkları. */
//
// "margin" sinyali bir YÜZDE DEĞİLDİR: yalnızca FİYAT BANDI sağlığıdır (0-100).
// Etiket "Marj" olduğu için kartta "Marj 80" yazısı `%80 kâr marjı` gibi
// okunuyordu; aynı ürünün gerçek marj hücresi ise "—"/brüt gösterdiğinden
// çelişki doğuyordu. Etiket "Fiyat bandı" olarak açıklığa kavuşturuldu.
const SIGNAL_LABELS = {
  demand: "Talep",
  competition: "Düşük rekabet",
  margin: "Fiyat bandı",
  rating: "Ürün puanı",
  availability: "Bulg. kolaylığı",
} as const;

/** Puanı renge çevirir (her yerde aynı eşikler). */
function scoreTone(score: number): string {
  if (score >= 70) return "text-emerald-500";
  if (score >= 50) return "text-amber-500";
  return "text-muted-foreground";
}

/** Ölçülmemiş sayıyı dürüstçü gösterir (0 ≠ bilinmiyor). */
function fmt(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "—";
}

/** Fiyat her zaman iki ondalıkla gösterilir: 35 ve 34.99 aynı sütunda
 *  farklı genişlikte görünmemeli, karşılaştırma kolaylaşsın. */
function fmtPrice(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(2)}` : "—";
}

export function DiscoveryWinnerCard({
  winner,
  rank,
  reason,
}: {
  winner: DiscoveryWinner;
  rank: number;
  /**
   * `top_products` sözleşmesindeki `selection_reason` — üç ölçütün (trend,
   * kâr/fiyat, rekabet) kısa, ÖLÇÜLMÜŞ karşılığı. Boşsa kart gerekçesiz
   * kalır: eski koşularda sözleşme yoktur ve kart eski hâliyle çalışır.
   */
  reason?: string;
}): React.JSX.Element {
  // `dataCompleteness` sunucu tarafında zod ile sınırlanır ama sütun ham
  // JSON'dan geldiği için burada da kelepçelenir: negatif "3 alan ölçülemedi"
  // gibi saçma bir metin üretmemelidir.
  const missing =
    MEASURABLE_FIELDS - Math.max(0, Math.min(MEASURABLE_FIELDS, winner.dataCompleteness));

  const rankStyle = rank === 1 ? "bg-amber-300 text-black border-amber-200 shadow-[0_0_18px_-4px_rgba(252,211,77,0.7)]" : rank === 2 ? "bg-zinc-200 text-black border-white" : rank === 3 ? "bg-amber-700 text-white border-amber-600" : "bg-white/10 text-white border-white/20";
  return (
    <article className="group space-y-4 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-[#0c0f18] to-[#07090f] p-5 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)] transition-colors hover:border-white/25">
      <div aria-hidden className="-mx-5 -mt-5 h-1 bg-gradient-to-r from-white/60 via-white/10 to-transparent" />
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${evidenceLevel(winner).cls}`}>
          <BadgeCheck className="size-3" /> {evidenceLevel(winner).label}
        </span>
        <span className="text-[10px] text-zinc-500">
          {winner.dataCompleteness}/5 alan doğrulandı · {winner.sources.length} kaynak
        </span>
        {winner.confidenceScore < 40 && (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-300">
            <AlertTriangle className="size-3" /> Puan yüksek olsa bile kanıt az — temkinli test et
          </span>
        )}
      </div>
      <header className="flex items-start gap-3">
        <span className={`flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-black tabular-nums ${rankStyle}`}>
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-bold leading-tight text-white">{winner.name || "İsimsiz ürün"}</h3>
          <p className="mt-1 text-xs text-zinc-500">
            {[winner.brand, winner.seller, winner.category, winner.sources.join(", ")]
              .filter(Boolean)
              .join(" · ") || "Kaynak bilgisi yok"}
          </p>
        </div>
        <div className="shrink-0 rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-right">
          <div className={`text-2xl font-black tabular-nums ${scoreTone(winner.councilScore)}`}>
            {winner.councilScore}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">konsey puanı</div>
        </div>
      </header>

      {/* GÜVEN — councilScore'ın ALTINDA ve AYRI. Eşitlik bozucusu budur. */}
      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/50 px-3 py-2">
        <ShieldCheck className="size-3.5 shrink-0 text-emerald-300" />
        <span className="text-xs text-zinc-400">Güven</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-white"
            style={{ width: `${Math.max(2, Math.min(100, winner.confidenceScore))}%` }}
          />
        </div>
        <span className="text-xs font-bold text-white tabular-nums">{winner.confidenceScore}</span>
        <span className="text-[10px] text-zinc-500">
          ({winner.votes}/{TOTAL_AGENTS} oy)
        </span>
      </div>

      {/* Ölçülen ticari veri — yoksa "—". */}
      <dl className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] py-2.5">
          <dt className="text-[10px] uppercase tracking-wider text-zinc-500">Fiyat</dt>
          <dd className="mt-0.5 text-sm font-bold text-white tabular-nums">{fmtPrice(winner.priceUsd)}</dd>
        </div>
        {/* Tedarik fiyatı ÖLÇÜLDÜYSE gösterilir. Boş kalmasının sebebi artık
            "kaynak yok" değil, bu ürüne alakalı toptan teklif bulunamaması —
            o durumda 0 yazmak yerine "—" yazılır. */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] py-2.5">
          <dt className="text-[10px] uppercase tracking-wider text-zinc-500">Tedarik</dt>
          <dd className="mt-0.5 text-sm font-bold text-white tabular-nums">
            {winner.supplier?.supplierPriceUsd != null
              ? fmtPrice(winner.supplier.supplierPriceUsd)
              : "—"}
          </dd>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] py-2.5">
          <dt className="text-[10px] uppercase tracking-wider text-zinc-500">Puan</dt>
          <dd className="mt-0.5 text-sm font-bold text-white tabular-nums">
            {typeof winner.rating === "number" ? `${winner.rating.toFixed(1)}/5` : "—"}
          </dd>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] py-2.5">
          <dt className="text-[10px] uppercase tracking-wider text-zinc-500">Ön skor</dt>
          <dd className="mt-0.5 text-sm font-bold text-white tabular-nums">{fmt(winner.preScore)}</dd>
        </div>
      </dl>
      {winner.supplier?.supplierPriceUsd == null && (
        <p className="-mt-2 text-[10px] leading-relaxed text-zinc-600">
          Bu ürüne alakalı toptan teklif bulunamadı — marj bu yüzden brüt/boş görünüyor, site bozuk değil.
        </p>
      )}

      {/* Deterministic ön sinyaller — 14 ajanın ortak zemini. */}
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(SIGNAL_LABELS) as (keyof typeof SIGNAL_LABELS)[]).map((key) => (
          <span
            key={key}
            className={`rounded-full border border-white/10 bg-black/50 px-2.5 py-1 text-[10px] font-medium ${scoreTone(
              winner.signals[key],
            )}`}
            title={`${SIGNAL_LABELS[key]} sinyali`}
          >
            {SIGNAL_LABELS[key]} {winner.signals[key]}
          </span>
        ))}
      </div>

      {/* NİHAİ 5 SÖZLEŞMESİ — kazananın neden seçildiğinin tek satırlık,
          ölçülmüş özeti (trend · marj/fiyat · rekabet). Ajan gerekçelerinden
          ayrıdır: bunlar kurator ölçütlerinin insan dili karşılığıdır. */}
      {reason && (
        <p className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-[11px] leading-relaxed text-zinc-300">
          <span className="font-bold text-white">Neden seçildi: </span>
          {reason}
        </p>
      )}

      {/* Ajan gerekçeleri — konsensüs tek başına "neden?" sorusunu yanıtlamaz. */}
      {winner.evidence.length > 0 && (
        <ul className="space-y-1.5 border-t border-white/10 pt-3">
          {winner.evidence.slice(0, 3).map((e, i) => (
            <li key={i} className="flex gap-2 text-[11px] text-zinc-400 leading-relaxed">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-zinc-500" />
              {e}
            </li>
          ))}
        </ul>
      )}

      <footer className="flex items-center justify-between gap-2 border-t border-white/10 pt-3 text-[11px]">
        <div className="flex flex-wrap items-center gap-3 text-zinc-500">
          <span title="Ajanların oy uyumu: yüksek = birlikte karar verdiler">
            <TrendingUp className="mr-1 inline size-3" />
            uyum {fmt(winner.agreement)}
          </span>
          {winner.inStock === false && (
            <span className="text-amber-500/90">stokta yok (ilan satış dışı)</span>
          )}
          {missing > 0 && (
            <span className="inline-flex items-center gap-1 text-amber-500/90">
              <AlertTriangle className="size-3" />
              {missing} alan ölçülemedi
            </span>
          )}
        </div>
        {winner.url && (
          <a
            href={winner.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white px-3 py-1.5 text-[11px] font-bold text-black transition hover:bg-zinc-200"
          >
            Kaynağa git <ExternalLink className="size-3" />
          </a>
        )}
      </footer>
    </article>
  );
}
