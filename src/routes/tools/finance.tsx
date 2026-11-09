import { withProGate } from "@/components/pro-route-gate";
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Calculator, Ship, Wallet, Boxes, ShieldCheck, Landmark } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { HubShell } from "@/components/tools/hub-shell";
import { ToolCard, Field, callTool } from "@/components/tools/tool-card";
import { firstValidationError, requirePositive, requireText } from "@/lib/tool-validation";
import {
  capitalPlan,
  desiPlan,
  landedCostPlan,
  milestonePlan,
  reverseCostPlan,
  todayIso,
} from "@/lib/tool-calculators";

const SECTIONS = [
  { id: "reverse-cost", label: "Tersine Maliyet" },
  { id: "landed-cost", label: "Landed Cost" },
  { id: "capital-planner", label: "Sermaye Planı" },
  { id: "desi-optimizer", label: "Desi / Ambalaj" },
  { id: "milestone-shield", label: "Ödeme Kalkanı" },
  { id: "hs-classifier", label: "HS & Gümrük" },
] as const;

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
  component: withProGate(FinanceHub),
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
const usd = (v: number) =>
  `$${(Math.round(v * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const dateLabel = (iso: string) =>
  new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

function ModelBreakdown({
  title,
  source,
  rows,
}: {
  title: string;
  source: string;
  rows: { label: string; amount: number; kind?: "fee" | "profit" }[];
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>{title}</span>
        <span className="rounded border border-[var(--accent-active)]/25 px-1.5 py-0.5 text-[9px] text-[var(--accent-active)]">
          model
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-2 text-[11px]">
            <span className="truncate text-muted-foreground">{row.label}</span>
            <span
              className={`shrink-0 font-mono ${
                row.kind === "profit" ? "text-[var(--profit)]" : "text-foreground/75"
              }`}
            >
              {usd(row.amount)}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground/70">
        Varsayım kaynağı: {source}. Hesaplanan model değeri; ölçülmüş teklif değil.
      </p>
    </div>
  );
}

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
  const [hs, setHs] = useState({
    product: "",
    material: "",
    destination: "US",
    price: "29.99",
    cost: "7.40",
  });

  const revPlan = reverseCostPlan({
    retail: rev.retail,
    marginPct: rev.margin,
    channel: rev.channel,
  });
  const landPlan = landedCostPlan({
    unit: land.unit,
    qty: land.qty,
    freight: land.freight,
    dutyPct: land.duty,
    extra: land.extra,
  });
  const capPlan = capitalPlan({
    units: cap.units,
    unit: cap.unit,
    freight: cap.freight,
    adsPerDay: cap.ads,
    velocity: cap.velocity,
    leadTime: cap.leadTime,
    today: todayIso(),
  });
  const dimPlan = desiPlan({ l: dim.l, w: dim.w, h: dim.h, weight: dim.weight });
  const msPlan = milestonePlan({ amount: ms.amount, leadTime: ms.leadTime });

  return (
    <HubShell
      emoji="💰"
      title="Financial & Cost Engine"
      subtitle="Depoziti göndermeden önce gerçek maliyeti, gereken sermayeyi ve ödeme riskini hesapla."
      sections={SECTIONS}
    >
      <ToolCard
        id="reverse-cost"
        icon={Calculator}
        title="Reverse Cost Engineer"
        description="Hedef satış fiyatı ve marjdan geriye doğru maksimum tedarikçi maliyetini bulur."
        runLabel="AI ile Stratejiyi Derinleştir"
        onRun={() => callTool("reverse-cost", rev)}
        validate={() =>
          firstValidationError(
            requireText(rev.product, "Ürün", 2),
            requirePositive(rev.retail, "Hedef perakende fiyat"),
            requirePositive(rev.margin, "Hedef marj"),
          )
        }
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
        <div className="grid grid-cols-3 gap-2">
          <Stat
            label="Maks. COGS"
            value={revPlan.feasible ? usd(revPlan.maxCogs) : "Ulaşılamaz"}
            tone={revPlan.feasible ? "profit" : "warning"}
          />
          <Stat label="Kanal kesintisi" value={usd(revPlan.fees)} tone="warning" />
          <Stat label="Hedef net kâr" value={usd(revPlan.targetProfit)} tone="action" />
        </div>
        <ModelBreakdown
          title={`${revPlan.profile.label} maliyet dökümü`}
          source={revPlan.profile.source}
          rows={revPlan.breakdown}
        />
        {!revPlan.feasible && (
          <p className="rounded-lg border border-[var(--warning)]/25 bg-[var(--warning)]/10 p-2 text-[11px] text-[var(--warning)]">
            Bu fiyat/marj kombinasyonunda kanal kesintileri hedef kârı aşıyor. Fiyatı yükselt, marjı
            düşür veya daha düşük komisyonlu kanalı seç.
          </p>
        )}
      </ToolCard>

      <ToolCard
        id="landed-cost"
        icon={Ship}
        title="Landed Cost Calculator"
        description="EXW/FOB + navlun + gümrük ile gerçek kapıdan kapıya birim maliyet."
        runLabel="AI ile Maliyeti Düşür"
        onRun={() => callTool("landed-cost", land)}
        validate={() =>
          firstValidationError(
            requirePositive(land.unit, "Birim maliyet"),
            requirePositive(land.qty, "Adet"),
          )
        }
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
          <Stat label="Birim landed cost" value={usd(landPlan.perUnit)} tone="profit" />
          <Stat label="Toplam yatırım" value={usd(landPlan.total)} />
          <Stat label="Gümrük vergisi" value={usd(landPlan.duty)} tone="warning" />
          <Stat label="Navlun / birim" value={usd(landPlan.freightPerUnit)} />
        </div>
        <p className="text-[10px] text-muted-foreground">
          Mal bedeli {usd(landPlan.goods)} · navlun {usd(landPlan.freight)} · ek{" "}
          {usd(landPlan.extra)}. Landed çarpanı: {landPlan.effectiveLandedMultiple}×.
        </p>
      </ToolCard>

      <ToolCard
        id="capital-planner"
        icon={Wallet}
        title="Minimum Capital Planner"
        description="Stok, navlun ve reklam bütçesini birlikte planla — stoksuz kalma riskini önle."
        runLabel="AI ile Nakit Akışını Planla"
        onRun={() => callTool("capital-planner", cap)}
        validate={() =>
          firstValidationError(
            requirePositive(cap.units, "İlk stok adedi"),
            requirePositive(cap.unit, "Birim maliyet"),
            requirePositive(cap.velocity, "Günlük satış"),
          )
        }
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
          <Stat label="Min. sermaye" value={usd(capPlan.total)} tone="action" />
          <Stat
            label="Stok tükenme"
            value={`${capPlan.stockoutDays} gün`}
            tone={capPlan.stockoutDays < n(cap.leadTime) ? "warning" : "profit"}
          />
          <Stat
            label="Sipariş tarihi"
            value={capPlan.reorderInDays <= 0 ? "Bugün / gecikmiş" : dateLabel(capPlan.reorderDate)}
            tone={capPlan.reorderInDays <= 0 ? "warning" : "neutral"}
          />
          <Stat label="Emniyet stoğu" value={`${capPlan.safetyStock} adet`} />
        </div>
        <p className="text-[10px] text-muted-foreground">
          Stok {usd(capPlan.inventory)} · navlun {usd(capPlan.freight)} · tedarik süresi reklamı{" "}
          {usd(capPlan.adsDuringLeadTime)}. Emniyet stoğu, tedarik süresi talebinin %20'si.
        </p>
      </ToolCard>

      <ToolCard
        id="desi-optimizer"
        icon={Boxes}
        title="Packaging & Desi Optimizer"
        description="Ölçüleri gir; bir alt FBA/kargo kademesine düşürecek ambalaj önerileri al."
        runLabel="AI ile Ambalajı Küçült"
        onRun={() => callTool("desi-optimizer", dim)}
        validate={() =>
          firstValidationError(
            requirePositive(dim.l, "Uzunluk"),
            requirePositive(dim.w, "Genişlik"),
            requirePositive(dim.h, "Yükseklik"),
          )
        }
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
          <Stat label="Hacimsel ağırlık" value={`${dimPlan.volumetricKg} kg`} />
          <Stat
            label="Ücretlendirilecek"
            value={`${dimPlan.billableKg} kg`}
            tone={dimPlan.isVolumetric ? "warning" : "profit"}
          />
        </div>
        <p className="text-[10px] text-muted-foreground">
          Formül: cm³ ÷ {dimPlan.divisor}.{" "}
          {dimPlan.isVolumetric
            ? "Hacim baskın; kutu küçültme doğrudan kargo kademesini düşürebilir."
            : "Gerçek ağırlık baskın; kutu küçültmek tek başına kademe düşürmeyebilir."}
        </p>
      </ToolCard>

      <ToolCard
        id="milestone-shield"
        icon={ShieldCheck}
        title="Supplier Milestone Shield"
        description="30/70 ödeme planını görselleştirir ve kur riski uyarısı üretir."
        runLabel="AI ile Ödeme Planını Koru"
        onRun={() => callTool("milestone-shield", ms)}
        validate={() => requirePositive(ms.amount, "Sipariş tutarı")}
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
              <div className="font-semibold text-[var(--accent-active)]">
                %{msPlan.depositPct} Depozito
              </div>
              <div className="text-muted-foreground">Gün 0 · {usd(msPlan.deposit)}</div>
            </div>
            <div>
              <div className="font-semibold text-[var(--warning)]">Üretim/QC</div>
              <div className="text-muted-foreground">Gün {msPlan.qcDay} · foto + rapor</div>
            </div>
            <div className="text-right">
              <div className="font-semibold text-[var(--profit)]">
                %{Math.round(100 - msPlan.depositPct)} Bakiye
              </div>
              <div className="text-muted-foreground">B/L öncesi · {usd(msPlan.balance)}</div>
            </div>
          </div>
          <div className="mt-3 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/10 p-2 text-[11px] text-[var(--warning)]">
            ⚠ Kur riski: {ms.leadTime} günlük vade boyunca {ms.currency} oynaklığı bakiye ödemesini
            etkileyebilir.
          </div>
        </div>
      </ToolCard>

      <ToolCard
        id="hs-classifier"
        icon={Landmark}
        title="HS Kodu & Gümrük Vergisi Bulucu"
        description="Ürünün HS/HTS kodunu, hedef pazar gümrük vergisini, VAT'ını ve zorunlu sertifikalarını çıkarır."
        runLabel="Kodu ve Vergiyi Çıkar"
        onRun={() => callTool("hs-classifier", hs)}
        validate={() =>
          firstValidationError(
            requireText(hs.product, "Ürün", 3),
            requireText(hs.material, "Malzeme", 2),
            requireText(hs.destination, "Hedef pazar", 2),
          )
        }
      >
        <Field label="Ürün (mümkünse malzeme ve kullanım amacıyla)">
          <Input
            value={hs.product}
            onChange={(e) => setHs({ ...hs, product: e.target.value })}
            placeholder="Paslanmaz çelik 750ml vakumlu terma termos"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Malzeme / kompozisyon">
            <Input
              value={hs.material}
              onChange={(e) => setHs({ ...hs, material: e.target.value })}
              placeholder="304 paslanmaz çelik + PP kapak"
            />
          </Field>
          <Field label="Hedef pazar">
            <Input
              value={hs.destination}
              onChange={(e) => setHs({ ...hs, destination: e.target.value })}
              placeholder="US / EU / UK"
            />
          </Field>
          <Field label="Hedef satış fiyatı ($)">
            <Input
              type="number"
              value={hs.price}
              onChange={(e) => setHs({ ...hs, price: e.target.value })}
              placeholder="29.99"
            />
          </Field>
          <Field label="Landed maliyet ($)">
            <Input
              type="number"
              value={hs.cost}
              onChange={(e) => setHs({ ...hs, cost: e.target.value })}
              placeholder="7.40"
            />
          </Field>
        </div>
      </ToolCard>
    </HubShell>
  );
}
