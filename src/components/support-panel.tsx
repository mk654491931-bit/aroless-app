import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { LifeBuoy, Loader2, Send } from "lucide-react";
import { createTicket, listMyTickets, CATEGORIES } from "@/lib/support.functions";

const LABELS: Record<string, string> = {
  general: "Genel",
  billing: "Ödeme / abonelik",
  bug: "Hata bildirimi",
  feature: "Özellik isteği",
  data: "Veri / gizlilik",
};

const STATUS: Record<string, string> = {
  open: "Açık",
  in_progress: "İnceleniyor",
  resolved: "Çözüldü",
  closed: "Kapandı",
};

export function SupportPanel() {
  const createFn = useServerFn(createTicket);
  const listFn = useServerFn(listMyTickets);
  const qc = useQueryClient();
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("general");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const q = useQuery({ queryKey: ["my-tickets"], queryFn: () => listFn() });

  const send = useMutation({
    mutationFn: () => createFn({ data: { category, subject, message } }),
    onSuccess: () => {
      toast.success("Talebin alındı, en kısa sürede döneceğiz.");
      setSubject("");
      setMessage("");
      qc.invalidateQueries({ queryKey: ["my-tickets"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <LifeBuoy size={18} className="text-[oklch(0.75_0.18_265)]" />
        <h2 className="font-semibold">Destek</h2>
      </div>
      <p className="text-sm text-muted-foreground">Sorun, öneri veya faturalama sorusu gönder.</p>

      <div className="mt-4 grid gap-2">
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`rounded-lg border px-2.5 py-1 text-xs ${category === c ? "border-primary/50 bg-primary/15" : "border-white/10 hover:bg-white/5"}`}
            >
              {LABELS[c]}
            </button>
          ))}
        </div>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Konu"
          className="rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-primary/50"
        />
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          placeholder="Detayları yaz…"
          className="rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-primary/50"
        />
        <button
          disabled={send.isPending || subject.trim().length < 3 || message.trim().length < 10}
          onClick={() => send.mutate()}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {send.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Gönder
        </button>
      </div>

      {(q.data?.length ?? 0) > 0 && (
        <div className="mt-5 space-y-2">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Taleplerin</div>
          {q.data!.map((t) => (
            <div key={t.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">{t.subject}</div>
                <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px]">{STATUS[t.status] ?? t.status}</span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground line-clamp-2">{t.message}</div>
              {t.admin_note && <div className="mt-2 rounded-lg bg-primary/10 p-2 text-xs">Yanıt: {t.admin_note}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
