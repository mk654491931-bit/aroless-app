import { withProGate } from "@/components/pro-route-gate";
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Tags, ImagePlus, MessageSquareHeart, LineChart } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { HubShell } from "@/components/tools/hub-shell";
import { ToolCard, Field, callTool } from "@/components/tools/tool-card";

export const Route = createFileRoute("/tools/listing")({
  ssr: false,
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
  const [seo, setSeo] = useState({ product: "", keywords: "", channel: "Amazon US" });
  const [img, setImg] = useState({ product: "", audience: "", usp: "" });
  const [rev, setRev] = useState({ product: "", reviews: "" });
  const [price, setPrice] = useState({
    product: "",
    cost: "",
    competitors: "",
    channel: "Amazon US",
  });

  return (
    <HubShell
      emoji="📝"
      title="Listing & Conversion Studio"
      subtitle="Trafiği satışa çeviren katman: arama görünürlüğü, görsel hikâye, yorum sinyalleri ve fiyat konumlandırma."
    >
      <ToolCard
        icon={Tags}
        title="Listing SEO Optimizer"
        description="Başlık, bullet, arka plan anahtar kelimeleri ve açıklamayı kanala göre üretir."
        runLabel="Listing Üret"
        onRun={() => callTool("listing-seo", seo)}
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
        icon={ImagePlus}
        title="Görsel & A+ İçerik Brief"
        description="7 görsellik set + A+ modül planını, çekim talimatlarıyla birlikte hazırlar."
        runLabel="Brief Oluştur"
        onRun={() => callTool("listing-visual", img)}
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
        icon={MessageSquareHeart}
        title="Yorum Sentiment Radarı"
        description="Rakip yorumlarından dönüşüm engellerini ve kullanılacak sosyal kanıt cümlelerini çıkarır."
        runLabel="Yorumları Analiz Et"
        onRun={() => callTool("review-sentiment", rev)}
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
        icon={LineChart}
        title="Fiyat & Buy Box Stratejisi"
        description="Rakip fiyatlarına göre kâr koruyan fiyat bandı, kupon ve bundle stratejisi."
        runLabel="Fiyat Stratejisi Üret"
        onRun={() => callTool("price-strategy", price)}
      >
        <Field label="Ürün">
          <Input
            value={price.product}
            onChange={(e) => setPrice({ ...price, product: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
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
        </div>
        <Field label="Rakip fiyatları">
          <Textarea
            rows={3}
            value={price.competitors}
            onChange={(e) => setPrice({ ...price, competitors: e.target.value })}
            placeholder="24.99, 27.50, 19.99"
          />
        </Field>
      </ToolCard>
    </HubShell>
  );
}
