import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Wallet, Loader2, Plus, Trash2, TrendingUp, TrendingDown, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHero } from "@/components/page-hero";
import { useAuth } from "@/hooks/use-auth";
import { listRoiEntries, saveRoiEntry, deleteRoiEntry } from "@/lib/roi.functions";
import { aggregateRoi, computeRoi, money, type RoiEntry } from "@/lib/roi-math";

export const Route = createFileRoute("/roi")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Kâr / ROI Takip Paneli — Velora" },
      { name: "description", content: "Gerçek mağaza rakamlarını gir; ürün bazında net kâr, marj, ROAS, CAC ve başabaş ROAS'ı anlık hesapla." },
      { property: "og:title", content: "Kâr / ROI Takip Paneli — Velora" },
      { property: "og:description", content: "Gerçek satış verinle ürün bazlı net kâr ve ROAS takibi." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RoiPage,
});

const PLATFORMS = ["Shopify", "TikTok Shop", "Amazon", "Etsy", "Trendyol", "eBay", "WooCommerce", "Hepsiburada"];
const CURRENCIES = ["USD", "EUR", "TRY", "GBP"];

const BLANK = {
  product_name: "", platform: "Shopify", country: "US", currency: "USD",
  cost_price: 0, sell_price: 0, shipping_cost: 0, other_cost: 0,
  ad_spend: 0, orders: 0, refunds: 0, expected_margin_pct: null as number | null, notes: "",
};

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="premium-card p-3 text-center">
      <div className="text-xl font-black" style={{ color: tone ?? "var(--accent-active)" }}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function RoiPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { user, loading } = useAuth();
  const [form, setForm] = useState({ ...BLANK });
  const [open, setOpen] = useState(false);

  const listFn = useServerFn(listRoiEntries);
  const saveFn = useServerFn(saveRoiEntry);
  const delFn = useServerFn(deleteRoiEntry);

  useEffect(() => { if (!loading && !user) nav({ to: "/auth" }); }, [user, loading, nav]);

  const q = useQuery({ queryKey: ["roi-entries"], queryFn: () => listFn(), enabled: !!user });
  const entries = useMemo(() => (q.data ?? []) as RoiEntry[], [q.data]);
  const agg = useMemo(() => aggregateRoi(entries), [entries]);
  const currency = entries[0]?.currency ?? "USD";

  const save = useMutation({
    mutationFn: () => saveFn({ data: { ...form, notes: form.notes || null } }),
    onSuccess: () => {
      setForm({ ...BLANK });
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["roi-entries"] });
      toast.success("Kayıt eklendi");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading || !user) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="animate-spin" /></div>;
  }

  const num = (k: keyof typeof BLANK) => ({
    value: String(form[k] ?? ""),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value === "" ? 0 : Number(e.target.value) })),
    type: "number" as const,
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <PageHero
        icon={<Wallet size={20} />}
        title="Kâr / ROI Takip Paneli"
        description="Gerçek mağaza rakamlarını gir, AI tahminleriyle karşılaştır. Hangi ürün gerçekten para kazandırıyor gör."
        actions={<Button size="sm" onClick={() => setOpen((v) => !v)}><Plus size={14} className="mr-1" /> Ürün ekle</Button>}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label="Ciro" value={money(agg.revenue, currency)} />
        <Stat label="Net kâr" value={money(agg.profit, currency)} tone={agg.profit >= 0 ? "var(--profit)" : "#f87171"} />
        <Stat label="Net marj" value={`%${agg.marginPct.toFixed(1)}`} />
        <Stat label="ROAS" value={`${(agg.roasPct / 100).toFixed(2)}x`} />
        <Stat label="CAC" value={money(agg.cac, currency)} />
        <Stat label="Kazanan / kaybeden" value={`${agg.winners} / ${agg.losers}`} />
      </div>

      {open && (
        <Card className="premium-card mb-5 border-white/10">
          <CardContent className="grid gap-3 p-4 md:grid-cols-4">
            <Input placeholder="Ürün adı" value={form.product_name} onChange={(e) => setForm((f) => ({ ...f, product_name: e.target.value }))} className="md:col-span-2" />
            <Select value={form.platform} onValueChange={(v) => setForm((f) => ({ ...f, platform: v }))}>
              <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{PLATFORMS.map((p) => <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={form.currency} onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}>
              <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{CURRENCIES.map((p) => <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>)}</SelectContent>
            </Select>
            <label className="text-xs text-muted-foreground">Ürün maliyeti<Input {...num("cost_price")} /></label>
            <label className="text-xs text-muted-foreground">Satış fiyatı<Input {...num("sell_price")} /></label>
            <label className="text-xs text-muted-foreground">Kargo / birim<Input {...num("shipping_cost")} /></label>
            <label className="text-xs text-muted-foreground">Diğer / birim<Input {...num("other_cost")} /></label>
            <label className="text-xs text-muted-foreground">Reklam harcaması<Input {...num("ad_spend")} /></label>
            <label className="text-xs text-muted-foreground">Sipariş<Input {...num("orders")} /></label>
            <label className="text-xs text-muted-foreground">İade<Input {...num("refunds")} /></label>
            <label className="text-xs text-muted-foreground">
              Beklenen marj %
              <Input
                type="number"
                value={form.expected_margin_pct ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, expected_margin_pct: e.target.value === "" ? null : Number(e.target.value) }))}
              />
            </label>
            <Input placeholder="Not" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="md:col-span-3" />
            <Button onClick={() => save.mutate()} disabled={form.product_name.trim().length < 1 || save.isPending}>
              {save.isPending ? <Loader2 size={14} className="animate-spin" /> : "Kaydet"}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="premium-card overflow-x-auto p-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Ürün</TableHead>
              <TableHead className="text-xs">Kanal</TableHead>
              <TableHead className="text-right text-xs">Sipariş</TableHead>
              <TableHead className="text-right text-xs">Ciro</TableHead>
              <TableHead className="text-right text-xs">Net kâr</TableHead>
              <TableHead className="text-right text-xs">Marj</TableHead>
              <TableHead className="text-right text-xs">ROAS</TableHead>
              <TableHead className="text-right text-xs">Başabaş ROAS</TableHead>
              <TableHead className="text-right text-xs">CAC</TableHead>
              <TableHead className="text-right text-xs">Tahmine göre</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {agg.rows.length === 0 && (
              <TableRow><TableCell colSpan={11} className="py-8 text-center text-xs text-muted-foreground">Henüz kayıt yok. “Ürün ekle” ile başla.</TableCell></TableRow>
            )}
            {agg.rows.map(({ entry, stats }) => (
              <TableRow key={entry.id}>
                <TableCell className="text-xs font-semibold">{entry.product_name}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{entry.platform}</TableCell>
                <TableCell className="text-right text-xs">{stats.netOrders}</TableCell>
                <TableCell className="text-right text-xs">{money(stats.revenue, entry.currency)}</TableCell>
                <TableCell className="text-right text-xs font-bold" style={{ color: stats.netProfit >= 0 ? "var(--profit)" : "#f87171" }}>
                  {money(stats.netProfit, entry.currency)}
                </TableCell>
                <TableCell className="text-right text-xs">%{stats.marginPct.toFixed(1)}</TableCell>
                <TableCell className="text-right text-xs">{(stats.roasPct / 100).toFixed(2)}x</TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">{stats.breakEvenRoas.toFixed(2)}x</TableCell>
                <TableCell className="text-right text-xs">{money(stats.cac, entry.currency)}</TableCell>
                <TableCell className="text-right text-xs">
                  {stats.vsExpectedPct == null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <Badge variant="outline" className={stats.vsExpectedPct >= 0 ? "border-[var(--profit)]/40 text-[var(--profit)]" : "border-red-400/40 text-red-400"}>
                      {stats.vsExpectedPct >= 0 ? <TrendingUp size={10} className="mr-1" /> : <TrendingDown size={10} className="mr-1" />}
                      {stats.vsExpectedPct >= 0 ? "+" : ""}{stats.vsExpectedPct.toFixed(1)} p
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <button
                    className="text-muted-foreground hover:text-red-400"
                    onClick={async () => { await delFn({ data: { id: entry.id } }); qc.invalidateQueries({ queryKey: ["roi-entries"] }); }}
                  >
                    <Trash2 size={13} />
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {agg.rows.length > 0 && (
        <div className="premium-card mt-4 p-4 text-xs text-muted-foreground">
          <div className="mb-2 flex items-center gap-2 text-sm font-bold text-foreground"><Target size={14} /> Aksiyon önerileri</div>
          <ul className="list-inside list-disc space-y-1">
            {agg.rows
              .filter((r) => r.stats.netProfit < 0)
              .slice(0, 3)
              .map((r) => (
                <li key={r.entry.id}>
                  <span className="text-foreground">{r.entry.product_name}</span>: zararda. Başabaş için ROAS {r.stats.breakEvenRoas.toFixed(2)}x gerekiyor, şu an {(r.stats.roasPct / 100).toFixed(2)}x.
                </li>
              ))}
            {agg.rows
              .filter((r) => r.stats.netProfit > 0)
              .sort((a, b) => b.stats.netProfit - a.stats.netProfit)
              .slice(0, 2)
              .map((r) => (
                <li key={r.entry.id}>
                  <span className="text-foreground">{r.entry.product_name}</span>: sipariş başına {money(r.stats.profitPerOrder, r.entry.currency)} kâr. Bütçeyi kademeli artır.
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
