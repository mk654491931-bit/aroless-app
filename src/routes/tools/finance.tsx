import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Calculator, Ship, Wallet, Boxes, ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { HubShell } from "@/components/tools/hub-shell";
import { ToolCard, Field, callTool } from "@/components/tools/tool-card";

export const Route = createFileRoute("/tools/finance")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Financial & Cost Engine — Aroless" },
      {
        name: "description",
        content:
          "Reverse cost engineering, landed cost, minimum capital planning, desi optimization and milestone payment protection.",
      },
      { property: "og:title", content: "Financial & Cost Engine — Aroless" },
      { property: "og:description", content: "Know your true cost before you wire the deposit." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FinanceHub,
});

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "profit" | "warning" | "action" | "neutral";
}) {
  const cls = {
    profit: "text-[var(--profit)] border-[var(--profit)]/30 bg-[var(--profit)]/10",
    warning: "text-[var(--warning)] border-[var(--warning)]/30 bg-[var(--warning)]/10",
    action:
      "text-[var(--accent-active)] border-[var(--accent-active)]/30 bg-[var(--accent-active)]/10",
    neutral: "border-white/10 bg-white/5",
  }[tone];
  return (
    <div className={`rounded-lg border p-2.5 ${cls}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-70">{label}</div>
      <div className="mt-0.5 text-base font-bold">{value}</div>
    </div>
  );
}

const n = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const usd = (v: number) => `$${(Math.round(v * 100) / 100).toLocaleString("en-US")}`;

function FinanceHub() {
  const [rev, setRev] = useState({
    product: "",
    retail: "39.99",
    margin: "30",
    channel: "Amazon US",
  });
  const [land, setLand] = useState({
    unit: "3.2",
    qty: "1000",
    freight: "850",
    duty: "12",
    extra: "150",
    route: "CN → US",
  });
  const [cap, setCap] = useState({
    units: "1000",
    unit: "3.2",
    freight: "850",
    ads: "40",
    velocity: "12",
    leadTime: "35",
  });
  const [dim, setDim] = useState({
    l: "30",
    w: "22",
    h: "14",
    weight: "0.9",
    channel: "Amazon FBA US",
  });
  const [ms, setMs] = useState({
    amount: "4200",
    currency: "USD/CNY",
    leadTime: "35",
    trust: "yeni tedarikçi",
  });

  const maxCost = n(rev.retail) * (1 - n(rev.margin) / 100) - n(rev.retail) * 0.15 - 3.9;
  const landedUnit =
    n(land.qty) > 0
      ? (n(land.unit) * n(land.qty) * (1 + n(land.duty) / 100) + n(land.freight) + n(land.extra)) /
        n(land.qty)
      : 0;
  const minCapital = n(cap.units) * n(cap.unit) + n(cap.freight) + n(cap.ads) * n(cap.leadTime);
  const stockoutDays = n(cap.velocity) > 0 ? Math.round(n(cap.units) / n(cap.velocity)) : 0;
  const volumetric = (n(dim.l) * n(dim.w) * n(dim.h)) / 5000;
  const billable = Math.max(volumetric, n(dim.weight));
  const deposit = n(ms.amount) * 0.3;

  return (
    <HubShell
      emoji="💰"
      title="Financial & Cost Engine"
      subtitle="Depoziti göndermeden önce gerçek maliyeti, gereken sermayeyi ve ödeme riskini hesapla."
    >
      <ToolCard
        icon={Calculator}
        title="Reverse Cost Engineer"
        description="Hedef satış fiyatı ve marjdan geriye doğru maksimum tedarikçi maliyetini bulur."
        runLabel="Maks. Maliyeti Hesapla"
        onRun={() => callTool("reverse-cost", rev)}
      >
        <Field label="Ürün">
          <Input
            value={rev.product}
            onChange={(e) => setRev({ ...rev, product: e.target.value })}
            placeholder="Yoga blok seti"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Hedef perakende ($)">
            <Input
              type="number"
              value={rev.retail}
              onChange={(e) => setRev({ ...rev, retail: e.target.value })}
            />
          </Field>
          <Field label="Hedef marj (%)">
            <Input
              type="number"
              value={rev.margin}
              onChange={(e) => setRev({ ...rev, margin: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Kanal">
          <Input
            value={rev.channel}
            onChange={(e) => setRev({ ...rev, channel: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Kaba maks. COGS" value={usd(Math.max(maxCost, 0))} tone="profit" />
          <Stat
            label="Tahmini kanal kesintisi"
            value={usd(n(rev.retail) * 0.15 + 3.9)}
            tone="warning"
          />
        </div>
      </ToolCard>

      <ToolCard
        icon={Ship}
        title="Landed Cost Calculator"
        description="EXW/FOB + navlun + gümrük ile gerçek kapıdan kapıya birim maliyet."
        runLabel="Landed Cost Analizi"
        onRun={() => callTool("landed-cost", land)}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="EXW/FOB birim ($)">
            <Input
              type="number"
              value={land.unit}
              onChange={(e) => setLand({ ...land, unit: e.target.value })}
            />
          </Field>
          <Field label="Adet">
            <Input
              type="number"
              value={land.qty}
              onChange={(e) => setLand({ ...land, qty: e.target.value })}
            />
          </Field>
          <Field label="Navlun toplam ($)">
            <Input
              type="number"
              value={land.freight}
              onChange={(e) => setLand({ ...land, freight: e.target.value })}
            />
          </Field>
          <Field label="Gümrük vergisi (%)">
            <Input
              type="number"
              value={land.duty}
              onChange={(e) => setLand({ ...land, duty: e.target.value })}
            />
          </Field>
          <Field label="Ek ücretler ($)">
            <Input
              type="number"
              value={land.extra}
              onChange={(e) => setLand({ ...land, extra: e.target.value })}
            />
          </Field>
          <Field label="Rota">
            <Input
              value={land.route}
              onChange={(e) => setLand({ ...land, route: e.target.value })}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Birim landed cost" value={usd(landedUnit)} tone="profit" />
          <Stat label="Toplam yatırım" value={usd(landedUnit * n(land.qty))} />
        </div>
      </ToolCard>

      <ToolCard
        icon={Wallet}
        title="Minimum Capital Planner"
        description="Stok, navlun ve reklam bütçesini birlikte planla — stoksuz kalma riskini önle."
        runLabel="Sermaye Planı Oluştur"
        onRun={() => callTool("capital-planner", cap)}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="İlk stok adedi">
            <Input
              type="number"
              value={cap.units}
              onChange={(e) => setCap({ ...cap, units: e.target.value })}
            />
          </Field>
          <Field label="Birim maliyet ($)">
            <Input
              type="number"
              value={cap.unit}
              onChange={(e) => setCap({ ...cap, unit: e.target.value })}
            />
          </Field>
          <Field label="Navlun ($)">
            <Input
              type="number"
              value={cap.freight}
              onChange={(e) => setCap({ ...cap, freight: e.target.value })}
            />
          </Field>
          <Field label="Günlük satış (adet)">
            <Input
              type="number"
              value={cap.velocity}
              onChange={(e) => setCap({ ...cap, velocity: e.target.value })}
            />
          </Field>
        </div>
        <Field label={`Günlük reklam bütçesi: $${cap.ads}`}>
          <Slider
            value={[n(cap.ads)]}
            min={0}
            max={500}
            step={5}
            onValueChange={(v) => setCap({ ...cap, ads: String(v[0]) })}
          />
        </Field>
        <Field label={`Tedarik süresi: ${cap.leadTime} gün`}>
          <Slider
            value={[n(cap.leadTime)]}
            min={7}
            max={120}
            step={1}
            onValueChange={(v) => setCap({ ...cap, leadTime: String(v[0]) })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Min. sermaye" value={usd(minCapital)} tone="action" />
          <Stat
            label="Stok tükenme"
            value={`${stockoutDays} gün`}
            tone={stockoutDays < n(cap.leadTime) ? "warning" : "profit"}
          />
        </div>
      </ToolCard>

      <ToolCard
        icon={Boxes}
        title="Packaging & Desi Optimizer"
        description="Ölçüleri gir; bir alt FBA/kargo kademesine düşürecek ambalaj önerileri al."
        runLabel="Ambalajı Optimize Et"
        onRun={() => callTool("desi-optimizer", dim)}
      >
        <div className="grid grid-cols-3 gap-3">
          <Field label="Uzunluk (cm)">
            <Input
              type="number"
              value={dim.l}
              onChange={(e) => setDim({ ...dim, l: e.target.value })}
            />
          </Field>
          <Field label="Genişlik (cm)">
            <Input
              type="number"
              value={dim.w}
              onChange={(e) => setDim({ ...dim, w: e.target.value })}
            />
          </Field>
          <Field label="Yükseklik (cm)">
            <Input
              type="number"
              value={dim.h}
              onChange={(e) => setDim({ ...dim, h: e.target.value })}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ağırlık (kg)">
            <Input
              type="number"
              value={dim.weight}
              onChange={(e) => setDim({ ...dim, weight: e.target.value })}
            />
          </Field>
          <Field label="Kanal">
            <Input
              value={dim.channel}
              onChange={(e) => setDim({ ...dim, channel: e.target.value })}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Hacimsel ağırlık" value={`${volumetric.toFixed(2)} kg`} />
          <Stat
            label="Ücretlendirilecek"
            value={`${billable.toFixed(2)} kg`}
            tone={billable > n(dim.weight) ? "warning" : "profit"}
          />
        </div>
      </ToolCard>

      <ToolCard
        icon={ShieldCheck}
        title="Supplier Milestone Shield"
        description="30/70 ödeme planını görselleştirir ve kur riski uyarısı üretir."
        runLabel="Ödeme Planını Koru"
        onRun={() => callTool("milestone-shield", ms)}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sipariş tutarı ($)">
            <Input
              type="number"
              value={ms.amount}
              onChange={(e) => setMs({ ...ms, amount: e.target.value })}
            />
          </Field>
          <Field label="Tedarik süresi (gün)">
            <Input
              type="number"
              value={ms.leadTime}
              onChange={(e) => setMs({ ...ms, leadTime: e.target.value })}
            />
          </Field>
          <Field label="Kur çifti">
            <Input
              value={ms.currency}
              onChange={(e) => setMs({ ...ms, currency: e.target.value })}
            />
          </Field>
          <Field label="Tedarikçi güveni">
            <Input value={ms.trust} onChange={(e) => setMs({ ...ms, trust: e.target.value })} />
          </Field>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="relative mt-2 h-1.5 rounded-full bg-white/10">
            <div className="absolute inset-y-0 left-0 w-[30%] rounded-full bg-[var(--accent-active)]" />
            <span className="absolute -top-1 left-0 h-3.5 w-3.5 -translate-x-1/2 rounded-full border-2 border-[var(--accent-active)] bg-[var(--surface)]" />
            <span className="absolute -top-1 left-[30%] h-3.5 w-3.5 -translate-x-1/2 rounded-full border-2 border-[var(--warning)] bg-[var(--surface)]" />
            <span className="absolute -top-1 left-full h-3.5 w-3.5 -translate-x-1/2 rounded-full border-2 border-[var(--profit)] bg-[var(--surface)]" />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
            <div>
              <div className="font-semibold text-[var(--accent-active)]">%30 Depozito</div>
              <div className="text-muted-foreground">Gün 0 · {usd(deposit)}</div>
            </div>
            <div>
              <div className="font-semibold text-[var(--warning)]">Üretim/QC</div>
              <div className="text-muted-foreground">
                Gün {Math.round(n(ms.leadTime) * 0.7)} · foto + rapor
              </div>
            </div>
            <div className="text-right">
              <div className="font-semibold text-[var(--profit)]">%70 Bakiye</div>
              <div className="text-muted-foreground">
                B/L öncesi · {usd(n(ms.amount) - deposit)}
              </div>
            </div>
          </div>
          <div className="mt-3 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/10 p-2 text-[11px] text-[var(--warning)]">
            ⚠ Kur riski: {ms.leadTime} günlük vade boyunca {ms.currency} oynaklığı bakiye ödemesini
            etkileyebilir.
          </div>
        </div>
      </ToolCard>
    </HubShell>
  );
}
