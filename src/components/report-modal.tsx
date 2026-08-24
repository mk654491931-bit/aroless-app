import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  X,
  Download,
  Copy,
  Share2,
  Target,
  TrendingUp,
  DollarSign,
  Megaphone,
  Sparkles,
  ShieldAlert,
} from "lucide-react";
import type { WinningProduct } from "@/lib/gemini.functions";
import { enrichProduct, recommendationStyle, formatCurrency } from "@/lib/recommendation";
import jsPDF from "jspdf";

export function ReportModal({
  product,
  onClose,
}: {
  product: WinningProduct | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const enriched = useMemo(() => (product ? enrichProduct(product) : null), [product]);

  if (!product || !enriched) return null;
  const rec = recommendationStyle(enriched.recommendation);

  const buildText = () => {
    return [
      `${product.name}`,
      "",
      `${t("report.executive_summary")}:`,
      product.why_winning,
      "",
      `${t("report.target_audience")}:`,
      product.target_audience,
      "",
      `${t("report.market_demand")}:`,
      ...(product.ad_angles || []).map((a) => `• ${a}`),
      "",
      `${t("report.profitability")}:`,
      `Supplier: ${product.supplier_price_usd}  |  Sell: ${product.selling_price_usd}  |  Margin: ${product.profit_margin_pct}%`,
      `Est. Monthly Revenue: ${formatCurrency(enriched.est_monthly_revenue_usd)}  |  Net Profit: ${formatCurrency(enriched.est_monthly_net_profit_usd)}`,
      `Competition: ${product.competition_level}   |   Recommendation: ${enriched.recommendation}`,
      "",
      `${t("report.marketing")}:`,
      product.platform_strategy,
      "",
      `${t("report.hooks")}:`,
      ...(product.ad_angles || []).map((a, i) => `${i + 1}. ${a}`),
    ].join("\n");
  };

  const onCopy = async () => {
    await navigator.clipboard.writeText(buildText());
    toast.success("Copied");
  };

  const onShare = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: product.name, text: buildText().slice(0, 400) });
      } else {
        await navigator.clipboard.writeText(buildText());
        toast.success("Copied to clipboard");
      }
    } catch {
      /* user cancelled */
    }
  };

  const onPdf = () => {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const margin = 40;
    let y = margin;
    const width = doc.internal.pageSize.getWidth() - margin * 2;
    const line = (text: string, size = 11, bold = false) => {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(size);
      const lines = doc.splitTextToSize(text, width);
      for (const l of lines) {
        if (y > doc.internal.pageSize.getHeight() - margin) {
          doc.addPage();
          y = margin;
        }
        doc.text(l, margin, y);
        y += size + 4;
      }
    };
    line(product.name, 20, true);
    line(`Recommendation: ${enriched.recommendation}  |  AI Score: ${enriched.ai_score}/100`, 11);
    y += 8;
    line(t("report.executive_summary"), 14, true);
    line(product.why_winning);
    y += 6;
    line(t("report.target_audience"), 14, true);
    line(product.target_audience);
    y += 6;
    line(t("report.market_demand"), 14, true);
    for (const a of product.ad_angles || []) line(`• ${a}`);
    y += 6;
    line(t("report.profitability"), 14, true);
    line(
      `Supplier: ${product.supplier_price_usd}   Sell: ${product.selling_price_usd}   Margin: ${product.profit_margin_pct}%`,
    );
    line(`Est. Monthly Sales: ${enriched.est_monthly_sales.toLocaleString()}`);
    line(`Est. Monthly Revenue: ${formatCurrency(enriched.est_monthly_revenue_usd)}`);
    line(`Est. Monthly Net Profit: ${formatCurrency(enriched.est_monthly_net_profit_usd)}`);
    line(`Competition: ${product.competition_level}`);
    y += 6;
    line(t("report.marketing"), 14, true);
    line(product.platform_strategy);
    y += 6;
    line(t("report.hooks"), 14, true);
    (product.ad_angles || []).forEach((a, i) => line(`${i + 1}. ${a}`));
    doc.save(`${product.name.replace(/[^\w-]+/g, "_")}.pdf`);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="glass rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6 md:p-8 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 end-4 p-1.5 rounded-lg hover:bg-white/10"
          aria-label={t("close")}
        >
          <X size={18} />
        </button>
        <div className="flex items-start gap-3 pe-8">
          <div className="text-4xl">{product.emoji || "🛍️"}</div>
          <div className="flex-1">
            <h2 className="text-xl md:text-2xl font-bold">{product.name}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`text-xs px-2.5 py-1 rounded-full border font-semibold ${rec.cls}`}>
                {rec.emoji} {enriched.recommendation}
              </span>
              <span className="text-xs px-2.5 py-1 rounded-full border border-white/10 bg-white/5">
                AI {enriched.ai_score}/100
              </span>
              <span className="text-xs px-2.5 py-1 rounded-full border border-white/10 bg-white/5">
                Trend {enriched.trend_score}
              </span>
              <span className="text-xs px-2.5 py-1 rounded-full border border-white/10 bg-white/5">
                Confidence {enriched.confidence_score}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-5">
          <Section icon={Sparkles} title={t("report.executive_summary")}>
            {product.why_winning}
          </Section>
          <Section icon={Target} title={t("report.target_audience")}>
            {product.target_audience}
          </Section>
          <Section icon={TrendingUp} title={t("report.market_demand")}>
            <ul className="space-y-1.5 list-disc list-inside marker:text-[oklch(0.75_0.18_265)]">
              {(product.ad_angles || []).map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </Section>
          <Section icon={DollarSign} title={t("report.profitability")}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
              <Stat
                label={t("est_monthly_sales")}
                value={enriched.est_monthly_sales.toLocaleString()}
              />
              <Stat
                label={t("est_revenue")}
                value={formatCurrency(enriched.est_monthly_revenue_usd)}
              />
              <Stat
                label={t("net_profit")}
                value={formatCurrency(enriched.est_monthly_net_profit_usd)}
              />
              <Stat label={t("competition")} value={product.competition_level} />
            </div>
          </Section>
          <Section icon={Megaphone} title={t("report.marketing")}>
            {product.platform_strategy}
          </Section>
          <Section icon={ShieldAlert} title={t("report.hooks")}>
            <ol className="space-y-1.5 list-decimal list-inside marker:text-[oklch(0.75_0.18_265)]">
              {(product.ad_angles || []).map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ol>
          </Section>
        </div>

        <div className="mt-6 flex flex-wrap gap-2 sticky bottom-0 -mx-6 md:-mx-8 px-6 md:px-8 pt-4 pb-1 border-t border-white/10 bg-gradient-to-t from-[oklch(0.17_0.03_265)] to-transparent">
          <button
            onClick={onPdf}
            className="rounded-lg bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] px-4 py-2 text-sm font-semibold text-white glow flex items-center gap-2"
          >
            <Download size={14} /> {t("export_pdf")}
          </button>
          <button
            onClick={onCopy}
            className="rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 px-4 py-2 text-sm flex items-center gap-2"
          >
            <Copy size={14} /> {t("copy")}
          </button>
          <button
            onClick={onShare}
            className="rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 px-4 py-2 text-sm flex items-center gap-2"
          >
            <Share2 size={14} /> {t("share")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="font-semibold mb-2 flex items-center gap-2 text-sm uppercase tracking-wider text-muted-foreground">
        <Icon size={14} className="text-[oklch(0.75_0.18_265)]" /> {title}
      </h3>
      <div className="text-sm leading-relaxed">{children}</div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/5 border border-white/10 p-2.5">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold mt-0.5">{value}</div>
    </div>
  );
}
