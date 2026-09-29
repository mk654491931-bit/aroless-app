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
import { Sparkles, Trophy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHero } from "@/components/page-hero";
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

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <PageHero
        title="Kanıtlı Kazanan Ürün Keşfi"
        description="Nişini 5 gerçek kaynaktan tara, sert filtrele, 14 ajanla puanla. Her adımda ne ölçüldüğünü gör."
      />

      {/* ---- Form ---- */}
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="niche">Niş</Label>
              <Input
                id="niche"
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                placeholder="örn. space saving kitchen gadgets"
                maxLength={120}
                disabled={d.isRunning}
              />
              <div className="flex flex-wrap gap-1.5 pt-1">
                {NICHE_EXAMPLES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setNiche(s)}
                    disabled={d.isRunning}
                    className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Ülke</Label>
                <Select value={country} onValueChange={setCountry} disabled={d.isRunning}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TARGET_COUNTRIES.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.flag} {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Platform</Label>
                <Select value={platform} onValueChange={setPlatform} disabled={d.isRunning}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLATFORM_OPTIONS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Sonuç sayısı</Label>
                <Select value={topN} onValueChange={setTopN} disabled={d.isRunning}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["3", "5", "8", "10"].map((n) => (
                      <SelectItem key={n} value={n}>
                        {n} ürün
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={!canSubmit}>
                <Sparkles className="size-4" />
                {d.isRunning ? "Aranıyor…" : d.isStarting ? "Başlatılıyor…" : "Kazananları bul"}
              </Button>
              {(d.run.products.length > 0 || d.run.error) && !d.isRunning && (
                <Button type="button" variant="ghost" size="sm" onClick={d.reset}>
                  Temizle
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {/* ---- İlerleme ---- */}
      {showProgress && (
        <DiscoveryProgress status={d.run.status} progress={d.run.progress} step={d.run.step} />
      )}

      {d.run.error && !d.isRunning && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {d.run.error}
        </div>
      )}

      {/* ---- Sonuç ---- */}
      {d.run.status === "completed" && d.run.products.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Trophy className="size-4 text-amber-500" />
          {products.length} kazanan ürün
        </h2>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground">
          {withConsensus
            ? "14 ajan · ölçülmüş kanıt üzerinde oyladı"
            : "Kazananlar ölçülmüş veriyle sıralandı"}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
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
        <aside className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground space-y-2">
            <p className="text-sm font-medium text-foreground">Nasıl sıralandı?</p>
            <p>
              Her ürün gerçek kaynaklardan ölçüldü, sert filtrelerden geçti ve 14 ajanın oyuyla
              değerlendirildi. Konsey puanı ile <em>güven skoru</em> ayrıdır: yüksek puan az kanıtla
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
