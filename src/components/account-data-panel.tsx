import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Download, ShieldAlert, Loader2, Activity } from "lucide-react";
import { exportMyData, deleteMyAccount, listMyUsage } from "@/lib/account.functions";

export function AccountDataPanel() {
  const exportFn = useServerFn(exportMyData);
  const deleteFn = useServerFn(deleteMyAccount);
  const usageFn = useServerFn(listMyUsage);
  const [confirm, setConfirm] = useState("");

  const usageQ = useQuery({ queryKey: ["my-usage"], queryFn: () => usageFn() });

  const doExport = useMutation({
    mutationFn: () => exportFn(),
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `velora-verilerim-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Verilerin indirildi");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const doDelete = useMutation({
    mutationFn: () => deleteFn({ data: { confirm: "DELETE" } }),
    onSuccess: async () => {
      toast.success("Hesabın silindi");
      await supabase.auth.signOut();
      window.location.href = "/auth";
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const totalCredits = (usageQ.data ?? []).reduce((s, r) => s + (r.credits ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="glass rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <Activity size={18} className="text-[oklch(0.75_0.18_265)]" />
          <h2 className="font-semibold">Kredi kullanımı</h2>
        </div>
        <p className="text-sm text-muted-foreground">Son 100 işlem · toplam {totalCredits} kredi</p>
        <div className="mt-3 max-h-56 space-y-1.5 overflow-auto pr-1">
          {usageQ.isLoading && <div className="text-sm text-muted-foreground">Yükleniyor…</div>}
          {!usageQ.isLoading && (usageQ.data?.length ?? 0) === 0 && (
            <div className="text-sm text-muted-foreground">Henüz kayıt yok.</div>
          )}
          {(usageQ.data ?? []).map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs"
            >
              <span className="font-medium">{r.tool}</span>
              <span className="text-muted-foreground">
                {new Date(r.created_at).toLocaleString()} · {r.credits} kredi
                {r.success ? "" : " · başarısız"}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="glass rounded-2xl p-5">
        <h2 className="font-semibold">Verilerin</h2>
        <p className="text-sm text-muted-foreground">
          KVKK/GDPR kapsamında tüm verilerini indirebilir veya hesabını silebilirsin.
        </p>
        <button
          onClick={() => doExport.mutate()}
          disabled={doExport.isPending}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-sm font-medium hover:bg-white/10 disabled:opacity-50"
        >
          {doExport.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Download size={14} />
          )}{" "}
          Verilerimi indir (JSON)
        </button>

        <div className="mt-5 rounded-xl border border-destructive/40 bg-destructive/10 p-3">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
            <ShieldAlert size={15} /> Hesabı sil
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Bu işlem geri alınamaz. Onaylamak için kutuya <b>DELETE</b> yaz.
          </p>
          <div className="mt-2 flex gap-2">
            <input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="DELETE"
              className="flex-1 rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-destructive/60"
            />
            <button
              disabled={confirm !== "DELETE" || doDelete.isPending}
              onClick={() => doDelete.mutate()}
              className="rounded-lg bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-50"
            >
              {doDelete.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                "Kalıcı olarak sil"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
