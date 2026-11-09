import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  AlertTriangle,
  Atom,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Database,
  ExternalLink,
  Filter,
  History,
  Loader2,
  PackageSearch,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Table2,
  TrendingUp,
  X,
} from "lucide-react";

import { PageHero } from "@/components/page-hero";
import { usePlanUsage } from "@/hooks/use-plan-usage";
import { withProGate } from "@/components/pro-route-gate";
import { Badge } from "@/components/ui/badge";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  H10_COUNTRIES,
  H10_DEFAULT_COUNTRY,
  H10_DEFAULT_FILTERS,
  H10_DEFAULT_PLATFORM,
  H10_PLATFORMS,
  filterH10Products,
  formatH10Count,
  formatH10Minor,
  formatH10Rating,
  formatH10Usd,
  h10AgeLabel,
  h10Monogram,
  h10StatusLabel,
  h10StatusTone,
  isH10ProductDetail,
  isH10SearchFailure,
  isH10SearchSuccess,
  type H10Filters,
  type H10Observation,
  type H10Offer,
  type H10Product,
  type H10SearchResult,
  type H10Sort,
  type H10SourceHealth,
} from "@/lib/hydrogen10";
import {
  getHydrogen10Product,
  searchHydrogen10,
  refreshHydrogen10,
} from "@/lib/hydrogen10.functions";
import { usageLabelFor } from "@/lib/plan-usage";
import { cn } from "@/lib/utils";

type H10SearchParams = {
  q: string;
  country: string;
  platform: string;
};

const EXAMPLE_QUERIES = [
  "air fryer",
  "led masa lambası",
  "robot vacuum",
  "cat scratching board",
  "espresso machine",
] as const;

export const Route = createFileRoute("/hidrojen10")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): H10SearchParams => {
    const country = String(search["country"] ?? H10_DEFAULT_COUNTRY).toUpperCase();
    const platform = String(search["platform"] ?? H10_DEFAULT_PLATFORM)
      .toLowerCase()
      .replace(/\s+/g, "_");
    return {
      q: String(search["q"] ?? "").slice(0, 160),
      country: H10_COUNTRIES.some((item) => item.code === country) ? country : H10_DEFAULT_COUNTRY,
      platform: H10_PLATFORMS.some((item) => item.id === platform)
        ? platform
        : H10_DEFAULT_PLATFORM,
    };
  },
  head: () => ({
    meta: [
      { title: "Hidrojen10 — Global Ürün İstihbaratı | Aroless" },
      {
        name: "description",
        content:
          "DB-first global ürün istihbaratı: kaynak kanıtı, fiyat/stok geçmişi ve kaynak sağlığı. Aynı niş 24 saat cache'ten döner.",
      },
      { property: "og:title", content: "Hidrojen10 — Global Ürün İstihbaratı" },
      {
        property: "og:description",
        content: "Global pazar laboratuvarı, ürün geçmişi ve kaynak sağlığı.",
      },
    ],
  }),
  component: withProGate(Hydrogen10Page),
});

function ProductThumb({ product, size = "md" }: { product: H10Product; size?: "md" | "lg" }) {
  const [failed, setFailed] = useState(false);
  const dimensions = size === "lg" ? "h-20 w-20 text-lg" : "h-11 w-11 text-[11px]";
  if (!product.imageUrl || failed) {
    return (
      <div
        className={cn(
          "flex shrink-0 items-center justify-center rounded-lg border border-white/10 bg-gradient-to-br from-white/10 to-white/[0.02] font-black tracking-wide text-white/60",
          dimensions,
        )}
      >
        {h10Monogram(product.title) || <PackageSearch size={16} />}
      </div>
    );
  }
  return (
    <img
      src={product.imageUrl}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("shrink-0 rounded-lg border border-white/10 object-cover", dimensions)}
    />
  );
}

function StockBadge({ value }: { value: boolean | null }) {
  if (value === true) {
    return (
      <Badge
        variant="outline"
        className="border-[var(--profit)]/35 bg-[var(--profit)]/10 text-[var(--profit)]"
      >
        Var
      </Badge>
    );
  }
  if (value === false) {
    return (
      <Badge variant="outline" className="border-red-400/35 bg-red-400/10 text-red-300">
        Yok
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-white/15 bg-white/5 text-muted-foreground">
      Bilinmiyor
    </Badge>
  );
}

function priceLine(product: H10Product): { primary: string; secondary: string | null } {
  if (product.bestPriceLocalMinor !== null) {
    return {
      primary: formatH10Minor(product.bestPriceLocalMinor, product.bestPriceCurrency),
      secondary: product.bestPriceUsd !== null ? `≈ ${formatH10Usd(product.bestPriceUsd)}` : null,
    };
  }
  if (product.bestPriceUsd !== null) {
    return {
      primary: formatH10Usd(product.bestPriceUsd),
      secondary: null,
    };
  }
  return { primary: "—", secondary: null };
}

function CacheLine({ data }: { data: Extract<H10SearchResult, { ok: true }> }) {
  const healthy = data.sourceHealth.filter((source) => source.status === "ok").length;
  const failed = data.sourceHealth.filter((source) => source.status === "failed").length;
  const notConfigured = data.sourceHealth.filter(
    (source) => source.status === "not_configured",
  ).length;
  const tone =
    data.status === "failed"
      ? "text-red-300"
      : data.stale
        ? "text-[var(--warning)]"
        : "text-[var(--profit)]";
  const dot =
    data.status === "failed"
      ? "bg-red-300"
      : data.stale
        ? "bg-[var(--warning)]"
        : "bg-[var(--profit)]";
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
      <span className={cn("inline-flex items-center gap-1.5", tone)}>
        <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
        {data.dataSource === "db" ? "Veritabanı" : "Canlı ilk tarama"} ·{" "}
        {h10AgeLabel(data.lastScrapedAt)}
      </span>
      <span className="text-white/20">/</span>
      <span className="inline-flex items-center gap-1">
        <Clock3 size={11} /> 24 saat cache
      </span>
      <span className="text-white/20">/</span>
      <span>
        {healthy}/{data.sourceHealth.length} kaynak çalıştı
        {failed > 0 ? ` · ${failed} hata` : ""}
        {notConfigured > 0 ? ` · ${notConfigured} anahtarsız` : ""}
      </span>
      {data.refreshing && (
        <span className="inline-flex items-center gap-1 text-[var(--warning)]">
          <Loader2 size={11} className="animate-spin" /> yenileniyor
        </span>
      )}
      {data.stale && !data.refreshing && (
        <span className="text-[var(--warning)]">bayat · yenileme bekliyor</span>
      )}
    </div>
  );
}

function MigrationNotice({ result }: { result: Extract<H10SearchResult, { ok: false }> }) {
  const schemaMissing = result.code === "schema_missing";
  const planLimit = result.code === "plan_limit";
  return (
    <div
      className={cn(
        "premium-card border p-5",
        schemaMissing || planLimit
          ? "border-[var(--warning)]/35 bg-[var(--warning)]/[0.06]"
          : "border-red-400/30 bg-red-400/[0.05]",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
            schemaMissing || planLimit
              ? "border-[var(--warning)]/30 bg-[var(--warning)]/10 text-[var(--warning)]"
              : "border-red-400/30 bg-red-400/10 text-red-300",
          )}
        >
          {schemaMissing ? <Database size={17} /> : <AlertTriangle size={17} />}
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-bold">
            {schemaMissing
              ? "Veritabanı migration'ı bekleniyor"
              : planLimit
                ? "Hidrojen10 hakkın doldu"
                : "İstek tamamlanamadı"}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{result.message}</p>
          {planLimit && (
            <Link
              to="/pricing"
              className="mt-3 inline-flex items-center gap-1 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-3 py-1.5 text-[11px] font-semibold text-[var(--warning)] hover:bg-[var(--warning)]/15"
            >
              Paketleri gör <ChevronRight size={12} />
            </Link>
          )}
          {schemaMissing && (
            <div className="mt-3 space-y-2 text-[11px] leading-relaxed text-muted-foreground">
              <p>
                <code className="rounded bg-black/25 px-1 py-0.5 text-white/80">
                  docs/hydrogen10/MIGRATION.sql
                </code>{" "}
                dosyasını Supabase SQL editörüne kopyalayıp çalıştırın. Kod migration'ı kendisi
                uygulamaz.
              </p>
              <p>
                Tablolar hazır olunca bu sayfayı yenileyin; ilk arama kaynakları tarar, sonraki
                aramalar 24 saat DB cache'inden döner.
              </p>
            </div>
          )}
          {result.details && (
            <details className="mt-3 text-[10px] text-muted-foreground/70">
              <summary className="cursor-pointer">Teknik detay</summary>
              <pre className="mt-1 whitespace-pre-wrap break-words">{result.details}</pre>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

function ProductTable({
  products,
  onSelect,
}: {
  products: H10Product[];
  onSelect: (product: H10Product) => void;
}) {
  if (!products.length) {
    return (
      <div className="rounded-xl border border-dashed border-white/12 bg-white/[0.02] p-8 text-center">
        <PackageSearch size={24} className="mx-auto text-muted-foreground/60" />
        <p className="mt-2 text-sm font-semibold">Bu filtrelerde sonuç yok</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Filtreleri temizleyin; nişin kendisinde ürün varsa yeniden görünür.
        </p>
      </div>
    );
  }
  return (
    <>
      <div className="hidden overflow-hidden rounded-xl border border-white/10 md:block">
        <Table>
          <TableHeader>
            <TableRow className="border-white/10 hover:bg-transparent">
              <TableHead className="w-[34%] text-[10px] uppercase tracking-wider">Ürün</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Fiyat</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Puan</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Stok</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Kaynak</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Tazelik</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((product) => {
              const price = priceLine(product);
              return (
                <TableRow
                  key={product.id}
                  className="cursor-pointer border-white/8 align-top hover:bg-white/[0.035]"
                  onClick={() => onSelect(product)}
                >
                  <TableCell className="py-3">
                    <div className="flex items-start gap-3">
                      <ProductThumb product={product} />
                      <div className="min-w-0">
                        <p className="line-clamp-2 text-xs font-bold leading-snug">
                          {product.title}
                        </p>
                        <p className="mt-1 line-clamp-1 text-[10px] text-muted-foreground">
                          {[product.brand, product.category].filter(Boolean).join(" · ") ||
                            "Marka/kategori ölçülmedi"}
                        </p>
                        <p className="mt-1 text-[9px] text-muted-foreground/60">
                          {product.gtin ? `GTIN ${product.gtin}` : product.identityKey.slice(0, 28)}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="py-3">
                    <p className="font-mono text-xs font-bold">{price.primary}</p>
                    {price.secondary && (
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{price.secondary}</p>
                    )}
                    {product.bestPriceLocalMinor === null && product.bestPriceUsd !== null && (
                      <p className="mt-0.5 text-[9px] text-muted-foreground/60">USD normalize</p>
                    )}
                  </TableCell>
                  <TableCell className="py-3">
                    <p className="flex items-center gap-1 text-xs font-semibold">
                      <Star size={11} className="fill-amber-300 text-amber-300" />
                      {formatH10Rating(product.bestRating)}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {formatH10Count(product.bestRatingCount)} yorum
                    </p>
                  </TableCell>
                  <TableCell className="py-3">
                    <StockBadge value={product.inStock} />
                  </TableCell>
                  <TableCell className="py-3">
                    <div className="flex max-w-[190px] flex-wrap gap-1">
                      {product.offers.slice(0, 3).map((offer) => (
                        <a
                          key={offer.id}
                          href={offer.sourceUrl || undefined}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                          className="inline-flex max-w-full items-center gap-1 truncate rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[9px] text-muted-foreground hover:border-[var(--accent-active)]/30 hover:text-white"
                        >
                          {offer.source}
                          {offer.sourceUrl ? <ExternalLink size={8} /> : null}
                        </a>
                      ))}
                      {product.offers.length > 3 && (
                        <span className="text-[9px] text-muted-foreground">
                          +{product.offers.length - 3}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="py-3">
                    <p className="text-[10px] text-muted-foreground">
                      {h10AgeLabel(product.lastSeenAt)}
                    </p>
                    <p className="mt-0.5 text-[9px] text-[var(--profit)]">Ölçüldü</p>
                  </TableCell>
                  <TableCell className="py-3">
                    <ChevronRight size={13} className="text-muted-foreground" />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-2 md:hidden">
        {products.map((product) => {
          const price = priceLine(product);
          return (
            <button
              key={product.id}
              type="button"
              onClick={() => onSelect(product)}
              className="premium-card flex w-full items-start gap-3 p-3 text-left"
            >
              <ProductThumb product={product} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="line-clamp-2 text-xs font-bold leading-snug">{product.title}</p>
                  <ChevronRight size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {[product.brand, product.category].filter(Boolean).join(" · ") || "Veri sınırlı"}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-bold">{price.primary}</span>
                  <span className="text-[10px] text-muted-foreground">
                    ★ {formatH10Rating(product.bestRating)}
                  </span>
                  <StockBadge value={product.inStock} />
                  <span className="text-[10px] text-muted-foreground">
                    {product.sourceCount} kaynak
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

function FiltersBar({
  filters,
  onChange,
  sources,
  onClear,
}: {
  filters: H10Filters;
  onChange: (next: H10Filters) => void;
  sources: H10SourceHealth[];
  onClear: () => void;
}) {
  return (
    <div className="premium-card p-3">
      <div className="flex flex-wrap items-end gap-2.5">
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          <Filter size={12} /> Filtre
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:grid-cols-4">
          <div>
            <Label className="text-[9px] uppercase tracking-wider text-muted-foreground">
              Min $
            </Label>
            <Input
              value={filters.minPriceUsd ?? ""}
              onChange={(event) =>
                onChange({
                  ...filters,
                  minPriceUsd: event.target.value === "" ? null : Number(event.target.value),
                })
              }
              type="number"
              min="0"
              placeholder="0"
              className="mt-0.5 h-8 text-xs"
            />
          </div>
          <div>
            <Label className="text-[9px] uppercase tracking-wider text-muted-foreground">
              Max $
            </Label>
            <Input
              value={filters.maxPriceUsd ?? ""}
              onChange={(event) =>
                onChange({
                  ...filters,
                  maxPriceUsd: event.target.value === "" ? null : Number(event.target.value),
                })
              }
              type="number"
              min="0"
              placeholder="∞"
              className="mt-0.5 h-8 text-xs"
            />
          </div>
          <div>
            <Label className="text-[9px] uppercase tracking-wider text-muted-foreground">
              Puan
            </Label>
            <Select
              value={filters.minRating === null ? "all" : String(filters.minRating)}
              onValueChange={(value) =>
                onChange({ ...filters, minRating: value === "all" ? null : Number(value) })
              }
            >
              <SelectTrigger className="mt-0.5 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tümü</SelectItem>
                <SelectItem value="3.5">3.5+</SelectItem>
                <SelectItem value="4">4.0+</SelectItem>
                <SelectItem value="4.5">4.5+</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[9px] uppercase tracking-wider text-muted-foreground">
              Sırala
            </Label>
            <Select
              value={filters.sort}
              onValueChange={(value) => onChange({ ...filters, sort: value as H10Sort })}
            >
              <SelectTrigger className="mt-0.5 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sources_desc">Kaynak sayısı</SelectItem>
                <SelectItem value="price_asc">Fiyat ↑</SelectItem>
                <SelectItem value="rating_desc">Puan ↓</SelectItem>
                <SelectItem value="reviews_desc">Yorum ↓</SelectItem>
                <SelectItem value="freshness_desc">Tazelik</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[9px] uppercase tracking-wider text-muted-foreground">
              Kaynak
            </Label>
            <Select
              value={filters.source}
              onValueChange={(value) => onChange({ ...filters, source: value })}
            >
              <SelectTrigger className="mt-0.5 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tümü</SelectItem>
                {sources.map((source) => (
                  <SelectItem key={source.source} value={source.source}>
                    {source.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <div className="flex items-center gap-2 pb-1">
              <Switch
                checked={filters.inStockOnly}
                onCheckedChange={(checked) => onChange({ ...filters, inStockOnly: checked })}
              />
              <span className="text-[10px] whitespace-nowrap text-muted-foreground">Stokta</span>
            </div>
          </div>
          <div className="flex items-end pb-0.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1 px-2 text-[11px]"
              onClick={onClear}
            >
              <X size={12} /> Temizle
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptySearch({ onPick }: { onPick: (query: string) => void }) {
  return (
    <div className="premium-card overflow-hidden p-6 md:p-10">
      <div className="relative z-10 max-w-3xl">
        <Badge
          variant="outline"
          className="border-[var(--accent-active)]/35 bg-[var(--accent-active)]/10 text-[var(--accent-active)]"
        >
          Global pazar laboratuvarı
        </Badge>
        <h2 className="mt-3 max-w-xl text-2xl font-black tracking-tight md:text-3xl">
          Bir niş yazın; kanıtı, fiyatı ve kaynağı aynı masada görün.
        </h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Hidrojen10 ürün uydurmaz. Kaynak satırlarını gözlem olarak saklar, aynı nişi 24 saat
          boyunca veritabanından döndürür ve hangi kaynağın çalışmadığını ayrıca söyler.
        </p>
        <div className="mt-5 flex flex-wrap gap-1.5">
          {EXAMPLE_QUERIES.map((query) => (
            <button
              key={query}
              type="button"
              onClick={() => onPick(query)}
              className="rounded-full border border-white/12 bg-white/[0.03] px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:border-[var(--accent-active)]/35 hover:text-white"
            >
              {query}
            </button>
          ))}
        </div>
        <div className="mt-7 grid gap-2 sm:grid-cols-3">
          {[
            ["DB-first", "Aynı niş tekrar kazınmaz; 24 saat cache."],
            ["Kanıt ayrımı", "Ölçülmeyen alan null kalır, 0 yazılmaz."],
            ["Kaynak sağlığı", "Hata ile 'sonuç yok' karışmaz."],
          ].map(([title, body]) => (
            <div key={title} className="rounded-xl border border-white/8 bg-white/[0.025] p-3">
              <p className="text-[11px] font-bold text-white/90">{title}</p>
              <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function HealthPanel({ data }: { data: Extract<H10SearchResult, { ok: true }> }) {
  const failed = data.sourceHealth.filter((source) => source.status === "failed").length;
  const notConfigured = data.sourceHealth.filter(
    (source) => source.status === "not_configured",
  ).length;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-4">
        <div className="premium-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-bold">
              <Activity size={15} className="text-[var(--accent-active)]" /> Kaynak sağlığı
            </h2>
            <div className="flex gap-1.5">
              <Badge variant="outline" className="border-white/12 bg-white/5 text-[10px]">
                {data.sourceHealth.length} kaynak
              </Badge>
              {failed > 0 && (
                <Badge
                  variant="outline"
                  className="border-red-400/30 bg-red-400/10 text-[10px] text-red-300"
                >
                  {failed} hata
                </Badge>
              )}
              {notConfigured > 0 && (
                <Badge
                  variant="outline"
                  className="border-white/12 bg-white/5 text-[10px] text-muted-foreground"
                >
                  {notConfigured} anahtarsız
                </Badge>
              )}
            </div>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            “Sonuç yok” ile “hata” ayrıdır; anahtarsız kaynak hiç çağrılmadı.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {data.sourceHealth.map((source) => (
              <div
                key={source.source}
                className="rounded-lg border border-white/8 bg-white/[0.02] p-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-semibold">{source.displayName}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {source.items} satır
                      {source.invalidItems > 0 ? ` · ${source.invalidItems} geçersiz` : ""} ·{" "}
                      {source.latencyMs} ms
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded border px-1.5 py-0.5 text-[9px]",
                      h10StatusTone(source.status),
                    )}
                  >
                    {h10StatusLabel(source.status)}
                  </span>
                </div>
                {source.error && (
                  <p className="mt-1.5 line-clamp-2 text-[9px] text-red-300/80">{source.error}</p>
                )}
              </div>
            ))}
          </div>
          {!data.sourceHealth.length && (
            <p className="mt-3 text-xs text-muted-foreground">Henüz kaynak raporu yok.</p>
          )}
        </div>

        <div className="premium-card p-4">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <History size={15} className="text-[var(--accent-active)]" /> Son taramalar
          </h2>
          <div className="mt-3 space-y-2">
            {data.recentRuns.map((run) => {
              const okCount = run.sourceStats.filter((source) => source.status === "ok").length;
              const failedCount = run.sourceStats.filter(
                (source) => source.status === "failed",
              ).length;
              return (
                <div
                  key={run.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/8 bg-white/[0.02] px-2.5 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        run.status === "failed"
                          ? "bg-red-300"
                          : run.status === "partial"
                            ? "bg-[var(--warning)]"
                            : "bg-[var(--profit)]",
                      )}
                    />
                    <span className="text-[10px] font-semibold">
                      {new Date(run.startedAt).toLocaleString("tr-TR")}
                    </span>
                    <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                      {run.triggeredBy === "manual"
                        ? "manuel"
                        : run.triggeredBy === "stale_refresh"
                          ? "bayat yenileme"
                          : "kullanıcı"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>{run.rowCount} gözlem</span>
                    <span className="text-white/15">·</span>
                    <span>{okCount} iyi</span>
                    {failedCount > 0 && <span className="text-red-300">{failedCount} hata</span>}
                    <span
                      className={cn(
                        "rounded border px-1 py-0.5 text-[9px]",
                        h10StatusTone(
                          run.status === "completed"
                            ? "ok"
                            : run.status === "failed"
                              ? "failed"
                              : "partial",
                        ),
                      )}
                    >
                      {h10StatusLabel(
                        run.status === "completed"
                          ? "ok"
                          : run.status === "failed"
                            ? "failed"
                            : "partial",
                      )}
                    </span>
                  </div>
                  {run.error && <p className="w-full text-[9px] text-red-300/80">{run.error}</p>}
                </div>
              );
            })}
            {!data.recentRuns.length && (
              <p className="text-xs text-muted-foreground">Henüz run geçmişi yok.</p>
            )}
          </div>
        </div>
      </div>

      <aside className="space-y-4">
        <div className="premium-card p-4">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Database size={15} className="text-[var(--accent-active)]" /> Cache özeti
          </h2>
          <dl className="mt-3 space-y-2 text-[11px]">
            {[
              ["Durum", h10StatusLabel(data.status)],
              ["Veri kaynağı", data.dataSource === "db" ? "Veritabanı" : "Canlı tarama"],
              ["Son tarama", h10AgeLabel(data.lastScrapedAt)],
              [
                "Taze bitişi",
                data.freshUntil ? new Date(data.freshUntil).toLocaleString("tr-TR") : "—",
              ],
              ["Gözlem", formatH10Count(data.rowCount)],
              ["Kanonik ürün", formatH10Count(data.productCount)],
              ["Kaynak", String(data.sourceHealth.length)],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-2 border-b border-white/6 pb-1.5 last:border-0 last:pb-0"
              >
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-right font-mono text-white/80">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="rounded-xl border border-[var(--accent-active)]/20 bg-[var(--accent-active)]/[0.05] p-3">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--accent-active)]">
            <ShieldCheck size={12} /> Cache sözleşmesi
          </p>
          <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
            Taze veri 24 saat DB'den döner. Bayat veri hemen gösterilir; yenileme arka planda
            başlar. Aynı niş için ikinci run açılmaz.
          </p>
        </div>
      </aside>
    </div>
  );
}

function PriceHistory({ observations }: { observations: H10Observation[] }) {
  const points = useMemo(
    () =>
      observations
        .filter((item): item is H10Observation & { priceUsd: number } => item.priceUsd !== null)
        .map((item) => ({
          x: new Date(item.observedAt).getTime(),
          y: item.priceUsd,
          source: item.source,
        }))
        .filter((point) => Number.isFinite(point.x)),
    [observations],
  );
  if (points.length < 2) {
    return (
      <div className="rounded-lg border border-dashed border-white/10 p-3 text-[11px] text-muted-foreground">
        {points.length === 1
          ? "Bir fiyat ölçümü var; çizgi için en az iki gözlem gerekir."
          : "Henüz yeterli fiyat gözlemi yok."}
      </div>
    );
  }
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = 600;
  const height = 130;
  const pad = 6;
  const sx = (x: number) => pad + ((x - minX) / Math.max(1, maxX - minX)) * (width - pad * 2);
  const sy = (y: number) =>
    height - pad - ((y - minY) / Math.max(0.01, maxY - minY)) * (height - pad * 2);
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${sx(point.x)},${sy(point.y)}`)
    .join(" ");
  return (
    <div>
      <div className="rounded-lg border border-white/8 bg-black/15 p-2">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-28 w-full overflow-visible"
          role="img"
          aria-label="Fiyat geçmişi"
        >
          <path d={path} fill="none" stroke="var(--accent-active)" strokeWidth="2" />
          {points.map((point, index) => (
            <circle
              key={`${point.x}-${index}`}
              cx={sx(point.x)}
              cy={sy(point.y)}
              r="3"
              fill="var(--profit)"
            />
          ))}
        </svg>
      </div>
      <div className="mt-1 flex justify-between text-[9px] text-muted-foreground">
        <span>min {formatH10Usd(minY)}</span>
        <span>
          {new Date(minX).toLocaleDateString("tr-TR")} →{" "}
          {new Date(maxX).toLocaleDateString("tr-TR")}
        </span>
        <span>max {formatH10Usd(maxY)}</span>
      </div>
    </div>
  );
}

function OfferRow({ offer }: { offer: H10Offer }) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.02] p-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-bold">
            {offer.source}
            {offer.sourceUrl && (
              <a
                href={offer.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[var(--accent-active)] hover:underline"
                aria-label={`${offer.source} kaynağını aç`}
              >
                <ExternalLink size={10} />
              </a>
            )}
          </p>
          <p className="mt-0.5 text-[9px] text-muted-foreground">
            {offer.seller || "Satıcı ölçülmedi"} · {h10AgeLabel(offer.lastSeenAt)}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-[11px] font-bold">
            {offer.priceLocalMinor !== null
              ? formatH10Minor(offer.priceLocalMinor, offer.currency)
              : formatH10Usd(offer.priceUsd)}
          </p>
          <p className="text-[9px] text-muted-foreground">
            {offer.priceLocalMinor !== null && offer.priceUsd !== null
              ? `≈ ${formatH10Usd(offer.priceUsd)}`
              : "USD normalize"}
          </p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Star size={10} className="fill-amber-300 text-amber-300" />{" "}
          {formatH10Rating(offer.rating)}
        </span>
        <span>{formatH10Count(offer.ratingCount)} yorum</span>
        <StockBadge value={offer.inStock} />
        <span className="rounded border border-white/10 px-1 py-0.5 text-[9px]">Ölçüldü</span>
      </div>
    </div>
  );
}

function ProductSheet({
  product,
  nicheId,
  open,
  onOpenChange,
}: {
  product: H10Product | null;
  nicheId: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const detailFn = useServerFn(getHydrogen10Product);
  const detail = useQuery({
    queryKey: ["hydrogen10-product", product?.id, nicheId],
    queryFn: () =>
      detailFn({
        data: { productId: product!.id, ...(nicheId ? { nicheId } : {}) },
      }),
    enabled: open && !!product,
    staleTime: 60_000,
    retry: 0,
  });

  const data = detail.data;
  const detailData = isH10ProductDetail(data) ? data : null;
  const observations = detailData?.observations ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto border-white/10 bg-[#080b12] p-0 sm:max-w-xl">
        <div className="border-b border-white/10 p-5 pr-12">
          <SheetHeader className="text-left">
            <SheetTitle className="flex items-center gap-2 text-base">
              <Sparkles size={15} className="text-[var(--accent-active)]" /> Ürün geçmişi
            </SheetTitle>
            <SheetDescription className="text-[11px]">
              Her fiyat/stok/puan satırı append-only gözlemden gelir.
            </SheetDescription>
          </SheetHeader>
          {product && (
            <div className="mt-4 flex items-start gap-3">
              <ProductThumb product={product} size="lg" />
              <div className="min-w-0">
                <h3 className="text-sm font-bold leading-snug">{product.title}</h3>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {[product.brand, product.category].filter(Boolean).join(" · ") ||
                    "Marka/kategori ölçülmedi"}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Badge variant="outline" className="border-white/12 bg-white/5 text-[9px]">
                    {product.sourceCount} kaynak
                  </Badge>
                  <Badge variant="outline" className="border-white/12 bg-white/5 text-[9px]">
                    {h10AgeLabel(product.lastSeenAt)}
                  </Badge>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-5 p-5">
          {detail.isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          )}

          {data && !data.ok && (
            <div className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/[0.06] p-3 text-[11px] text-[var(--warning)]">
              {data.message}
            </div>
          )}

          {detailData && (
            <>
              <section>
                <h4 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <TrendingUp size={13} className="text-[var(--accent-active)]" /> Fiyat geçmişi ·
                  90 gün
                </h4>
                <div className="mt-2">
                  <PriceHistory observations={observations} />
                </div>
              </section>

              <section>
                <h4 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <Table2 size={13} className="text-[var(--accent-active)]" /> Kaynak teklifleri
                </h4>
                <div className="mt-2 space-y-1.5">
                  {detailData.offers.map((offer) => (
                    <OfferRow key={offer.id} offer={offer} />
                  ))}
                  {!detailData.offers.length && (
                    <p className="text-[11px] text-muted-foreground">Kaynak teklifi yok.</p>
                  )}
                </div>
              </section>

              <section>
                <h4 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <Database size={13} className="text-[var(--accent-active)]" /> Kimlik / kanıt
                </h4>
                <dl className="mt-2 space-y-1.5 text-[10px]">
                  {[
                    ["Kimlik anahtarı", detailData.product.identityKey],
                    ["GTIN", detailData.product.gtin ?? "—"],
                    ["MPN", detailData.product.mpn ?? "—"],
                    ["Gözlem sayısı", `${observations.length} (son 90 gün)`],
                    [
                      "İlk görülme",
                      detailData.product.createdAt
                        ? new Date(detailData.product.createdAt).toLocaleString("tr-TR")
                        : "—",
                    ],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="flex items-start justify-between gap-3 border-b border-white/6 pb-1 last:border-0"
                    >
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="max-w-[65%] break-all text-right font-mono text-white/70">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section>
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Son gözlemler
                </h4>
                <div className="mt-2 max-h-64 space-y-1 overflow-y-auto pr-1">
                  {[...observations]
                    .reverse()
                    .slice(0, 30)
                    .map((observation) => (
                      <div
                        key={observation.id}
                        className="flex items-center justify-between gap-2 rounded border border-white/8 bg-white/[0.02] px-2 py-1.5 text-[10px]"
                      >
                        <span className="truncate text-muted-foreground">
                          {new Date(observation.observedAt).toLocaleString("tr-TR")} ·{" "}
                          {observation.source}
                        </span>
                        <span className="shrink-0 font-mono">
                          {observation.priceLocalMinor !== null
                            ? formatH10Minor(observation.priceLocalMinor, observation.currency)
                            : formatH10Usd(observation.priceUsd)}
                          {!observation.eligible && (
                            <span className="ml-1 text-[9px] text-[var(--warning)]">
                              {observation.rejectionReason ?? "filtre"}
                            </span>
                          )}
                        </span>
                      </div>
                    ))}
                  {!observations.length && (
                    <p className="text-[11px] text-muted-foreground">Gözlem yok.</p>
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Hydrogen10Page() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const searchFn = useServerFn(searchHydrogen10);
  const refreshFn = useServerFn(refreshHydrogen10);

  const [query, setQuery] = useState(search.q);
  const [country, setCountry] = useState(search.country);
  const [platform, setPlatform] = useState(search.platform);
  const [filters, setFilters] = useState<H10Filters>(H10_DEFAULT_FILTERS);
  const [selectedProduct, setSelectedProduct] = useState<H10Product | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);

  // Aylık Hidrojen10 hakkı — üst bar ve ayarlar ile AYNI sayaçtan okunur.
  const planUsage = usePlanUsage();
  const h10Row = planUsage.rows.find((row) => row.kind === "hydrogen10Runs");
  const h10Label = h10Row
    ? usageLabelFor({
        used: h10Row.used,
        limit: h10Row.limit,
        disabled: h10Row.disabled,
        measured: planUsage.measured,
        loading: planUsage.loading,
      })
    : "…";
  const h10Exhausted = !!h10Row && h10Row.exhausted && !h10Row.disabled;

  useEffect(() => {
    setQuery(search.q);
    setCountry(search.country);
    setPlatform(search.platform);
  }, [search.q, search.country, search.platform]);

  const submittedQuery = search.q.trim();
  const canSearch = submittedQuery.length >= 2;

  const resultQuery = useQuery({
    queryKey: ["hydrogen10", submittedQuery, search.country, search.platform],
    queryFn: () =>
      searchFn({
        data: {
          query: submittedQuery,
          country: search.country,
          platform: search.platform,
        },
      }),
    enabled: canSearch,
    staleTime: 30_000,
    retry: 0,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.ok && data.refreshing ? 3_500 : false;
    },
  });

  const refresh = useMutation({
    mutationFn: () =>
      refreshFn({
        data: {
          query: submittedQuery,
          country: search.country,
          platform: search.platform,
        },
      }),
    onSuccess: (data) => {
      setManualError(null);
      if (data.ok) {
        queryClient.setQueryData(
          ["hydrogen10", submittedQuery, search.country, search.platform],
          data,
        );
      } else {
        setManualError(data.message);
      }
    },
    onError: (error) =>
      setManualError(error instanceof Error ? error.message : "Yenileme başarısız."),
  });

  const submit = (nextQuery = query) => {
    const clean = nextQuery.trim();
    if (clean.length < 2) return;
    setManualError(null);
    void navigate({
      to: "/hidrojen10",
      search: {
        q: clean,
        country,
        platform,
      },
    });
  };

  const data = resultQuery.data;
  const success = isH10SearchSuccess(data) ? data : null;
  const lastScrapedAt = success?.lastScrapedAt ?? null;

  // Canlı tarama bittiğinde aylık hak rozeti kendiliğinden düşsün. Yalnız
  // `lastScrapedAt` DEĞİŞTİĞİNDE çalışır: cache polling'i sayacı boşa
  // tazelemez, tarama tamamlanınca bir kez tazeler.
  useEffect(() => {
    if (!lastScrapedAt) return;
    void queryClient.invalidateQueries({ queryKey: ["plan-usage"] });
  }, [lastScrapedAt, queryClient]);
  const failure = isH10SearchFailure(data) ? data : null;
  const filtered = useMemo(
    () => (success ? filterH10Products(success.products, filters) : []),
    [success, filters],
  );
  const sources = success?.sourceHealth ?? [];
  const totalOffers =
    success?.products.reduce((sum, product) => sum + product.offers.length, 0) ?? 0;

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-7xl px-4 py-8">
        <PageHero
          icon={<Atom size={19} />}
          title="Hidrojen10"
          description="Global pazar istihbaratı — kanıtlı ürün verisi, fiyat/stok geçmişi ve kaynak sağlığı. Aynı niş 24 saat DB cache'inden döner."
          actions={
            <>
              <Badge
                variant="outline"
                className="border-[var(--accent-active)]/30 bg-[var(--accent-active)]/10 text-[10px] text-[var(--accent-active)]"
              >
                BETA
              </Badge>
              <Badge variant="outline" className="border-white/12 bg-white/5 text-[10px]">
                <Database size={10} className="mr-1" /> DB-first
              </Badge>
              <Badge
                variant="outline"
                title={`Bu ay Hidrojen10 tarama hakkı: ${h10Label}. 24 saat cache'ten dönen aramalar hak harcamaz.`}
                className={cn(
                  "border-white/12 bg-white/5 text-[10px]",
                  h10Exhausted &&
                    "border-[var(--warning)]/35 bg-[var(--warning)]/10 text-[var(--warning)]",
                )}
              >
                <Activity size={10} className="mr-1" /> Hidrojen10 {h10Label}
              </Badge>
              <Button
                variant="secondary"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  if (!canSearch || h10Exhausted) return;
                  refresh.mutate();
                }}
                disabled={!canSearch || refresh.isPending || h10Exhausted}
                title={
                  h10Exhausted
                    ? "Aylık Hidrojen10 hakkın doldu — cache'teki nişler görüntülenebilir."
                    : "Aynı nişi 24 saatlik cache'i atlayarak yeniden tara"
                }
              >
                {refresh.isPending ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <RefreshCw size={13} />
                )}
                {refresh.isPending ? "Taranıyor…" : "Yine de yenile"}
              </Button>
            </>
          }
        />

        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[linear-gradient(135deg,rgba(16,24,40,0.92),rgba(7,10,18,0.96))] p-4 md:p-5">
          <div className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-[var(--accent-active)]/10 blur-3xl" />
          <div className="relative z-10">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
              className="grid gap-2.5 lg:grid-cols-[minmax(0,1fr)_180px_190px_auto]"
            >
              <div className="relative">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Niş, ASIN veya ürün URL'si…"
                  maxLength={160}
                  className="h-11 border-white/12 bg-black/20 pl-9 text-sm"
                  aria-label="Hidrojen10 niş araması"
                />
              </div>
              <Select value={country} onValueChange={setCountry}>
                <SelectTrigger className="h-11 border-white/12 bg-black/20 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {H10_COUNTRIES.map((item) => (
                    <SelectItem key={item.code} value={item.code}>
                      {item.flag} {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger className="h-11 border-white/12 bg-black/20 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {H10_PLATFORMS.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="submit"
                className="h-11 gap-2 bg-[var(--accent-active)] px-6 text-black hover:bg-[var(--accent-active)]/90"
                disabled={query.trim().length < 2 || resultQuery.isFetching}
              >
                {resultQuery.isFetching ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Search size={14} />
                )}
                {resultQuery.isFetching ? "Taranıyor" : "Ara"}
              </Button>
            </form>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
              {h10Exhausted ? (
                <span className="inline-flex items-center gap-1.5 text-[var(--warning)]">
                  <AlertTriangle size={11} />
                  Aylık canlı tarama hakkın doldu; cache'teki nişleri görüntülemeye devam
                  edebilirsin.
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck size={11} className="text-[var(--profit)]" />
                  24 saat cache · aynı nişte kazıma yapılmaz · PRO
                </span>
              )}
              <span>Ülke + platform + para birimi ayrı niş anahtarıdır.</span>
            </div>
            {h10Exhausted && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--warning)]/25 bg-[var(--warning)]/[0.07] px-3 py-2 text-[11px] text-[var(--warning)]">
                <span className="inline-flex items-center gap-1.5">
                  <AlertTriangle size={12} />
                  Bu ay {h10Label} canlı tarama kullandın. Yeni niş taraması için paketini
                  yükseltebilirsin.
                </span>
                <Link
                  to="/pricing"
                  className="inline-flex items-center gap-1 font-semibold hover:underline"
                >
                  Paketleri gör <ChevronRight size={12} />
                </Link>
              </div>
            )}
            {success && <CacheLine data={success} />}
          </div>
        </div>

        {manualError && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-[var(--warning)]/30 bg-[var(--warning)]/10 p-3 text-xs text-[var(--warning)]">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {manualError}
          </div>
        )}

        {!canSearch && !resultQuery.isLoading && (
          <div className="mt-5">
            <EmptySearch
              onPick={(next) => {
                setQuery(next);
                submit(next);
              }}
            />
          </div>
        )}

        {canSearch && resultQuery.isLoading && (
          <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-12 w-full" />
              {[0, 1, 2, 3].map((item) => (
                <Skeleton key={item} className="h-20 w-full" />
              ))}
            </div>
            <Skeleton className="h-64 w-full" />
          </div>
        )}

        {failure && (
          <div className="mt-5">
            <MigrationNotice result={failure} />
          </div>
        )}

        {success && (
          <Tabs defaultValue="lab" className="mt-5">
            <TabsList className="h-9 border border-white/10 bg-white/[0.03]">
              <TabsTrigger value="lab" className="gap-1.5 text-xs">
                <Sparkles size={12} /> Pazar Laboratuvarı
              </TabsTrigger>
              <TabsTrigger value="health" className="gap-1.5 text-xs">
                <Activity size={12} /> Veri Sağlığı
              </TabsTrigger>
            </TabsList>

            <TabsContent value="lab" className="mt-4 space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold">
                    {success.query}{" "}
                    <span className="font-normal text-muted-foreground">
                      · {success.country} · {success.platform}
                    </span>
                  </h2>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {formatH10Count(success.products.length)} ürün · {formatH10Count(totalOffers)}{" "}
                    teklif · {formatH10Count(success.rowCount)} gözlem
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={cn("text-[10px]", h10StatusTone(success.status))}
                >
                  {h10StatusLabel(success.status)}
                </Badge>
              </div>

              <FiltersBar
                filters={filters}
                onChange={setFilters}
                sources={sources}
                onClear={() => setFilters(H10_DEFAULT_FILTERS)}
              />

              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>{formatH10Count(filtered.length)} sonuç gösteriliyor</span>
                <span>Aynı ürün farklı kaynaklarda tek satırda birleşir; detayda ayrışır.</span>
              </div>

              <ProductTable products={filtered} onSelect={setSelectedProduct} />

              {success.message && (
                <p className="flex items-start gap-2 rounded-lg border border-white/8 bg-white/[0.025] p-2.5 text-[10px] text-muted-foreground">
                  <CircleDot size={11} className="mt-0.5 shrink-0 text-[var(--accent-active)]" />
                  {success.message}
                </p>
              )}

              {!success.products.length && (
                <div className="premium-card p-4">
                  <h3 className="flex items-center gap-2 text-xs font-bold">
                    <AlertTriangle size={13} className="text-[var(--warning)]" /> Bu nişte ürün
                    bulunamadı
                  </h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    Kaynaklardan ürün satırı gelmedi. Bu bir “0 ürün” iddiası değildir; hangi
                    kaynağın yapılandırılmadığını veya hata verdiğini Veri Sağlığı sekmesinde
                    görebilirsiniz.
                  </p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="health" className="mt-4">
              <HealthPanel data={success} />
            </TabsContent>
          </Tabs>
        )}

        {success && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 size={11} className="text-[var(--profit)]" />
              Fiyat, stok, puan ve yorum sayısı yalnız kaynaktan ölçülür; AI üretmez.
            </span>
            <span className="font-mono text-[9px] text-muted-foreground/60">
              {success.canonicalKey}
            </span>
          </div>
        )}

        <ProductSheet
          product={selectedProduct}
          nicheId={success?.nicheId}
          open={selectedProduct !== null}
          onOpenChange={(open) => {
            if (!open) setSelectedProduct(null);
          }}
        />
      </main>
    </div>
  );
}
