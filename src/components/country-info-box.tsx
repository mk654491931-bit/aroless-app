import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Lightbulb, Loader2, ShieldAlert, Sparkles, ThumbsUp } from "lucide-react";
import { countryByCode } from "@/lib/countries";
import { getCountryStrategy } from "@/lib/competitor.functions";

/** 🟢 Kolaylıklar / 🔴 Zorluklar / 💡 AI stratejisi — "Pazar Karnesi". */
export function CountryInfoBox({ code, niche = "" }: { code: string; niche?: string }) {
  const c = countryByCode(code);
  const [strategy, setStrategy] = useState<string>("");
  const fn = useServerFn(getCountryStrategy);
  const mut = useMutation({
    mutationFn: () => fn({ data: { niche, country: c.code } }),
    onSuccess: (r) => setStrategy(r.strategy),
  });

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <span className="text-lg">{c.flag}</span> {c.name} — Pazar Karnesi
        </h3>
        <span className="text-[10px] px-2 py-1 rounded-full border border-white/10 bg-white/5 text-muted-foreground">
          {c.vat_label} · {c.currency}
        </span>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-emerald-400 mb-1 flex items-center gap-1.5">
            <ThumbsUp size={11} /> Kolaylıklar
          </div>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {c.strengths.map((s) => <li key={s}>🟢 {s}</li>)}
          </ul>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-rose-400 mb-1 flex items-center gap-1.5">
            <ShieldAlert size={11} /> Zorluklar &amp; Engeller
          </div>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {c.challenges.map((s) => <li key={s}>🔴 {s}</li>)}
          </ul>
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
            <Lightbulb size={11} /> AI Özel Stratejisi
          </span>
          <button
            type="button"
            onClick={() => mut.mutate()}
            disabled={mut.isPending}
            className="text-[11px] rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 px-2.5 py-1 font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            {mut.isPending ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
            {strategy ? "Yenile" : "Strateji üret"}
          </button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {strategy || "Bu ülke + niş kombinasyonu için Gemini destekli özel strateji üretmek üzere butona bas."}
        </p>
      </div>
    </div>
  );
}
