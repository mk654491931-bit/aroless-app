import { getUiLang } from "@/lib/auto-i18n/lang";
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Gauge, PackagePlus, CalendarClock, Globe2, Megaphone, Loader2, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HubShell } from "@/components/tools/hub-shell";
import { ToolCard, Field, callTool } from "@/components/tools/tool-card";
import { toast } from "sonner";

export const Route = createFileRoute("/tools/growth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Growth & Market AI — Velora" },
      { name: "description", content: "Multi-AI consensus scoring, bundle AOV booster, lead-time countdown, cross-border arbitrage matrix and competitor ad hook extraction." },
      { property: "og:title", content: "Growth & Market AI — Velora" },
      { property: "og:description", content: "Three AI engines score your product and map your growth moves." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: GrowthHub,
});

type Engine = { score: number; note: string };
type Consensus = {
  gemini: Engine;
  groq: Engine;
  openrouter: Engine;
  lovable?: Engine;
  hybrid: number;
  agreement?: number;
  engines?: number;
};

function Gauge360({ value, label, color }: { value: number; label: string; color: string }) {
  const r = 30, c = 2 * Math.PI * r;
  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg width="76" height="76" viewBox="0 0 76 76" className="-rotate-90">
        <circle cx="38" cy="38" r={r} fill="none" stroke="currentColor" strokeWidth="7" className="text-white/10" />
        <circle
          cx="38" cy="38" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (c * Math.min(value, 100)) / 100}
        />
      </svg>
      <div className="-mt-[52px] text-lg font-black" style={{ color }}>{value}</div>
      <div className="mt-[26px] text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function ConsensusCard() {
  const [input, setInput] = useState({ product: "", country: "US", price: "39.99", cost: "8.50" });
  const [data, setData] = useState<Consensus | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/public/tool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "consensus", input: { ...input, uiLang: getUiLang() } }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Consensus başarısız");
      setData((await res.json()) as Consensus);
    } catch (e) {
      toast.error("Analiz başarısız", { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-white/10 bg-[var(--surface)]/70 backdrop-blur lg:col-span-2">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--ai)]/25 bg-[var(--ai)]/10">
            <Gauge size={15} className="text-[var(--ai)]" />
          </span>
          Multi-AI Consensus Score
        </CardTitle>
        <CardDescription className="text-xs">Gemini, Groq, OpenRouter ve Lovable AI aynı ürünü bağımsız puanlar; hibrit skor ağırlıklı olarak birleştirilir.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-3">
          <Field label="Ürün"><Input value={input.product} onChange={(e) => setInput({ ...input, product: e.target.value })} placeholder="LED yıldız projektör" /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Pazar"><Input value={input.country} onChange={(e) => setInput({ ...input, country: e.target.value })} /></Field>
            <Field label="Fiyat ($)"><Input type="number" value={input.price} onChange={(e) => setInput({ ...input, price: e.target.value })} /></Field>
            <Field label="Maliyet ($)"><Input type="number" value={input.cost} onChange={(e) => setInput({ ...input, cost: e.target.value })} /></Field>
          </div>
          <Button onClick={run} disabled={loading} className="w-full gap-2">
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {loading ? "4 motor çalışıyor…" : "Consensus Skorunu Hesapla"}
          </Button>
          {data && (
            <div className="space-y-2 text-xs text-muted-foreground">
              <p><span className="font-semibold text-[var(--accent-active)]">Gemini:</span> {data.gemini.note}</p>
              <p><span className="font-semibold text-[var(--profit)]">Groq:</span> {data.groq.note}</p>
              <p><span className="font-semibold text-[var(--ai)]">OpenRouter:</span> {data.openrouter.note}</p>
              {data.lovable && <p><span className="font-semibold text-[var(--warning)]">Lovable AI:</span> {data.lovable.note}</p>}
              {typeof data.agreement === "number" && (
                <p className="pt-1">
                  <span className="font-semibold">Motor uyumu:</span> %{data.agreement} · {data.engines ?? 0} motor yanıt verdi
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-4 rounded-xl border border-white/10 bg-black/20 p-4">
          <Gauge360 value={data?.gemini.score ?? 0} label="Gemini" color="var(--accent-active)" />
          <Gauge360 value={data?.groq.score ?? 0} label="Groq" color="var(--profit)" />
          <Gauge360 value={data?.openrouter.score ?? 0} label="OpenRouter" color="var(--ai)" />
          <Gauge360 value={data?.lovable?.score ?? 0} label="Lovable AI" color="var(--warning)" />
          <div className="ml-2 rounded-xl border border-[var(--profit)]/30 bg-[var(--profit)]/10 px-4 py-3 text-center">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Hybrid</div>
            <div className="text-3xl font-black text-[var(--profit)]">{data?.hybrid ?? 0}%</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function GrowthHub() {
  const today = new Date().toISOString().slice(0, 10);
  const [bundle, setBundle] = useState({ product: "", price: "39.99", channel: "Amazon US" });
  const [lead, setLead] = useState({ today, production: "25", transit: "32", checkin: "5", stock: "600", velocity: "14" });
  const [arb, setArb] = useState({ product: "", cost: "8.5", price: "39.99" });
  const [hook, setHook] = useState("");

  return (
    <HubShell
      emoji="🚀"
      title="Growth & Market AI"
      subtitle="Ürünü üç motorla puanla, sepeti büyüt, stok tarihini kaçırma ve rakibin reklam kancasını çöz."
    >
      <ConsensusCard />

      <ToolCard
        icon={PackagePlus}
        title="AI Bundle & AOV Booster"
        description="Düşük maliyetli tamamlayıcı ürünlerle sepet ortalamasını yükselt."
        runLabel="Bundle Önerileri Getir"
        onRun={() => callTool("bundle-booster", bundle)}
      >
        <Field label="Ana ürün"><Input value={bundle.product} onChange={(e) => setBundle({ ...bundle, product: e.target.value })} placeholder="Pilates minderi" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Satış fiyatı ($)"><Input type="number" value={bundle.price} onChange={(e) => setBundle({ ...bundle, price: e.target.value })} /></Field>
          <Field label="Kanal"><Input value={bundle.channel} onChange={(e) => setBundle({ ...bundle, channel: e.target.value })} /></Field>
        </div>
      </ToolCard>

      <ToolCard
        icon={CalendarClock}
        title="Lead-Time Countdown"
        description="Üretim + transit + depo girişini toplayıp tam yeniden sipariş tarihini verir."
        runLabel="Reorder Tarihini Hesapla"
        onRun={() => callTool("lead-time", lead)}
      >
        <div className="grid grid-cols-3 gap-3">
          <Field label="Üretim (gün)"><Input type="number" value={lead.production} onChange={(e) => setLead({ ...lead, production: e.target.value })} /></Field>
          <Field label="Transit (gün)"><Input type="number" value={lead.transit} onChange={(e) => setLead({ ...lead, transit: e.target.value })} /></Field>
          <Field label="Depo girişi (gün)"><Input type="number" value={lead.checkin} onChange={(e) => setLead({ ...lead, checkin: e.target.value })} /></Field>
          <Field label="Eldeki stok"><Input type="number" value={lead.stock} onChange={(e) => setLead({ ...lead, stock: e.target.value })} /></Field>
          <Field label="Günlük satış"><Input type="number" value={lead.velocity} onChange={(e) => setLead({ ...lead, velocity: e.target.value })} /></Field>
          <Field label="Bugün"><Input type="date" value={lead.today} onChange={(e) => setLead({ ...lead, today: e.target.value })} /></Field>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-black/20 p-2 text-[10px]">
          <span className="rounded bg-[var(--accent-active)]/15 px-2 py-1 text-[var(--accent-active)]">Üretim {lead.production}g</span>
          <span className="h-px flex-1 bg-white/10" />
          <span className="rounded bg-[var(--ai)]/15 px-2 py-1 text-[var(--ai)]">Transit {lead.transit}g</span>
          <span className="h-px flex-1 bg-white/10" />
          <span className="rounded bg-[var(--profit)]/15 px-2 py-1 text-[var(--profit)]">Check-in {lead.checkin}g</span>
        </div>
      </ToolCard>

      <ToolCard
        icon={Globe2}
        title="Cross-Border Arbitrage Matrix"
        description="Amazon US, Amazon EU ve TikTok Shop marjlarını yan yana karşılaştırır."
        runLabel="Pazar Matrisini Çıkar"
        onRun={() => callTool("arbitrage-matrix", arb)}
      >
        <Field label="Ürün"><Input value={arb.product} onChange={(e) => setArb({ ...arb, product: e.target.value })} placeholder="Paslanmaz termos" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Landed cost ($)"><Input type="number" value={arb.cost} onChange={(e) => setArb({ ...arb, cost: e.target.value })} /></Field>
          <Field label="Referans fiyat ($)"><Input type="number" value={arb.price} onChange={(e) => setArb({ ...arb, price: e.target.value })} /></Field>
        </div>
      </ToolCard>

      <ToolCard
        icon={Megaphone}
        title="Competitor Ad Hook Extractor"
        description="Rakip reklam metnindeki psikolojik kancaları ve doymamış açıları ortaya çıkarır."
        runLabel="Kancaları Çöz"
        onRun={() => callTool("ad-hook-extractor", { adCopy: hook })}
      >
        <Field label="Rakip reklam metni">
          <Textarea rows={7} value={hook} onChange={(e) => setHook(e.target.value)} placeholder="Only 200 left in stock — over 40,000 moms already switched…" />
        </Field>
      </ToolCard>
    </HubShell>
  );
}
