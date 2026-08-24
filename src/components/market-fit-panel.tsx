import { useState } from "react";
import { AlertTriangle, Check, ChevronDown, Globe2, Truck, X } from "lucide-react";
import type { MarketVerdict } from "@/lib/market-verdict";

const fitTone = (fit: string) =>
  fit === "native"
    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
    : fit === "cross-border"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
      : "border-rose-500/40 bg-rose-500/10 text-rose-300";

const decisionTone = (d: MarketVerdict["decision"]) =>
  d === "kept"
    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
    : d === "rescued"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
      : "border-rose-500/40 bg-rose-500/10 text-rose-300";

const decisionLabel = (d: MarketVerdict["decision"]) =>
  d === "kept" ? "Seçildi" : d === "rescued" ? "Sınırda kaldı" : "Elendi";

/** Ülke + platform karar gerekçesi: komisyon, teslimat, bariyer, eşik kontrolleri. */
export function MarketFitPanel({
  verdict,
  defaultOpen = false,
}: {
  verdict?: MarketVerdict;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!verdict) return null;

  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="inline-flex items-center gap-2 text-[11px] font-semibold text-foreground">
          <Globe2 size={12} className="opacity-70" />
          Ülke &amp; platform uyumu · {verdict.country_name}
        </span>
        <span className="inline-flex items-center gap-2">
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${decisionTone(verdict.decision)}`}
          >
            {decisionLabel(verdict.decision)}
          </span>
          <ChevronDown size={13} className={`transition ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{verdict.summary}</p>

      {open && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5">
              Para birimi: {verdict.currency}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5">
              {verdict.vat_label}: %{verdict.vat_pct}
            </span>
          </div>

          {verdict.channels.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-white/10">
              <table className="w-full text-left text-[10.5px]">
                <thead className="bg-white/5 text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Kanal</th>
                    <th className="px-2 py-1.5 font-medium">Durum</th>
                    <th className="px-2 py-1.5 font-medium">Komisyon</th>
                    <th className="px-2 py-1.5 font-medium">Teslimat</th>
                  </tr>
                </thead>
                <tbody>
                  {verdict.channels.map((c) => (
                    <tr key={c.platform} className="border-t border-white/5 align-top">
                      <td className="px-2 py-1.5 font-medium text-foreground">
                        {c.platform}
                        {c.note && (
                          <div className="mt-0.5 text-[9.5px] font-normal text-muted-foreground">
                            {c.note}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <span
                          className={`rounded-full border px-1.5 py-0.5 text-[9.5px] ${fitTone(c.fit)}`}
                        >
                          {c.fit_label}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">
                        %{c.commission[0]}–%{c.commission[1]}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Truck size={10} className="opacity-70" />
                          {c.ship_days[0]}–{c.ship_days[1]} gün
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {verdict.blocked_channels.length > 0 && (
            <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 text-[10.5px] text-rose-200">
              {verdict.blocked_channels.join(", ")} → {verdict.country_name} pazarında satış kanalı
              olarak kullanılamıyor.
            </p>
          )}

          {verdict.barrier && (
            <p className="inline-flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10.5px] text-amber-200">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              <span>
                <b>Sertifika / gümrük bariyeri:</b> {verdict.barrier.why}
              </span>
            </p>
          )}

          <ul className="space-y-1">
            {verdict.checks.map((c, i) => (
              <li
                key={i}
                className="flex items-start justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-2 py-1.5 text-[10.5px]"
              >
                <span className="inline-flex items-start gap-1.5">
                  {c.passed ? (
                    <Check size={11} className="mt-0.5 shrink-0 text-emerald-400" />
                  ) : (
                    <X size={11} className="mt-0.5 shrink-0 text-rose-400" />
                  )}
                  <span>
                    <b className="font-medium text-foreground">{c.label}</b>
                    {c.detail && <span className="block text-muted-foreground">{c.detail}</span>}
                  </span>
                </span>
                <span className="shrink-0 text-right text-muted-foreground">
                  {c.value && (
                    <span className={c.passed ? "text-emerald-300" : "text-rose-300"}>
                      {c.value}
                    </span>
                  )}
                  {c.threshold && (
                    <span className="block text-[9.5px] opacity-70">{c.threshold}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
