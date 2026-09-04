import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, Sparkles, Zap, Crown, ArrowRight, ShieldCheck } from "lucide-react";
import { PLANS, USAGE_ROWS } from "@/lib/plans";
import { BrandLogo } from "@/components/brand-logo";
import { useFxRates } from "@/lib/currency";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Aroless Fiyatlandırma — Kazandıran Ürün Bulucu Paketleri" },
      {
        name: "description",
        content:
          "Aroless paketleri: tüm modüller her pakette açık, fark yalnızca aylık kullanım miktarında. TRY ve USD fiyatlarıyla şeffaf fiyatlandırma.",
      },
      { property: "og:title", content: "Aroless Fiyatlandırma — Paketler ve Krediler" },
      {
        property: "og:description",
        content:
          "Tüm modüller açık; Starter, Pro ve Business paketleri aylık kullanım miktarında farklılaşır.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PricingPage,
});

type Cur = "USD" | "TRY";

const PLAN_ICON = { Starter: Sparkles, Pro: Zap, Business: Crown } as const;

const MODULE_ROWS = [
  "📚 Library · Dashboard & Karşılaştırma",
  "📦 Sourcing & Factory Hub",
  "📰 E-Com News Explainer",
  "💰 Financial & Cost Engine",
  "🚀 Growth & Market AI",
  "📡 Multi-Platform Trend Radar",
  "📝 Listing & Conversion Studio",
  "🧠 14'lü AI Konsey",
  "📈 Büyüme Suite",
];

const FAQ = [
  {
    q: "Modüller pakete göre kilitli mi?",
    a: "Hayır. Dokuz modülün tamamı her pakette açıktır; paketler yalnızca aylık kullanım miktarında (kredi ve araç çalıştırma hakkı) farklılaşır.",
  },
  {
    q: "Kredi nedir?",
    a: "Her Ürün Bulucu araması veya derin analiz bir kredi harcar. Kalan kredini ayarlar sayfasındaki kullanım günlüğünden takip edebilirsin.",
  },
  {
    q: "İstediğim zaman iptal edebilir miyim?",
    a: "Evet. Abonelik dönem sonuna kadar aktif kalır, otomatik yenileme durur.",
  },
  {
    q: "TRY fiyatı nasıl hesaplanıyor?",
    a: "Tahsilat USD üzerinden yapılır; TRY tutarı güncel kur ile bilgilendirme amaçlı gösterilir.",
  },
  { q: "Krediler devrediyor mu?", a: "Aylık krediler dönem başında yenilenir; devretmez." },
  {
    q: "Tek seferlik kredi satıyor musunuz?",
    a: "Hayır. Tek satış modelimiz Starter, Pro ve Business aylık paketleridir.",
  },
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
    } catch {
      /* varsayılan USD */
    }
  }, []);

  // Canlı kur yoksa (ağ/API kesintisi) ASLA sabit/bayat kur ile hesap yapılmaz;
  // gösterim USD'ye düşer ve kullanıcı bilgilendirilir.
  const tryRate = data?.rates?.TRY;
  const effective = cur === "TRY" && !tryRate ? "USD" : cur;
  const rate = effective === "TRY" ? (tryRate ?? 1) : 1;
  const price = (usd: number) => {
    const v = usd * rate * (yearly ? 10 : 1);
    if (v === 0) return effective === "TRY" ? "₺0" : "$0";
    return new Intl.NumberFormat(effective === "TRY" ? "tr-TR" : "en-US", {
      style: "currency",
      currency: effective,
      maximumFractionDigits: 0,
    }).format(v);
  };

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Aroless",
    description: "Yapay zekâ destekli kazandıran ürün bulucu ve e-ticaret araştırma platformu.",
    offers: PLANS.map((p) => ({
      "@type": "Offer",
      name: p.label,
      price: p.usd,
      priceCurrency: "USD",
      category: "SaaS subscription",
    })),
  };

  return (
    <div className="min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="mx-auto max-w-6xl px-4 py-12">
        <div className="mb-8 flex items-center justify-between gap-3">
          <BrandLogo />
          <Link
            to="/auth"
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
          >
            Ücretsiz başla
          </Link>
        </div>

        <div className="text-center">
          <h1 className="text-3xl font-extrabold md:text-5xl">
            Şeffaf <span className="text-gradient">fiyatlandırma</span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground md:text-base">
            Tüm modüller her pakette açıktır. Paketler sadece aylık kullanım miktarında farklılaşır.
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
              <button
                onClick={() => setYearly(false)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${!yearly ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >
                Aylık
              </button>
              <button
                onClick={() => setYearly(true)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${yearly ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >
                Yıllık · 2 ay hediye
              </button>
            </div>
          </div>
        </div>

        {cur === "TRY" && !tryRate && (
          <p className="mt-4 text-center text-xs text-amber-300/90">
            Canlı TL kuru şu an alınamadı — fiyatlar USD üzerinden gösteriliyor (tahsilat zaten
            USD'dir). Bağlantı düzelince kur otomatik güncellenir.
          </p>
        )}

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {PLANS.map((p) => {
            const Icon = PLAN_ICON[p.id];
            return (
              <div
                key={p.id}
                className={`glass rounded-2xl p-6 ${p.highlight ? "ring-2 ring-primary/50" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <div className="inline-flex items-center gap-1.5 text-sm font-semibold">
                    <Icon size={16} className="text-[oklch(0.75_0.18_265)]" /> {p.label}
                  </div>
                  {p.highlight && (
                    <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[11px] font-bold">
                      En popüler
                    </span>
                  )}
                </div>
                <div className="mt-4 text-3xl font-extrabold">
                  {price(p.usd)}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    /{yearly ? "yıl" : "ay"}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-semibold">
                    {p.credits} kredi / ay
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-semibold">
                    Tüm modüller açık
                  </span>
                </div>
                <ul className="mt-4 space-y-2 text-sm">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check size={15} className="mt-0.5 shrink-0 text-[oklch(0.75_0.18_265)]" />{" "}
                      <span className="text-muted-foreground">{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  to="/auth"
                  className={`mt-6 inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold ${p.highlight ? "bg-primary text-primary-foreground" : "border border-white/15 hover:bg-white/5"}`}
                >
                  {p.label}'a geç <ArrowRight size={15} />
                </Link>
              </div>
            );
          })}
        </div>

        <div className="mt-12 glass rounded-2xl p-6">
          <h2 className="font-semibold">Paketlere göre aylık kullanım</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Modüllerin tamamı her pakette açık; değişen tek şey kullanım miktarı.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="py-2">Kullanım</th>
                  {PLANS.map((p) => (
                    <th key={p.id} className="py-2 text-center">
                      {p.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {USAGE_ROWS.map((row) => (
                  <tr key={row.key} className="border-t border-white/10">
                    <td className="py-2 pr-3 text-muted-foreground">{row.label}</td>
                    {PLANS.map((p) => (
                      <td key={p.id} className="py-2 text-center font-semibold">
                        {p[row.key]}{" "}
                        <span className="text-[10px] font-normal text-muted-foreground">
                          {row.unit}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="mt-8 text-sm font-semibold">Her pakette açık modüller</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {MODULE_ROWS.map((m) => (
              <div
                key={m}
                className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-muted-foreground"
              >
                <Check size={14} className="shrink-0 text-emerald-400" /> {m}
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
          <ShieldCheck size={14} /> Ödemeler Paddle üzerinden güvenle işlenir · istediğin zaman
          iptal
        </div>
      </div>
    </div>
  );
}
