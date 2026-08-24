import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Handshake, FileSearch, ShieldQuestion, ClipboardList } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { HubShell } from "@/components/tools/hub-shell";
import { ToolCard, Field, callTool } from "@/components/tools/tool-card";

export const Route = createFileRoute("/tools/sourcing")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sourcing & Factory Hub — Aroless" },
      {
        name: "description",
        content:
          "AI supplier negotiator, offer analyzer, legitimacy detector and review-to-spec-sheet tools for cross-border sourcing.",
      },
      { property: "og:title", content: "Sourcing & Factory Hub — Aroless" },
      {
        property: "og:description",
        content: "Negotiate, verify and spec your factory orders with AI.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SourcingHub,
});

function SourcingHub() {
  const [neg, setNeg] = useState({ product: "", targetPrice: "", moq: "", notes: "" });
  const [offer, setOffer] = useState("");
  const [legit, setLegit] = useState({ url: "", notes: "" });
  const [spec, setSpec] = useState({ product: "", reviews: "" });

  return (
    <HubShell
      emoji="📦"
      title="Sourcing & Factory Hub"
      subtitle="Fabrika pazarlığından tedarikçi doğrulamaya kadar tüm sourcing sürecini AI ile yönet."
    >
      <ToolCard
        icon={Handshake}
        title="AI Supplier Negotiator"
        description="Hedef fiyat ve MOQ'ya göre İngilizce + Çince pazarlık mesajı üretir."
        runLabel="Generate Pitch (EN/CN)"
        onRun={() => callTool("supplier-negotiator", neg)}
      >
        <Field label="Ürün">
          <Input
            value={neg.product}
            onChange={(e) => setNeg({ ...neg, product: e.target.value })}
            placeholder="Katlanabilir silikon su şişesi"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Hedef birim fiyat ($)">
            <Input
              type="number"
              value={neg.targetPrice}
              onChange={(e) => setNeg({ ...neg, targetPrice: e.target.value })}
              placeholder="2.40"
            />
          </Field>
          <Field label="Hedef MOQ">
            <Input
              type="number"
              value={neg.moq}
              onChange={(e) => setNeg({ ...neg, moq: e.target.value })}
              placeholder="500"
            />
          </Field>
        </div>
        <Field label="Tedarikçi notları / mevcut teklif">
          <Textarea
            rows={3}
            value={neg.notes}
            onChange={(e) => setNeg({ ...neg, notes: e.target.value })}
            placeholder="Şu an $3.10 / MOQ 1000 veriyor, kalıp ücreti $450 istiyor…"
          />
        </Field>
      </ToolCard>

      <ToolCard
        icon={FileSearch}
        title="Supplier Offer Analyzer"
        description="Tedarikçi e-postasını yapıştır; gizli navlun kalemleri ve Incoterm risklerini çıkarır."
        runLabel="Teklifi Denetle"
        onRun={() => callTool("offer-analyzer", { offer })}
      >
        <Field label="Tedarikçi e-postası / teklif metni">
          <Textarea
            rows={8}
            value={offer}
            onChange={(e) => setOffer(e.target.value)}
            placeholder="Dear friend, our best price is USD 3.10/pc EXW, MOQ 1000pcs, mold cost 450USD, lead time 25-30 days…"
          />
        </Field>
      </ToolCard>

      <ToolCard
        icon={ShieldQuestion}
        title="Supplier Legitimacy Detector"
        description="Alibaba/1688 profil linkini analiz eder: gerçek fabrika mı, ticaret firması mı?"
        runLabel="Tedarikçiyi Doğrula"
        onRun={() => callTool("legitimacy-detector", legit)}
      >
        <Field label="Alibaba / 1688 profil URL veya firma adı">
          <Input
            value={legit.url}
            onChange={(e) => setLegit({ ...legit, url: e.target.value })}
            placeholder="https://xxx.en.alibaba.com"
          />
        </Field>
        <Field label="Ek gözlemler">
          <Textarea
            rows={3}
            value={legit.notes}
            onChange={(e) => setLegit({ ...legit, notes: e.target.value })}
            placeholder="12 farklı kategoride 4000 ürün listelemiş, 2 yıllık Gold Supplier…"
          />
        </Field>
      </ToolCard>

      <ToolCard
        icon={ClipboardList}
        title="Negative Review ➔ Spec Sheet"
        description="Rakibin 1 yıldızlı yorumlarını fabrikaya gönderilecek üretim şartnamesine çevirir."
        runLabel="Spec Sheet Üret"
        onRun={() => callTool("review-spec-sheet", spec)}
      >
        <Field label="Ürün">
          <Input
            value={spec.product}
            onChange={(e) => setSpec({ ...spec, product: e.target.value })}
            placeholder="Taşınabilir blender"
          />
        </Field>
        <Field label="1 yıldızlı rakip yorumları (yapıştır)">
          <Textarea
            rows={7}
            value={spec.reviews}
            onChange={(e) => setSpec({ ...spec, reviews: e.target.value })}
            placeholder="Motor 3 kullanımda yandı… Kapak sızdırıyor… Şarj kablosu gevşek…"
          />
        </Field>
      </ToolCard>
    </HubShell>
  );
}
