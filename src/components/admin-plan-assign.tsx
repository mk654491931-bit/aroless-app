import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CalendarClock, Crown, Loader2, Search, Sparkles, XCircle } from "lucide-react";
import {
  assignAdminPlan,
  cancelAdminPlan,
  findAdminPlanTarget,
  type AdminPlanSnapshot,
} from "@/lib/admin.functions";
import { ADMIN_PERIOD_MONTHS, PLANS, type PlanId } from "@/lib/plans";

const PLAN_OPTIONS: PlanId[] = ["Starter", "Pro", "Business"];

const TIER_STYLE: Record<string, string> = {
  Starter: "border-sky-400/40 bg-sky-400/10 text-sky-200",
  Pro: "border-[oklch(0.62_0.17_255)]/50 bg-gradient-to-r from-[oklch(0.62_0.17_255)]/25 to-[oklch(0.52_0.15_262)]/20 text-foreground",
  Business: "border-amber-400/40 bg-amber-400/10 text-amber-200",
};

function fmt(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" }) : "—";
}

/**
 * Yönetici, seçtiği kullanıcıya (e-posta ile) Starter / Pro / Business paketini
 * 1, 2, 3, 6 veya 12 ay süreyle tanımlar; istediğinde iptal eder.
 */
export function AdminPlanAssign() {
  const qc = useQueryClient();
  const findFn = useServerFn(findAdminPlanTarget);
  const assignFn = useServerFn(assignAdminPlan);
  const cancelFn = useServerFn(cancelAdminPlan);

  const [email, setEmail] = useState("");
  const [plan, setPlan] = useState<PlanId>("Pro");
  const [months, setMonths] = useState<number>(1);
  const [grantCredits, setGrantCredits] = useState(true);
  const [snapshot, setSnapshot] = useState<AdminPlanSnapshot | null>(null);

  const refreshAdminViews = () => {
    qc.invalidateQueries({ queryKey: ["admin-users"] });
    qc.invalidateQueries({ queryKey: ["admin-stats"] });
    qc.invalidateQueries({ queryKey: ["admin-tx"] });
  };

  const find = useMutation({
    mutationFn: (value: string) => findFn({ data: { email: value } }),
    onSuccess: (data) => {
      setSnapshot(data);
      if (data.tier !== "Free") setPlan(data.tier as PlanId);
    },
    onError: (e: Error) => {
      setSnapshot(null);
      toast.error(e.message);
    },
  });

  const assign = useMutation({
    mutationFn: () =>
      assignFn({ data: { email: email.trim().toLowerCase(), plan, months, grantCredits } }),
    onSuccess: (data) => {
      setSnapshot(data);
      toast.success(
        `${data.email ?? "Kullanıcı"} → ${data.tier} paketi ${months} ay tanımlandı.`,
      );
      refreshAdminViews();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancel = useMutation({
    mutationFn: () => cancelFn({ data: { email: email.trim().toLowerCase() } }),
    onSuccess: (data) => {
      setSnapshot(data);
      toast.success(`${data.email ?? "Kullanıcı"} paketi iptal edildi.`);
      refreshAdminViews();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const busy = find.isPending || assign.isPending || cancel.isPending;
  const selected = PLANS.find((p) => p.id === plan);

  return (
    <section className="glass rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3">
        <h2 className="font-semibold flex items-center gap-2">
          <Crown size={16} /> Paket Tanımla / İptal Et
        </h2>
        <span className="text-xs text-muted-foreground">E-posta ile süreli paket ataması</span>
      </div>

      <div className="p-5 space-y-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!email.trim()) return;
            find.mutate(email.trim().toLowerCase());
          }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <div className="relative flex-1">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="kullanici@example.com"
              className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm outline-none focus:border-[oklch(0.62_0.17_255)]"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10 disabled:opacity-60"
          >
            {find.isPending ? (
              <Loader2 className="animate-spin" size={16} />
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <Search size={14} /> Kullanıcıyı bul
              </span>
            )}
          </button>
        </form>

        {snapshot && (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex min-w-0 items-center gap-2 text-sm font-medium">
                <Sparkles size={14} className="shrink-0 text-[oklch(0.85_0.15_255)]" />
                <span className="truncate">{snapshot.email ?? snapshot.id}</span>
              </span>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                  TIER_STYLE[snapshot.tier] ?? "border-white/10 bg-white/5 text-muted-foreground"
                }`}
              >
                {snapshot.tier}
              </span>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] ${
                  snapshot.active
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : "border-white/10 bg-white/5 text-muted-foreground"
                }`}
              >
                {snapshot.active
                  ? `Aktif${snapshot.days_left !== null ? ` · ${snapshot.days_left} gün kaldı` : ""}`
                  : snapshot.status}
              </span>
            </div>

            <div className="grid gap-3 text-xs sm:grid-cols-4">
              <Info label="Kredi" value={String(snapshot.credits)} />
              <Info label="Sim. kredisi" value={String(snapshot.sim_credits)} />
              <Info label="Başlangıç" value={fmt(snapshot.period_start)} />
              <Info label="Bitiş" value={fmt(snapshot.period_end)} />
            </div>

            <div className="grid gap-3 lg:grid-cols-[1fr_1fr_auto_auto] lg:items-end">
              <label className="text-xs">
                <span className="mb-1 block text-muted-foreground">Paket</span>
                <select
                  value={plan}
                  onChange={(e) => setPlan(e.target.value as PlanId)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[oklch(0.62_0.17_255)]"
                >
                  {PLAN_OPTIONS.map((id) => (
                    <option key={id} value={id} className="bg-[oklch(0.2_0.02_265)]">
                      {id} — ${PLANS.find((p) => p.id === id)?.usd}/ay
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs">
                <span className="mb-1 block text-muted-foreground">Süre</span>
                <select
                  value={months}
                  onChange={(e) => setMonths(Number(e.target.value))}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[oklch(0.62_0.17_255)]"
                >
                  {ADMIN_PERIOD_MONTHS.map((m) => (
                    <option key={m} value={m} className="bg-[oklch(0.2_0.02_265)]">
                      {m} ay
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex items-center gap-2 text-xs lg:pb-2">
                <input
                  type="checkbox"
                  checked={grantCredits}
                  onChange={(e) => setGrantCredits(e.target.checked)}
                  className="h-4 w-4 accent-[oklch(0.62_0.17_255)]"
                />
                <span className="text-muted-foreground">
                  Kredileri yenile{selected ? ` (${selected.credits})` : ""}
                </span>
              </label>

              <button
                type="button"
                disabled={busy}
                onClick={() => assign.mutate()}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {assign.isPending ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <>
                    <CalendarClock size={14} /> Tanımla
                  </>
                )}
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3">
              <span className="text-[11px] text-muted-foreground">
                Tanımlama, ödeme sağlayıcısına dokunmadan erişim hakkını ve süreyi yazar; işlem
                kaydı admin olarak düşülür.
              </span>
              <button
                type="button"
                disabled={busy || snapshot.tier === "Free"}
                onClick={() => {
                  if (window.confirm(`${snapshot.email ?? "Kullanıcı"} paketi iptal edilsin mi?`)) {
                    cancel.mutate();
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/20 disabled:opacity-50"
              >
                {cancel.isPending ? (
                  <Loader2 className="animate-spin" size={13} />
                ) : (
                  <>
                    <XCircle size={13} /> Paketi iptal et
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-semibold">{value}</div>
    </div>
  );
}
