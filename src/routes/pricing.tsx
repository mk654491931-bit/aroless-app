import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, Sparkles, Zap, Coins, ArrowRight, ShieldCheck } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { useFxRates } from "@/lib/currency";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Aroless Fiyatlandırma — Kazandıran Ürün Bulucu Paketleri" },
      { name: "description", content: "Aroless paketleri: aylık kredi, sınırsız araç erişimi, simülatör ve akademi. TRY ve USD fiyatlarıyla şeffaf fiyatlandırma." },
      { property: "og:title", content: "Aroless Fiyatlandırma — Paketler ve Krediler" },
      { property: "og:description", content: "Aylık kredi paketleri, tek seferlik kredi alımı ve tüm premium araçlara erişim." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PricingPage,
});

type Cur = "USD" | "TRY";

const PLANS = [
  {
    name: "Free",
    usd: 0,
    icon: Sparkles,
    badge: "Başlangıç",
    features: ["Başlangıç kredisi", "Ürün Bulucu erişimi", "Akademi temel modüller", "Topluluk desteği"],
    cta: "Ücretsiz başla",
    highlight: false,
  },
  {
    name: "Starter",
    usd: 29,
    icon: Sparkles,
    badge: "Pro",
    features: ["10 Ürün Bulucu kredisi / ay", "5 simülasyon kredisi / ay", "Tüm premium araçlar", "Reklam açıları & kitle analizi", "E-posta desteği"],
    cta: "Starter'a geç",
    highlight: false,
  },
  {
    name: "Pro",
    usd: 49,
    icon: Zap,
    badge: "Ultra",
    features: ["20 Ürün Bulucu kredisi / ay", "10 simülasyon kredisi / ay", "Starter'daki her şey", "Öncelikli üretim kuyruğu", "Öncelikli destek"],
    cta: "Pro'ya geç",
    highlight: true,
  },
];

const PACKS = [
  { credits: 5, usd: 9 },
  { credits: 15, usd: 24 },
  { credits: 40, usd: 55 },
];

const FAQ = [
  { q: "Kredi nedir?", a: "Her Ürün Bulucu araması veya derin analiz bir kredi harcar. Kalan kredini ayarlar sayfasındaki kullanım günlüğünden takip edebilirsin." },
  { q: "İstediğim zaman iptal edebilir miyim?", a: "Evet. Abonelik dönem sonuna kadar aktif kalır, otomatik yenileme durur." },
  { q: "TRY fiyatı nasıl hesaplanıyor?", a: "Tahsilat USD üzerinden yapılır; TRY tutarı güncel kur ile bilgilendirme amaçlı gösterilir." },
  { q: "Krediler devrediyor mu?", a: "Aylık krediler dönem başında yenilenir. Tek seferlik kredi paketleri süresizdir." },
];

function PricingPage() {
  const { data } = useFxRates();
  const [cur, setCur] = useState<Cur>("USD");
  const [yearly, setYearly] = useState(false);

  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      const lang = navigator.language || "";
      if (tz.includes("Istanbul") || lang.toLowerCase().startsWith("tr")) setCur("TRY");
    } catch { /* varsayılan USD */ }
  }, []);

  const rate = cur === "TRY" ? data?.rates?.TRY ?? 34.2 : 1;
  const price = (usd: number) => {
    const v = usd * rate * (yearly ? 10 : 1);
    if (v === 0) return cur === "TRY" ? "₺0" : "$0";
    return new Intl.NumberFormat(cur === "TRY" ? "tr-TR" : "en-US", {
      style: "currency", currency: cur, maximumFractionDigits: 0,
    }).format(v);
  };

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Aroless",
    description: "Yapay zekâ destekli kazandıran ürün bulucu ve e-ticaret araştırma platformu.",
    offers: PLANS.filter((p) => p.usd > 0).map((p) => ({
      "@type": "Offer",
      name: p.name,
      price: p.usd,
      priceCurrency: "USD",
      category: "SaaS subscription",
    })),
  };

  return (
    <div className="min-h-screen">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="mx-auto max-w-6xl px-4 py-12">
        <div className="mb-8 flex items-center justify-between gap-3">
          <BrandLogo />
          <Link to="/auth" className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">Ücretsiz başla</Link>
        </div>

        <div className="text-center">
          <h1 className="text-3xl font-extrabold md:text-5xl">Şeffaf <span className="text-gradient">fiyatlandırma</span></h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground md:text-base">
            Eğitim ve simülatör her pakete dahildir. Ne kadar kullandığını kredi günlüğünden görürsün.
          </p>

          <div className="mt-6 inline-flex flex-wrap items-center justify-center gap-2">
            <div className="inline-flex rounded-xl border border-white/10 bg-white/5 p-1">
              {(["USD", "TRY"] as Cur[]).map((c) => (
                <button
                  key={c}
                  onClick={() => setCur(c)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${cur === c ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                >
                  {c}
                </button>
              ))}
            </div>
            <div className="inline-flex rounded-xl border border-white/10 bg-white/5 p-1">
              <button onClick={() => setYearly(false)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${!yearly ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Aylık</button>
              <button onClick={() => setYearly(true)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${yearly ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Yıllık · 2 ay hediye</button>
            </div>
          </div>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {PLANS.map((p) => (
            <div key={p.name} className={`glass rounded-2xl p-6 ${p.highlight ? "ring-2 ring-primary/50" : ""}`}>
              <div className="flex items-center justify-between">
                <div className="inline-flex items-center gap-1.5 text-sm font-semibold"><p.icon size={16} className="text-[oklch(0.75_0.18_265)]" /> {p.name}</div>
                {p.highlight && <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[11px] font-bold">En popüler</span>}
              </div>
              <div className="mt-4 text-3xl font-extrabold">
                {price(p.usd)}
                <span className="ml-1 text-xs font-normal text-muted-foreground">/{yearly ? "yıl" : "ay"}</span>
              </div>
              <ul className="mt-4 space-y-2 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2"><Check size={15} className="mt-0.5 shrink-0 text-[oklch(0.75_0.18_265)]" /> <span className="text-muted-foreground">{f}</span></li>
                ))}
              </ul>
              <Link
                to="/auth"
                className={`mt-6 inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold ${p.highlight ? "bg-primary text-primary-foreground" : "border border-white/15 hover:bg-white/5"}`}
              >
                {p.cta} <ArrowRight size={15} />
              </Link>
            </div>
          ))}
        </div>

        <div className="mt-12 glass rounded-2xl p-6">
          <div className="flex items-center gap-2"><Coins size={18} className="text-[oklch(0.75_0.18_265)]" /><h2 className="font-semibold">Tek seferlik kredi paketleri</h2></div>
          <p className="mt-1 text-sm text-muted-foreground">Abonelik istemiyorsan sadece ihtiyacın kadar kredi al. Süresi dolmaz.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {PACKS.map((pk) => (
              <div key={pk.credits} className="rounded-xl border border-white/10 bg-white/5 p-4 text-center">
                <div className="text-2xl font-extrabold">{pk.credits}</div>
                <div className="text-xs text-muted-foreground">kredi</div>
                <div className="mt-2 text-sm font-semibold">{price(pk.usd)}</div>
                <Link to="/auth" className="mt-3 inline-flex w-full items-center justify-center rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium hover:bg-white/10">
                  Satın al
                </Link>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 grid gap-3 md:grid-cols-2">
          {FAQ.map((f) => (
            <details key={f.q} className="glass rounded-2xl p-4">
              <summary className="cursor-pointer text-sm font-semibold">{f.q}</summary>
              <p className="mt-2 text-sm text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>

        <div className="mt-10 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck size={14} /> Ödemeler Lemon Squeezy üzerinden güvenle işlenir · istediğin zaman iptal
        </div>
      </div>
    </div>
  );
}
