import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Boxes,
  CalendarDays,
  ChevronDown,
  Clapperboard,
  Factory,
  Flag,
  Gauge,
  Layers,
  LineChart,
  Search,
  ShieldCheck,
  Tags,
  Target,
  TrendingUp,
  Users,
  Wrench,
  Globe2,
  Truck,
  Receipt,
  Store,
  DollarSign,
  Package,
  MapPin,
  Flame,
  ExternalLink,
  SlidersHorizontal,
} from "lucide-react";
import type { WinningProduct } from "@/lib/gemini.functions";
import { supplierMatchKind } from "@/lib/supplier-economics";
import { buildProductCostBreakdown, type CostValue } from "@/lib/product-cost-breakdown";
import { completeDeepDive, num } from "@/lib/deep-dive-complete";
import { sourcingSearchLinks } from "@/lib/sourcing-links";
import {
  CheckItem,
  ChecklistProgress,
  ExportReport,
  ScenarioSimulator,
  useChecklist,
} from "@/components/deep-dive-tools";
import { ConsensusPanel } from "@/components/consensus-report";

const sevCls = (s?: string) =>
  s === "High"
    ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
    : s === "Low"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
      : "border-amber-500/40 bg-amber-500/10 text-amber-300";

/** İngilizce gelen AI etiketlerini Türkçeye çevirir (Rising/Low/High vb.). */
const TR_LABEL: Record<string, string> = {
  Rising: "Yükseliyor",
  Stable: "Sabit",
  Declining: "Düşüyor",
  Low: "Düşük",
  Medium: "Orta",
  High: "Yüksek",
};
const tr = (v?: string) => (v ? (TR_LABEL[v] ?? v) : "—");

/** "12–25 days", "Day 1-5", "Week 2", "Month 1" gibi ifadeleri Türkçeleştirir. */
function trDuration(v?: string | number | null): string {
  if (v === undefined || v === null || v === "") return "—";
  const s = String(v).trim();
  if (/^\d+$/.test(s)) return `${s} gün`;
  return s
    .replace(/\bbusiness days?\b/gi, "iş günü")
    .replace(/\bdays?\b/gi, "gün")
    .replace(/\bweeks?\b/gi, "hafta")
    .replace(/\bmonths?\b/gi, "ay")
    .replace(/\bDay\b/g, "Gün")
    .replace(/\bWeek\b/g, "Hafta")
    .replace(/\bMonth\b/g, "Ay");
}

function Block({
  icon,
  title,
  children,
  defaultOpen = false,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-white/[0.04] transition"
      >
        <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
          {icon} {title}
        </span>
        <ChevronDown
          size={13}
          className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <div className="px-3 pb-3 pt-1 text-xs space-y-2">{children}</div>}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right font-medium">{v}</span>
    </div>
  );
}

/** Maliyet hücresi: değeri ve "ölçüldü / hesaplandı" kaynağını birlikte gösterir. */
function CostCell({ row }: { row: CostValue }) {
  if (row.usd === null) {
    return <span className="text-[10px] text-muted-foreground">{row.source}</span>;
  }
  const title = [row.source, row.detail].filter(Boolean).join(" · ");
  return (
    <span className="inline-flex items-center justify-end gap-1" title={title}>
      ${row.usd.toFixed(2)}
      <span
        className={`rounded-full border px-1 py-0 text-[8px] font-normal ${
          row.basis === "measured"
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300/80"
            : "border-amber-500/30 bg-amber-500/10 text-amber-200/80"
        }`}
      >
        {row.basis === "measured" ? "ölçüldü" : "hesaplandı"}
      </span>
    </span>
  );
}

/**
 * Modelin ürettiği sayı/plan bölümleri için DÜRÜSTLÜK ETİKETİ.
 *
 * Bu bölümler canlı kaynaktan ölçülmedi; projeksiyon, plan ve fiyat
 * basamakları model çıktısıdır. Eksik bölüm artık sessizce varsayılanla
 * doldurulmuyor: üretilen her bölüm bu etiketle "tahmin" olduğunu söylüyor.
 */
function ModelNote() {
  return (
    <p className="text-[10px] text-amber-200/80">
      AI tahmini — ölçüm değil. Canlı kaynak bu alanı doğrulamadı.
    </p>
  );
}

export function ProductDeepDive({ p: raw }: { p: WinningProduct }) {
  // Eski sürüm eksik plan bölümlerini SESSİZ varsayılanlarla dolduruyordu.
  // Yeni tamamlama yalnız kaynak etiketli model çıktısı üretir; tedarikçi
  // adı/fiyatı uydurmaz ve her bölüm ModelNote taşır.
  const p = useMemo(() => completeDeepDive(raw), [raw]);
  const { done, toggle } = useChecklist(p.name ?? "urun");
  const planIds = useMemo(() => {
    const ids: string[] = [];
    (p.launch_roadmap ?? []).forEach((ph, i) =>
      (ph.actions ?? []).forEach((_, j) => ids.push(`r${i}-${j}`)),
    );
    (p.content_calendar ?? []).forEach((w, i) =>
      (w.posts ?? []).forEach((_, j) => ids.push(`c${i}-${j}`)),
    );
    return ids;
  }, [p]);
  const completed = planIds.filter((id) => done[id]).length;

  // ÖLÇÜLMÜŞ TEDARİK KANITI — "Tek bakışta" paneli eskiden yalnız modelin
  // `supplier_shortlist` alanına bakıyordu. Ölçümlü hatta o alan HİÇ
  // doldurulmuyor; sonuç: kanıt varken bile "Tedarik kaynağı Ölçülmedi"
  // yazıyordu. Aşağıdaki değerler doğrudan `supplier_evidence`ten gelir.
  const supplier = p.supplier_evidence;
  const supplierLinks = sourcingSearchLinks(p.name);
  const supplierKind = supplier ? supplierMatchKind(supplier) : null;
  const supplierMatched = supplierKind === "product";
  const hasSupplierEvidence = Boolean(supplier && supplier.samples > 0);
  const supplierBand =
    supplier && supplier.supplierLowUsd !== null && supplier.supplierHighUsd !== null
      ? supplier.supplierHighUsd > supplier.supplierLowUsd
        ? `$${supplier.supplierLowUsd.toFixed(2)} – $${supplier.supplierHighUsd.toFixed(2)}`
        : `$${supplier.supplierLowUsd.toFixed(2)}`
      : null;
  const supplierName = hasSupplierEvidence
    ? supplierMatched
      ? supplier?.store || "Ölçülen toptan teklif"
      : supplierBand
        ? `Niş bandı ${supplierBand}`
        : "Niş bandı (birebir eşleşme yok)"
    : p.supplier_shortlist?.[0]?.name
      ? `${p.supplier_shortlist[0].name} · model önerisi`
      : "Tedarik araştırması gerekli";
  const supplierSub = hasSupplierEvidence
    ? [
        supplierMatched && supplier?.shipFrom ? `Kargo çıkışı ${supplier.shipFrom}` : "",
        supplierMatched && supplier?.freeShipping ? "ücretsiz kargo" : "",
        supplierMatched &&
        typeof supplier?.deliveryMinDays === "number" &&
        typeof supplier?.deliveryMaxDays === "number"
          ? `teslimat ${supplier.deliveryMinDays}-${supplier.deliveryMaxDays} gün`
          : "",
        `${supplier?.samples ?? 0} toptan teklif`,
        supplierMatched ? "birebir ürün" : "aynı niş",
      ]
        .filter(Boolean)
        .join(" · ")
    : (p.supplier_shortlist?.[0]?.region ??
      (p.sourcing?.shipping_method
        ? `${p.sourcing.shipping_method} · model`
        : "Canlı toptan kaynakta birebir teklif yok; arama bağlantıları aşağıda"));

  // MALİYET DÖKÜMÜ: ölçülmüş değer varsa o; yoksa platform/ülke
  // tarifelerinden hesaplanmış değer. Boş bırakmak yerine kaynağı görünen
  // bir sayı gösterilir.
  const costs = buildProductCostBreakdown(p);
  const allCostsMeasured =
    [costs.supplier, costs.shipping, costs.platformFee, costs.adSpend, costs.netProfit].every(
      (row) => row.basis === "measured",
    ) &&
    (costs.delivery === null || costs.delivery.basis === "measured");
  const channel =
    p.platform_fit?.[0] ??
    p.real_economics?.context?.platform ??
    p.market_verdict?.channels?.[0]?.platform;
  const grossProfitUsd = costs.grossProfit.usd;
  const netProfitUsd = costs.netProfit.usd;
  const netMeasured = costs.netProfit.basis === "measured";
  const grossMarginPct = costs.grossMarginPct;
  const netMarginPct = costs.netMarginPct;
  const deliveryMain = costs.delivery
    ? costs.delivery.min === costs.delivery.max
      ? `${costs.delivery.min} gün`
      : `${costs.delivery.min}–${costs.delivery.max} gün`
    : p.supplier_shortlist?.[0]?.lead_time
      ? trDuration(p.supplier_shortlist[0].lead_time)
      : supplier?.shipFrom
        ? `Kargo çıkışı ${supplier.shipFrom}`
        : "Teslimat ölçülmedi";
  const deliverySub = costs.delivery
    ? costs.delivery.basis === "measured"
      ? `${p.sourcing?.shipping_method || costs.delivery.source} · ölçüldü`
      : `${costs.delivery.source}${
          supplier?.shipFrom ? ` · tedarikçi çıkışı ${supplier.shipFrom}` : ""
        }`
    : supplier?.shipFrom
      ? `Kargo çıkışı ${supplier.shipFrom}`
      : "Platform teslimat tarifesi yok";
  const bestMarkets = p.demand?.primary_markets?.length
    ? p.demand.primary_markets
    : p.real_economics?.context?.country_label
      ? [p.real_economics.context.country_label]
      : p.market_verdict?.country_name
        ? [p.market_verdict.country_name]
        : [];

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-[oklch(0.85_0.15_255)]">
        <span className="flex items-center gap-1.5">
          <Activity size={11} /> Derin analiz
        </span>
      </div>

      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5 space-y-2">
        {planIds.length > 0 ? (
          <ChecklistProgress total={planIds.length} completed={completed} />
        ) : (
          <p className="text-[10px] text-muted-foreground">
            Bu ürün için plan üretilemedi; ürün adı ve fiyatı olmadan model planı oluşturulmaz.
          </p>
        )}
        <ExportReport p={p} />
      </div>

      {p.consensus && (
        <Block
          icon={<ShieldCheck size={11} />}
          title={`Çift Gemini uzlaşısı — ${p.consensus.average_score}/100`}
          defaultOpen
        >
          <ConsensusPanel consensus={p.consensus} />
        </Block>
      )}

      {p.viral_proof && p.viral_proof.length > 0 && (
        <Block
          icon={<Flame size={11} />}
          title={`Viral kanıt (${p.viral_proof.length})`}
          defaultOpen
        >
          {p.viral_proof.map((v, i) => (
            <a
              key={i}
              href={v.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start justify-between gap-2 rounded border border-rose-500/30 bg-rose-500/[0.06] p-2 hover:bg-rose-500/[0.1] transition"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] rounded-full border border-rose-500/40 bg-rose-500/10 text-rose-300 px-1.5 py-0.5">
                    {v.platform}
                  </span>
                  <span className="font-semibold text-rose-300">{v.views}</span>
                  {v.hashtag && (
                    <span className="text-[10px] text-muted-foreground">{v.hashtag}</span>
                  )}
                </div>
                {v.note && <div className="text-muted-foreground mt-1">{v.note}</div>}
                <div className="text-[10px] text-muted-foreground truncate mt-0.5">{v.url}</div>
              </div>
              <ExternalLink size={12} className="shrink-0 text-muted-foreground mt-0.5" />
            </a>
          ))}
        </Block>
      )}

      <Block
        icon={<ShieldCheck size={11} />}
        title="Tek bakışta: ihtiyacın olan her şey"
        defaultOpen
      >
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/[0.06] p-2">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-emerald-300/90">
              <Factory size={10} /> Tedarik kaynağı
            </div>
            <div className="mt-1 font-semibold">{supplierName}</div>
            <div className="text-[10px] text-muted-foreground">{supplierSub}</div>
            {supplierBand && (
              <div className="mt-0.5 text-[10px] text-emerald-300/90">
                {supplierMatched ? "Toptan bandı" : "Niş bandı"}: {supplierBand}
              </div>
            )}
            {supplier?.url && supplierMatched && (
              <a
                href={supplier.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-[10px] text-emerald-300 hover:underline"
              >
                Teklifi aç <ExternalLink size={9} />
              </a>
            )}
            {(!supplierMatched || !supplier?.url) && supplierLinks.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {supplierLinks.slice(0, 2).map((link) => (
                  <a
                    key={link.label}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={link.note}
                    className="inline-flex items-center gap-0.5 rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] text-emerald-300/90 hover:bg-white/10"
                  >
                    {link.label} <ExternalLink size={8} />
                  </a>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-md border border-sky-500/30 bg-sky-500/[0.06] p-2">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-sky-300/90">
              <Truck size={10} /> Teslimat
            </div>
            <div className="mt-1 font-semibold">{deliveryMain}</div>
            <div className="text-[10px] text-muted-foreground">{deliverySub}</div>
          </div>
          <div className="rounded-md border border-violet-500/30 bg-violet-500/[0.06] p-2">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-violet-300/90">
              <Store size={10} /> En iyi kanal
            </div>
            <div className="mt-1 font-semibold">{channel ?? "Kanal seçilmedi"}</div>
            <div className="text-[10px] text-muted-foreground">
              {(p.platform_fit ?? []).slice(1).join(" · ") ||
                (channel ? "Ölçülen satış kaynağı" : "Hedef kanal bu aramada seçilmedi")}
            </div>
          </div>
          <div className="rounded-md border border-amber-500/30 bg-amber-500/[0.06] p-2">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-amber-300/90">
              <DollarSign size={10} /> Adet başı kâr
            </div>
            <div className="mt-1 font-semibold text-emerald-300">
              {netProfitUsd !== null
                ? `$${netProfitUsd.toFixed(2)}`
                : grossProfitUsd !== null
                  ? `$${grossProfitUsd.toFixed(2)}`
                  : "Tedarik fiyatı yok"}
            </div>
            {/* Ölçülmemiş marj "%0" DEĞİLDİR: net/brüt ayrımı açıkça yazılır.
                Net kâr hesabı modelle yapıldıysa "hesaplandı" denir; ölçüm
                gibi gösterilmez. */}
            <div className="text-[10px] text-muted-foreground">
              {netProfitUsd !== null
                ? `Net marj %${netMarginPct ?? 0}${netMeasured ? "" : " · hesaplandı"}`
                : grossProfitUsd !== null && grossMarginPct !== null
                  ? `Brüt marj %${grossMarginPct}`
                  : "Tedarik fiyatı ölçülmeden net kâr hesaplanmaz"}
            </div>
          </div>
          <div className="rounded-md border border-teal-500/30 bg-teal-500/[0.06] p-2 col-span-2">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-teal-300/90">
              <Globe2 size={10} /> En iyi pazarlar
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {bestMarkets.length === 0 ? (
                <span className="text-[10px] text-muted-foreground">
                  Hedef pazar bu aramada seçilmedi; ülke seçerek yeniden çalıştır.
                </span>
              ) : (
                bestMarkets.map((m, i) => (
                  <span
                    key={i}
                    className="text-[10px] rounded-full bg-white/5 border border-white/10 px-2 py-0.5 flex items-center gap-1"
                  >
                    <MapPin size={9} /> {m}
                  </span>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="mt-2 rounded-md border border-white/10 overflow-hidden">
          <div className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground bg-white/[0.03] border-b border-white/10">
            <Receipt size={10} /> Tüm maliyet dökümü (adet başına)
          </div>
          <table className="w-full text-[11px]">
            <tbody>
              <tr className="border-b border-white/5">
                <td className="px-2 py-1.5 text-muted-foreground flex items-center gap-1.5">
                  <Package size={10} /> Tedarik maliyeti
                </td>
                <td className="px-2 py-1.5 text-right font-medium">
                  <CostCell row={costs.supplier} />
                </td>
              </tr>
              <tr className="border-b border-white/5">
                <td className="px-2 py-1.5 text-muted-foreground flex items-center gap-1.5">
                  <Truck size={10} /> Kargo
                </td>
                <td className="px-2 py-1.5 text-right font-medium">
                  <CostCell row={costs.shipping} />
                </td>
              </tr>
              <tr className="border-b border-white/5">
                <td className="px-2 py-1.5 text-muted-foreground flex items-center gap-1.5">
                  <Store size={10} /> Platform komisyonu
                </td>
                <td className="px-2 py-1.5 text-right font-medium">
                  <CostCell row={costs.platformFee} />
                </td>
              </tr>
              <tr className="border-b border-white/5">
                <td className="px-2 py-1.5 text-muted-foreground flex items-center gap-1.5">
                  <Clapperboard size={10} /> Reklam gideri / CAC
                </td>
                <td className="px-2 py-1.5 text-right font-medium">
                  <CostCell row={costs.adSpend} />
                </td>
              </tr>
              <tr className="border-b border-white/5 bg-white/[0.02]">
                <td className="px-2 py-1.5 font-semibold flex items-center gap-1.5">
                  <Tags size={10} /> Satış fiyatı
                </td>
                <td className="px-2 py-1.5 text-right font-semibold">
                  {p.selling_price_usd || "Ölçülmedi"}
                </td>
              </tr>
              {grossProfitUsd !== null && (
                <tr className="border-b border-white/5">
                  <td className="px-2 py-1.5 font-semibold text-emerald-300 flex items-center gap-1.5">
                    <DollarSign size={10} /> Brüt kâr / adet
                  </td>
                  <td className="px-2 py-1.5 text-right font-semibold text-emerald-300">
                    ${grossProfitUsd.toFixed(2)}{" "}
                    <span className="text-[10px] font-normal opacity-80">
                      ({grossMarginPct !== null ? `%${grossMarginPct} brüt` : "kargo öncesi"})
                    </span>
                  </td>
                </tr>
              )}
              <tr className="bg-emerald-500/[0.06]">
                <td className="px-2 py-1.5 font-semibold text-emerald-300 flex items-center gap-1.5">
                  <DollarSign size={10} /> Net kâr / adet
                </td>
                <td className="px-2 py-1.5 text-right font-bold text-emerald-300">
                  {netProfitUsd !== null ? `$${netProfitUsd.toFixed(2)}` : "Tedarik eşleşmedi"}{" "}
                  <span className="text-[10px] font-normal opacity-80">
                    (
                    {netProfitUsd !== null
                      ? `net marj %${netMarginPct ?? 0}${netMeasured ? "" : " · hesaplandı"}`
                      : costs.netProfit.source}
                    )
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
          <div className="border-t border-white/5 px-2 py-1.5 text-[9px] leading-relaxed text-muted-foreground">
            Ölçülen kalemler “ölçüldü”, türetilen kalemler “hesaplandı” rozetiyle işaretlenir.
            Hesaplanan kargo/komisyon/CAC; ülke kargo benchmark’ı, platform komisyon tarifesi ve
            pazaryeri TACoS/CPC modeline dayanır; yayınlanmış tarifelerin ürün fiyatına uygulanmış
            hâlidir.
            {allCostsMeasured ? " Tüm kalemler doğrudan ürün kaynağından ölçüldü." : ""}
          </div>
        </div>

        {p.unit_economics && (
          <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
            <div className="rounded border border-white/10 bg-white/[0.03] p-1.5">
              <div className="text-[9px] uppercase text-muted-foreground">Başabaş</div>
              <div className="text-xs font-semibold">{p.unit_economics.breakeven_units} adet</div>
            </div>
            <div className="rounded border border-white/10 bg-white/[0.03] p-1.5">
              <div className="text-[9px] uppercase text-muted-foreground">Maks. CPA</div>
              <div className="text-xs font-semibold">{p.unit_economics.target_cpa_usd}</div>
            </div>
            <div className="rounded border border-white/10 bg-white/[0.03] p-1.5">
              <div className="text-[9px] uppercase text-muted-foreground">Yaşam boyu değer</div>
              <div className="text-xs font-semibold">{p.unit_economics.ltv_usd}</div>
            </div>
          </div>
        )}
      </Block>

      {(!p.supplier_shortlist || p.supplier_shortlist.length === 0) && supplierLinks.length > 0 && (
        <Block
          icon={<Factory size={11} />}
          title="Tedarikçi araştırması — canlı teklif yok"
          defaultOpen
        >
          <p className="text-muted-foreground leading-relaxed">
            Bu ürün için canlı toptan havuzda birebir teklif eşleşmedi. Aşağıdaki aramalarla fiyatı,
            MOQ'yu ve teslimatı kendin doğrula. Ölçülmeyen tedarik fiyatı 0 sayılmaz; net kâr ve
            marj bu yüzden hesaplanmaz.
          </p>
          <div className="space-y-1.5">
            {supplierLinks.map((link) => (
              <a
                key={link.label}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-2 rounded border border-white/10 bg-white/[0.03] px-2 py-1.5 transition hover:bg-white/[0.07]"
              >
                <span>
                  <span className="font-semibold">{link.label}</span>
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    {link.note} · fiyat, MOQ ve teslimatı doğrula
                  </span>
                </span>
                <ExternalLink size={11} className="shrink-0 text-muted-foreground" />
              </a>
            ))}
          </div>
          <div className="rounded border border-amber-500/20 bg-amber-500/[0.06] p-2 text-[10px] text-muted-foreground">
            <span className="font-semibold text-amber-200">Aramada kontrol et:</span> ürünün ayırt
            edici 3 kelimesi · birim fiyat · MOQ · numune maliyeti · teslimat aralığı. Bulduğun
            teklifi bu ürünle aynı model/ölçü olduğundan emin olduktan sonra maliyet hesabına al.
          </div>
        </Block>
      )}

      {p.demand && (
        <Block icon={<TrendingUp size={11} />} title="Talep & mevsimsellik" defaultOpen>
          <Row k="Arama talebi" v={p.demand.monthly_search_volume} />
          <Row
            k="Trend"
            v={
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full border ${
                  p.demand.trend_direction === "Rising"
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : p.demand.trend_direction === "Declining"
                      ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                      : "border-amber-500/40 bg-amber-500/10 text-amber-300"
                }`}
              >
                {tr(p.demand.trend_direction)}
              </span>
            }
          />
          {p.demand.peak_months?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {p.demand.peak_months.map((m, i) => (
                <span
                  key={i}
                  className="text-[10px] bg-white/5 border border-white/10 rounded px-1.5 py-0.5 flex items-center gap-1"
                >
                  <CalendarDays size={9} /> {m}
                </span>
              ))}
            </div>
          )}
          {p.demand.primary_markets?.length > 0 && (
            <Row k="Öne çıkan pazarlar" v={p.demand.primary_markets.join(", ")} />
          )}
          {p.demand.seasonality && (
            <p className="text-muted-foreground leading-relaxed">{p.demand.seasonality}</p>
          )}
        </Block>
      )}

      {p.unit_economics && (
        <Block icon={<BarChart3 size={11} />} title="Birim ekonomisi & başabaş">
          <ModelNote />
          <Row k="Başabaş adedi" v={`${p.unit_economics.breakeven_units} adet`} />
          <Row k="Başabaş ROAS" v={`${p.unit_economics.breakeven_roas}x`} />
          <Row k="Maksimum CPA" v={p.unit_economics.target_cpa_usd} />
          <Row k="Tahmini LTV (12 ay)" v={p.unit_economics.ltv_usd} />
          <Row k="Tekrar satın alma" v={`%${p.unit_economics.repeat_purchase_rate_pct}`} />
          <Row k="İade oranı" v={`%${p.unit_economics.return_rate_pct}`} />
        </Block>
      )}

      {p.sourcing && (
        <Block icon={<Boxes size={11} />} title="Tedarik & uyumluluk">
          <ModelNote />
          <Row k="Minimum sipariş (MOQ)" v={p.sourcing.moq} />
          <Row k="Tedarik süresi" v={trDuration(p.sourcing.lead_time_days)} />
          <Row k="Numune maliyeti" v={p.sourcing.sample_cost_usd} />
          <Row k="Gönderim yöntemi" v={p.sourcing.shipping_method} />
          {p.sourcing.quality_checkpoints?.length > 0 && (
            <div>
              <div className="text-muted-foreground mb-1 flex items-center gap-1">
                <ShieldCheck size={10} /> Kalite kontrol listesi
              </div>
              <ul className="space-y-1">
                {p.sourcing.quality_checkpoints.map((q, i) => (
                  <li key={i} className="text-muted-foreground">
                    • {q}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {p.sourcing.customs_notes && (
            <p className="text-amber-200/90 bg-amber-500/10 border border-amber-500/20 rounded p-2">
              {p.sourcing.customs_notes}
            </p>
          )}
        </Block>
      )}

      {p.personas && p.personas.length > 0 && (
        <Block icon={<Users size={11} />} title={`Alıcı personaları (${p.personas.length})`}>
          {p.personas.map((ps, i) => (
            <div key={i} className="rounded border border-white/10 bg-white/[0.03] p-2 space-y-1">
              <div className="font-semibold">
                {ps.name}{" "}
                <span className="text-muted-foreground font-normal">· {ps.age_range}</span>
              </div>
              <p className="text-muted-foreground">
                <span className="text-foreground/80">Sorun:</span> {ps.pain}
              </p>
              <p className="text-muted-foreground">
                <span className="text-foreground/80">Tetikleyici:</span> {ps.trigger}
              </p>
              <p className="text-muted-foreground">
                <span className="text-foreground/80">Nerede bulunur:</span> {ps.where_to_find}
              </p>
            </div>
          ))}
        </Block>
      )}

      {p.keyword_opportunities && p.keyword_opportunities.length > 0 && (
        <Block icon={<Search size={11} />} title="Anahtar kelime fırsatları">
          <ModelNote />
          {p.keyword_opportunities.map((k, i) => (
            <div
              key={i}
              className="flex items-start justify-between gap-2 border-b border-white/5 pb-1.5 last:border-0 last:pb-0"
            >
              <div className="min-w-0">
                <div className="font-medium truncate">{k.keyword}</div>
                <div className="text-[10px] text-muted-foreground">{k.intent}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[10px]">{k.monthly_volume}</div>
                <span
                  className={`text-[9px] px-1.5 py-0.5 rounded-full border ${sevCls(k.difficulty === "Low" ? "Low" : k.difficulty === "High" ? "High" : "Medium")}`}
                >
                  {tr(k.difficulty)} zorluk
                </span>
              </div>
            </div>
          ))}
        </Block>
      )}

      {p.differentiation && p.differentiation.length > 0 && (
        <Block icon={<Layers size={11} />} title="Nasıl farklılaşırsın">
          <ul className="space-y-1">
            {p.differentiation.map((d, i) => (
              <li key={i} className="text-muted-foreground">
                • {d}
              </li>
            ))}
          </ul>
        </Block>
      )}

      {p.review_pain_points && p.review_pain_points.length > 0 && (
        <Block icon={<Wrench size={11} />} title="Yorumlardaki şikâyetler → çözümler">
          {p.review_pain_points.map((r, i) => (
            <div key={i} className="rounded border border-white/10 bg-white/[0.03] p-2">
              <div className="text-rose-300/90">✗ {r.complaint}</div>
              <div className="text-emerald-300/90 mt-0.5">✓ {r.fix}</div>
            </div>
          ))}
        </Block>
      )}

      {p.bundles && p.bundles.length > 0 && (
        <Block icon={<Boxes size={11} />} title="Paketler & sepet artırıcılar">
          <ModelNote />
          {p.bundles.map((b, i) => (
            <div key={i} className="rounded border border-white/10 bg-white/[0.03] p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{b.name}</span>
                <span className="text-emerald-300 font-semibold">{b.price_usd}</span>
              </div>
              <div className="text-muted-foreground">{b.contents}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{b.why}</div>
            </div>
          ))}
        </Block>
      )}

      {p.risks && p.risks.length > 0 && (
        <Block icon={<AlertTriangle size={11} />} title="Riskler & önlemler">
          {p.risks.map((r, i) => (
            <div key={i} className="rounded border border-white/10 bg-white/[0.03] p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{r.risk}</span>
                <span
                  className={`text-[9px] px-1.5 py-0.5 rounded-full border shrink-0 ${sevCls(r.severity)}`}
                >
                  {tr(r.severity)}
                </span>
              </div>
              <div className="text-muted-foreground mt-0.5">→ {r.mitigation}</div>
            </div>
          ))}
        </Block>
      )}

      {p.launch_roadmap && p.launch_roadmap.length > 0 && (
        <Block
          icon={<Target size={11} />}
          title={`30 günlük lansman yol haritası (${p.launch_roadmap.length} faz)`}
        >
          <ModelNote />
          <div className="max-h-72 overflow-y-auto pr-1 space-y-2">
            {p.launch_roadmap.map((ph, i) => (
              <div key={i} className="relative pl-4 border-l border-white/10 pb-2 last:pb-0">
                <span className="absolute -left-[4px] top-1 h-2 w-2 rounded-full bg-[oklch(0.62_0.17_255)]" />
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{ph.phase}</span>
                  <span className="text-[10px] text-muted-foreground">{trDuration(ph.days)}</span>
                </div>
                <ul className="mt-1 space-y-0.5">
                  {(ph.actions ?? []).map((a, j) => (
                    <CheckItem
                      key={j}
                      id={`r${i}-${j}`}
                      label={a}
                      done={!!done[`r${i}-${j}`]}
                      onToggle={toggle}
                    />
                  ))}
                </ul>
                <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                  <span className="bg-white/5 border border-white/10 rounded px-1.5 py-0.5">
                    Bütçe: {ph.budget_usd}
                  </span>
                  <span className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 rounded px-1.5 py-0.5">
                    Hedef: {ph.kpi}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Block>
      )}

      {(p.scaling_playbook || (p.exit_criteria && p.exit_criteria.length > 0)) && (
        <Block icon={<Flag size={11} />} title="Ölçekleme & çıkış kriterleri">
          <ModelNote />
          {p.scaling_playbook && (
            <p className="text-muted-foreground leading-relaxed whitespace-pre-line">
              {p.scaling_playbook}
            </p>
          )}
          {p.exit_criteria && p.exit_criteria.length > 0 && (
            <ul className="space-y-1 pt-1">
              {p.exit_criteria.map((e, i) => (
                <li key={i} className="text-rose-300/90">
                  ⛔ {e}
                </li>
              ))}
            </ul>
          )}
        </Block>
      )}

      {p.market_saturation && (
        <Block icon={<Gauge size={11} />} title="Pazar doygunluğu" defaultOpen>
          <ModelNote />
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Doygunluk</span>
              <span className="font-semibold">{p.market_saturation.score}/100</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  p.market_saturation.score < 40
                    ? "bg-emerald-400"
                    : p.market_saturation.score < 70
                      ? "bg-amber-400"
                      : "bg-rose-400"
                }`}
                style={{ width: `${Math.min(100, Math.max(0, p.market_saturation.score))}%` }}
              />
            </div>
          </div>
          <Row k="Aktif satıcı" v={p.market_saturation.active_sellers} />
          <Row k="Reklam yoğunluğu" v={p.market_saturation.ad_activity} />
          <Row k="Giriş penceresi" v={trDuration(p.market_saturation.entry_window)} />
          <p className="text-muted-foreground leading-relaxed">{p.market_saturation.verdict}</p>
        </Block>
      )}

      {p.pricing_ladder && p.pricing_ladder.length > 0 && (
        <Block icon={<Tags size={11} />} title="Test edilecek fiyat basamakları">
          <ModelNote />
          {p.pricing_ladder.map((t, i) => (
            <div key={i} className="rounded border border-white/10 bg-white/[0.03] p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{t.tier}</span>
                <span className="text-emerald-300 font-semibold">{t.price_usd}</span>
              </div>
              <div className="text-muted-foreground">{t.positioning}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                Tahmini dönüşüm: %{t.expected_cvr_pct}
              </div>
            </div>
          ))}
        </Block>
      )}

      {p.ad_creatives && p.ad_creatives.length > 0 && (
        <Block
          icon={<Clapperboard size={11} />}
          title={`Reklam kreatif brifingleri (${p.ad_creatives.length})`}
        >
          {p.ad_creatives.map((c, i) => (
            <div key={i} className="rounded border border-white/10 bg-white/[0.03] p-2 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{c.platform}</span>
                <span className="text-[10px] bg-white/5 border border-white/10 rounded px-1.5 py-0.5">
                  {c.format}
                </span>
              </div>
              <div className="text-[oklch(0.85_0.15_255)]">“{c.hook}”</div>
              <ol className="space-y-0.5 list-decimal list-inside text-muted-foreground">
                {(c.script_beats ?? []).map((b, j) => (
                  <li key={j}>{b}</li>
                ))}
              </ol>
              <div className="text-emerald-300/90">Eylem çağrısı: {c.cta}</div>
            </div>
          ))}
        </Block>
      )}

      {p.supplier_shortlist && p.supplier_shortlist.length > 0 && (
        <Block icon={<Factory size={11} />} title="Tedarikçi kısa listesi">
          <ModelNote />
          {p.supplier_shortlist.map((s, i) => (
            <div key={i} className="rounded border border-white/10 bg-white/[0.03] p-2 space-y-0.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{s.name}</span>
                <span className="text-emerald-300 font-semibold">{s.unit_price_usd}</span>
              </div>
              <div className="text-[10px] text-muted-foreground">
                {s.region} · MOQ {s.moq} · {trDuration(s.lead_time)}
              </div>
              <div className="text-muted-foreground">{s.notes}</div>
            </div>
          ))}
        </Block>
      )}

      {p.financial_projection && p.financial_projection.length > 0 && (
        <Block icon={<LineChart size={11} />} title="90 günlük finansal projeksiyon" defaultOpen>
          <ModelNote />
          <p className="text-[9px] text-muted-foreground">
            {supplierMatched
              ? "Tedarik fiyatı ölçüldü; diğer maliyetler yayınlanmış tarifelerden hesaplandı."
              : "Tedarik fiyatı ölçülmediği için bu tablo model tedarik varsayımıyla hesaplandı; ölçülmüş kâr değildir."}{" "}
            Net kâr, CAC/reklam dahil birim kârdan hesaplanır; reklam sütunu plan bütçesidir.
          </p>
          <div className="max-h-56 overflow-y-auto pr-1">
            <div className="grid grid-cols-5 gap-1 text-[10px] text-muted-foreground border-b border-white/10 pb-1 sticky top-0 bg-[oklch(0.19_0.03_255)]">
              <span>Ay</span>
              <span className="text-right">Adet</span>
              <span className="text-right">Ciro</span>
              <span className="text-right">Reklam</span>
              <span className="text-right">Net</span>
            </div>
            {p.financial_projection.map((f, i) => (
              <div key={i} className="grid grid-cols-5 gap-1 text-[11px] py-0.5">
                <span className="font-medium">{trDuration(f.month)}</span>
                <span className="text-right tabular-nums">{f.units}</span>
                <span className="text-right tabular-nums">{f.revenue_usd}</span>
                <span className="text-right tabular-nums text-rose-300/90">{f.ad_spend_usd}</span>
                <span
                  className={`text-right tabular-nums ${
                    num(f.net_profit_usd) >= 0 ? "text-emerald-300" : "text-rose-300"
                  }`}
                >
                  {f.net_profit_usd}
                </span>
              </div>
            ))}
          </div>
          {(() => {
            const t = p.financial_projection!.reduce(
              (a, f) => ({
                units: a.units + (Number(f.units) || 0),
                rev: a.rev + num(f.revenue_usd),
                ad: a.ad + num(f.ad_spend_usd),
                net: a.net + num(f.net_profit_usd),
              }),
              { units: 0, rev: 0, ad: 0, net: 0 },
            );
            const m = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
            return (
              <div className="grid grid-cols-5 gap-1 text-[11px] font-semibold border-t border-white/15 mt-1 pt-1.5">
                <span className="text-[oklch(0.85_0.15_255)]">Toplam</span>
                <span className="text-right tabular-nums">{t.units}</span>
                <span className="text-right tabular-nums">{m(t.rev)}</span>
                <span className="text-right tabular-nums text-rose-300/90">{m(t.ad)}</span>
                <span
                  className={`text-right tabular-nums ${t.net >= 0 ? "text-emerald-300" : "text-rose-300"}`}
                >
                  {m(t.net)}
                </span>
              </div>
            );
          })()}
        </Block>
      )}

      {p.financial_projection && p.financial_projection.length > 0 && (
        <Block icon={<SlidersHorizontal size={11} />} title="Senaryo simülatörü & risk analizi">
          <ModelNote />
          <ScenarioSimulator p={p} />
        </Block>
      )}

      {p.content_calendar && p.content_calendar.length > 0 && (
        <Block
          icon={<CalendarDays size={11} />}
          title={`${p.content_calendar.length} haftalık içerik takvimi`}
        >
          <ModelNote />
          <div className="max-h-80 overflow-y-auto pr-1 space-y-2">
            {p.content_calendar.map((w, i) => (
              <div key={i} className="rounded border border-white/10 bg-white/[0.03] p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{trDuration(w.week)}</span>
                  <span className="text-[10px] text-muted-foreground">{w.theme}</span>
                </div>
                <ul className="mt-1 space-y-0.5">
                  {(w.posts ?? []).map((post, j) => (
                    <CheckItem
                      key={j}
                      id={`c${i}-${j}`}
                      label={post}
                      done={!!done[`c${i}-${j}`]}
                      onToggle={toggle}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Block>
      )}
    </div>
  );
}
