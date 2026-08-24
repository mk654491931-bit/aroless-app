import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Flame,
  Globe,
  Store,
  Wallet,
  TrendingUp,
  Truck,
  Users,
  Megaphone,
  AlertTriangle,
  Loader2,
  Package,
  Clock,
} from "lucide-react";
import { fetchHotProducts, HOT_FEED_QUERY_KEY } from "@/lib/hot-products";
import { BrandLogo } from "@/components/brand-logo";

export const Route = createFileRoute("/hot/$id")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Şu An Satılmaya En Müsait Ürün — Pazar & Bütçe Planı" },
      {
        name: "description",
        content:
          "Bu ürünün hangi ülkede, hangi pazarda ve hangi bütçeyle satılması gerektiğini gösteren canlı saatlik pazar raporu.",
      },
      { property: "og:title", content: "Canlı Ürün Fırsatı — Ülke, Pazar ve Bütçe Planı" },
      {
        property: "og:description",
        content: "Saatlik yenilenen gerçek pazar verisiyle ülke, kanal, maliyet ve bütçe planı.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HotProductPage,
});

function Stat({ icon: Icon, label, value }: { icon: React.ComponentType<{ size?: number; className?: string }>; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/60 p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <p className="mt-1 text-lg font-bold text-foreground">{value}</p>
    </div>
  );
}

function HotProductPage() {
  const { id } = Route.useParams();
  const { data, isLoading } = useQuery({
    queryKey: HOT_FEED_QUERY_KEY,
    queryFn: fetchHotProducts,
    staleTime: 60 * 60 * 1000,
  });
  const p = data?.items.find((x) => x.id === id);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3">
          <Link
            to="/"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Geri
          </Link>
          <div className="ml-auto">
            <BrandLogo size="sm" />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8">
        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Canlı pazar verisi yükleniyor…
          </div>
        )}

        {!isLoading && !p && (
          <div className="rounded-xl border border-border/60 bg-card/60 p-6">
            <h1 className="text-lg font-bold text-foreground">Bu fırsat artık listede değil</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Liste her saat başı yenileniyor. Güncel fırsatlar için ana sayfadaki canlı akışa
              dönün.
            </p>
          </div>
        )}

        {p && (
          <article className="space-y-6">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-orange-400">
                <Flame className="h-4 w-4" /> Şu an satılmaya en müsait · {p.score}/100
              </div>
              <h1 className="mt-2 text-3xl font-bold text-foreground">{p.name}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{p.why_now}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat icon={Globe} label="Hangi ülke" value={`${p.country_flag} ${p.country}`} />
              <Stat icon={Store} label="Hangi pazar" value={p.marketplace} />
              <Stat icon={Wallet} label="Başlangıç bütçesi" value={p.budget_usd} />
              <Stat icon={TrendingUp} label="Net marj" value={`${p.margin_pct}%`} />
            </div>

            <section className="rounded-xl border border-border/60 bg-card/60 p-5">
              <h2 className="text-sm font-bold text-foreground">Maliyet ve fiyatlandırma</h2>
              <div className="mt-3 overflow-hidden rounded-lg border border-border/60">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-border/60">
                    <tr>
                      <td className="px-3 py-2 text-muted-foreground">Tedarik maliyeti</td>
                      <td className="px-3 py-2 text-right font-medium text-foreground">
                        {p.supplier_cost_usd}
                      </td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-muted-foreground">Satış fiyatı</td>
                      <td className="px-3 py-2 text-right font-medium text-foreground">
                        {p.retail_price_usd}
                      </td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-muted-foreground">Rekabet</td>
                      <td className="px-3 py-2 text-right font-medium text-foreground">
                        {p.competition}
                      </td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-muted-foreground">Net marj</td>
                      <td className="px-3 py-2 text-right font-medium text-emerald-400">
                        {p.margin_pct}%
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <div className="grid gap-3 sm:grid-cols-2">
              <Stat icon={Package} label="Tedarik kanalı" value={p.sourcing} />
              <Stat icon={Truck} label="Teslim süresi" value={p.lead_time} />
            </div>

            <section className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-border/60 bg-card/60 p-5">
                <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
                  <Users className="h-4 w-4" /> Hedef kitle
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">{p.audience || "—"}</p>
              </div>
              <div className="rounded-xl border border-border/60 bg-card/60 p-5">
                <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
                  <Megaphone className="h-4 w-4" /> Reklam açısı
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">{p.ad_angle || "—"}</p>
              </div>
            </section>

            <section className="rounded-xl border border-border/60 bg-card/60 p-5">
              <h2 className="text-sm font-bold text-foreground">Talep sinyali</h2>
              <p className="mt-2 text-sm text-muted-foreground">{p.demand_signal || "—"}</p>
            </section>

            {p.first_week_plan.length > 0 && (
              <section className="rounded-xl border border-border/60 bg-card/60 p-5">
                <h2 className="text-sm font-bold text-foreground">İlk hafta planı</h2>
                <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
                  {p.first_week_plan.map((s, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
                        {i + 1}
                      </span>
                      {s}
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {p.risks.length > 0 && (
              <section className="rounded-xl border border-destructive/40 bg-destructive/5 p-5">
                <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
                  <AlertTriangle className="h-4 w-4 text-destructive" /> Riskler
                </h2>
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {p.risks.map((r, i) => (
                    <li key={i}>• {r}</li>
                  ))}
                </ul>
              </section>
            )}

            {data && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                Son güncelleme {new Date(data.refreshed_at).toLocaleString()} · Sonraki yenileme{" "}
                {new Date(data.next_refresh_at).toLocaleTimeString()}
              </p>
            )}
          </article>
        )}
      </main>
    </div>
  );
}
