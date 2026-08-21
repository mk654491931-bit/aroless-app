import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Gavel, QrCode, Barcode, FlaskConical } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { HubShell } from "@/components/tools/hub-shell";
import { ToolCard, Field, callTool } from "@/components/tools/tool-card";

export const Route = createFileRoute("/tools/compliance")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Compliance & Legal Guard — Aroless" },
      { name: "description", content: "Hijacker cease & desist generator, return mitigation inserts, HS code & tariff radar and lab test budgeting for sellers." },
      { property: "og:title", content: "Compliance & Legal Guard — Aroless" },
      { property: "og:description", content: "Protect your listing, your customs file and your certification budget." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ComplianceHub,
});

const CATEGORIES = [
  { id: "electronics", label: "Elektronik (FCC, CE, RoHS)" },
  { id: "kids", label: "Çocuk & Oyuncak (CPC, CPSIA, EN71)" },
  { id: "beauty", label: "Kozmetik & Kişisel bakım (FDA, CPNP)" },
  { id: "food-contact", label: "Gıdayla temas (LFGB, FDA)" },
  { id: "battery", label: "Pil / Lityum (UN38.3, MSDS)" },
  { id: "textile", label: "Tekstil (REACH, OEKO-TEX)" },
];

function ComplianceHub() {
  const [cd, setCd] = useState({ asin: "", seller: "", brand: "", trademark: "" });
  const [ret, setRet] = useState({ product: "", reasons: "", lang: "EN" });
  const [hs, setHs] = useState({ product: "", country: "United States", origin: "China" });
  const [lab, setLab] = useState({ product: "", markets: "US, EU" });
  const [cats, setCats] = useState<string[]>(["electronics"]);

  const toggle = (id: string) =>
    setCats((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  return (
    <HubShell
      emoji="🛡️"
      title="Compliance & Legal Guard"
      subtitle="Listing hijacker'lardan gümrük kodlarına, iade azaltmadan zorunlu sertifikalara kadar yasal kalkanın."
    >
      <ToolCard
        icon={Gavel}
        title="Hijacker Cease & Desist"
        description="ASIN ve hijacker satıcı adından resmî ihtarname üretir."
        runLabel="İhtarname Oluştur"
        onRun={() => callTool("cease-desist", cd)}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="ASIN"><Input value={cd.asin} onChange={(e) => setCd({ ...cd, asin: e.target.value })} placeholder="B0XXXXXXXX" /></Field>
          <Field label="Hijacker satıcı adı"><Input value={cd.seller} onChange={(e) => setCd({ ...cd, seller: e.target.value })} placeholder="BestDeal Store" /></Field>
          <Field label="Marka"><Input value={cd.brand} onChange={(e) => setCd({ ...cd, brand: e.target.value })} /></Field>
          <Field label="Marka tescil no"><Input value={cd.trademark} onChange={(e) => setCd({ ...cd, trademark: e.target.value })} placeholder="USPTO 99XXXXXX" /></Field>
        </div>
      </ToolCard>

      <ToolCard
        icon={QrCode}
        title="Return Mitigation Card"
        description="Kutu içi QR kodlu kullanım kartı metni üreterek iadeleri düşürür."
        runLabel="Kart Metnini Üret"
        onRun={() => callTool("return-mitigation", ret)}
      >
        <Field label="Ürün"><Input value={ret.product} onChange={(e) => setRet({ ...ret, product: e.target.value })} placeholder="Akıllı priz" /></Field>
        <Field label="En sık iade nedenleri">
          <Textarea rows={4} value={ret.reasons} onChange={(e) => setRet({ ...ret, reasons: e.target.value })} placeholder="Wi-Fi eşleşmiyor, uygulama kurulumu karışık, kutuda kılavuz yok…" />
        </Field>
        <Field label="Kart dili"><Input value={ret.lang} onChange={(e) => setRet({ ...ret, lang: e.target.value })} /></Field>
      </ToolCard>

      <ToolCard
        icon={Barcode}
        title="HS Code & Tariff Radar"
        description="Doğru 6-10 haneli HS kodu, vergi oranı ve anti-damping uyarıları."
        runLabel="HS Kodunu Bul"
        onRun={() => callTool("hs-code", hs)}
      >
        <Field label="Ürün tanımı"><Input value={hs.product} onChange={(e) => setHs({ ...hs, product: e.target.value })} placeholder="Silikon mutfak spatula seti" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Hedef ülke"><Input value={hs.country} onChange={(e) => setHs({ ...hs, country: e.target.value })} /></Field>
          <Field label="Menşe"><Input value={hs.origin} onChange={(e) => setHs({ ...hs, origin: e.target.value })} /></Field>
        </div>
      </ToolCard>

      <ToolCard
        icon={FlaskConical}
        title="Lab Test Budgeter"
        description="Kategori seç; zorunlu CPC/CE/FDA testlerinin maliyetini tahmin eder."
        runLabel="Test Bütçesini Hesapla"
        onRun={() => callTool("lab-budget", { ...lab, categories: cats.join(", ") })}
        disabled={cats.length === 0}
      >
        <Field label="Ürün"><Input value={lab.product} onChange={(e) => setLab({ ...lab, product: e.target.value })} placeholder="Bluetooth çocuk kulaklığı" /></Field>
        <Field label="Hedef pazarlar"><Input value={lab.markets} onChange={(e) => setLab({ ...lab, markets: e.target.value })} /></Field>
        <div className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-3">
          {CATEGORIES.map((c) => (
            <label key={c.id} className="flex items-center gap-2.5 text-xs">
              <Checkbox checked={cats.includes(c.id)} onCheckedChange={() => toggle(c.id)} />
              {c.label}
            </label>
          ))}
        </div>
      </ToolCard>
    </HubShell>
  );
}
