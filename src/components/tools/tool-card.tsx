import { getUiLang } from "@/lib/auto-i18n/lang";
import { useRef, useState, type ReactNode } from "react";
import {
  Loader2,
  Sparkles,
  AlertTriangle,
  Copy,
  Check,
  ShieldAlert,
  ListChecks,
  Info,
  Cpu,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiFetch } from "@/lib/api-client";
import { AiDisclaimer } from "@/components/ai-disclaimer";
import { ErrorBoundary } from "@/components/error-boundary";

export type ToolResult = {
  headline: string;
  metrics: { label: string; value: string; tone?: "profit" | "warning" | "action" | "neutral" }[];
  bullets: string[];
  table: { columns: string[]; rows: string[][] } | null;
  document: string | null;
  risks?: string[];
  actions?: string[];
  assumptions?: string[];
  verdict?: string;
  score?: number;
  provider: string;
  providers?: string[];
  confidence?: number;
};

export async function callTool(tool: string, input: Record<string, string>): Promise<ToolResult> {
  const res = await apiFetch(
    "/api/public/tool",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool, input: { ...input, uiLang: getUiLang() } }),
    },
    60_000, // AI calls can take up to 60s across multiple provider fallbacks
  );
  const json = (await res.json().catch(() => ({}))) as {
    status?: string;
    results?: Partial<ToolResult>;
    error?: string;
  } & Partial<ToolResult>;

  if (!res.ok) throw new Error(json.error ?? "AI isteği başarısız");

  // Support both legacy direct format and new { status, results } wrapper
  const data: Partial<ToolResult> = json.results ?? json;

  return {
    headline: String(data.headline ?? "").slice(0, 160),
    metrics: Array.isArray(data.metrics) ? data.metrics : [],
    bullets: Array.isArray(data.bullets) ? data.bullets : [],
    table:
      data.table &&
      typeof data.table === "object" &&
      Array.isArray((data.table as { columns?: unknown }).columns) &&
      Array.isArray((data.table as { rows?: unknown }).rows)
        ? (data.table as ToolResult["table"])
        : null,
    document: typeof data.document === "string" ? data.document : null,
    risks: Array.isArray(data.risks) ? data.risks : [],
    actions: Array.isArray(data.actions) ? data.actions : [],
    assumptions: Array.isArray(data.assumptions) ? data.assumptions : [],
    verdict: typeof data.verdict === "string" ? data.verdict : "",
    score: typeof data.score === "number" ? data.score : 0,
    provider: typeof data.provider === "string" ? data.provider : "unknown",
    providers: Array.isArray(data.providers) ? data.providers : undefined,
    confidence: typeof data.confidence === "number" ? data.confidence : undefined,
  };
}

const toneClass: Record<string, string> = {
  profit: "text-[var(--profit)] border-[var(--profit)]/30 bg-[var(--profit)]/10",
  warning: "text-[var(--warning)] border-[var(--warning)]/30 bg-[var(--warning)]/10",
  action:
    "text-[var(--accent-active)] border-[var(--accent-active)]/30 bg-[var(--accent-active)]/10",
  neutral: "text-foreground/80 border-white/10 bg-white/5",
};

const STAGES = [
  "3 motor paralel taslak üretiyor…",
  "Sayısal çelişkiler karşılaştırılıyor…",
  "Editör motoru nihai sentezi yazıyor…",
];

/** Small radial score ring. */
function ScoreRing({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, value));
  const color = pct >= 70 ? "var(--profit)" : pct >= 45 ? "var(--warning)" : "var(--accent-active)";
  return (
    <div className="flex items-center gap-2">
      <div
        className="relative flex h-12 w-12 items-center justify-center rounded-full"
        style={{
          background: `conic-gradient(${color} ${pct * 3.6}deg, color-mix(in oklab, var(--foreground) 12%, transparent) 0deg)`,
        }}
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface)] text-[11px] font-bold">
          {pct}
        </div>
      </div>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
    </div>
  );
}

function ListBlock({
  icon: Icon,
  title,
  items,
  tone,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  items: string[];
  tone: "profit" | "warning" | "action";
}) {
  if (!items.length) return null;
  const c =
    tone === "warning"
      ? "var(--warning)"
      : tone === "profit"
        ? "var(--profit)"
        : "var(--accent-active)";
  return (
    <div
      className="rounded-lg border p-2.5"
      style={{
        borderColor: `color-mix(in oklab, ${c} 25%, transparent)`,
        background: `color-mix(in oklab, ${c} 8%, transparent)`,
      }}
    >
      <div
        className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: c }}
      >
        <Icon size={12} /> {title}
      </div>
      <ul className="space-y-1">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2 text-xs text-foreground/85">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ background: c }} />
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ToolCard({
  icon: Icon,
  title,
  description,
  children,
  onRun,
  runLabel = "AI ile Analiz Et",
  disabled,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  description: string;
  children: ReactNode;
  onRun: () => Promise<ToolResult>;
  runLabel?: string;
  disabled?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(0);
  const [result, setResult] = useState<ToolResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [copied, setCopied] = useState(false);

  const run = async () => {
    // Abort any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setStage(0);
    const timer = setInterval(() => setStage((s) => (s + 1) % STAGES.length), 2600);
    const timeoutId = setTimeout(() => {
      controller.abort();
      setError("Arama zaman aşımına uğradı. Lütfen tekrar deneyin.");
      setLoading(false);
      clearInterval(timer);
    }, 65_000); // Slightly longer than the 60s apiFetch timeout
    try {
      setResult(await onRun());
    } catch (e) {
      if (controller.signal.aborted && !(e as Error).message?.includes("abort")) {
        // User-initiated abort, skip error state
      } else {
        const msg =
          (e as Error).name === "AbortError"
            ? "Arama zaman aşımına uğradı. Lütfen tekrar deneyin."
            : (e as Error).message || "Bilinmeyen hata oluştu.";
        setError(msg);
        toast.error("Analiz başarısız", { description: msg });
      }
    } finally {
      clearTimeout(timeoutId);
      clearInterval(timer);
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  const copyDoc = async () => {
    if (!result?.document) return;
    await navigator.clipboard.writeText(result.document);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
    toast.success("Panoya kopyalandı");
  };

  const download = () => {
    if (!result?.document) return;
    const blob = new Blob([result.document], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Card
      className={`group premium-card live-card relative overflow-hidden border-transparent bg-transparent transition-colors ${loading ? "card-shimmer" : ""}`}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent-active)]/50 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--accent-active)]/25 bg-[var(--accent-active)]/10 transition-transform duration-300 group-hover:scale-105 group-hover:rotate-3">
            <Icon size={15} className="text-[var(--accent-active)]" />
          </span>
          {title}
        </CardTitle>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {children}
        <Button
          onClick={run}
          disabled={loading || disabled}
          className={`press w-full gap-2 ${loading || disabled ? "" : "edge-light"}`}
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          {loading ? "Hibrit AI çalışıyor…" : runLabel}
        </Button>

        {loading && (
          <div className="animate-fade-in space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="flex items-center gap-2 text-[11px] text-[var(--accent-active)]">
              <Cpu size={12} className="animate-pulse" /> {STAGES[stage]}
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-white/5">
              <div className="h-full w-1/3 animate-[slide-in-right_1.6s_ease-in-out_infinite] rounded-full bg-[var(--accent-active)]/70" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-10 rounded-lg border border-white/5 bg-white/5"
                  style={{ opacity: 0.5 + (i % 2) * 0.2 }}
                />
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/10 p-2.5 text-xs text-[var(--warning)]">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}

        {result && !loading && (
          <ErrorBoundary
            fallback={(err, retry) => (
              <div className="rounded-xl border border-[var(--warning)]/30 bg-[var(--warning)]/10 p-3 text-xs text-[var(--warning)]">
                <div className="mb-2 font-semibold">Sonuç gösterilirken hata oluştu</div>
                <p className="mb-2 opacity-80">{err.message}</p>
                <button onClick={retry} className="underline hover:opacity-100">
                  Tekrar dene
                </button>
              </div>
            )}
            onError={(e) => console.error("[ToolCard] result render error:", e)}
          >
          <div className="animate-fade-in space-y-3 rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {result?.verdict && (
                  <Badge className="mb-1.5 border-[var(--accent-active)]/30 bg-[var(--accent-active)]/10 text-[10px] text-[var(--accent-active)]">
                    {result.verdict}
                  </Badge>
                )}
                {result?.headline && (
                  <p className="text-sm font-semibold leading-snug">{result.headline}</p>
                )}
              </div>
              {(result?.score ?? 0) > 0 && <ScoreRing value={result?.score ?? 0} label="skor" />}
            </div>

            {(result?.metrics ?? []).length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {(result?.metrics ?? []).map((m, i) => (
                  <div
                    key={i}
                    className={`rounded-lg border p-2 transition-transform hover:scale-[1.02] ${toneClass[m?.tone ?? "neutral"]}`}
                  >
                    <div className="text-[10px] uppercase tracking-wider opacity-70">{m?.label ?? ""}</div>
                    <div className="mt-0.5 text-sm font-bold">{m?.value ?? ""}</div>
                  </div>
                ))}
              </div>
            )}

            {result?.table && Array.isArray(result.table.columns) && Array.isArray(result.table.rows) && result.table.rows.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-white/10">
                <Table>
                  <TableHeader>
                    <TableRow className="border-white/10 hover:bg-transparent">
                      {(result.table.columns ?? []).map((c, i) => (
                        <TableHead key={i} className="text-[11px] whitespace-nowrap">
                          {String(c ?? "")}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(result.table.rows ?? []).map((r, i) => (
                      <TableRow key={i} className="border-white/5">
                        {(Array.isArray(r) ? r : []).map((cell, j) => (
                          <TableCell key={j} className="text-xs">
                            {String(cell ?? "")}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {(result?.bullets ?? []).length > 0 && (
              <ul className="space-y-1.5">
                {(result?.bullets ?? []).map((b, i) => (
                  <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                    <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[var(--accent-active)]" />
                    {String(b ?? "")}
                  </li>
                ))}
              </ul>
            )}

            <ListBlock
              icon={ShieldAlert}
              title="Riskler"
              items={(result?.risks ?? []).filter(Boolean)}
              tone="warning"
            />
            <ListBlock
              icon={ListChecks}
              title="Aksiyon planı"
              items={(result?.actions ?? []).filter(Boolean)}
              tone="profit"
            />
            <ListBlock
              icon={Info}
              title="Varsayımlar"
              items={(result?.assumptions ?? []).filter(Boolean)}
              tone="action"
            />

            {result?.document && (
              <div className="space-y-2">
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/30 p-3 text-[11px] leading-relaxed">
                  {result.document}
                </pre>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" className="gap-1.5" onClick={copyDoc}>
                    {copied ? <Check size={13} /> : <Copy size={13} />} Kopyala
                  </Button>
                  <Button size="sm" variant="outline" onClick={download}>
                    İndir
                  </Button>
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5 border-t border-white/5 pt-2">
              {(result?.providers ?? []).filter(Boolean).map((p) => (
                <Badge
                  key={p}
                  variant="outline"
                  className="border-white/10 text-[10px] text-muted-foreground"
                >
                  <Cpu size={10} className="mr-1" /> {p}
                </Badge>
              ))}
              <Badge
                variant="outline"
                className="border-white/10 text-[10px] text-muted-foreground"
              >
                {result?.provider ?? ""}
              </Badge>
              {typeof result?.confidence === "number" && (result?.confidence ?? 0) > 0 && (
                <Badge
                  variant="outline"
                  className="border-[var(--profit)]/30 text-[10px] text-[var(--profit)]"
                >
                  <TrendingUp size={10} className="mr-1" /> güven %{result.confidence}
                </Badge>
              )}
            </div>
          </div>
          </ErrorBoundary>
        )}
        <AiDisclaimer />
      </CardContent>
    </Card>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
