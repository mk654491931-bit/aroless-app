import { withProGate } from "@/components/pro-route-gate";
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Tags, ImagePlus, MessageSquareHeart, LineChart } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { HubShell } from "@/components/tools/hub-shell";
import { ToolCard, Field, callTool } from "@/components/tools/tool-card";
import { firstValidationError, requirePositive, requireText } from "@/lib/tool-validation";
import { formatUsd, priceStrategyPlan } from "@/lib/tool-calculators";

const SECTIONS = [
  { id: "listing-seo", label: "SEO Listing" },
  { id: "listing-visual", label: "Görsel & A+" },
  { id: "review-sentiment", label: "Yorum Sentiment" },
  { id: "price-strategy", label: "Fiyat & Buy Box" },
] as const;

export const Route = createFileRoute("/tools/listing")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => {
    const product = typeof s["product"] === "string" ? s["product"].trim().slice(0, 120) : "";
    return product ? { product } : {};
  },
  head: () => ({
    meta: [
      { title: "Listing & Conversion Studio — Aroless" },
      {
        name: "description",
        content:
          "Listing SEO optimizer, görsel/A+ brief üretici, yorum sentiment radarı ve fiyat-Buy Box stratejisi ile dönüşüm oranını yükselt.",
      },
      { property: "og:title", content: "Listing & Conversion Studio — Aroless" },
      {
        property: "og:description",
        content: "Başlık, bullet, görsel brief ve fiyat stratejisiyle listing dönüşümünü artır.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: withProGate(ListingHub),
});

function ListingHub() {
  const search = Route.useSearch();
  const [seo, setSeo] = useState({
    product: search.product ?? "",
    keywords: "",
    channel: "Amazon US",
  });
  const [img, setImg] = useState({ product: search.product ?? "", audience: "", usp: "" });
  const [rev, setRev] = useState({ product: search.product ?? "", reviews: "" });
  const [price, setPrice] = useState({
    product: search.product ?? "",
    cost: "",
    competitors: "",
    channel: "Amazon US",
    targetMargin: "20",
  });
  const pricePlan = priceStrategyPlan({
    cost: price.cost,
    competitors: price.competitors,
    channel: price.channel,
    targetMarginPct: price.targetMargin,
  });

  return (
    <HubShell
      emoji="📝"
      title="Listing & Conversion Studio"
      subtitle="Trafiği satışa çeviren katman: arama görünürlüğü, görsel hikâye, yorum sinyalleri ve fiyat konumlandırma."
      sections={SECTIONS}
    >
      <ToolCard
        id="listing-seo"
        icon={Tags}
        title="Listing SEO Optimizer"
        description="Başlık, bullet, arka plan anahtar kelimeleri ve açıklamayı kanala göre üretir."
        runLabel="Listing Üret"
        inputs={seo}
        onRun={() => callTool("listing-seo", seo)}
        validate={() =>
          firstValidationError(
            requireText(seo.product, "Ürün", 2),
            requireText(seo.keywords, "Hedef anahtar kelimeler", 3),
          )
        }
      >
        <Field label="Ürün">
          <Input
            value={seo.product}
            onChange={(e) => setSeo({ ...seo, product: e.target.value })}
            placeholder="Katlanabilir laptop standı"
          />
        </Field>
        <Field label="Hedef anahtar kelimeler">
          <Textarea
            rows={3}
            value={seo.keywords}
            onChange={(e) => setSeo({ ...seo, keywords: e.target.value })}
            placeholder="laptop stand, aluminum, ergonomic…"
          />
        </Field>
        <Field label="Kanal">
          <Input
            value={seo.channel}
            onChange={(e) => setSeo({ ...seo, channel: e.target.value })}
          />
        </Field>
      </ToolCard>

      <ToolCard
        id="listing-visual"
        icon={ImagePlus}
        title="Görsel & A+ İçerik Brief"
        description="7 görsellik set + A+ modül planını, çekim talimatlarıyla birlikte hazırlar."
        runLabel="Brief Oluştur"
        inputs={img}
        onRun={() => callTool("listing-visual", img)}
        validate={() =>
          firstValidationError(
            requireText(img.product, "Ürün", 2),
            requireText(img.usp, "Öne çıkan fayda (USP)", 5),
          )
        }
      >
        <Field label="Ürün">
          <Input
            value={img.product}
            onChange={(e) => setImg({ ...img, product: e.target.value })}
          />
        </Field>
        <Field label="Hedef kitle">
          <Input
            value={img.audience}
            onChange={(e) => setImg({ ...img, audience: e.target.value })}
            placeholder="Uzaktan çalışan 25-40 yaş"
          />
        </Field>
        <Field label="Öne çıkan fayda (USP)">
          <Textarea
            rows={3}
            value={img.usp}
            onChange={(e) => setImg({ ...img, usp: e.target.value })}
            placeholder="6 kademeli açı, 8 kg taşıma, 320 gr"
          />
        </Field>
      </ToolCard>

      <ToolCard
        id="review-sentiment"
        icon={MessageSquareHeart}
        title="Yorum Sentiment Radarı"
        description="Rakip yorumlarından dönüşüm engellerini ve kullanılacak sosyal kanıt cümlelerini çıkarır."
        runLabel="Yorumları Analiz Et"
        inputs={rev}
        onRun={() => callTool("review-sentiment", rev)}
        validate={() =>
          firstValidationError(
            requireText(rev.product, "Ürün", 2),
            requireText(rev.reviews, "Yorumlar", 30),
          )
        }
      >
        <Field label="Ürün">
          <Input
            value={rev.product}
            onChange={(e) => setRev({ ...rev, product: e.target.value })}
          />
        </Field>
        <Field label="Yorumlar">
          <Textarea
            rows={6}
            value={rev.reviews}
            onChange={(e) => setRev({ ...rev, reviews: e.target.value })}
            placeholder="Yorum metinlerini yapıştır…"
          />
        </Field>
      </ToolCard>

      <ToolCard
        id="price-strategy"
        icon={LineChart}
        title="Fiyat & Buy Box Stratejisi"
        description="Rakip fiyatlarına göre kâr koruyan fiyat bandı, kupon ve bundle stratejisi."
        runLabel="Fiyat Stratejisi Üret"
        inputs={price}
        onRun={() => callTool("price-strategy", price)}
        validate={() =>
          firstValidationError(
            requireText(price.product, "Ürün", 2),
            requirePositive(price.cost, "Landed cost"),
          )
        }
      >
        <Field label="Ürün">
          <Input
            value={price.product}
            onChange={(e) => setPrice({ ...price, product: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Landed cost ($)">
            <Input
              value={price.cost}
              onChange={(e) => setPrice({ ...price, cost: e.target.value })}
              placeholder="7.4"
            />
          </Field>
          <Field label="Kanal">
            <Input
              value={price.channel}
              onChange={(e) => setPrice({ ...price, channel: e.target.value })}
            />
          </Field>
          <Field label="Hedef net marj (%)">
            <Input
              type="number"
              value={price.targetMargin}
              onChange={(e) => setPrice({ ...price, targetMargin: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Rakip fiyatları">
          <Textarea
            rows={3}
            value={price.competitors}
            onChange={(e) => setPrice({ ...price, competitors: e.target.value })}
            placeholder="24.99, 27.50, 19.99"
          />
        </Field>

        <div className="rounded-lg border border-white/10 bg-black/20 p-2.5">
          <div className="mb-2 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            <span>Anlık fiyat bandı</span>
            <span className="rounded border border-[var(--accent-active)]/25 px-1.5 py-0.5 text-[9px] text-[var(--accent-active)]">
              {pricePlan.profile.label} · model
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Başabaş", value: formatUsd(pricePlan.breakEvenPrice), tone: "warning" },
              { label: "Taban", value: formatUsd(pricePlan.floorPrice), tone: "action" },
              { label: "Önerilen", value: formatUsd(pricePlan.suggestedPrice), tone: "profit" },
              {
                label: "Önerilen marj",
                value:
                  pricePlan.marginAtSuggested === null ? "—" : `%${pricePlan.marginAtSuggested}`,
                tone: "neutral",
              },
            ].map((item) => (
              <div
                key={item.label}
                className={`rounded-lg border p-2 ${
                  item.tone === "profit"
                    ? "border-[var(--profit)]/25 bg-[var(--profit)]/10 text-[var(--profit)]"
                    : item.tone === "warning"
                      ? "border-[var(--warning)]/25 bg-[var(--warning)]/10 text-[var(--warning)]"
                      : item.tone === "action"
                        ? "border-[var(--accent-active)]/25 bg-[var(--accent-active)]/10 text-[var(--accent-active)]"
                        : "border-white/10 bg-white/5"
                }`}
              >
                <div className="text-[9px] uppercase tracking-wider opacity-70">{item.label}</div>
                <div className="mt-0.5 font-mono text-sm font-bold">{item.value}</div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground/70">
            {pricePlan.competitor
              ? `${pricePlan.competitor.count} rakip · min ${formatUsd(pricePlan.competitor.min)} / medyan ${formatUsd(pricePlan.competitor.median)} / max ${formatUsd(pricePlan.competitor.max)} · konum: ${pricePlan.positioning}.`
              : "Rakip fiyatı girildiğinde pazar medyanı ve konumlandırma da hesaplanır."}{" "}
            {pricePlan.feasible
              ? `Hedef %${pricePlan.targetMarginPct} marj için taban fiyat ${formatUsd(pricePlan.floorPrice)}.`
              : "Bu maliyetle hedef marj ulaşılabilir değil; maliyeti veya hedefi değiştir."}
          </p>
        </div>
      </ToolCard>
    </HubShell>
  );
}
