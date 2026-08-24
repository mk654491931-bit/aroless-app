import { useQuery } from "@tanstack/react-query";
import { Bot, Loader2, ShieldAlert, Target, TrendingUp, Truck, X } from "lucide-react";
import { Sparkline } from "@/components/sparkline";
import { hybridBadge } from "@/lib/consensus-types";
import type { TrendItem } from "@/routes/api/public/predictive-trends";
import type { TrendAnalysis } from "@/routes/api/public/trend-analysis";
import { apiFetch } from "@/lib/api-client";

async function fetchAnalysis(p: TrendItem, country: string): Promise<TrendAnalysis> {
  const res = await apiFetch("/api/public/trend-analysis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...p, country }),
  });
  if (!res.ok) throw new Error("Analiz alınamadı");
  return (await res.json()) as TrendAnalysis;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-bold">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** Deep-dive for a Predictive Trends product: 4 AI engines + live market data. */
export function TrendAnalysisModal({
  product,
  country,
  onClose,
}: {
  product: TrendItem;
  country: string;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["trend-analysis", country, product.id],
    queryFn: () => fetchAnalysis(product, country),
    staleTime: 60 * 60 * 1000,
  });

  const badge = data ? hybridBadge(data.hybrid.calculated_score) : null;

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-3 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[88dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-[oklch(0.18_0.03_265)] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-extrabold">{product.name}</h3>
            <p className="text-[11px] text-muted-foreground">
              {product.category} · {product.marketplace} · Pazar: {country} · Peak:{" "}
              {product.peak_month}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 hover:bg-white/10"
            aria-label="Kapat"
          >
            <X size={16} />
          </button>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> 4 yapay zeka birlikte analiz ediyor…
          </div>
        )}
        {isError && (
          <p className="py-16 text-center text-sm text-muted-foreground">
            Analiz alınamadı, tekrar dene.
          </p>
        )}

        {data && (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] px-3 py-1 text-sm font-bold text-white">
                Hibrit Skor {data.hybrid.calculated_score}/100
              </span>
              {badge && (
                <span className={`rounded-full border px-2.5 py-1 text-[11px] ${badge.cls}`}>
                  {badge.label}
                </span>
              )}
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px]">
                {data.verdict}
              </span>
            </div>

            <Sparkline
              values={data.trends.yearly.length ? data.trends.yearly : product.series}
              height={56}
            />
            <p className="text-[10px] text-muted-foreground">
              12 aylık arama ilgisi · momentum {data.trends.momentum_pct >= 0 ? "+" : ""}
              {data.trends.momentum_pct}% ·{" "}
              {data.trends.source === "google-trends" ? "Google Trends" : "tahmini seri"}
            </p>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Stat
                label="AI 1 · Talep (Groq)"
                value={`${data.hybrid.ai_1_score}/100`}
                sub={`Rekabet: ${data.hybrid.local_competition_level}`}
              />
              <Stat
                label="AI 2 · Marj & Lojistik"
                value={`${data.hybrid.ai_2_score}/100`}
                sub={`~${data.hybrid.estimated_shipping_days} gün teslimat`}
              />
              <Stat
                label="Tedarik"
                value={`$${data.sourcing.supplier_price_usd} + $${data.sourcing.shipping_usd}`}
                sub={data.sourcing.source === "aliexpress" ? "AliExpress canlı" : "tahmini"}
              />
              <Stat
                label="Önerilen Satış"
                value={`$${data.pricing.suggested_retail_usd}`}
                sub={`Marj ~%${data.pricing.margin_pct}`}
              />
            </div>

            {(data.hybrid.market_note || data.hybrid.logistics_note) && (
              <div className="grid gap-2 sm:grid-cols-2 text-[11px]">
                {data.hybrid.market_note && (
                  <p className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
                    <TrendingUp size={11} className="mr-1 inline" />
                    {data.hybrid.market_note}
                  </p>
                )}
                {data.hybrid.logistics_note && (
                  <p className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
                    <Truck size={11} className="mr-1 inline" />
                    {data.hybrid.logistics_note}
                  </p>
                )}
              </div>
            )}

            {data.hybrid.alt_country_name && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-200">
                AI 3 · Daha güçlü pazar: <b>{data.hybrid.alt_country_name}</b> —{" "}
                {data.hybrid.alt_country_note}
              </p>
            )}

            {data.ai_comment && (
              <div className="rounded-xl border border-white/10 bg-gradient-to-br from-[oklch(0.68_0.20_265)]/10 to-transparent p-3">
                <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold">
                  <Bot size={13} /> AI Yorumu (4 motorun ortak kararı)
                </p>
                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  {data.ai_comment}
                </p>
              </div>
            )}

            {data.action_plan.length > 0 && (
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">
                  <Target size={13} /> Aksiyon Planı
                </p>
                <ol className="space-y-1 text-[11px] text-muted-foreground">
                  {data.action_plan.map((s, i) => (
                    <li
                      key={i}
                      className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5"
                    >
                      {i + 1}. {s}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {data.risks.length > 0 && (
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">
                  <ShieldAlert size={13} /> Riskler
                </p>
                <ul className="space-y-1 text-[11px] text-rose-200/80">
                  {data.risks.map((r, i) => (
                    <li key={i}>• {r}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
