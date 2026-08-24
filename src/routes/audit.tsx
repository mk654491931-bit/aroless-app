import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ShieldCheck,
  Loader2,
  Search,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHero } from "@/components/page-hero";
import { useAuth } from "@/hooks/use-auth";
import { getUiLang } from "@/lib/auto-i18n/lang";
import {
  auditStore,
  listStoreAudits,
  deleteStoreAudit,
  type StoreAuditRow,
} from "@/lib/store-audit.functions";

export const Route = createFileRoute("/audit")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "AI Mağaza Denetçisi — Aroless" },
      {
        name: "description",
        content:
          "Mağaza adresini gir; güven sinyalleri, dönüşüm kırıcıları, hız ve hızlı kazanımlar için sağlık skorlu bir denetim raporu al.",
      },
      { property: "og:title", content: "AI Mağaza Denetçisi — Aroless" },
      { property: "og:description", content: "Mağazanın dönüşüm kırıcılarını AI ile bul." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuditPage,
});

const SEV: Record<string, string> = {
  critical: "border-red-400/40 text-red-400",
  high: "border-orange-400/40 text-orange-400",
  medium: "border-amber-400/40 text-amber-400",
  low: "border-white/20 text-muted-foreground",
};

function ScoreRing({ value }: { value: number }) {
  const r = 42,
    c = 2 * Math.PI * r;
  const color = value >= 75 ? "var(--profit)" : value >= 50 ? "oklch(0.85 0.18 90)" : "#f87171";
  return (
    <div className="relative h-[104px] w-[104px] shrink-0">
      <svg width="104" height="104" viewBox="0 0 104 104" className="-rotate-90">
        <circle
          cx="52"
          cy="52"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="9"
          className="text-white/10"
        />
        <circle
          cx="52"
          cy="52"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (c * Math.min(value, 100)) / 100}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-2xl font-black" style={{ color }}>
          {value}
        </div>
        <div className="text-[9px] uppercase text-muted-foreground">sağlık</div>
      </div>
    </div>
  );
}

function Report({ row }: { row: StoreAuditRow }) {
  const r = row.report;
  return (
    <div className="mt-5 space-y-4">
      <div className="premium-card flex flex-wrap items-center gap-5 p-5">
        <ScoreRing value={row.health_score} />
        <div className="min-w-[240px] flex-1">
          <div className="truncate text-sm font-bold">{row.url}</div>
          <p className="mt-1 text-sm text-muted-foreground">{r.summary}</p>
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-[var(--profit)]/30 bg-[var(--profit)]/10 px-2.5 py-1 text-[11px] text-[var(--profit)]">
            <Zap size={11} /> Tüm düzeltmelerle tahmini dönüşüm artışı: %{r.estimated_cr_gain_pct}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="premium-card p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-bold text-red-400">
            <AlertTriangle size={14} /> Dönüşüm kırıcıları
          </div>
          <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
            {r.conversion_killers?.map((k, i) => (
              <li key={i}>{k}</li>
            ))}
          </ul>
        </div>
        <div className="premium-card p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-bold text-[var(--profit)]">
            <CheckCircle2 size={14} /> Güçlü yönler
          </div>
          <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
            {r.strengths?.map((k, i) => (
              <li key={i}>{k}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="premium-card p-4">
        <div className="mb-3 text-sm font-bold">Bulgular ve düzeltmeler</div>
        <div className="space-y-2">
          {r.issues?.map((it, i) => (
            <div key={i} className="rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={SEV[it.severity] ?? SEV["low"]}>
                  {it.severity}
                </Badge>
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {it.area}
                </span>
              </div>
              <div className="mt-1.5 text-sm font-semibold">{it.finding}</div>
              <div className="mt-1 text-xs text-muted-foreground">Etki: {it.impact}</div>
              <div className="mt-1 text-xs text-[var(--accent-active)]">Çözüm: {it.fix}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="premium-card p-4">
          <div className="mb-2 text-sm font-bold">Güven sinyalleri</div>
          <div className="grid grid-cols-2 gap-1.5 text-xs">
            {r.trust_signals?.map((s, i) => (
              <div key={i} className="flex items-center gap-1.5">
                {s.present ? (
                  <CheckCircle2 size={12} className="text-[var(--profit)]" />
                ) : (
                  <XCircle size={12} className="text-red-400" />
                )}
                <span className={s.present ? "" : "text-muted-foreground"}>{s.signal}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="premium-card p-4">
          <div className="mb-2 text-sm font-bold">1 saatlik hızlı kazanımlar</div>
          <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
            {r.quick_wins?.map((k, i) => (
              <li key={i}>{k}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function AuditPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { user, loading } = useAuth();
  const [url, setUrl] = useState("");
  const [active, setActive] = useState<StoreAuditRow | null>(null);

  const auditFn = useServerFn(auditStore);
  const listFn = useServerFn(listStoreAudits);
  const delFn = useServerFn(deleteStoreAudit);

  useEffect(() => {
    if (!loading && !user) nav({ to: "/auth" });
  }, [user, loading, nav]);

  const history = useQuery({
    queryKey: ["store-audits"],
    queryFn: () => listFn(),
    enabled: !!user,
  });

  const run = useMutation({
    mutationFn: () =>
      auditFn({
        data: { url: url.startsWith("http") ? url : `https://${url}`, lang: getUiLang() },
      }),
    onSuccess: (row) => {
      setActive(row as StoreAuditRow);
      qc.invalidateQueries({ queryKey: ["store-audits"] });
      qc.invalidateQueries({ queryKey: ["profile"] });
      toast.success("Denetim tamamlandı");
    },
    onError: (e: Error) =>
      toast.error(
        e.message === "NO_CREDITS"
          ? "Kredin bitti"
          : e.message === "FETCH_FAILED"
            ? "Sayfaya ulaşılamadı, adresi kontrol et"
            : e.message,
      ),
  });

  if (loading || !user) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <PageHero
        icon={<ShieldCheck size={20} />}
        title="AI Mağaza Denetçisi"
        description="Mağaza adresini ver; sayfayı okuyup güven sinyallerini, dönüşüm kırıcılarını ve hızlı kazanımları raporlar."
      />

      <Card className="premium-card border-white/10">
        <CardContent className="flex flex-wrap gap-3 p-4">
          <Input
            placeholder="magazam.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && url.length > 3) run.mutate();
            }}
            className="min-w-[220px] flex-1"
          />
          <Button onClick={() => run.mutate()} disabled={url.length < 4 || run.isPending}>
            {run.isPending ? (
              <Loader2 size={14} className="mr-1 animate-spin" />
            ) : (
              <Search size={14} className="mr-1" />
            )}
            Denetle (1 kredi)
          </Button>
        </CardContent>
      </Card>

      {run.isPending && (
        <div className="mt-6 flex flex-col items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="animate-spin" /> Sayfa okunuyor ve analiz ediliyor…
        </div>
      )}

      {active && <Report row={active} />}

      {(history.data?.length ?? 0) > 0 && (
        <div className="mt-6">
          <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
            Geçmiş denetimler
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            {history.data!.map((row) => (
              <div
                key={row.id}
                className="premium-card flex items-center justify-between gap-2 p-3"
              >
                <button className="min-w-0 flex-1 text-left" onClick={() => setActive(row)}>
                  <div className="truncate text-xs font-semibold">{row.url}</div>
                  <div className="text-[10px] text-muted-foreground">
                    Skor {row.health_score} · {new Date(row.created_at).toLocaleDateString()}
                  </div>
                </button>
                <button
                  className="text-muted-foreground hover:text-red-400"
                  onClick={async () => {
                    await delFn({ data: { id: row.id } });
                    if (active?.id === row.id) setActive(null);
                    qc.invalidateQueries({ queryKey: ["store-audits"] });
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
