import { useState } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Tier = {
  id: "free" | "pro";
  name: string;
  price: string;
  tagline: string;
  features: string[];
  highlight?: boolean;
};

const TIERS: Tier[] = [
  {
    id: "free",
    name: "FREE",
    price: "$0",
    tagline: "14 Ajanlı Temel Analiz",
    features: [
      "14 ajanlı ürün bulucu (temel mod)",
      "Tier 1-3 hızlı motorlar (Cerebras / Gemini / Groq)",
      "Günlük sınırlı çalıştırma",
      "Standart rapor çıktısı",
    ],
  },
  {
    id: "pro",
    name: "PRO",
    price: "$59",
    tagline: "Sınırsız Bedrock Sentezi",
    highlight: true,
    features: [
      "Tier 4 Bedrock Claude sentez motoru",
      "Sınırsız 14 ajan çalıştırma",
      "Öncelikli sağlayıcı sırası, düşük gecikme",
      "Genişletilmiş yönetici raporu ve dışa aktarım",
    ],
  },
];

/** Minimalist FREE / PRO fiyatlandırma kartları. */
export function PricingCard({ className }: { className?: string }) {
  const [loading, setLoading] = useState(false);

  async function upgrade() {
    setLoading(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        toast.error("Yükseltmek için önce giriş yapın.");
        return;
      }
      const resp = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan: "Pro" }),
      });
      const json = (await resp.json()) as { url?: string; error?: string };
      if (!resp.ok || !json.url) throw new Error(json.error || "Ödeme bağlantısı alınamadı.");
      // Paddle S2S checkout redirect
      window.location.href = json.url;
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={cn("grid gap-5 sm:grid-cols-2", className)}>
      {TIERS.map((tier) => (
        <div
          key={tier.id}
          className={cn(
            "relative flex flex-col rounded-2xl border border-border/60 bg-card/60 p-6 backdrop-blur transition-colors",
            tier.highlight && "border-primary/60 bg-card/80 shadow-lg shadow-primary/10",
          )}
        >
          {tier.highlight && (
            <span className="absolute -top-3 left-6 inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground">
              <Sparkles className="size-3" /> Önerilen
            </span>
          )}
          <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {tier.name}
          </h3>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-4xl font-bold tracking-tight">{tier.price}</span>
            <span className="text-sm text-muted-foreground">/ay</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{tier.tagline}</p>

          <ul className="mt-5 flex-1 space-y-2.5 text-sm">
            {tier.features.map((f) => (
              <li key={f} className="flex gap-2">
                <Check
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    tier.highlight ? "text-primary" : "text-muted-foreground",
                  )}
                />
                <span>{f}</span>
              </li>
            ))}
          </ul>

          {tier.id === "pro" ? (
            <Button className="mt-6 w-full" onClick={upgrade} disabled={loading}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : "PRO'ya yükselt"}
            </Button>
          ) : (
            <Button variant="outline" className="mt-6 w-full" disabled>
              Mevcut plan
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

export default PricingCard;
