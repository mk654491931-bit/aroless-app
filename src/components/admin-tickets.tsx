import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, LifeBuoy } from "lucide-react";
import { toast } from "sonner";
import { adminListTickets, adminUpdateTicket } from "@/lib/support.functions";

const STATUSES = ["open", "in_progress", "resolved", "closed"] as const;

const STATUS_LABEL: Record<string, string> = {
  open: "Açık",
  in_progress: "İşlemde",
  resolved: "Çözüldü",
  closed: "Kapalı",
};

export function AdminTickets() {
  const qc = useQueryClient();
  const listFn = useServerFn(adminListTickets);
  const updateFn = useServerFn(adminUpdateTicket);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const q = useQuery({ queryKey: ["admin-tickets"], queryFn: () => listFn() });

  const save = useMutation({
    mutationFn: (v: { id: string; status?: string; admin_note?: string }) =>
      updateFn({ data: v as never }),
    onSuccess: () => {
      toast.success("Talep güncellendi");
      qc.invalidateQueries({ queryKey: ["admin-tickets"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = q.data ?? [];

  return (
    <section className="glass rounded-2xl p-5">
      <h2 className="font-semibold mb-3 flex items-center gap-2">
        <LifeBuoy size={16} /> Destek Talepleri
        <span className="text-xs text-muted-foreground font-normal">({rows.length})</span>
      </h2>

      {q.isLoading && <div className="py-6 flex justify-center"><Loader2 className="animate-spin" size={18} /></div>}
      {!q.isLoading && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">Henüz destek talebi yok.</p>
      )}

      <div className="space-y-3">
        {rows.map((tk) => (
          <div key={tk.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-full border border-white/10 px-2 py-0.5">{tk.category}</span>
              <span className="rounded-full border border-white/10 px-2 py-0.5">{STATUS_LABEL[tk.status] ?? tk.status}</span>
              <span>{tk.email ?? "—"}</span>
              <span>{new Date(tk.created_at).toLocaleString()}</span>
            </div>
            <div className="mt-1.5 text-sm font-semibold">{tk.subject}</div>
            <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">{tk.message}</p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  disabled={save.isPending}
                  onClick={() => save.mutate({ id: tk.id, status: s })}
                  className={`rounded-lg border px-2.5 py-1 text-xs transition ${
                    tk.status === s ? "border-[oklch(0.68_0.20_265)] bg-[oklch(0.68_0.20_265)]/20" : "border-white/10 hover:bg-white/10"
                  }`}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>

            <div className="mt-2 flex gap-2">
              <input
                value={notes[tk.id] ?? tk.admin_note ?? ""}
                onChange={(e) => setNotes((n) => ({ ...n, [tk.id]: e.target.value }))}
                placeholder="Yönetici notu"
                className="flex-1 rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 text-xs outline-none focus:border-[oklch(0.68_0.20_265)]"
              />
              <button
                disabled={save.isPending}
                onClick={() => save.mutate({ id: tk.id, admin_note: notes[tk.id] ?? "" })}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs hover:bg-white/10"
              >
                Kaydet
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
