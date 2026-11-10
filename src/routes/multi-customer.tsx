import { useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Brain,
  CheckCircle2,
  ChevronDown,
  Download,
  ExternalLink,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  XCircle,
} from "lucide-react";
import { withProGate } from "@/components/pro-route-gate";
import { PageHero } from "@/components/page-hero";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CreditCost } from "@/components/credit-cost";
import {
  DISTRIBUTION_DIMENSIONS,
  simulateMultiCustomer,
  type DistributionRow,
  type MultiCustomerResult,
  type Persona,
} from "@/lib/multi-customer";
import {
  getMultiCustomerProducts,
  getSelectedMultiCustomerProduct,
  selectMultiCustomerProduct,
  type StoredSimulationProduct,
} from "@/lib/multi-customer-store";
import { explainMultiCustomer, type MultiCustomerAiInsight } from "@/lib/multi-customer.functions";

export const Route = createFileRoute("/multi-customer")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Multi Customer — 1.000 kişilik alıcı simülasyonu | Aroless" },
      {
        name: "description",
        content:
          "Seçtiğin ürünü 1.000 farklı sentetik karakterin gözünden simüle et: kimler alır, kimler almaz, hangi segmentte dönüşüm yüksek?",
      },
      { property: "og:title", content: "Multi Customer — 1.000 kişilik alıcı simülasyonu" },
      {
        property: "og:description",
        content: "Kimler alır, kimler almaz? 1.000 karakterlik dağılım ve itiraz analizi.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: withProGate(MultiCustomerPage),
});

function fmtPct(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

function Kpi({
  label,
  value,
  hint,
  tone = "text-foreground",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.035] p-3.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-black tabular-nums ${tone}`}>{value}</div>
      {hint && <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{hint}</div>}
    </div>
  );
}

function PersonaDots({ personas }: { personas: Persona[] }) {
  return (
    <div className="overflow-x-auto">
      <div
        className="grid min-w-[520px] gap-[2px]"
        style={{ gridTemplateColumns: "repeat(50, minmax(0, 1fr))" }}
        aria-label="1.000 kişilik panel: yeşil alır, gri almaz"
      >
        {personas.map((persona) => (
          <span
            key={persona.id}
            title={`${persona.id} · ${persona.label} · ${persona.buy ? "Alır" : "Almaz"} · eğilim ${fmtPct(persona.propensity * 100, 0)}`}
            className={`aspect-square rounded-[1px] transition-transform hover:scale-150 ${
              persona.buy
                ? "bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.35)]"
                : "bg-white/[0.14] hover:bg-white/25"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function DistributionCard({
  title,
  hint,
  rows,
  overallRate,
}: {
  title: string;
  hint: string;
  rows: DistributionRow[];
  overallRate: number;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-xs font-bold">{title}</h3>
          <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">{hint}</p>
        </div>
        <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[9px] text-muted-foreground">
          1.000 kişi
        </span>
      </div>
      <div className="mt-3 space-y-2.5">
        {rows.map((row) => {
          const above = row.ratePct >= overallRate;
          return (
            <div key={row.label}>
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="truncate font-medium">{row.label}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  <span className={above ? "font-semibold text-emerald-300" : "text-foreground/80"}>
                    {row.buyers}
                  </span>
                  /{row.total} · {fmtPct(row.ratePct)}
                </span>
              </div>
              <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full ${above ? "bg-emerald-400/90" : "bg-amber-400/70"}`}
                  style={{ width: `${Math.max(0, Math.min(100, row.ratePct))}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PersonaCard({ persona }: { persona: Persona }) {
  return (
    <div
      className={`rounded-xl border p-3 ${
        persona.buy
          ? "border-emerald-500/25 bg-emerald-500/[0.055]"
          : "border-white/10 bg-white/[0.025]"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            <span className="font-mono">{persona.id}</span>
            <span>·</span>
            <span>{persona.decisionStyle}</span>
          </div>
          <div className="mt-0.5 truncate text-xs font-bold">{persona.label}</div>
        </div>
        <Badge
          variant="outline"
          className={`shrink-0 text-[9px] ${
            persona.buy
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              : "border-white/15 bg-white/5 text-muted-foreground"
          }`}
        >
          {persona.buy ? "Alır" : "Almaz"}
        </Badge>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {[persona.channel, persona.incomeBand, persona.priceSensitivity, persona.priceFit].map(
          (trait) => (
            <span
              key={trait}
              className="rounded-full border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[9px] text-muted-foreground"
            >
              {trait}
            </span>
          ),
        )}
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
        <div
          className={persona.buy ? "h-full bg-emerald-400" : "h-full bg-amber-400/70"}
          style={{ width: `${Math.max(2, Math.min(100, persona.propensity * 100))}%` }}
        />
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
        <span
          className={
            persona.buy ? "font-semibold text-emerald-300" : "font-semibold text-amber-300"
          }
        >
          {persona.buy ? "Neden alır: " : "Neden almaz: "}
        </span>
        {persona.buy ? persona.topReason : persona.topObjection}
      </p>
    </div>
  );
}

function ProductSummary({
  selected,
  recent,
  onSelect,
}: {
  selected: StoredSimulationProduct;
  recent: StoredSimulationProduct[];
  onSelect: (item: StoredSimulationProduct) => void;
}) {
  const product = selected.product;
  return (
    <div className="mb-5 rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.055] to-white/[0.015] p-4">
      <div className="flex flex-wrap items-start gap-4">
        {selected.imageUrl ? (
          <img
            src={selected.imageUrl}
            alt=""
            className="h-20 w-20 shrink-0 rounded-xl border border-white/10 bg-white/5 object-cover"
            onError={(event) => (event.currentTarget.style.display = "none")}
          />
        ) : (
          <div className="grid h-20 w-20 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/5 text-2xl">
            🛍️
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="border-sky-500/35 bg-sky-500/10 text-[9px] text-sky-300"
            >
              Seçili ürün
            </Badge>
            {selected.winnerScore !== null && (
              <Badge variant="outline" className="text-[9px]">
                Winner score {selected.winnerScore}/100
              </Badge>
            )}
            {product.platform && (
              <span className="text-[10px] text-muted-foreground">{product.platform}</span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-lg font-bold">{product.name}</h2>
            <span className="text-sm font-semibold text-emerald-300">
              {typeof product.sellingPriceUsd === "number"
                ? `$${product.sellingPriceUsd.toFixed(2)}`
                : "Fiyat ölçülmedi"}
            </span>
          </div>
          {product.description && (
            <p className="mt-1 line-clamp-2 max-w-3xl text-xs leading-relaxed text-muted-foreground">
              {product.description}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {recent.length > 1 && (
              <label className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <ChevronDown size={11} />
                <select
                  value={selected.key}
                  onChange={(event) => {
                    const next = recent.find((item) => item.key === event.target.value);
                    if (next) onSelect(next);
                  }}
                  className="max-w-[240px] rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-foreground outline-none focus:border-[var(--accent-active)]"
                >
                  {recent.map((item) => (
                    <option key={item.key} value={item.key} className="bg-[oklch(0.20_0.035_255)]">
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {selected.sourceUrl && (
              <a
                href={selected.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[10px] text-sky-300 hover:underline"
              >
                Kaynak sayfayı aç <ExternalLink size={9} />
              </a>
            )}
            <Link
              to="/"
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft size={10} /> Ürün Bulucu'ya dön
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function AiInsightPanel({
  selected,
  ai,
  pending,
  error,
  onRun,
}: {
  selected: StoredSimulationProduct;
  ai: MultiCustomerAiInsight | null;
  pending: boolean;
  error: string | null;
  onRun: () => void;
}) {
  return (
    <section className="premium-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Brain size={15} className="text-[var(--ai)]" /> AI strateji yorumu
          </h2>
          <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-muted-foreground">
            1.000 kişilik panel yerelde hesaplanır. AI yalnızca bu sonucu okunur bir kimler-alır /
            kimler-almaz planına çevirir; kişi başına ayrı çağrı yapmaz.
          </p>
        </div>
        <CreditCost amount={1} label="1 kredi · tek AI çağrısı" />
      </div>

      {!ai && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-3 gap-1.5"
          onClick={onRun}
          disabled={pending}
        >
          {pending ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          {pending ? "Yorum üretiliyor…" : "AI ile yorumla"}
        </Button>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-200">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {ai && (
        <div className="mt-3 space-y-3">
          <p className="rounded-xl border border-[var(--ai)]/20 bg-[var(--ai)]/[0.06] p-3 text-xs leading-relaxed">
            {ai.summary}
          </p>
          <div className="grid gap-2 md:grid-cols-2">
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.05] p-3">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                <CheckCircle2 size={11} /> Kimler alır
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                {ai.buyer_profile || "AI bu alanı boş bıraktı."}
              </p>
            </div>
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.05] p-3">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                <XCircle size={11} /> Kimler almaz
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                {ai.non_buyer_profile || "AI bu alanı boş bıraktı."}
              </p>
            </div>
          </div>

          {ai.segments.length > 0 && (
            <div className="grid gap-2 md:grid-cols-3">
              {ai.segments.map((segment) => (
                <div
                  key={segment.label}
                  className="rounded-xl border border-white/10 bg-white/[0.025] p-3"
                >
                  <div className="text-xs font-bold">{segment.label}</div>
                  <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                    {segment.verdict}
                  </p>
                  <p className="mt-1.5 text-[10px] leading-relaxed text-emerald-300/90">
                    → {segment.action}
                  </p>
                </div>
              ))}
            </div>
          )}

          {ai.actions.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Uygulama sırası
              </div>
              <ol className="space-y-1">
                {ai.actions.map((action, index) => (
                  <li
                    key={index}
                    className="flex gap-2 text-[11px] leading-relaxed text-muted-foreground"
                  >
                    <span className="grid size-4 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-[9px]">
                      {index + 1}
                    </span>
                    {action}
                  </li>
                ))}
              </ol>
            </div>
          )}

          <p className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
            <ShieldCheck size={11} className="mt-0.5 shrink-0" /> {ai.caveat}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={onRun}
            disabled={pending}
          >
            {pending ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Yeniden yorumla
          </Button>
        </div>
      )}

      <p className="mt-2 text-[10px] text-muted-foreground">
        Seçili ürün: {selected.name} · AI anahtarı yapılandırılmamışsa yalnız bu yorum devre dışı
        kalır; panel sonucu çalışmaya devam eder.
      </p>
    </section>
  );
}

function PersonaExplorer({ result }: { result: MultiCustomerResult }) {
  const [query, setQuery] = useState("");
  const [decision, setDecision] = useState<"all" | "buy" | "no">("all");
  const [style, setStyle] = useState("all");
  const [page, setPage] = useState(0);
  const pageSize = 24;

  const styles = useMemo(
    () => [...new Set(result.personas.map((persona) => persona.decisionStyle))].sort(),
    [result.personas],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return result.personas.filter((persona) => {
      if (decision === "buy" && !persona.buy) return false;
      if (decision === "no" && persona.buy) return false;
      if (style !== "all" && persona.decisionStyle !== style) return false;
      if (!needle) return true;
      return [
        persona.id,
        persona.label,
        persona.decisionStyle,
        persona.channel,
        persona.incomeBand,
        persona.interest,
        persona.topReason,
        persona.topObjection,
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [decision, query, result.personas, style]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const rows = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const update = <T,>(setter: (value: T) => void, value: T) => {
    setter(value);
    setPage(0);
  };

  const downloadCsv = () => {
    const header = [
      "id",
      "karar",
      "yas",
      "cinsiyet",
      "gelir",
      "karar_tarzi",
      "kanal",
      "fiyat_hassasiyeti",
      "fiyat_uyumu",
      "ilgi_alani",
      "egilim_pct",
      "neden",
      "itiraz",
    ];
    const lines = filtered.map((persona) =>
      [
        persona.id,
        persona.buy ? "alir" : "almaz",
        persona.age,
        persona.gender,
        persona.incomeBand,
        persona.decisionStyle,
        persona.channel,
        persona.priceSensitivity,
        persona.priceFit,
        persona.interest,
        (persona.propensity * 100).toFixed(1),
        persona.topReason,
        persona.topObjection,
      ]
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(","),
    );
    const blob = new Blob([`\uFEFF${[header.join(","), ...lines].join("\n")}`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "multi-customer-1000.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="premium-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Users size={15} className="text-[var(--accent-active)]" /> 1.000 karakteri keşfet
          </h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Her satır sentetik bir persona; gerçek kişi değildir. Filtrele, nedenini oku, CSV indir.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="gap-1.5"
          onClick={downloadCsv}
        >
          <Download size={12} /> CSV indir ({filtered.length})
        </Button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_180px]">
        <label className="relative">
          <Search
            size={13}
            className="pointer-events-none absolute left-2.5 top-2 text-muted-foreground"
          />
          <input
            value={query}
            onChange={(event) => update(setQuery, event.target.value)}
            placeholder="İsim, segment, kanal veya itiraz ara…"
            className="w-full rounded-lg border border-white/10 bg-white/5 py-1.5 pl-8 pr-2.5 text-xs outline-none placeholder:text-muted-foreground focus:border-[var(--accent-active)]"
          />
        </label>
        <select
          value={decision}
          onChange={(event) => update(setDecision, event.target.value as "all" | "buy" | "no")}
          className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs outline-none focus:border-[var(--accent-active)]"
        >
          <option value="all" className="bg-[oklch(0.20_0.035_255)]">
            Tüm kararlar
          </option>
          <option value="buy" className="bg-[oklch(0.20_0.035_255)]">
            Sadece alır
          </option>
          <option value="no" className="bg-[oklch(0.20_0.035_255)]">
            Sadece almaz
          </option>
        </select>
        <select
          value={style}
          onChange={(event) => update(setStyle, event.target.value)}
          className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs outline-none focus:border-[var(--accent-active)]"
        >
          <option value="all" className="bg-[oklch(0.20_0.035_255)]">
            Tüm karar tarzları
          </option>
          {styles.map((option) => (
            <option key={option} value={option} className="bg-[oklch(0.20_0.035_255)]">
              {option}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span>{filtered.length} karakter eşleşti</span>
        <span>
          Sayfa {safePage + 1}/{totalPages}
        </span>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((persona) => (
          <PersonaCard key={persona.id} persona={persona} />
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="mt-4 rounded-xl border border-dashed border-white/15 p-4 text-center text-xs text-muted-foreground">
          Bu filtreyle eşleşen karakter yok. Filtreleri sıfırlayıp tekrar dene.
        </p>
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setPage(Math.max(0, safePage - 1))}
          disabled={safePage === 0}
        >
          Önceki
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setPage(Math.min(totalPages - 1, safePage + 1))}
          disabled={safePage >= totalPages - 1}
        >
          Sonraki
        </Button>
      </div>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="premium-card p-8 text-center">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-sky-500/30 bg-sky-500/10 text-sky-300">
        <Users size={28} />
      </div>
      <h2 className="mt-4 text-lg font-bold">Önce bir ürün seç</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
        Ürün Bulucu'da bir ürün aç, kartındaki <strong>Multi Customer · 1.000 kişi</strong>{" "}
        düğmesine tek tıkla. Seçtiğin ürün burada 1.000 farklı karakterin gözünden simüle edilir.
      </p>
      <Link
        to="/"
        className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-sky-500 to-violet-500 px-4 py-2 text-sm font-semibold text-white"
      >
        <ArrowLeft size={14} /> Ürün Bulucu'ya git
      </Link>
    </div>
  );
}

function MultiCustomerContent() {
  const [selected, setSelected] = useState<StoredSimulationProduct | null>(() =>
    getSelectedMultiCustomerProduct(),
  );
  const [recent, setRecent] = useState<StoredSimulationProduct[]>(() => getMultiCustomerProducts());
  const [ai, setAi] = useState<MultiCustomerAiInsight | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [showAllDimensions, setShowAllDimensions] = useState(false);
  const aiFn = useServerFn(explainMultiCustomer);
  const aiRequestId = useRef(0);

  const result = useMemo(
    () => (selected ? simulateMultiCustomer(selected.product) : null),
    [selected],
  );

  type AiInput = {
    productName: string;
    priceUsd: number | null;
    platform: string;
    audience: string;
    buyers: number;
    nonBuyers: number;
    penetrationPct: number;
    confidencePct: number;
    signals: string[];
    missingSignals: string[];
    segments: Array<{ label: string; total: number; buyers: number; ratePct: number }>;
    reasons: Array<{ label: string; count: number }>;
    objections: Array<{ label: string; count: number }>;
  };

  const aiMut = useMutation({
    mutationFn: (input: AiInput) => aiFn({ data: input }),
  });

  const choose = (item: StoredSimulationProduct) => {
    const next = selectMultiCustomerProduct(item.key);
    if (!next) return;
    // Devam eden AI isteği eski ürüne ait olabilir; yanıtı artık kabul etme.
    aiRequestId.current += 1;
    setSelected(next);
    setRecent(getMultiCustomerProducts());
    setAi(null);
    setAiError(null);
    aiMut.reset();
  };

  const runAi = () => {
    if (!result || !selected) return;
    const requestId = ++aiRequestId.current;
    aiMut.mutate(
      {
        productName: selected.product.name,
        priceUsd: result.product.priceUsd,
        platform: selected.product.platform ?? "",
        audience: selected.product.targetAudience ?? "",
        buyers: result.buyers,
        nonBuyers: result.nonBuyers,
        penetrationPct: result.penetrationPct,
        confidencePct: result.confidencePct,
        signals: result.product.signalsUsed,
        missingSignals: result.product.missingSignals,
        segments: result.distributions.decisionStyle.map((row) => ({
          label: row.label,
          total: row.total,
          buyers: row.buyers,
          ratePct: row.ratePct,
        })),
        reasons: result.topReasons.map((item) => ({ label: item.label, count: item.count })),
        objections: result.topObjections.map((item) => ({ label: item.label, count: item.count })),
      },
      {
        onSuccess: (data) => {
          if (requestId !== aiRequestId.current) return;
          setAi(data);
          setAiError(null);
        },
        onError: (error: Error) => {
          if (requestId !== aiRequestId.current) return;
          const message = error.message || "";
          setAiError(
            message.includes("NO_CREDITS")
              ? "Kredi yetersiz. AI yorumu için 1 kredi gerekiyor."
              : message.includes("PLAN_LIMIT")
                ? "Bu ayki AI kullanım hakkın doldu. Panel sonucu yine de kullanılabilir."
                : message.includes("UNAVAILABLE") || message.includes("CREDIT_DEDUCT_FAILED")
                  ? "Kredi doğrulanamadı. AI yorumu şu an başlatılamadı."
                  : "AI yorumu alınamadı. 1.000 kişilik panel sonucu geçerli; daha sonra tekrar deneyebilirsin.",
          );
        },
      },
    );
  };

  if (!selected) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8">
        <PageHero
          icon={<Users size={18} />}
          title="Multi Customer"
          description="1.000 farklı karakterin gözünden kimler alır, kimler almaz?"
        />
        <EmptyState />
      </main>
    );
  }

  if (!result) return null;
  const overallRate = result.penetrationPct;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <PageHero
        icon={<Users size={18} />}
        title="Multi Customer"
        description="Seçili ürünü 1.000 farklı sentetik karakterin gözünden simüle et. Kimler alır, kimler almaz, hangi itiraz tekrar ediyor?"
        actions={
          <>
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs hover:bg-white/10"
            >
              <ArrowLeft size={13} /> Ürün Bulucu
            </Link>
            <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1.5 text-[10px] font-semibold text-sky-300">
              <Activity size={11} /> 1.000 kişi · simülasyon
            </span>
          </>
        }
      />

      <ProductSummary selected={selected} recent={recent} onSelect={choose} />

      <section className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Panel"
          value={result.panelSize.toLocaleString("tr-TR")}
          hint="Sentetik karakter; gerçek anket değil."
        />
        <Kpi
          label="Alır"
          value={result.buyers.toLocaleString("tr-TR")}
          tone="text-emerald-300"
          hint={`${fmtPct(overallRate)} · ${result.nonBuyers} kişi almaz`}
        />
        <Kpi
          label="En açık segment"
          value={result.topBuyerSegments[0]?.label ?? "—"}
          tone="text-sky-300"
          hint={
            result.topBuyerSegments[0]
              ? `${result.topBuyerSegments[0].buyers}/${result.topBuyerSegments[0].total} · ${fmtPct(result.topBuyerSegments[0].ratePct)}`
              : "Yeterli segment yok"
          }
        />
        <Kpi
          label="Model güveni"
          value={fmtPct(result.confidencePct, 0)}
          tone="text-amber-300"
          hint={`${result.product.signalsUsed.length}/6 ölçülü sinyal kullanıldı`}
        />
      </section>

      <section className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="premium-card p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-bold">
                <Users size={15} className="text-emerald-300" /> 1.000 kişilik panel
              </h2>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Yeşil: alır · gri: almaz. Noktaya gelerek karakterin kimliğini ve eğilimini gör.
              </p>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className="size-2 rounded-sm bg-emerald-400" /> Alır {result.buyers}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="size-2 rounded-sm bg-white/20" /> Almaz {result.nonBuyers}
              </span>
            </div>
          </div>
          <div className="mt-4">
            <PersonaDots personas={result.personas} />
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.05] p-3">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                <CheckCircle2 size={11} /> Kimler alır?
              </div>
              <ul className="mt-1.5 space-y-1">
                {result.topBuyerSegments.slice(0, 3).map((segment) => (
                  <li key={segment.label} className="text-[11px] text-muted-foreground">
                    <span className="font-semibold text-foreground/85">{segment.label}</span> ·{" "}
                    {segment.buyers}/{segment.total} ({fmtPct(segment.ratePct)})
                  </li>
                ))}
              </ul>
              {result.topReasons.slice(0, 2).map((reason) => (
                <p
                  key={reason.label}
                  className="mt-1 text-[10px] leading-relaxed text-emerald-300/85"
                >
                  + {reason.label} ({reason.count})
                </p>
              ))}
            </div>
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.05] p-3">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                <XCircle size={11} /> Kimler almaz?
              </div>
              <ul className="mt-1.5 space-y-1">
                {result.topNonBuyerSegments.slice(0, 3).map((segment) => (
                  <li key={segment.label} className="text-[11px] text-muted-foreground">
                    <span className="font-semibold text-foreground/85">{segment.label}</span> ·{" "}
                    {segment.nonBuyers}/{segment.total} almaz
                  </li>
                ))}
              </ul>
              {result.topObjections.slice(0, 2).map((item) => (
                <p key={item.label} className="mt-1 text-[10px] leading-relaxed text-amber-200/90">
                  − {item.label} ({item.count})
                </p>
              ))}
            </div>
          </div>
        </div>

        <div className="premium-card p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Filter size={15} className="text-[var(--accent-active)]" /> Dağılım özeti
          </h2>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {result.narrative}
          </p>
          <div className="mt-3 space-y-2">
            {result.topObjections.slice(0, 3).map((item) => (
              <div
                key={item.label}
                className="rounded-lg border border-white/10 bg-white/[0.025] p-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[11px] font-semibold text-amber-200">{item.label}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {item.count} kişi
                  </span>
                </div>
                <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                  Düzeltme: {item.fix}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mb-4">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold">
              <Activity size={15} className="text-[var(--accent-active)]" /> 1.000 karakterin
              dağılımı
            </h2>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Her satır o segmentteki alıcı oranını gösterir; yeşil çubuk alır, kalanı almaz.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">
              Genel alım eğilimi: {fmtPct(overallRate)}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[10px]"
              onClick={() => setShowAllDimensions((value) => !value)}
            >
              {showAllDimensions ? "Özet (6)" : `Tüm boyutlar (${DISTRIBUTION_DIMENSIONS.length})`}
            </Button>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {DISTRIBUTION_DIMENSIONS.slice(
            0,
            showAllDimensions ? DISTRIBUTION_DIMENSIONS.length : 6,
          ).map((dimension) => (
            <DistributionCard
              key={dimension.key}
              title={dimension.label}
              hint={dimension.hint}
              rows={result.distributions[dimension.key]}
              overallRate={overallRate}
            />
          ))}
        </div>
      </section>

      <section className="mb-4 grid gap-3 lg:grid-cols-2">
        <div className="premium-card p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-emerald-300">
            <CheckCircle2 size={15} /> Alır: örnek karakterler
          </h2>
          <div className="mt-3 space-y-2">
            {result.buyerExamples.slice(0, 4).map((persona) => (
              <div
                key={persona.id}
                className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold">{persona.label}</span>
                  <span className="text-[10px] font-mono text-emerald-300">
                    {fmtPct(persona.propensity * 100, 0)}
                  </span>
                </div>
                <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                  {persona.decisionStyleNote}
                </p>
                <p className="mt-1 text-[10px] leading-relaxed text-emerald-300/85">
                  + {persona.topReason}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div className="premium-card p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-amber-300">
            <XCircle size={15} /> Almaz: örnek karakterler
          </h2>
          <div className="mt-3 space-y-2">
            {result.nonBuyerExamples.slice(0, 4).map((persona) => (
              <div
                key={persona.id}
                className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold">{persona.label}</span>
                  <span className="text-[10px] font-mono text-amber-300">
                    {fmtPct(persona.propensity * 100, 0)}
                  </span>
                </div>
                <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                  {persona.decisionStyleNote}
                </p>
                <p className="mt-1 text-[10px] leading-relaxed text-amber-200/90">
                  − {persona.topObjection}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="mb-4">
        <PersonaExplorer result={result} />
      </div>

      <div className="mb-4">
        <AiInsightPanel
          selected={selected}
          ai={ai}
          pending={aiMut.isPending}
          error={aiError}
          onRun={runAi}
        />
      </div>

      <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-4 sm:p-5">
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <ShieldCheck size={15} className="text-emerald-300" /> Bu sonuç ne, ne değil?
        </h2>
        <div className="mt-2 grid gap-3 text-[11px] leading-relaxed text-muted-foreground md:grid-cols-2">
          <p>
            <strong className="text-foreground/85">Ne:</strong> Ürünün ölçülen fiyat, puan, yorum,
            satış, trend ve rekabet sinyallerine 1.000 sentetik karakterin verdiği deterministik
            tepki. Aynı ürün için aynı sonucu verir; segment ve itiraz dağılımını gösterir.
          </p>
          <p>
            <strong className="text-foreground/85">Ne değil:</strong> Gerçek anket, pazar payı
            tahmini veya kesin dönüşüm oranı değil. AI yorumu opsiyoneldir; panelin kendisi AI
            çağrısı yapmaz. Fiyat/puan/satış ölçülmemişse model bu sinyali 0 saymaz, eksik bırakır
            ve güveni düşürür. Panel çalıştırması{" "}
            <strong className="text-foreground/85">0 kredi</strong> ve 0 AI çağrısıdır; yalnızca AI
            yorumu 1 kredi + tek çağrıdır.
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {result.product.signalsUsed.map((signal) => (
            <span
              key={signal}
              className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300"
            >
              {signal} · ölçüldü
            </span>
          ))}
          {result.product.missingSignals.map((signal) => (
            <span
              key={signal}
              className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300"
            >
              {signal} · ölçülmedi
            </span>
          ))}
          {result.product.signalsUsed.length === 0 &&
            result.product.missingSignals.length === 0 && (
              <span className="text-[10px] text-muted-foreground">Sinyal bilgisi yok.</span>
            )}
        </div>
      </section>
    </main>
  );
}

function MultiCustomerPage() {
  return (
    <div className="min-h-screen">
      <MultiCustomerContent />
    </div>
  );
}
