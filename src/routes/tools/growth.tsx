import { withProGate } from "@/components/pro-route-gate";
import { getUiLang } from "@/lib/auto-i18n/lang";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Gauge,
  PackagePlus,
  CalendarClock,
  Globe2,
  Megaphone,
  Loader2,
  Sparkles,
  Swords,
  Target,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HubShell } from "@/components/tools/hub-shell";
import { ToolCard, Field, callTool } from "@/components/tools/tool-card";
import { firstValidationError, requirePositive, requireText } from "@/lib/tool-validation";
import { leadTimePlan } from "@/lib/tool-calculators";

const SECTIONS = [
  { id: "consensus", label: "AI Konsensüs" },
  { id: "growth-plan", label: "90 Günlük Plan" },
  { id: "bundle-booster", label: "Bundle / AOV" },
  { id: "lead-time", label: "Tedarik Süresi" },
  { id: "arbitrage-matrix", label: "Arbitraj" },
  { id: "ad-hook-extractor", label: "Reklam Kancası" },
  { id: "competitor-intel", label: "Rakip İstihbaratı" },
] as const;

/** Yerel hesaplanan ISO tarihini kısa Türkçe takvim gününe çevirir. */
function shortDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
import { CreditCost } from "@/components/credit-cost";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api-client";

export const Route = createFileRoute("/tools/growth")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => {
    const product = typeof s["product"] === "string" ? s["product"].trim().slice(0, 120) : "";
    return product ? { product } : {};
  },
  head: () => ({
    meta: [
      { title: "Growth & Market AI — Aroless" },
      {
        name: "description",
        content:
          "Six-engine AI consensus scoring, a 90-day growth plan, bundle AOV booster, lead-time countdown, cross-border arbitrage matrix and competitor ad hook extraction.",
      },
      { property: "og:title", content: "Growth & Market AI — Aroless" },
      {
        property: "og:description",
        content:
          "Six configured AI engines score your product and turn it into a 90-day growth plan.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: withProGate(GrowthHub),
});

type Engine = { provider?: string; score: number; note: string };
type Consensus = {
  gemini: Engine;
  groq: Engine;
  openrouter: Engine;
  lovable?: Engine;
  hybrid: number;
  agreement?: number;
  engines?: number;
  /** Kaç motorun çağrıldığı — `engines` 0 iken "anahtar yok" demenin şartı. */
  attempted?: number;
  /** Yeni sözleşme: yalnız gerçekten çağrılan motorlar. */
  results?: Engine[];
};

/** Motor etiketi → renk. Yeni sağlayıcı eklendiğinde gauge yine görünür. */
const ENGINE_COLORS: Record<string, string> = {
  gemini: "var(--accent-active)",
  groq: "var(--profit)",
  openrouter: "var(--ai)",
  hf: "#f59e0b",
  cerebras: "#38bdf8",
  sambanova: "#a78bfa",
  lovable: "var(--warning)",
};
const ENGINE_LABELS: Record<string, string> = {
  gemini: "Gemini",
  groq: "Groq",
  openrouter: "OpenRouter",
  hf: "Hugging Face",
  cerebras: "Cerebras",
  sambanova: "SambaNova",
  lovable: "AI Gateway",
};

function Gauge360({ value, label, color }: { value: number; label: string; color: string }) {
  const r = 30,
    c = 2 * Math.PI * r;
  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg width="76" height="76" viewBox="0 0 76 76" className="-rotate-90">
        <circle
          cx="38"
          cy="38"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="7"
          className="text-white/10"
        />
        <circle
          cx="38"
          cy="38"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (c * Math.min(value, 100)) / 100}
        />
      </svg>
      <div className="-mt-[52px] text-lg font-black" style={{ color }}>
        {value}
      </div>
      <div className="mt-[26px] text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function ConsensusCard() {
  const [input, setInput] = useState({ product: "", country: "US", price: "39.99", cost: "8.50" });
  const [data, setData] = useState<Consensus | null>(null);
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();

  const run = async () => {
    if (input.product.trim().length < 2) {
      toast.error("Ürün adı gerekli", { description: "Motorları çalıştırmadan önce ürünü yaz." });
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch("/api/public/tool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "consensus", input: { ...input, uiLang: getUiLang() } }),
      });
      if (!res.ok)
        throw new Error((await res.json().catch(() => ({}))).error ?? "Consensus başarısız");
      setData((await res.json()) as Consensus);
    } catch (e) {
      toast.error("Analiz başarısız", { description: (e as Error).message });
    } finally {
      setLoading(false);
      // 2 jeton düşer (önbellek isabetinde harcanmaz): rozet hemen yenilenir.
      qc.invalidateQueries({ queryKey: ["profile"] });
    }
  };

  return (
    <section id="consensus" className="min-w-0 scroll-mt-32 lg:col-span-2">
      <Card className="border-white/10 bg-[var(--surface)]/70 backdrop-blur">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--ai)]/25 bg-[var(--ai)]/10">
              <Gauge size={15} className="text-[var(--ai)]" />
            </span>
            Multi-AI Consensus Score
            {/* Yapılandırılmış tüm ücretsiz motorlar bağımsız puanlar + sentez. */}
            <CreditCost amount={2} label="çok motorlu · 2 kredi" className="ms-auto" />
          </CardTitle>
          <CardDescription className="text-xs">
            Gemini, Groq, OpenRouter, Hugging Face, Cerebras ve SambaNova anahtarlarından hangisi
            tanımlıysa aynı ürünü bağımsız puanlar; hibrit skor ağırlıklı olarak birleştirilir.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="space-y-3">
            <Field label="Ürün">
              <Input
                value={input.product}
                onChange={(e) => setInput({ ...input, product: e.target.value })}
                placeholder="LED yıldız projektör"
              />
              {input.product.trim().length < 2 && (
                <span className="text-[11px] text-[var(--warning)]/90">
                  Motorların puanlayacağı ürünü yaz.
                </span>
              )}
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Pazar">
                <Input
                  value={input.country}
                  onChange={(e) => setInput({ ...input, country: e.target.value })}
                />
              </Field>
              <Field label="Fiyat ($)">
                <Input
                  type="number"
                  value={input.price}
                  onChange={(e) => setInput({ ...input, price: e.target.value })}
                />
              </Field>
              <Field label="Maliyet ($)">
                <Input
                  type="number"
                  value={input.cost}
                  onChange={(e) => setInput({ ...input, cost: e.target.value })}
                />
              </Field>
            </div>
            <Button
              onClick={run}
              disabled={loading || input.product.trim().length < 2}
              className="w-full gap-2"
            >
              {loading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              {loading ? "Motorlar çalışıyor…" : "Consensus Skorunu Hesapla"}
            </Button>
            {data && (
              <div className="space-y-2 text-xs text-muted-foreground">
                {(data.results?.length
                  ? data.results
                  : [data.gemini, data.groq, data.openrouter, data.lovable].filter(
                      (e): e is Engine => Boolean(e),
                    )
                ).map((engine) => (
                  <p key={engine.provider ?? engine.note}>
                    <span
                      className="font-semibold"
                      style={{ color: ENGINE_COLORS[engine.provider ?? ""] ?? "var(--foreground)" }}
                    >
                      {ENGINE_LABELS[engine.provider ?? ""] ?? engine.provider ?? "Motor"}:
                    </span>{" "}
                    {engine.note}
                  </p>
                ))}
                {typeof data.agreement === "number" && (
                  <p className="pt-1">
                    <span className="font-semibold">Motor uyumu:</span> %{data.agreement} ·{" "}
                    {data.engines ?? 0} motor yanıt verdi
                  </p>
                )}
                {(data.engines ?? 0) === 0 && (
                  <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-amber-200">
                    {(data.attempted ?? 0) > 0
                      ? "Motorlar çağrıldı ama yanıt vermedi (kota veya zaman aşımı). 20-30 sn sonra tekrar deneyin."
                      : "Çağrılabilir AI motoru bulunamadı: anahtar tanımlı değil veya tümü kota beklemesinde. Gemini, Groq, OpenRouter, Hugging Face, Cerebras veya SambaNova anahtarlarından en az birini Ayarlar → Environment bölümüne ekleyin."}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-4 rounded-xl border border-white/10 bg-black/20 p-4">
            {(data?.results?.length
              ? data.results
              : [data?.gemini, data?.groq, data?.openrouter, data?.lovable].filter(
                  (e): e is Engine => Boolean(e),
                )
            ).map((engine) => (
              <Gauge360
                key={engine.provider ?? engine.note}
                value={Math.round(engine.score)}
                label={ENGINE_LABELS[engine.provider ?? ""] ?? engine.provider ?? "Motor"}
                color={ENGINE_COLORS[engine.provider ?? ""] ?? "var(--foreground)"}
              />
            ))}
            <div className="ml-2 rounded-xl border border-[var(--profit)]/30 bg-[var(--profit)]/10 px-4 py-3 text-center">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Hybrid
              </div>
              <div className="text-3xl font-black text-[var(--profit)]">{data?.hybrid ?? 0}%</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function GrowthPlanCard({ initialProduct }: { initialProduct?: string }) {
  const [input, setInput] = useState({
    product: initialProduct ?? "",
    country: "US",
    channel: "Amazon US",
    price: "39.99",
    cost: "8.50",
    budget: "1500",
    goal: "90 günde kârlılığı doğrula ve günlük 10 siparişe çık",
  });

  return (
    <ToolCard
      id="growth-plan"
      icon={Target}
      title="90 Günlük Büyüme Planı"
      description="Ürünün birim ekonomisini, kanal maliyetlerini ve reklam bütçesini tek plana bağlar; 0-30, 31-60 ve 61-90 gün için ölçülebilir aksiyonlar üretir."
      runLabel="90 Günlük Planı Çıkar"
      onRun={() => callTool("growth-plan", input)}
      validate={() =>
        firstValidationError(
          requireText(input.product, "Ürün", 2),
          requirePositive(input.price, "Satış fiyatı"),
          requirePositive(input.cost, "Landed maliyet"),
        )
      }
    >
      <Field label="Ürün">
        <Input
          value={input.product}
          onChange={(e) => setInput({ ...input, product: e.target.value })}
          placeholder="Pilates minderi"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Pazar">
          <Input
            value={input.country}
            onChange={(e) => setInput({ ...input, country: e.target.value })}
          />
        </Field>
        <Field label="Kanal">
          <Input
            value={input.channel}
            onChange={(e) => setInput({ ...input, channel: e.target.value })}
          />
        </Field>
        <Field label="Satış fiyatı ($)">
          <Input
            type="number"
            value={input.price}
            onChange={(e) => setInput({ ...input, price: e.target.value })}
          />
        </Field>
        <Field label="Landed maliyet ($)">
          <Input
            type="number"
            value={input.cost}
            onChange={(e) => setInput({ ...input, cost: e.target.value })}
          />
        </Field>
        <Field label="Aylık reklam bütçesi ($)">
          <Input
            type="number"
            value={input.budget}
            onChange={(e) => setInput({ ...input, budget: e.target.value })}
          />
        </Field>
        <Field label="90 günlük hedef">
          <Input
            value={input.goal}
            onChange={(e) => setInput({ ...input, goal: e.target.value })}
            placeholder="Günlük 10 sipariş, %25 net marj"
          />
        </Field>
      </div>
    </ToolCard>
  );
}

function GrowthHub() {
  const search = Route.useSearch();
  const today = new Date().toISOString().slice(0, 10);
  const [bundle, setBundle] = useState({ product: "", price: "39.99", channel: "Amazon US" });
  const [lead, setLead] = useState({
    today,
    production: "25",
    transit: "32",
    checkin: "5",
    stock: "600",
    velocity: "14",
  });
  const [arb, setArb] = useState({ product: "", cost: "8.5", price: "39.99" });
  const [hook, setHook] = useState("");
  const [ci, setCi] = useState({
    competitor: "",
    evidence: "",
    category: "",
    cost: "",
    channel: "Amazon US",
  });
  const leadPlan = leadTimePlan({
    today: lead.today || today,
    production: lead.production,
    transit: lead.transit,
    checkin: lead.checkin,
    stock: lead.stock,
    velocity: lead.velocity,
  });

  return (
    <HubShell
      emoji="🚀"
      title="Growth & Market AI"
      subtitle="Ürünü altı AI motoruyla puanla, 90 günlük büyüme planına bağla, sepeti büyüt, stok tarihini kaçırma ve rakibin reklam kancasını çöz."
      sections={SECTIONS}
    >
      <ConsensusCard />

      <GrowthPlanCard initialProduct={search.product} />

      <ToolCard
        id="bundle-booster"
        icon={PackagePlus}
        title="AI Bundle & AOV Booster"
        description="Düşük maliyetli tamamlayıcı ürünlerle sepet ortalamasını yükselt."
        runLabel="Bundle Önerileri Getir"
        onRun={() => callTool("bundle-booster", bundle)}
        validate={() =>
          firstValidationError(
            requireText(bundle.product, "Ana ürün", 2),
            requirePositive(bundle.price, "Satış fiyatı"),
          )
        }
      >
        <Field label="Ana ürün">
          <Input
            value={bundle.product}
            onChange={(e) => setBundle({ ...bundle, product: e.target.value })}
            placeholder="Pilates minderi"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Satış fiyatı ($)">
            <Input
              type="number"
              value={bundle.price}
              onChange={(e) => setBundle({ ...bundle, price: e.target.value })}
            />
          </Field>
          <Field label="Kanal">
            <Input
              value={bundle.channel}
              onChange={(e) => setBundle({ ...bundle, channel: e.target.value })}
            />
          </Field>
        </div>
      </ToolCard>

      <ToolCard
        id="lead-time"
        icon={CalendarClock}
        title="Lead-Time Countdown"
        description="Üretim + transit + depo girişini toplayıp tam yeniden sipariş tarihini verir."
        runLabel="AI ile Gecikme Senaryosu Çıkar"
        onRun={() => callTool("lead-time", lead)}
        validate={() =>
          firstValidationError(
            requirePositive(lead.stock, "Eldeki stok"),
            requirePositive(lead.velocity, "Günlük satış"),
          )
        }
      >
        <div className="grid grid-cols-3 gap-3">
          <Field label="Üretim (gün)">
            <Input
              type="number"
              value={lead.production}
              onChange={(e) => setLead({ ...lead, production: e.target.value })}
            />
          </Field>
          <Field label="Transit (gün)">
            <Input
              type="number"
              value={lead.transit}
              onChange={(e) => setLead({ ...lead, transit: e.target.value })}
            />
          </Field>
          <Field label="Depo girişi (gün)">
            <Input
              type="number"
              value={lead.checkin}
              onChange={(e) => setLead({ ...lead, checkin: e.target.value })}
            />
          </Field>
          <Field label="Eldeki stok">
            <Input
              type="number"
              value={lead.stock}
              onChange={(e) => setLead({ ...lead, stock: e.target.value })}
            />
          </Field>
          <Field label="Günlük satış">
            <Input
              type="number"
              value={lead.velocity}
              onChange={(e) => setLead({ ...lead, velocity: e.target.value })}
            />
          </Field>
          <Field label="Bugün">
            <Input
              type="date"
              value={lead.today}
              onChange={(e) => setLead({ ...lead, today: e.target.value })}
            />
          </Field>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-black/20 p-2 text-[10px]">
          <span className="rounded bg-[var(--accent-active)]/15 px-2 py-1 text-[var(--accent-active)]">
            Üretim {lead.production}g
          </span>
          <span className="h-px flex-1 bg-white/10" />
          <span className="rounded bg-[var(--ai)]/15 px-2 py-1 text-[var(--ai)]">
            Transit {lead.transit}g
          </span>
          <span className="h-px flex-1 bg-white/10" />
          <span className="rounded bg-[var(--profit)]/15 px-2 py-1 text-[var(--profit)]">
            Check-in {lead.checkin}g
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
          <div className="rounded-lg border border-[var(--warning)]/25 bg-[var(--warning)]/10 p-2">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
              Yeniden sipariş
            </div>
            <div className="mt-0.5 font-bold text-[var(--warning)]">
              {leadPlan.overdueDays > 0
                ? `${leadPlan.overdueDays} gün gecikmiş`
                : shortDate(leadPlan.reorderDate)}
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-2">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
              Stok tükenme
            </div>
            <div className="mt-0.5 font-bold">{shortDate(leadPlan.stockoutDate)}</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-2">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
              Emniyet stoğu
            </div>
            <div className="mt-0.5 font-bold">{leadPlan.safetyStock} adet</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-2">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
              Sipariş noktası
            </div>
            <div className="mt-0.5 font-bold">{leadPlan.reorderPoint} adet</div>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Toplam tedarik {leadPlan.totalDays} gün · stok {leadPlan.stockoutDays} gün yeter · emniyet
          stoğu tedarik süresi talebinin %20'si. Tarihler {shortDate(lead.today || today)} baz
          alınarak hesaplandı.
        </p>
      </ToolCard>

      <ToolCard
        id="arbitrage-matrix"
        icon={Globe2}
        title="Cross-Border Arbitrage Matrix"
        description="Amazon US, Amazon EU ve TikTok Shop marjlarını yan yana karşılaştırır."
        runLabel="Pazar Matrisini Çıkar"
        onRun={() => callTool("arbitrage-matrix", arb)}
        validate={() =>
          firstValidationError(
            requireText(arb.product, "Ürün", 2),
            requirePositive(arb.cost, "Landed maliyet"),
            requirePositive(arb.price, "Referans fiyat"),
          )
        }
      >
        <Field label="Ürün">
          <Input
            value={arb.product}
            onChange={(e) => setArb({ ...arb, product: e.target.value })}
            placeholder="Paslanmaz termos"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Landed cost ($)">
            <Input
              type="number"
              value={arb.cost}
              onChange={(e) => setArb({ ...arb, cost: e.target.value })}
            />
          </Field>
          <Field label="Referans fiyat ($)">
            <Input
              type="number"
              value={arb.price}
              onChange={(e) => setArb({ ...arb, price: e.target.value })}
            />
          </Field>
        </div>
      </ToolCard>

      <ToolCard
        id="ad-hook-extractor"
        icon={Megaphone}
        title="Competitor Ad Hook Extractor"
        description="Rakip reklam metnindeki psikolojik kancaları ve doymamış açıları ortaya çıkarır."
        runLabel="Kancaları Çöz"
        onRun={() => callTool("ad-hook-extractor", { adCopy: hook })}
        validate={() => requireText(hook, "Rakip reklam metni", 20)}
      >
        <Field label="Rakip reklam metni">
          <Textarea
            rows={7}
            value={hook}
            onChange={(e) => setHook(e.target.value)}
            placeholder="Only 200 left in stock — over 40,000 moms already switched…"
          />
        </Field>
      </ToolCard>

      <ToolCard
        id="competitor-intel"
        icon={Swords}
        title="Rakip İlan İstihbaratı"
        description="Rakibin fiyat/yorum/zayıf noktalarını parçalar ve fiyat–ürün–görsel ekseninde kazanma planı çıkarır."
        runLabel="Rakibi Parçala"
        onRun={() => callTool("competitor-intel", ci)}
        validate={() =>
          firstValidationError(
            requireText(ci.competitor, "Rakip ürün / ilan", 3),
            requireText(ci.evidence, "Rakip kanıtı", 10),
          )
        }
      >
        <Field label="Rakip ürün / ilan (ad, ASIN veya URL)">
          <Input
            value={ci.competitor}
            onChange={(e) => setCi({ ...ci, competitor: e.target.value })}
            placeholder="B0XXXXXXX — 2L cam saklama kabı seti, 4.3★ / 2.180 yorum"
          />
        </Field>
        <Field label="Kanıt: fiyat, BSR, yorum şikâyetleri, kupon metni">
          <Textarea
            rows={5}
            value={ci.evidence}
            onChange={(e) => setCi({ ...ci, evidence: e.target.value })}
            placeholder="$24.99 (30 gün önce $29.99), BSR 4.200, en çok şikâyet: kapak contası sızdırıyor, 6'lı set eksik geliyor…"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kategori">
            <Input
              value={ci.category}
              onChange={(e) => setCi({ ...ci, category: e.target.value })}
              placeholder="Kitchen storage"
            />
          </Field>
          <Field label="Bizim landed maliyetimiz ($)">
            <Input
              type="number"
              value={ci.cost}
              onChange={(e) => setCi({ ...ci, cost: e.target.value })}
              placeholder="6.10"
            />
          </Field>
        </div>
        <Field label="Hedef pazaryeri">
          <Input
            value={ci.channel}
            onChange={(e) => setCi({ ...ci, channel: e.target.value })}
            placeholder="Amazon US"
          />
        </Field>
      </ToolCard>
    </HubShell>
  );
}
