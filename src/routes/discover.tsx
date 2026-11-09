// ============================================================================
// /discover — NİŞ TARAMA ARAYÜZÜ.
//
// Bu modül KAZANAN ÜRÜN SEÇMEZ. Ana sayfadaki Ürün Bulucu'nun aksine, bir
// nişin gerçek kaynaklardaki görünümünü ölçer: kaç aday satırı bulundu, fiyat
// bantları nerede, hangi kategoriler ve kaynaklar baskın? Aynı dört adımlı
// hattı kullanır ama çıktıyı "kazananlar" olarak değil, nişin pazar yapısı
// olarak sunar. Böylece iki ekran aynı işi yapmaz.
//
// DÜRÜSTLÜK: Ölçülmemiş bir alan gösterilmez. Kaynak raporu yoksa özet
// gizlenir; fiyat/puan ölçülmediyse "—" yazar.
// ============================================================================

import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, BarChart3, Layers3, Search, Sparkles, Store, Tag } from "lucide-react";

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
import { DraggableCopilot } from "@/components/draggable-copilot";
import { PageHero } from "@/components/page-hero";
import { withProGate } from "@/components/pro-route-gate";
import { DiscoveryProgress, DiscoveryStats } from "@/features/finder/components/discovery-progress";
import { useProductDiscovery } from "@/features/finder/hooks/use-product-discovery";
import { sourceLabel } from "@/features/finder/utils/source-label";
import { getUiLang } from "@/lib/auto-i18n/lang";
import { TARGET_COUNTRIES } from "@/lib/countries";
import type {
  FilterStats,
  ProductDiscoveryStatus,
  TopProduct,
} from "@/lib/product-discovery.types";
import type { DiscoveryWinner } from "@/lib/product-discovery.functions";

export const Route = createFileRoute("/discover")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Niş Tarama — Aroless" },
      {
        name: "description",
        content:
          "Bir nişin gerçek kaynaklardaki pazar yapısını tara: ölçülen adaylar, fiyat bantları, kategoriler ve kaynak kapsamı. Kazanan ürün seçmez; karar için kanıt üretir.",
      },
    ],
  }),
  component: withProGate(NicheScanPage),
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

function NicheScanPage() {
  const [niche, setNiche] = useState("");
  const [country, setCountry] = useState("US");
  const [platform, setPlatform] = useState<string>("Genel");
  const [topN, setTopN] = useState("5");
  const [category, setCategory] = useState("");
  const [audience, setAudience] = useState("");
  const [budget, setBudget] = useState("");

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
      category: category.trim() || undefined,
      audience: audience.trim() || undefined,
      budget: budget.trim() || undefined,
      lang: getUiLang(),
    });
  };

  const showProgress = d.run.runId !== null && (d.isRunning || d.run.status === "failed");

  return (
    <div className="min-h-screen bg-[#05070d]">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <PageHero
          title="Niş Tarama"
          description="Bir nişin gerçek kaynaklardaki görünümünü tara: kaç aday ölçüldü, fiyatlar hangi bantta, hangi kategoriler ve kaynaklar baskın? Kazanan seçmez; karar için kanıt üretir."
        />

        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-sky-500/25 bg-sky-500/[0.06] px-4 py-3 text-xs text-sky-100/90">
          <Search size={14} className="shrink-0" />
          <span>
            Bu modül nişin pazar yapısını inceler. Kazanan ürünleri görmek için ana sayfadaki Ürün
            Bulucu'yu kullan.
          </span>
          <Link
            to="/"
            className="inline-flex items-center gap-1 font-semibold text-sky-200 underline-offset-2 hover:underline"
          >
            Ürün Bulucu'ya git <ArrowRight size={12} />
          </Link>
        </div>

        {/* ---- Form ---- */}
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="niche">Taranacak niş</Label>
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
                  <Label>Aday sayısı</Label>
                  <Select value={topN} onValueChange={setTopN} disabled={d.isRunning}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["3", "5", "8", "10"].map((n) => (
                        <SelectItem key={n} value={n}>
                          {n} aday
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="scan-category">Kategori (opsiyonel)</Label>
                  <Input
                    id="scan-category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="Ev & Yaşam"
                    maxLength={60}
                    disabled={d.isRunning}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="scan-audience">Hedef kitle (opsiyonel)</Label>
                  <Input
                    id="scan-audience"
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                    placeholder="küçük dairede yaşayanlar"
                    maxLength={120}
                    disabled={d.isRunning}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="scan-budget">Başlangıç bütçesi (opsiyonel)</Label>
                  <Input
                    id="scan-budget"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    placeholder="$500 - $2,000"
                    maxLength={40}
                    disabled={d.isRunning}
                  />
                </div>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Bu bağlam yalnızca AI kısa listesini daraltır. Niş taraması ölçülmemiş veri üretmez;
                kaynak raporu ve fiyat bantları gerçek kaynak satırlarından gelir.
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={!canSubmit}>
                  <Sparkles className="size-4" />
                  {d.isRunning ? "Taranıyor…" : d.isStarting ? "Başlatılıyor…" : "Nişi tara"}
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
          <DiscoveryProgress
            status={d.run.status}
            progress={d.run.progress}
            step={d.run.step}
            stats={d.run.stats}
            runningLabel="Niş taranıyor…"
            doneLabel="Tarama tamamlandı"
            failedLabel="Tarama başarısız"
          />
        )}

        {d.run.error && !d.isRunning && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            {d.run.error}
          </div>
        )}

        {d.run.note && !d.isRunning && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200">
            {d.run.note}
          </div>
        )}

        {/* ---- Sonuç ---- */}
        {d.run.status === "completed" && d.run.products.length === 0 && (
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Bu niş için ölçülebilir pazar verisi bulunamadı. Daha dar bir niş dene (örn. “space
              saving kitchen gadgets” yerine “under sink organizer”).
            </p>
          </div>
        )}

        {d.run.products.length > 0 && !d.isRunning && (
          <NicheScanResults
            products={d.run.products}
            topProducts={d.run.topProducts}
            stats={d.run.stats}
            status={d.run.status}
            step={d.run.step}
          />
        )}
      </div>
      <DraggableCopilot context={`Niş Tarama · niş: ${niche} · ülke: ${country}`} />
    </div>
  );
}

/* --------------------------------------------------------------- Sonuçlar */

const priceFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function formatPrice(value: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? priceFormatter.format(value) : "—";
}

function priceBand(price: number | null): string {
  if (typeof price !== "number" || !Number.isFinite(price)) return "Fiyat ölçülmedi";
  if (price < 25) return "< $25";
  if (price < 50) return "$25–$50";
  if (price < 100) return "$50–$100";
  if (price < 250) return "$100–$250";
  return "$250+";
}

function countBy(values: readonly string[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function NicheScanResults({
  products,
  topProducts,
  stats,
  status,
  step,
}: {
  products: DiscoveryWinner[];
  /** Konseyin son 5 aday gerekçesi — sıralama değil, ölçüm kanıtı olarak. */
  topProducts: TopProduct[];
  stats: FilterStats | null;
  status: ProductDiscoveryStatus;
  step: string | null;
}): React.JSX.Element {
  const reasonByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const topProduct of topProducts) {
      if (topProduct.id) map.set(topProduct.id.trim().toLowerCase(), topProduct.selection_reason);
      if (topProduct.title)
        map.set(topProduct.title.trim().toLowerCase(), topProduct.selection_reason);
    }
    return map;
  }, [topProducts]);

  const reasonFor = (product: DiscoveryWinner): string | undefined => {
    const fingerprint = product.fingerprint.trim().toLowerCase();
    if (fingerprint) {
      const hit = reasonByKey.get(fingerprint);
      if (hit) return hit;
    }
    return reasonByKey.get(product.name.trim().toLowerCase());
  };

  const report = useMemo(() => {
    const prices = products
      .map((product) => product.priceUsd)
      .filter((price): price is number => typeof price === "number" && Number.isFinite(price));
    const ratings = products
      .map((product) => product.rating)
      .filter((rating): rating is number => typeof rating === "number" && Number.isFinite(rating));
    const sources = new Set(
      products.flatMap((product) => product.sources.map((source) => source.trim())).filter(Boolean),
    );
    const categories = countBy(
      products.map((product) => product.category.trim() || "Kategori ölçülmedi"),
    );
    const bands = countBy(products.map((product) => priceBand(product.priceUsd)));
    const averageRating =
      ratings.length > 0 ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length : null;

    return {
      minPrice: prices.length > 0 ? Math.min(...prices) : null,
      maxPrice: prices.length > 0 ? Math.max(...prices) : null,
      averageRating,
      sources: [...sources],
      categories,
      bands,
    };
  }, [products]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <BarChart3 className="size-4 text-[var(--accent-active)]" />
            Niş tarama raporu
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {products.length} ölçülmüş aday · {report.sources.length} bağımsız kaynak ·{" "}
            {report.categories.length} kategori
          </p>
        </div>
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 bg-white/5 px-3 py-2 text-xs font-semibold transition hover:bg-white/10"
        >
          Kazanan ürünleri ana sayfada bul <ArrowRight size={13} />
        </Link>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-xs leading-relaxed text-muted-foreground">
        Bu ekran bir kazanan listesi değildir. Aşağıdaki adaylar nişte ölçülen ürünleri ve kaynak
        kanıtını gösterir; yatırım kararını tek başına vermez.
      </div>

      {stats && <DiscoveryStats stats={stats} status={status} step={step} />}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "Ölçülen aday", value: String(products.length), icon: Layers3 },
          {
            label: "Fiyat aralığı",
            value:
              report.minPrice !== null && report.maxPrice !== null
                ? `${formatPrice(report.minPrice)} – ${formatPrice(report.maxPrice)}`
                : "—",
            icon: Tag,
          },
          {
            label: "Ortalama puan",
            value: report.averageRating !== null ? `${report.averageRating.toFixed(1)} / 5` : "—",
            icon: Store,
          },
          {
            label: "Bağımsız kaynak",
            value: String(report.sources.length),
            icon: Search,
          },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              <Icon size={12} /> {label}
            </div>
            <div className="mt-1 text-sm font-semibold text-foreground">{value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-card p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Tag size={14} className="text-[var(--accent-active)]" /> Kategori dağılımı
          </h3>
          <div className="mt-3 space-y-2">
            {report.categories.slice(0, 8).map(([category, count]) => (
              <div key={category} className="flex items-center gap-2 text-xs">
                <span className="w-28 truncate text-muted-foreground" title={category}>
                  {category}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
                  <div
                    className="h-full rounded-full bg-[var(--accent-active)]/70"
                    style={{ width: `${Math.max(4, (count / products.length) * 100)}%` }}
                  />
                </div>
                <span className="w-6 text-right font-mono text-white/70">{count}</span>
              </div>
            ))}
            {!report.categories.length && (
              <p className="text-xs text-muted-foreground">Kategori ölçülmedi.</p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-card p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <BarChart3 size={14} className="text-[var(--accent-active)]" /> Fiyat bantları
          </h3>
          <div className="mt-3 space-y-2">
            {report.bands.map(([band, count]) => (
              <div key={band} className="flex items-center gap-2 text-xs">
                <span className="w-28 truncate text-muted-foreground">{band}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
                  <div
                    className="h-full rounded-full bg-emerald-400/70"
                    style={{ width: `${Math.max(4, (count / products.length) * 100)}%` }}
                  />
                </div>
                <span className="w-6 text-right font-mono text-white/70">{count}</span>
              </div>
            ))}
            {!report.bands.length && (
              <p className="text-xs text-muted-foreground">Fiyat ölçülmedi.</p>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Layers3 size={14} className="text-[var(--accent-active)]" /> Ölçülmüş adaylar
        </h3>
        {products.map((product, index) => {
          const demand =
            product.salesVolume !== null && product.salesVolume !== undefined
              ? `${product.salesVolume} satış`
              : product.viewed90d !== null && product.viewed90d !== undefined
                ? `${product.viewed90d} görüntülenme`
                : "Talep ölçülmedi";
          return (
            <article
              key={product.fingerprint || product.name || index}
              className="rounded-xl border border-white/10 bg-card p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                      #{index + 1}
                    </span>
                    <h4 className="truncate text-sm font-semibold">
                      {product.name || "İsimsiz ürün"}
                    </h4>
                  </div>
                  <p className="mt-1 truncate text-[11px] text-muted-foreground">
                    {[product.brand, product.seller, product.category]
                      .filter(Boolean)
                      .join(" · ") || "Marka / satıcı / kategori ölçülmedi"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-lg font-bold tabular-nums text-foreground">
                    {product.councilScore}
                  </div>
                  <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
                    aday puanı
                  </div>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-lg border border-white/8 bg-white/[0.02] p-2">
                  <div className="text-[10px] text-muted-foreground">Fiyat</div>
                  <div className="mt-0.5 font-mono text-xs">{formatPrice(product.priceUsd)}</div>
                </div>
                <div className="rounded-lg border border-white/8 bg-white/[0.02] p-2">
                  <div className="text-[10px] text-muted-foreground">Puan</div>
                  <div className="mt-0.5 font-mono text-xs">
                    {product.rating !== null ? `${product.rating.toFixed(1)} / 5` : "—"}
                  </div>
                </div>
                <div className="rounded-lg border border-white/8 bg-white/[0.02] p-2">
                  <div className="text-[10px] text-muted-foreground">Talep</div>
                  <div className="mt-0.5 truncate font-mono text-xs" title={demand}>
                    {demand}
                  </div>
                </div>
                <div className="rounded-lg border border-white/8 bg-white/[0.02] p-2">
                  <div className="text-[10px] text-muted-foreground">Kaynak</div>
                  <div className="mt-0.5 truncate font-mono text-xs">
                    {product.sources.length > 0
                      ? product.sources.map(sourceLabel).join(", ")
                      : "Ölçülmedi"}
                  </div>
                </div>
              </div>

              {reasonFor(product) && (
                <p className="mt-2 rounded-lg border border-white/8 bg-white/[0.02] p-2 text-[11px] leading-relaxed text-muted-foreground">
                  <span className="font-semibold text-foreground/80">Konsey gerekçesi:</span>{" "}
                  {reasonFor(product)}
                </p>
              )}

              {product.url && (
                <a
                  href={product.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--accent-active)] hover:underline"
                >
                  Kaynağa git ↗
                </a>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
