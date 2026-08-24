import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Ticket, Plus, Loader2, Trash2, Power, Copy, Check } from "lucide-react";
import {
  listPromoCodes,
  createPromoCode,
  setPromoCodeActive,
  deletePromoCode,
  getPromoCodeStats,
} from "@/lib/promo.functions";

function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return (
    "VLR" +
    Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("")
  );
}

export function AdminPromoCodes() {
  const qc = useQueryClient();
  const listFn = useServerFn(listPromoCodes);
  const createFn = useServerFn(createPromoCode);
  const toggleFn = useServerFn(setPromoCodeActive);
  const delFn = useServerFn(deletePromoCode);

  const [code, setCode] = useState(randomCode());
  const [pct, setPct] = useState(20);
  const [maxUses, setMaxUses] = useState<string>("");
  const [expires, setExpires] = useState<string>("");
  const [copied, setCopied] = useState<string | null>(null);

  const statsFn = useServerFn(getPromoCodeStats);
  const q = useQuery({ queryKey: ["admin-promos"], queryFn: () => listFn() });
  const statsQ = useQuery({ queryKey: ["admin-promo-stats"], queryFn: () => statsFn() });
  const statOf = (c: string) => (statsQ.data ?? []).find((s) => s.code === c);

  const create = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          code: code.trim(),
          discount_pct: pct,
          max_redemptions: maxUses ? Number(maxUses) : null,
          expires_at: expires ? new Date(expires).toISOString() : null,
        },
      }),
    onSuccess: () => {
      toast.success("Promosyon kodu oluşturuldu");
      setCode(randomCode());
      setMaxUses("");
      setExpires("");
      qc.invalidateQueries({ queryKey: ["admin-promos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: (v: { id: string; active: boolean }) => toggleFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-promos"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Kod silindi");
      qc.invalidateQueries({ queryKey: ["admin-promos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const copy = async (c: string) => {
    await navigator.clipboard.writeText(c);
    setCopied(c);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <section className="glass rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
        <h2 className="font-semibold flex items-center gap-2">
          <Ticket size={16} /> Promosyon Kodları
        </h2>
        <span className="text-xs text-muted-foreground">{q.data?.length ?? 0} kod</span>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
        className="grid gap-3 border-b border-white/10 p-5 sm:grid-cols-2 lg:grid-cols-5"
      >
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">Kod</span>
          <div className="flex gap-1">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-mono uppercase outline-none focus:border-[oklch(0.68_0.20_265)]"
              placeholder="VLRXXXXXX"
              required
            />
            <button
              type="button"
              onClick={() => setCode(randomCode())}
              title="Rastgele kod üret"
              className="rounded-lg border border-white/10 bg-white/5 px-2 text-xs hover:bg-white/10"
            >
              🎲
            </button>
          </div>
        </label>

        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">
            İndirim: <b className="text-foreground">%{pct}</b>
          </span>
          <input
            type="range"
            min={1}
            max={100}
            value={pct}
            onChange={(e) => setPct(Number(e.target.value))}
            className="w-full accent-[oklch(0.68_0.20_265)]"
          />
        </label>

        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">Maks. kullanım (boş = sınırsız)</span>
          <input
            type="number"
            min={1}
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[oklch(0.68_0.20_265)]"
            placeholder="∞"
          />
        </label>

        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">Son kullanma (opsiyonel)</span>
          <input
            type="date"
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[oklch(0.68_0.20_265)]"
          />
        </label>

        <button
          type="submit"
          disabled={create.isPending}
          className="self-end rounded-lg bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {create.isPending ? (
            <Loader2 className="mx-auto animate-spin" size={16} />
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <Plus size={14} /> Kod oluştur
            </span>
          )}
        </button>
      </form>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.02] text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-5 py-3 text-left font-medium">Kod</th>
              <th className="px-5 py-3 text-right font-medium">İndirim</th>
              <th className="px-5 py-3 text-right font-medium">Kullanım</th>
              <th className="px-5 py-3 text-right font-medium">Kaydolan</th>
              <th className="px-5 py-3 text-left font-medium">Alınan paketler</th>
              <th className="px-5 py-3 text-right font-medium">Ciro</th>
              <th className="px-5 py-3 text-left font-medium">Bitiş</th>
              <th className="px-5 py-3 text-left font-medium">Durum</th>
              <th className="px-5 py-3 text-right font-medium">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && (
              <tr>
                <td colSpan={9} className="py-10 text-center text-muted-foreground">
                  <Loader2 className="inline animate-spin" />
                </td>
              </tr>
            )}
            {!q.isLoading &&
              (q.data ?? []).map((p) => (
                <tr key={p.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                  <td className="px-5 py-3 font-mono font-semibold">
                    <button
                      onClick={() => copy(p.code)}
                      className="inline-flex items-center gap-1.5 hover:text-[oklch(0.86_0.10_265)]"
                      title="Kopyala"
                    >
                      {p.code}{" "}
                      {copied === p.code ? (
                        <Check size={12} className="text-emerald-400" />
                      ) : (
                        <Copy size={12} className="opacity-50" />
                      )}
                    </button>
                  </td>
                  <td className="px-5 py-3 text-right font-semibold">%{p.discount_pct}</td>
                  <td className="px-5 py-3 text-right text-muted-foreground">
                    {p.times_redeemed}
                    {p.max_redemptions ? ` / ${p.max_redemptions}` : ""}
                  </td>
                  <td className="px-5 py-3 text-right font-semibold">
                    {statOf(p.code)?.signups ?? 0}
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">
                    {(() => {
                      const st = statOf(p.code);
                      if (!st || st.purchases === 0) return "—";
                      return (
                        <span className="inline-flex flex-wrap gap-1">
                          {Object.entries(st.by_tier).map(([tier, n]) => (
                            <span
                              key={tier}
                              className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5"
                            >
                              {tier}: <b className="text-foreground">{n}</b>
                            </span>
                          ))}
                          <span className="text-muted-foreground">
                            ({st.purchases}/{st.signups} dönüşüm)
                          </span>
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-5 py-3 text-right text-muted-foreground">
                    {statOf(p.code)?.revenue_cents
                      ? `$${(statOf(p.code)!.revenue_cents / 100).toFixed(2)}`
                      : "—"}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {p.expires_at ? new Date(p.expires_at).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] ${p.active ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-white/10 bg-white/5 text-muted-foreground"}`}
                    >
                      {p.active ? "Aktif" : "Pasif"}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <button
                        onClick={() => toggle.mutate({ id: p.id, active: !p.active })}
                        title={p.active ? "Pasifleştir" : "Aktifleştir"}
                        className="rounded-lg border border-white/10 bg-white/5 p-1.5 hover:bg-white/10"
                      >
                        <Power size={13} />
                      </button>
                      <button
                        onClick={() => remove.mutate(p.id)}
                        title="Sil"
                        className="rounded-lg border border-red-500/30 bg-red-500/10 p-1.5 text-red-300 hover:bg-red-500/20"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            {!q.isLoading && (q.data ?? []).length === 0 && (
              <tr>
                <td colSpan={9} className="py-10 text-center text-muted-foreground">
                  Henüz promosyon kodu yok
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
