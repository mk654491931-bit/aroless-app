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

import { AlertTriangle, ExternalLink, ShieldCheck, TrendingUp } from "lucide-react";

import type { DiscoveryWinner } from "@/lib/product-discovery.functions";

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

  return (
    <article className="rounded-xl border border-border bg-card p-5 space-y-4">
      <header className="flex items-start gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary tabular-nums">
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold leading-tight">{winner.name || "İsimsiz ürün"}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {[winner.brand, winner.seller, winner.category, winner.sources.join(", ")]
              .filter(Boolean)
              .join(" · ") || "Kaynak bilgisi yok"}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className={`text-2xl font-bold tabular-nums ${scoreTone(winner.councilScore)}`}>
            {winner.councilScore}
          </div>
          <div className="text-[10px] text-muted-foreground">konsey puanı</div>
        </div>
      </header>

      {/* GÜVEN — councilScore'ın ALTINDA ve AYRI. Eşitlik bozucusu budur. */}
      <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2">
        <ShieldCheck className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Güven</span>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary/70"
            style={{ width: `${Math.max(2, Math.min(100, winner.confidenceScore))}%` }}
          />
        </div>
        <span className="text-xs font-medium tabular-nums">{winner.confidenceScore}</span>
        <span className="text-[10px] text-muted-foreground">
          ({winner.votes}/{TOTAL_AGENTS} oy)
        </span>
      </div>

      {/* Ölçülen ticari veri — yoksa "—". */}
      <dl className="grid grid-cols-4 gap-2 text-center">
        <div className="rounded-lg bg-muted/30 py-2">
          <dt className="text-[10px] text-muted-foreground">Fiyat</dt>
          <dd className="text-sm font-semibold tabular-nums">{fmtPrice(winner.priceUsd)}</dd>
        </div>
        {/* Tedarik fiyatı ÖLÇÜLDÜYSE gösterilir. Boş kalmasının sebebi artık
            "kaynak yok" değil, bu ürüne alakalı toptan teklif bulunamaması —
            o durumda 0 yazmak yerine "—" yazılır. */}
        <div className="rounded-lg bg-muted/30 py-2">
          <dt className="text-[10px] text-muted-foreground">Tedarik</dt>
          <dd className="text-sm font-semibold tabular-nums">
            {winner.supplier?.supplierPriceUsd != null ? fmtPrice(winner.supplier.supplierPriceUsd) : "—"}
          </dd>
        </div>
        <div className="rounded-lg bg-muted/30 py-2">
          <dt className="text-[10px] text-muted-foreground">Puan</dt>
          <dd className="text-sm font-semibold tabular-nums">
            {typeof winner.rating === "number" ? `${winner.rating.toFixed(1)}/5` : "—"}
          </dd>
        </div>
        <div className="rounded-lg bg-muted/30 py-2">
          <dt className="text-[10px] text-muted-foreground">Ön skor</dt>
          <dd className="text-sm font-semibold tabular-nums">{fmt(winner.preScore)}</dd>
        </div>
      </dl>

      {/* Deterministic ön sinyaller — 14 ajanın ortak zemini. */}
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(SIGNAL_LABELS) as (keyof typeof SIGNAL_LABELS)[]).map((key) => (
          <span
            key={key}
            className={`rounded-md border border-border px-2 py-0.5 text-[10px] ${scoreTone(
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
        <p className="rounded-lg bg-primary/5 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground/80">Neden seçildi: </span>
          {reason}
        </p>
      )}

      {/* Ajan gerekçeleri — konsensüs tek başına "neden?" sorusunu yanıtlamaz. */}
      {winner.evidence.length > 0 && (
        <ul className="space-y-1 border-t border-border pt-3">
          {winner.evidence.slice(0, 3).map((e, i) => (
            <li key={i} className="text-[11px] text-muted-foreground leading-relaxed">
              {e}
            </li>
          ))}
        </ul>
      )}

      <footer className="flex items-center justify-between gap-2 border-t border-border pt-3 text-[11px]">
        <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
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
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            Kaynağa git <ExternalLink className="size-3" />
          </a>
        )}
      </footer>
    </article>
  );
}
