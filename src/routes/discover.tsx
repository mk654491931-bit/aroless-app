// ============================================================================
// /discover — PRODUCT DISCOVERY ARAYÜZÜ.
//
// Bu sayfa 1. hatta ("Kazananları Bul") BAKILMAZ. İkisi farklı sözleşmeye
// sahip iki ayrı hattır ve bu sayfa yalnız 2. hatta aittir:
//
//   1. hat → `generateProducts` server fn, tek koşuda ~2-4 dk, AI ağırlıklı.
//   2. hat → QStash adım zinciri, 4 adım × ~10 sn; ilk adım TAMAMEN saf kod
//           (0 token), sonuç `searches.result`'a yazılır.
//
// Kullanıcıya gösterilen söz DEĞİŞMEZ: "kazanan ürün". Değişen şey nasıl
// bulunduğu — ve bu sayfada bunu adım adım, ölçülebilir rakamlarla gösteriyoruz.
//
// DÜRÜSTLÜK: Sonuç boşsa "bulunamadı" denir. Sahte bir "6 ürün bulundu"
// yerine boş liste + gerekçe göstermek, bu hattın tüm varlık sebebidir.
// ============================================================================

import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Sparkles, Trophy, Radar, Users, ShieldCheck, Database, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { withProGate } from "@/components/pro-route-gate";
import { DiscoveryProgress } from "@/features/finder/components/discovery-progress";
import { DiscoveryWinnerCard } from "@/features/finder/components/discovery-winner-card";
import { useProductDiscovery } from "@/features/finder/hooks/use-product-discovery";
import { TARGET_COUNTRIES } from "@/lib/countries";
import type { Consensus, TopProduct } from "@/lib/product-discovery.types";
import type { DiscoveryWinner } from "@/lib/product-discovery.functions";

export const Route = createFileRoute("/discover")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Kanıtlı Kazanan Ürün Keşfi — Aroless" },
      {
        name: "description",
        content:
          "Nişini gerçek kaynaklardan tara, sert filtrele, 14 ajanla puanla. Her adımda kanıtı ve gerekçesi görünür.",
      },
    ],
  }),
  component: withProGate(DiscoverPage),
});

const PLATFORM_OPTIONS = [
  "Genel",
  "Amazon",
  "eBay",
  "TikTok Shop",
  "Etsy",
  "Shopify",
  "Trendyol",
  "WooCommerce",
] as const;

/** Niş örnekleri — boş formda kalmasın, ne beklenir görünsün. */
const NICHE_EXAMPLES = [
  "space saving kitchen gadgets",
  "remote work accessories",
  "beginner home fitness equipment",
  "sustainable travel gear",
  "small apartment pet products",
] as const;

function DiscoverPage() {
  const [niche, setNiche] = useState("");
  const [country, setCountry] = useState("US");
  const [platform, setPlatform] = useState<string>("Genel");
  const [topN, setTopN] = useState("5");

  const d = useProductDiscovery();
  const canSubmit = niche.trim().length >= 2 && !d.isStarting && !d.isRunning;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    await d.start({
      niche: niche.trim(),
      country,
      platform,
      topN: Number(topN),
    });
  };

  const showProgress = d.run.runId !== null && (d.isRunning || d.run.status === "failed");
  const isTR = country === "TR";

  return (
    <div className="min-h-screen bg-[#05070d] text-foreground">
      {/* ---- Premium siyah hero ---- */}
      <div className="relative overflow-hidden border-b border-white/10">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_320px_at_50%_-40px,rgba(255,255,255,0.09),transparent_70%),radial-gradient(700px_280px_at_85%_0px,rgba(96,165,250,0.12),transparent_65%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(70%_80%_at_50%_0%,black,transparent)]"
        />
        <div className="relative mx-auto max-w-5xl px-4 pb-8 pt-10 md:pt-14">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-300">
              <Radar className="size-3.5 text-white" /> Product Finder · Pro
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-[11px] font-medium text-emerald-300">
              <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" /> Canlı kaynak taraması
            </span>
          </div>
          <h1 className="mt-4 max-w-3xl text-3xl font-black leading-[1.05] tracking-tight text-white md:text-5xl">
            Kazanan ürünü <span className="bg-gradient-to-r from-white via-zinc-200 to-zinc-500 bg-clip-text text-transparent">kanıta dayanarak</span> bul.
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400 md:text-base">
            Nişini 5 gerçek kaynaktan tara, sert filtrelerden geçir, 14 ajanla puanla.
            Ölçülmeyen sayı yazılmaz — bulamadığımız yerde “bulunamadı” deriz.
          </p>
          <div className="mt-5 grid max-w-2xl grid-cols-3 gap-2">
            {[
              { icon: Database, top: "5 kaynak", sub: "ölçülmüş veri" },
              { icon: Users, top: "14 ajan", sub: "konsey oyu" },
              { icon: ShieldCheck, top: "%100 dürüst", sub: "0 uydurma" },
            ].map((s) => (
              <div key={s.top} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-center backdrop-blur">
                <s.icon className="mx-auto size-4 text-zinc-300" />
                <div className="mt-1 text-xs font-bold text-white md:text-sm">{s.top}</div>
                <div className="text-[10px] text-zinc-500 md:text-[11px]">{s.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 md:py-8">
      {isTR && (
        <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.07] px-4 py-2.5 text-xs leading-relaxed text-amber-200/90">
          TR pazarı notu: bu sonuçlar global kaynaklardan ölçülür, TR pazaryeri verisi sınırlı olabilir. Trendyol/Hepsiburada fiyatını karttaki “Kaynağa git”ten doğrulamadan stok girmeyin.
        </div>
      )}
      {/* ---- Form : siyah premium panel ---- */}
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] shadow-[0_24px_80px_-32px_rgba(0,0,0,0.9)] backdrop-blur">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">
            <Search className="size-3.5 text-white" /> Arama konsolu
          </span>
          <span className="text-[11px] text-zinc-500">~2 dk · kredi iade garantili</span>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 p-5 md:p-6">
            <div className="space-y-2">
              <Label htmlFor="niche" className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">Niş</Label>
              <Input
                id="niche"
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                placeholder="örn. space saving kitchen gadgets"
                maxLength={120}
                disabled={d.isRunning}
                className="h-12 border-white/10 bg-black/60 text-[15px] text-white placeholder:text-zinc-600 focus-visible:border-white/40 focus-visible:ring-white/20"
              />
              <div className="flex flex-wrap gap-1.5 pt-1">
                {NICHE_EXAMPLES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setNiche(s)}
                    disabled={d.isRunning}
                    className={`rounded-full border px-3 py-1 text-[11px] transition-all disabled:opacity-50 ${niche === s ? "border-white/60 bg-white/10 text-white" : "border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/30 hover:text-white"}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2 rounded-xl border border-white/10 bg-black/40 p-3">
                <Label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Ülke</Label>
                <Select value={country} onValueChange={setCountry} disabled={d.isRunning}>
                  <SelectTrigger className="border-white/10 bg-white/[0.04] text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-white/10 bg-[#0a0d16] text-zinc-200">
                    {TARGET_COUNTRIES.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.flag} {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 rounded-xl border border-white/10 bg-black/40 p-3">
                <Label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Platform</Label>
                <Select value={platform} onValueChange={setPlatform} disabled={d.isRunning}>
                  <SelectTrigger className="border-white/10 bg-white/[0.04] text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-white/10 bg-[#0a0d16] text-zinc-200">
                    {PLATFORM_OPTIONS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 rounded-xl border border-white/10 bg-black/40 p-3">
                <Label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Sonuç sayısı</Label>
                <Select value={topN} onValueChange={setTopN} disabled={d.isRunning}>
                  <SelectTrigger className="border-white/10 bg-white/[0.04] text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-white/10 bg-[#0a0d16] text-zinc-200">
                    {["3", "5", "8", "10"].map((n) => (
                      <SelectItem key={n} value={n}>
                        {n} ürün
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button type="submit" disabled={!canSubmit} className="h-11 flex-1 bg-white text-sm font-bold text-black shadow-[0_8px_30px_-8px_rgba(255,255,255,0.4)] hover:bg-zinc-200 disabled:opacity-40 sm:flex-none sm:px-10">
                <Sparkles className="size-4" />
                {d.isRunning ? "Aranıyor…" : d.isStarting ? "Başlatılıyor…" : "Kazananları bul"}
              </Button>
              {(d.run.products.length > 0 || d.run.error) && !d.isRunning && (
                <Button type="button" variant="ghost" size="sm" onClick={d.reset} className="text-zinc-400 hover:text-white">
                  Temizle
                </Button>
              )}
              <p className="text-[11px] text-zinc-600 sm:ml-auto">Başarısız aramada kredi otomatik iade edilir.</p>
            </div>
          </form>
      </div>

      {/* ---- İlerleme ---- */}
      {showProgress && (
        <DiscoveryProgress status={d.run.status} progress={d.run.progress} step={d.run.step} />
      )}

      {d.run.error && !d.isRunning && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/[0.07] p-4 text-sm text-red-300">
          {d.run.error}
        </div>
      )}

      {/* ---- Sonuç ---- */}
      {d.run.status === "completed" && d.run.products.length === 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
          <p className="text-sm text-zinc-400">
            Bu niş için ölçülebilir kanıt bulunamadı. Daha dar bir niş dene (örn. “space saving
            kitchen gadgets” yerine “under sink organizer”).
          </p>
        </div>
      )}

      {d.run.products.length > 0 && !d.isRunning && (
        <DiscoveryResults
          products={d.run.products}
          consensus={d.run.consensus}
          topProducts={d.run.topProducts}
        />
      )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Sonuçlar */

function DiscoveryResults({
  products,
  consensus,
  topProducts,
}: {
  products: DiscoveryWinner[];
  consensus: Consensus[];
  /** `top_products` sözleşmesi — gerekçe metni buradan gelir. */
  topProducts: TopProduct[];
}): React.JSX.Element {
  // Uzlaşma tablosu parmak izine göre eşlenir; kart yalnızca kazanana bakar
  // ama "güven skoru neden bu?" sorusunu yanıtlamak için konsensüs gerekir.
  const consensusById = useMemo(
    () => new Map(consensus.map((c) => [c.candidateId, c] as const)),
    [consensus],
  );
  const withConsensus = useMemo(() => consensusById.size > 0, [consensusById]);

  // `top_products` sözleşmesini kartlara bağlar. Sunucu `id` alanına önce
  // ürün kimliğini, sonra parmak izini yazar; kartın elimizdeki en güvenilir
  // eşleme anahtarı da `fingerprint`. Başlık eşlemesi yalnız BİR YEDEK yoldur.
  const reasonByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of topProducts) {
      if (t.id) map.set(t.id.trim().toLowerCase(), t.selection_reason);
      if (t.title) map.set(t.title.trim().toLowerCase(), t.selection_reason);
    }
    return map;
  }, [topProducts]);

  const reasonFor = (w: DiscoveryWinner): string | undefined => {
    const fingerprint = w.fingerprint.trim().toLowerCase();
    if (fingerprint) {
      const hit = reasonByKey.get(fingerprint);
      if (hit) return hit;
    }
    return reasonByKey.get(w.name.trim().toLowerCase());
  };

  const avgConfidence = products.length
    ? Math.round(products.reduce((a, w) => a + w.confidenceScore, 0) / products.length)
    : 0;
  const uniqueSources = new Set(products.flatMap((w) => w.sources)).size;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-gradient-to-r from-white/[0.05] to-transparent px-4 py-3">
        <h2 className="flex items-center gap-2.5 text-base font-bold text-white md:text-lg">
          <span className="inline-flex size-8 items-center justify-center rounded-full bg-white text-black">
            <Trophy className="size-4" />
          </span>
          {products.length} kazanan ürün
          <span className="text-xs font-medium text-zinc-500">
            puan + güven ayrı yazılır · ort. güven {avgConfidence} · {uniqueSources} farklı kaynak
          </span>
        </h2>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/50 px-3 py-1 text-[11px] text-zinc-300">
          {withConsensus
            ? "14 ajan · ölçülmüş kanıt üzerinde oyladı"
            : "Kazananlar ölçülmüş veriyle sıralandı"}
        </span>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_280px]">
        <div className="space-y-4">
          {products.map((w, i) => (
            <DiscoveryWinnerCard
              key={w.fingerprint || w.name || i}
              winner={w}
              rank={i + 1}
              reason={reasonFor(w)}
            />
          ))}
        </div>
        <aside className="space-y-4 lg:sticky lg:top-4">
          <div className="space-y-3 rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-4 text-xs leading-relaxed text-zinc-400">
            <p className="text-sm font-bold text-white">Nasıl sıralandı?</p>
            <ol className="space-y-2">
              {["5 kaynaktan ölçüm", "Sert filtre (puan·stok·fiyat)", "14 ajan konsey oyu", "Puan + güven ile final"].map((t, i) => (
                <li key={t} className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5">
                  <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-white text-[10px] font-black text-black">{i + 1}</span>
                  <span className="text-[11px] text-zinc-300">{t}</span>
                </li>
              ))}
            </ol>
            <p>
              Her ürün gerçek kaynaklardan ölçüldü, sert filtrelerden geçti ve 14 ajanın oyuyla
              değerlendirildi. Konsey puanı ile <em className="text-zinc-200">güven skoru</em> ayrıdır: yüksek puan az kanıtla
              da gelebilir, güven skoru o puanın ne kadar savunulabilir olduğunu söyler.
            </p>
            {withConsensus && (
              <p>
                14 ajanın oy uyumu{" "}
                {Math.round(
                  (consensus.reduce((a, c) => a + c.disagreement, 0) /
                    Math.max(1, consensus.length)) *
                    -1 +
                    100,
                )}
                /100 (yüksek = birlikte karar).
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
