import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3, Calculator, Download, FileText, Radar, Store, Swords, Target, X, Bot, Truck,
  Activity, Loader2, PackageSearch,
} from "lucide-react";
import type { WinningProduct } from "@/lib/gemini.functions";
import { ProductDeepDive } from "@/components/product-deep-dive";
import { CountryInfoBox } from "@/components/country-info-box";
import { CountryFlag } from "@/components/country-flag";
import { Sparkline } from "@/components/sparkline";
import { getMarketIntel } from "@/lib/market-data.functions";
import { useCountryMeta, useUsdRate } from "@/lib/rest-countries";
import { TARGET_COUNTRIES, countryByCode } from "@/lib/countries";


function Metric({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

/** Radar-style bar chart of the market breakdown for the selected country. */
function MarketRadar({ bars }: { bars: { label: string; value: number }[] }) {
  return (
    <div className="space-y-2">
      {bars.map((b) => (
        <div key={b.label}>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{b.label}</span><span className="text-foreground font-semibold">{Math.round(b.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-white/5 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)]"
              style={{ width: `${Math.max(2, Math.min(100, b.value))}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ProductDeepDiveModal({
  product, onClose, onSendToSimulator,
}: {
  product: WinningProduct | null;
  onClose: () => void;
  onSendToSimulator?: (p: WinningProduct) => void;
}) {
  const nav = useNavigate();
  const [country, setCountry] = useState(product?.hybrid?.target_country ?? "GLOBAL");
  const c = countryByCode(country);
  const meta = useCountryMeta(country);
  const localCur = meta.currency || c.currency;
  const rate = useUsdRate(localCur);
  const [showLocal, setShowLocal] = useState(false);

  const defaults = useMemo(() => {
    const money = (v: unknown, fb: number) => {
      const n = Number(String(v ?? "").replace(/[^0-9.]/g, ""));
      return Number.isFinite(n) && n > 0 ? n : fb;
    };
    const price = money(product?.selling_price_usd, 49);
    const cogs = money(product?.supplier_price_usd, Math.round(price * 0.3));
    const ship = money(product?.cost_breakdown?.shipping_cost, 6);
    return { price, cogs, ship };
  }, [product]);


  const [price, setPrice] = useState(defaults.price);
  const [cogs, setCogs] = useState(defaults.cogs);
  const [fees, setFees] = useState(defaults.ship);
  const [adCost, setAdCost] = useState(Math.round(defaults.price * 0.2));
  const [autoFilled, setAutoFilled] = useState(false);

  // Free external enrichment: Google Trends + AliExpress sourcing + Open Products Facts.
  const intelFn = useServerFn(getMarketIntel);
  const intel = useQuery({
    queryKey: ["market-intel", product?.name ?? "", country],
    enabled: Boolean(product?.name),
    staleTime: 10 * 60 * 1000,
    queryFn: () =>
      intelFn({
        data: {
          query: product?.name ?? "",
          country,
          selling_price_usd: defaults.price,
          barcode: String((product as { barcode?: string } | null)?.barcode ?? ""),
        },
      }),
  });

  const sourcing = intel.data?.sourcing;
  useEffect(() => {
    if (!sourcing || autoFilled) return;
    setCogs(sourcing.supplier_price_usd);
    setFees(sourcing.shipping_usd);
    setAutoFilled(true);
  }, [sourcing, autoFilled]);

  if (!product) return null;

  const vat = (price * c.vat_pct) / 100;
  const net = price - cogs - fees - adCost - vat;
  const marginPct = price > 0 ? (net / price) * 100 : 0;

  const canLocal = showLocal && rate > 0 && localCur !== "USD";
  const sym = canLocal ? (meta.currencySymbol || localCur) : "$";
  const fx = (usd: number) => (canLocal ? usd * rate : usd);
  const fmt = (usd: number, digits = 2) =>
    `${sym}${fx(usd).toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

  const trends = intel.data?.trends;
  const physical = intel.data?.physical;

  const h = product.hybrid;
  const bars = [
    { label: "Pazar talebi (Groq)", value: h?.ai_1_score ?? 50 },
    { label: "Kâr & lojistik (Gemini)", value: h?.ai_2_score ?? 50 },
    { label: "Hibrit skor", value: h?.calculated_score ?? 50 },
    { label: "Vergi yükü (ters)", value: 100 - c.vat_pct * 3 },
    { label: "Teslimat hızı", value: Math.max(5, 100 - (h?.estimated_shipping_days ?? 12) * 4) },
  ];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-3" onClick={onClose}>
      <div
        className="premium-card grain rounded-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <span className="text-2xl">{product.emoji || "🛍️"}</span> {product.name}
            </h2>
            <p className="text-xs text-muted-foreground">Derinlemesine pazar, kârlılık ve AI analizi</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10" aria-label="Kapat"><X size={16} /></button>
        </div>

        {/* 1 — Target market breakdown */}
        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4 mb-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h3 className="text-sm font-semibold flex items-center gap-2"><Radar size={14} /> Hedef Pazar Analizi</h3>
            <div className="flex items-center gap-2">
              <CountryFlag code={country} size={14} />
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5 text-xs outline-none focus:border-[oklch(0.68_0.20_265)]"
              >
                {TARGET_COUNTRIES.map((tc) => (
                  <option key={tc.code} value={tc.code} className="bg-[oklch(0.20_0.035_265)]">{tc.flag} {tc.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <MarketRadar bars={bars} />
            <div className="grid grid-cols-2 gap-2">
              <Metric label="Hibrit skor" value={`${h?.calculated_score ?? "—"}/100`} />
              <Metric label="Rekabet" value={h?.local_competition_level ?? "—"} />
              <Metric label="Teslimat" value={`${h?.estimated_shipping_days ?? "—"} gün`} />
              <Metric label="Vergi" value={c.vat_label} />
            </div>
          </div>
        </section>

        {/* 1b — Google Trends search interest */}
        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4 mb-4">
          <div className="flex items-center justify-between gap-3 mb-2">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Activity size={14} /> Arama İlgisi — Google Trends
            </h3>
            {intel.isPending ? (
              <Loader2 size={13} className="animate-spin text-muted-foreground" />
            ) : trends ? (
              <span className={`text-xs font-semibold ${trends.momentum_pct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                30g momentum: {trends.momentum_pct > 0 ? "+" : ""}{trends.momentum_pct}%
              </span>
            ) : null}
          </div>
          {trends && (
            <>
              <Sparkline values={trends.yearly} />
              <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>Son 12 ay</span>
                <span>{trends.source === "google-trends" ? "Kaynak: Google Trends" : "Tahmini seri (Trends erişilemedi)"}</span>
              </div>
              <div className="mt-3">
                <Sparkline values={trends.monthly} height={28} />
                <div className="text-[10px] text-muted-foreground mt-1">Son 30 gün</div>
              </div>
            </>
          )}
        </section>

        <div className="mb-4"><CountryInfoBox code={country} niche={product.name} /></div>

        {/* 2 — Profitability calculator */}
        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4 mb-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Calculator size={14} /> Kârlılık Hesaplayıcı (<CountryFlag code={country} size={12} /> {c.vat_label})
            </h3>
            <div className="inline-flex rounded-lg border border-white/10 bg-white/5 p-0.5 text-[11px] font-semibold">
              <button
                type="button" onClick={() => setShowLocal(false)}
                className={`px-2.5 py-1 rounded-md ${!showLocal ? "bg-white/10 text-foreground" : "text-muted-foreground"}`}
              >USD $</button>
              <button
                type="button" onClick={() => setShowLocal(true)}
                disabled={rate <= 0 || localCur === "USD"}
                className={`px-2.5 py-1 rounded-md disabled:opacity-40 ${showLocal ? "bg-white/10 text-foreground" : "text-muted-foreground"}`}
              >{localCur} {meta.currencySymbol}</button>
            </div>
          </div>
          {canLocal && (
            <p className="text-[10px] text-muted-foreground mb-2">
              Frankfurter canlı kuru: 1 USD = {rate.toFixed(4)} {localCur} · girişler USD, sonuçlar {localCur}
            </p>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {([
              ["Satış fiyatı ($)", price, setPrice],
              ["Tedarik / COGS ($)", cogs, setCogs],
              ["FBA + kargo ($)", fees, setFees],
              ["Reklam / CAC ($)", adCost, setAdCost],
            ] as const).map(([label, val, set]) => (
              <label key={label} className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {label}
                <input
                  type="number" min={0} value={val}
                  onChange={(e) => set(Math.max(0, Number(e.target.value) || 0))}
                  className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-[oklch(0.68_0.20_265)]"
                />
              </label>
            ))}
          </div>
          {sourcing && (
            <p className="mt-2 text-[10px] text-muted-foreground flex items-center gap-1.5">
              <PackageSearch size={11} />
              {sourcing.source === "aliexpress"
                ? `AliExpress tedarik verisi ile otomatik dolduruldu (~$${sourcing.supplier_price_usd}).`
                : `Tedarik maliyeti tahmini olarak dolduruldu (~$${sourcing.supplier_price_usd}).`}
              {physical?.found && physical.weight_g ? ` · Ürün ağırlığı ${physical.weight_g}g (Open Products Facts) — kargo/KDV hesabına eklendi.` : ""}
            </p>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
            <Metric label={`KDV / Gümrük (${c.vat_pct}%)`} value={`-${fmt(vat)}`} tone="text-amber-300" />
            <Metric label="Net kâr / adet" value={fmt(net)} tone={net >= 0 ? "text-emerald-400" : "text-rose-400"} />
            <Metric label="Net marj" value={`${marginPct.toFixed(1)}%`} tone={marginPct >= 20 ? "text-emerald-400" : "text-rose-400"} />
            <Metric label="100 satışta" value={fmt(net * 100, 0)} />
          </div>
        </section>


        {/* 3 — Raw dual-agent reports */}
        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4 mb-4">
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-3"><BarChart3 size={14} /> AI Çift-Ajan Ham Raporu</h3>
          <div className="grid md:grid-cols-2 gap-3 text-xs">
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <div className="text-[10px] uppercase tracking-wider text-[oklch(0.85_0.15_265)] mb-1 flex items-center gap-1.5"><Target size={11} /> Groq — Talep &amp; Rekabet ({h?.ai_1_score ?? "—"}/100)</div>
              <p className="text-muted-foreground">{h?.market_note || "Bu ürün için pazar notu üretilmedi."}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <div className="text-[10px] uppercase tracking-wider text-[oklch(0.85_0.15_265)] mb-1 flex items-center gap-1.5"><Truck size={11} /> Gemini — Lojistik &amp; Vergi ({h?.ai_2_score ?? "—"}/100)</div>
              <p className="text-muted-foreground">{h?.logistics_note || "Lojistik notu üretilmedi."}</p>
            </div>
          </div>
          {h?.tooltip && <p className="mt-2 text-xs text-muted-foreground flex items-start gap-1.5"><Bot size={12} className="mt-0.5" /> {h.tooltip}</p>}
        </section>

        <ProductDeepDive p={product} />

        {/* 4 — One-click actions */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 mt-5">
          <button onClick={() => window.print()} className="rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-2 text-xs font-semibold flex items-center justify-center gap-1.5">
            <FileText size={13} /> PDF Dışa Aktar
          </button>
          <button
            onClick={() => { onSendToSimulator?.(product); onClose(); }}
            className="rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-2 text-xs font-semibold flex items-center justify-center gap-1.5"
          >
            <Store size={13} /> Simülatöre Gönder
          </button>
          <button
            onClick={() => nav({ to: "/competitor-analysis", search: { q: product.name, country } })}
            className="rounded-lg bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] px-3 py-2 text-xs font-semibold text-white flex items-center justify-center gap-1.5"
          >
            <Swords size={13} /> Rakipleri Analiz Et
          </button>
          <button
            onClick={() => {
              const blob = new Blob([JSON.stringify(product, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url; a.download = `${product.name.replace(/\s+/g, "-").toLowerCase()}.json`; a.click();
              URL.revokeObjectURL(url);
            }}
            className="rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-2 text-xs font-semibold flex items-center justify-center gap-1.5"
          >
            <Download size={13} /> Ürünü Takip Et / İndir
          </button>
        </div>
      </div>
    </div>
  );
}
