import { useState } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { apiFetch } from "@/lib/api-client";
import { getMyPromoCode } from "@/lib/promo.functions";
import { openPaddleOverlay, openPaddlePlanCheckout } from "@/lib/paddle-checkout";
import { isCheckoutCompleted } from "@/lib/subscription-confirmation";
import { PLAN_BY_ID } from "@/lib/plans";
import { LEGAL_VERSION } from "@/lib/legal-content";
import { hasMarketingConsent } from "@/lib/cookie-consent";
import { trackMetaEvent } from "@/lib/meta-pixel";
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
  // Ödeme öncesi mesafeli satış onayları — modal ile aynı kural.
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [immediateAccepted, setImmediateAccepted] = useState(false);
  const legalReady = legalAccepted && immediateAccepted;
  const qc = useQueryClient();
  const promoFn = useServerFn(getMyPromoCode);

  /**
   * Ödeme bitti olayı — indirim durumundan BAĞIMSIZ.
   *
   * Ölçülen hata: bu bileşen `openPaddleOverlay`'a `onEvent` VERMİYORDU.
   * Paddle.js örnek önbelleklemesi sayesinde daha önce `onEvent`'li bir
   * checkout açılmışsa bu yol çalışıyor gibi görünüyor, ama ilk açılış bu
   * ise hiçbir olay dinleyicisi kurulmuyor ve “Ödeme başarılı” mesajı hiç
   * görünmüyordu. İndirimli alışverişte kullanıcının bildirdiği “abonelik
   * başlaması tetiklenmiyor” belirtisinin bir kaynağı da buydu.
   */
  const onCheckoutEvent = (event: unknown) => {
    if (!isCheckoutCompleted(event)) return;
    void qc.invalidateQueries({ queryKey: ["profile"] });
    toast.success("Ödeme alındı — aboneliğin aktifleşmesini doğruluyoruz…", {
      description: "Paket, ödeme kaydı tamamlandığında otomatik yükselir.",
    });
    // BURADA `Purchase` GÖNDERİLMEZ. `checkout.completed` Paddle'ın başarılı
    // checkout olayıdır ama yetki/ödeme kaydı webhook ile doğrulanmadan Meta'ya
    // ciro yazmak, gecikmeli tahsilatta yanlış dönüşüm üretir. Sunucu CAPI
    // `transaction.completed` + veritabanı yazımı sonrasında tek kez gönderir.
  };

  async function upgrade() {
    if (!legalReady) {
      toast.error("Devam etmek için mesafeli satış onaylarını işaretleyin.");
      return;
    }
    setLoading(true);
    let opened = false;

    // Hesaba bağlı kod (varsa) ödeme ekranına ön-doldurulur. Oturum yoksa
    // (landing sayfası) okuma hata verir ve yok sayılır — ödeme yine açılır.
    const promo = await promoFn().catch(() => null);

    try {
      const resp = await apiFetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: "Pro",
          marketingConsent: hasMarketingConsent(),
          legalAccepted: true,
          immediatePerformanceAccepted: true,
        }),
      });
      const json = (await resp.json()) as {
        transactionId?: string;
        clientToken?: string;
        environment?: "sandbox" | "production";
        priceId?: string | null;
        email?: string | null;
        error?: string;
      };
      if (resp.ok && json.transactionId) {
        opened = await openPaddleOverlay(
          {
            transactionId: json.transactionId,
            clientToken: json.clientToken,
            environment: json.environment,
            priceId: json.priceId,
            email: json.email ?? null,
          },
          {
            plan: "Pro",
            promo,
            onEvent: onCheckoutEvent,
            legal: {
              version: LEGAL_VERSION,
              acceptedAt: new Date().toISOString(),
              withdrawalWaived: true,
            },
          },
        );
      }
    } catch (error) {
      console.warn("[Paddle] Server checkout unavailable; using Vite price checkout.", error);
    }

    if (!opened) {
      opened = await openPaddlePlanCheckout("Pro", {
        promo,
        onEvent: onCheckoutEvent,
        legal: {
          version: LEGAL_VERSION,
          acceptedAt: new Date().toISOString(),
          withdrawalWaived: true,
        },
      });
    }
    if (opened) {
      trackMetaEvent("InitiateCheckout", {
        content_name: "Pro",
        content_type: "product",
        value: PLAN_BY_ID.Pro.usd,
        currency: "USD",
      });
    } else {
      toast.error("Ödeme penceresi açılamadı. Lütfen tekrar deneyin.");
    }
    setLoading(false);
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

          {tier.id === "pro" && (
            <div className="mt-4 space-y-2 rounded-xl border border-border/60 bg-card/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={legalAccepted}
                  onChange={(event) => setLegalAccepted(event.target.checked)}
                  className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
                />
                <span>
                  <a
                    href="/legal/on-bilgilendirme-formu"
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-foreground underline underline-offset-2"
                  >
                    Ön Bilgilendirme Formu
                  </a>{" "}
                  ve{" "}
                  <a
                    href="/legal/mesafeli-satis-sozlesmesi"
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-foreground underline underline-offset-2"
                  >
                    Mesafeli Satış Sözleşmesi
                  </a>
                  'ni okudum, onaylıyorum.
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={immediateAccepted}
                  onChange={(event) => setImmediateAccepted(event.target.checked)}
                  className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
                />
                <span>
                  Hizmetin derhal ifasına başlanmasını talep ediyorum; 14 günlük cayma hakkımı
                  kaybedeceğim konusunda bilgilendirildim.
                </span>
              </label>
            </div>
          )}

          {tier.id === "pro" ? (
            <Button className="mt-4 w-full" onClick={upgrade} disabled={loading || !legalReady}>
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
