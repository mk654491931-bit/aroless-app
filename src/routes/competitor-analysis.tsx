import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft, Gauge, Globe, Lightbulb, Loader2, MessageSquareWarning, Search, Swords, TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { TARGET_COUNTRIES, DEFAULT_TARGET_COUNTRY, countryByCode } from "@/lib/countries";
import { analyzeCompetitors, type CompetitorReport } from "@/lib/competitor.functions";
import { CountryInfoBox } from "@/components/country-info-box";
import { CountryFlag } from "@/components/country-flag";
import { Sparkline } from "@/components/sparkline";
import { DraggableCopilot } from "@/components/draggable-copilot";

type SearchParams = { q?: string; country?: string };

export const Route = createFileRoute("/competitor-analysis")({
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    q: typeof s["q"] === "string" ? s["q"] : undefined,
    country: typeof s["country"] === "string" ? s["country"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Rakip Analizi — Velora" },
      { name: "description", content: "Bir ürün, ASIN veya mağaza URL'si gir; aktif satıcıları, fiyat trendlerini, müşteri şikâyetlerini ve AI karşı-strateji planını gör." },
      { property: "og:title", content: "Rakip Analizi — Velora" },
      { property: "og:description", content: "Aktif satıcı radarı, zayıflık analizi ve AI karşı-strateji playbook'u." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CompetitorAnalysisPage,
});

function CompetitorAnalysisPage() {
  const nav = useNavigate();
  const { user, loading } = useAuth();
  const search = Route.useSearch();
  const [query, setQuery] = useState(search.q ?? "");
  const [country, setCountry] = useState(search.country ?? DEFAULT_TARGET_COUNTRY);
  const [report, setReport] = useState<CompetitorReport | null>(null);
  const fn = useServerFn(analyzeCompetitors);

  useEffect(() => { if (!loading && !user) nav({ to: "/auth" }); }, [user, loading, nav]);

  const mut = useMutation({
    mutationFn: (q: string) => fn({ data: { query: q, country } }),
    onSuccess: (r) => setReport(r.report),
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    if (search.q && !report && !mut.isPending) mut.mutate(search.q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.q]);

  const c = countryByCode(country);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[oklch(0.16_0.03_265)]/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft size={15} /> Panele dön
          </Link>
          <h1 className="text-sm font-semibold flex items-center gap-2"><Swords size={15} /> Rakip Analizi</h1>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const q = query.trim();
            if (q.length < 2) return toast.error("Ürün adı, ASIN veya mağaza URL'si gir.");
            mut.mutate(q);
          }}
          className="premium-card grain rounded-2xl p-5 space-y-4"
        >
          <div>
            <label className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
              <Search size={12} /> Ürün / ASIN / Shopify · Etsy · eBay mağaza URL'si
            </label>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="örn. B0C7KMR9ZD, posture corrector, myshopify.com/store"
              maxLength={300}
              className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm outline-none focus:border-[oklch(0.68_0.20_265)]"
            />
          </div>
          <div className="grid md:grid-cols-[1fr_auto] gap-3 items-end">
            <div>
              <label className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground mb-2"><Globe size={12} /> Hedef Ülke</label>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm outline-none focus:border-[oklch(0.68_0.20_265)]"
              >
                {TARGET_COUNTRIES.map((tc) => (
                  <option key={tc.code} value={tc.code} className="bg-[oklch(0.20_0.035_265)]">{tc.flag} {tc.label}</option>
                ))}
              </select>
            </div>
            <button
              type="submit" disabled={mut.isPending}
              className="rounded-lg bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] px-5 py-2.5 text-sm font-semibold text-white glow disabled:opacity-60 inline-flex items-center gap-2"
            >
              {mut.isPending ? <><Loader2 size={16} className="animate-spin" /> Radar taranıyor…</> : <><Swords size={16} /> Rakipleri Tara</>}
            </button>
          </div>
        </form>

        <CountryInfoBox code={country} niche={query} />

        {report && (
          <>
            <section className="premium-card grain rounded-2xl p-5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h2 className="text-sm font-semibold flex items-center gap-2"><Gauge size={14} /> Aktif Satıcı Radarı — <CountryFlag code={country} size={13} /> {c.name}</h2>
                <span className="text-xs text-muted-foreground">Ortalama pazar fiyatı: <span className="text-foreground font-semibold">${report.avg_price_usd.toFixed(2)}</span></span>
              </div>
              {report.trend_monthly && report.trend_monthly.length > 1 && (
                <div className="mb-4 rounded-lg border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                    <span>Google Trends — son 30 gün arama ilgisi{report.trend_source === "estimated" ? " (tahmini)" : ""}</span>
                    <span className={(report.trend_momentum_pct ?? 0) >= 0 ? "text-emerald-400 font-semibold" : "text-rose-400 font-semibold"}>
                      {(report.trend_momentum_pct ?? 0) > 0 ? "+" : ""}{report.trend_momentum_pct ?? 0}%
                    </span>
                  </div>
                  <Sparkline values={report.trend_monthly} height={32} />
                </div>
              )}
              {report.sellers.length === 0 ? (
                <p className="text-xs text-muted-foreground">Bu sorgu için satıcı verisi bulunamadı — daha spesifik bir ürün adı ya da ASIN dene.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground">
                      <tr className="text-left">
                        {["Satıcı", "Domain / DA", "Platform", "Fiyat", "Fiyat trendi", "Aylık satış", "Stok", "Puan", "Trafik", "Marj notu"].map((h) => (
                          <th key={h} className="py-2 pr-3 font-medium whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.sellers.map((s, i) => (
                        <tr key={i} className="border-t border-white/10">
                          <td className="py-2 pr-3 font-semibold">{s.seller}</td>
                          <td className="py-2 pr-3">
                            {s.domain ? (
                              <span className="flex items-center gap-1.5">
                                <a href={s.url || `https://${s.domain}`} target="_blank" rel="noreferrer noopener" className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">
                                  {s.domain}
                                </a>
                                {typeof s.domain_rank === "number" && s.domain_rank > 0 && (
                                  <span className="rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-emerald-300">DA {s.domain_rank.toFixed(1)}</span>
                                )}
                              </span>
                            ) : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="py-2 pr-3">{s.platform}</td>
                          <td className="py-2 pr-3 whitespace-nowrap">${s.price_usd.toFixed(2)}</td>
                          <td className="py-2 pr-3 text-muted-foreground">{s.price_trend}</td>
                          <td className="py-2 pr-3">{s.est_monthly_sales.toLocaleString()}</td>
                          <td className="py-2 pr-3">{s.est_stock.toLocaleString()}</td>
                          <td className="py-2 pr-3">{s.rating.toFixed(1)}★</td>
                          <td className="py-2 pr-3">
                            <span className="flex flex-wrap gap-1">
                              {s.traffic_sources.map((t) => (
                                <span key={t} className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px]">{t}</span>
                              ))}
                            </span>
                          </td>
                          <td className="py-2 pr-3 text-muted-foreground max-w-[220px]">{s.margin_note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="premium-card grain rounded-2xl p-5">
              <h2 className="text-sm font-semibold flex items-center gap-2 mb-1"><MessageSquareWarning size={14} /> Zayıflık &amp; Şikâyet Analizi (Groq)</h2>
              <p className="text-xs text-muted-foreground mb-3">{report.sentiment_summary}</p>
              <div className="grid md:grid-cols-2 gap-3">
                {report.weaknesses.map((w, i) => (
                  <div key={i} className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-xs">
                    <div className="font-semibold text-rose-300">🔴 {w.complaint}</div>
                    <div className="text-muted-foreground mt-0.5">{w.frequency}</div>
                    <div className="mt-1.5 text-emerald-300">💡 {w.opportunity}</div>
                  </div>
                ))}
              </div>
            </section>

            {report.strategy && (
              <section className="premium-card grain rounded-2xl p-5">
                <h2 className="text-sm font-semibold flex items-center gap-2 mb-2"><Lightbulb size={14} /> AI Karşı-Strateji Planı (Gemini)</h2>
                <p className="text-sm font-semibold text-gradient">{report.strategy.headline}</p>
                <p className="text-xs text-muted-foreground mt-1.5">{report.strategy.positioning}</p>
                <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-xs flex items-start gap-2">
                  <TrendingUp size={13} className="mt-0.5 text-emerald-400" /> <span>{report.strategy.price_advice}</span>
                </div>
                <ol className="mt-3 space-y-1.5 text-xs text-muted-foreground list-decimal list-inside">
                  {report.strategy.playbook.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
                {report.strategy.ad_angle && (
                  <p className="mt-3 text-xs"><span className="text-muted-foreground">Reklam açısı: </span>“{report.strategy.ad_angle}”</p>
                )}
              </section>
            )}
          </>
        )}
      </main>

      <DraggableCopilot context={`Rakip analizi sayfası · sorgu: ${query} · ülke: ${c.name}`} />
    </div>
  );
}
