import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Gift, Copy, Check, Users, Coins, Loader2, Megaphone, ArrowRight } from "lucide-react";
import { getMyReferral, claimReferral, REFERRER_BONUS } from "@/lib/referral.functions";

export function ReferralPanel() {
  const summaryFn = useServerFn(getMyReferral);
  const claimFn = useServerFn(claimReferral);
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [code, setCode] = useState("");

  const q = useQuery({ queryKey: ["referral"], queryFn: () => summaryFn() });

  const claim = useMutation({
    mutationFn: (c: string) => claimFn({ data: { code: c } }),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success(
          res.affiliate
            ? "Partner hesabına bağlandınız · komisyon takibi başladı"
            : `Davet kodu uygulandı · +${res.credits} kredi`,
        );
        setCode("");
        qc.invalidateQueries({ queryKey: ["referral"] });
        qc.invalidateQueries({ queryKey: ["profile"] });
        qc.invalidateQueries({ queryKey: ["profile-full"] });
      } else toast.error(res.reason ?? "Kod uygulanamadı");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const link =
    typeof window !== "undefined" && q.data?.code
      ? `${window.location.origin}/auth?ref=${q.data.code}`
      : "";

  const copy = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    toast.success("Davet linki kopyalandı");
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <Gift size={18} className="text-[var(--brand)]" />
        <h2 className="font-semibold">Arkadaşını davet et</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Davet linkinle kayıt olan her arkadaşın için <b>+{REFERRER_BONUS} kredi</b> kazanırsın. En
        fazla 2 arkadaş davet edebilirsin.
      </p>

      {q.isLoading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> Yükleniyor…
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <code className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm break-all flex-1 min-w-[200px]">
              {link || "—"}
            </code>
            <button
              onClick={copy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />} Kopyala
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Users size={13} /> Davet edilen
              </div>
              <div className="text-2xl font-bold">{q.data?.invited ?? 0}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Coins size={13} /> Kazanılan kredi
              </div>
              <div className="text-2xl font-bold">{q.data?.credits_earned ?? 0}</div>
            </div>
          </div>

          {q.data?.claimable && (
            <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-sm font-medium mb-2">Sana bir davet kodu verildi mi?</div>
              <div className="flex gap-2">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="ÖRN. A1B2C3D4"
                  className="flex-1 rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-primary/50"
                />
                <button
                  disabled={claim.isPending || code.trim().length < 4}
                  onClick={() => claim.mutate(code)}
                  className="rounded-lg border border-white/10 px-3 py-2 text-sm font-medium hover:bg-white/10 disabled:opacity-50"
                >
                  {claim.isPending ? <Loader2 size={14} className="animate-spin" /> : "Uygula"}
                </button>
              </div>
            </div>
          )}
          {q.data?.referred_by_code && (
            <p className="mt-3 text-xs text-muted-foreground">
              Davet kodu kullanıldı: <b>{q.data.referred_by_code}</b>
            </p>
          )}

          <Link
            to="/partner"
            className="mt-4 flex items-center justify-between gap-2 rounded-xl border border-[var(--brand)]/30 bg-gradient-to-r from-[var(--brand)]/15 to-[var(--brand-2)]/15 px-4 py-3 text-sm hover:from-[var(--brand)]/25 hover:to-[var(--brand-2)]/25"
          >
            <span className="flex items-center gap-2">
              <Megaphone size={15} className="text-[var(--brand)]" />
              <span>
                <b>Affiliate Partner Programı</b>
                <span className="block text-[11px] text-muted-foreground">
                  %30 tekrarlayan komisyon · 12 ay · canlı panel
                </span>
              </span>
            </span>
            <ArrowRight size={15} className="shrink-0 text-muted-foreground" />
          </Link>
        </>
      )}
    </div>
  );
}
