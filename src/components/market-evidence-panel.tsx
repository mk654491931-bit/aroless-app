import { BadgeCheck, ExternalLink, ShieldAlert, TrendingDown, TrendingUp } from "lucide-react";
import { realismStyle, realismVerdict, type MarketEvidence } from "@/lib/market-evidence";
import { Sparkline } from "@/components/sparkline";

export function RealismBadge({ score }: { score?: number }) {
  if (typeof score !== "number") return null;
  const v = realismVerdict(score);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold ${realismStyle(score)}`}
      title={`Canlı piyasa doğrulaması: ${v} (${score}/100)`}
    >
      {score >= 75 ? <BadgeCheck size={11} /> : <ShieldAlert size={11} />} {v} · {score}
    </span>
  );
}

/** Compact live-evidence strip shown on a product card. */
export function MarketEvidencePanel({ ev }: { ev?: MarketEvidence }) {
  if (!ev) return null;
  const up = ev.trend_momentum_pct >= 0;
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">🔎 Canlı piyasa kanıtı</span>
        <span className={up ? "text-emerald-300" : "text-rose-300"}>
          {up ? (
            <TrendingUp size={11} className="inline -mt-0.5" />
          ) : (
            <TrendingDown size={11} className="inline -mt-0.5" />
          )}{" "}
          {up ? "+" : ""}
          {ev.trend_momentum_pct}% / 30g
        </span>
      </div>

      {ev.trend_monthly.length > 3 && (
        <Sparkline values={ev.trend_monthly} className="h-8 w-full" />
      )}

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
        <span>
          Tedarik ~<b className="text-foreground">${ev.supplier_price_usd.toFixed(2)}</b>
          <span className="opacity-60">
            {" "}
            ({ev.supplier_source === "aliexpress" ? "AliExpress" : "tahmini"})
          </span>
        </span>
        {ev.market_price_usd > 0 && (
          <span>
            Piyasa medyanı <b className="text-foreground">${ev.market_price_usd.toFixed(2)}</b>
            {ev.price_delta_pct !== 0 && (
              <span className={Math.abs(ev.price_delta_pct) > 45 ? "text-amber-300" : "opacity-60"}>
                {" "}
                ({ev.price_delta_pct > 0 ? "+" : ""}
                {ev.price_delta_pct}% fark)
              </span>
            )}
          </span>
        )}
        <span>
          Talep kaynağı{" "}
          <b className="text-foreground">
            {ev.trend_source === "google-trends" ? "Google Trends" : "tahmini"}
          </b>
        </span>
      </div>

      {ev.sellers.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Canlı satıcı ilanları
          </div>
          <div className="max-h-24 space-y-1 overflow-y-auto pr-1">
            {ev.sellers.map((s) => (
              <a
                key={s.domain}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="flex items-center justify-between gap-2 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 hover:bg-white/10"
              >
                <span className="truncate">
                  <b className="text-foreground">{s.platform}</b> · {s.domain}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {s.price_usd > 0 ? `$${s.price_usd.toFixed(2)}` : "—"}{" "}
                  <ExternalLink size={10} className="inline -mt-0.5" />
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {(ev.verified_signals.length > 0 || ev.unverified_signals.length > 0) && (
        <div className="flex flex-wrap gap-1">
          {ev.verified_signals.map((s) => (
            <span
              key={s}
              className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-300"
            >
              ✓ {s}
            </span>
          ))}
          {ev.unverified_signals.map((s) => (
            <span
              key={s}
              className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-muted-foreground"
            >
              ~ {s}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
