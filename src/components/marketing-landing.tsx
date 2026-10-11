import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BadgeCheck,
  Bot,
  Check,
  CircleDollarSign,
  FileText,
  Gauge,
  Layers,
  LineChart,
  Lock,
  Network,
  Rocket,
  Search,
  ShieldCheck,
  Sparkles,
  Workflow,
  Zap,
} from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { AgentConsole } from "@/components/landing/agent-console";
import { CapabilitySimulator } from "@/components/landing/capability-simulator";
import { AgentTopology } from "@/components/landing/agent-topology";
import { CountUp } from "@/components/landing/count-up";
import {
  ExampleReviews,
  FaqSection,
  type ExampleReview,
  type FaqItem,
} from "@/components/landing/sections";
import { PLANS } from "@/lib/plans";

const ECOSYSTEMS = [
  "Amazon",
  "TikTok Shop",
  "Shopify",
  "Trendyol",
  "eBay",
  "Etsy",
  "Zalando",
  "Allegro",
  "Cdiscount",
  "Hepsiburada",
];

const BENTO = [
  {
    icon: Layers,
    title: "Ürün Bulucu",
    text: "Tek aramada veri kaynakları taranır; talep, rekabet ve gerçek birim maliyet (tedarik + kargo + komisyon + KDV) aynı kartta birleşir.",
    span: "lg:col-span-2",
  },
  {
    icon: ShieldCheck,
    title: "Trend Radar",
    text: "20+ platformdaki talep ve fiyat hareketleri izlenir; trend herkese görünmeden önce raporlanır.",
    span: "lg:col-span-2",
  },
  {
    icon: Workflow,
    title: "14'lü AI Konsey",
    text: "Farklı uzman roller aynı ürünü ayrı ayrı tartışır; risk, aksiyon ve varsayımlar ayrıştırılmış tek bir raporda toplanır.",
    span: "lg:col-span-3",
  },
  {
    icon: CircleDollarSign,
    title: "Denetçi & ROI motoru",
    text: "Rakip mağazalar ve listingler denetlenir; fiyat, stok ve kampanya senaryolarının kârlılığı önceden simüle edilir.",
    span: "lg:col-span-1",
  },
];

const METRICS = [
  {
    value: <CountUp end={99.9} decimals={1} suffix="%" />,
    label: "Demo: eşleşme doğruluğu",
    sim: true,
    note: "Simülasyon referansı",
  },
  {
    value: <CountUp end={50} prefix="<" suffix="ms" />,
    label: "Demo: ajan yanıt süresi",
    sim: true,
    note: "Lokal simülasyon",
  },
  {
    value: <CountUp end={10} suffix="k+" />,
    label: "Demo: işlenen olay sayısı",
    sim: true,
    note: "Demo verisi",
  },
  {
    value: <CountUp end={312} prefix="+" suffix="%" />,
    label: "Demo: simülasyon ROI artışı",
    sim: true,
    note: "Simülasyon senaryosu",
  },
];

/* What we do — animated capability cards (hover-follow spotlight) */
const WHAT_WE_DO = [
  {
    icon: Search,
    step: "01",
    title: "Piyasayı analist gibi tara",
    text: "20+ platform ve ülke ekonomisi izlenir; talep sıçramaları, sezon kaymaları ve marj bozulmaları herkes fark etmeden önce yüzeye çıkar.",
    accent: "indigo",
  },
  {
    icon: Gauge,
    step: "02",
    title: "Ürünü gerçek ekonomi ile puanla",
    text: "Ödül puanı yalnız talebi değil gerçek birim ekonomisini de okur: tedarik, kargo, komisyon, KDV, iade ve reklam. %420 trend, -%12 marjı gizleyemez.",
    accent: "emerald",
  },
  {
    icon: Workflow,
    step: "03",
    title: "Sınırsız deneme: eğitim simülatörü",
    text: "Karar vermeden önce sezon ve kampanya senaryolarını simüle et. Yaptığın hatanın bedelini gerçek stokla değil, simülasyonda öde.",
    accent: "indigo",
  },
  {
    icon: LineChart,
    step: "04",
    title: "Kanıtı ve aksiyonu birlikte al",
    text: "14'lü AI Konsey her ürün için riski, aksiyonu ve varsayımları ayrı ayrı yazar. Hangi veriye dayandığını görürsün — kara kutu yok.",
    accent: "emerald",
  },
];

/**
 * Temsilî örnek yorumlar — GERÇEK müşteri yorumu DEĞİLDİR.
 * Arayüzde hem bölüm hem kart seviyesinde "örnek" olarak etiketlenir
 * (bkz. sections.tsx → ExampleReviews).
 */
const EXAMPLE_REVIEWS: ExampleReview[] = [
  {
    name: "Elif Kaya",
    role: "E-ticaret operatörü · İstanbul",
    market: "TR",
    initials: "EK",
    quote:
      "Üç ürünü trend zirvesine çıkmadan radar üzerinden lansmana aldık. Kâr tablosu, ikinci en çok satan ürünümüzü sessizce öldürecek komisyon yapısını yakaladı.",
  },
  {
    name: "Ahmet Demir",
    role: "İhracatçı · Gaziantep",
    market: "TR",
    initials: "AD",
    quote:
      "Altı ülkeye ihracat yapıyorum, ekonomiyi eskiden Excel'de tutuyordum. Şimdi ülke başına kapıya maliyeti saniyeler içinde görüyorum.",
  },
  {
    name: "Merve Aksoy",
    role: "Dropshipping · İzmir",
    market: "TR",
    initials: "MA",
    quote:
      "Simülatörde sezon oynarken öğrendiklerim, geçen yıl iki kez para kaybettiren hatayı tekrarlamamı engelledi.",
  },
  {
    name: "Can Yılmaz",
    role: "Ajans kurucusu · Ankara",
    market: "TR",
    initials: "CY",
    quote:
      "Müşterilerimize ülke + platform bazında net kâr projeksiyonu çıkaran tek araç. Konsey raporları sunumlarımızın yıldızı oldu.",
  },
  {
    name: "Zeynep Şahin",
    role: "Mağaza denetçisi · Bursa",
    market: "TR",
    initials: "ZŞ",
    quote:
      "Mağaza denetçisiyle rakiplerimizin zayıf noktalarını haftalar öncesinden görüyoruz. SEO kiti ile ürünleri aynı gün pazara taşıyoruz.",
  },
];

const FAQ_ITEMS: FaqItem[] = [
  {
    q: "Landing'deki demolar gerçek mi, simülasyon mu?",
    a: "Demolar deterministik ve yerel veriyle çalışır; dış servise istek gitmez. Ürünün içinde aynı hat gerçek piyasa verisiyle çalışır ve her adımı inceleyebilirsin.",
  },
  {
    q: "Hangi platform ve ülkeleri kapsıyor?",
    a: "Amazon, TikTok Shop, Shopify, Trendyol, Hepsiburada, eBay, Etsy, Zalando ve daha fazlası ile 20+ ülke ekonomisi modellenir. Her ülkenin komisyon, KDV, kargo ve sertifikasyon mantığı puanlamaya dahildir.",
  },
  {
    q: "Ürün puanı nasıl hesaplanıyor?",
    a: "Puan iki parçadan oluşur: talep momentumu ve gerçek birim ekonomisi. Talep tahminleri, rekabet seviyesi, tedarik/kargo/komisyon/vergi sonrası marj, uyumluluk ve iade riski birlikte değerlendirilir. Her puanın arkasındaki kanıt kartta gösterilir.",
  },
  {
    q: "Ödeme ve iptal nasıl işliyor?",
    a: "Ödemeler Paddle üzerinden alınır. Aboneliği istediğin zaman iptal edebilirsin; dönem sonuna kadar erişimin devam eder, otomatik yenileme durur.",
  },
  {
    q: "Veri güvenliği nasıl sağlanıyor?",
    a: "Veriler Supabase üzerinde tutulur ve satır düzeyi güvenlik (RLS) ile erişim kullanıcı bazında kısıtlanır. KVKK aydınlatma metni ve veri işleme sözleşmesi uygulama içinde yer alır.",
  },
  {
    q: "Ödemeden önce deneyebilir miyim?",
    a: "Evet. Kayıt olduğunda hoş geldin kredisi tanımlanır; Ürün Bulucu'yu kredi kartı girmeden denersin.",
  },
];

/**
 * Aroless — enterprise dark landing page.
 * All interactive demos stream deterministic, pre-loaded local simulation
 * payloads: zero external API calls, zero network latency, no accounts needed.
 */
export function MarketingLanding() {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#050608] font-sans text-slate-200 antialiased">
      {/* Page atmosphere */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[52rem] overflow-hidden"
      >
        <div className="ent-orb ent-orb-a" />
        <div className="ent-orb ent-orb-b" />
        <div className="ent-grid-bg" />
        <div className="absolute left-1/2 top-0 h-px w-[min(72rem,92%)] -translate-x-1/2 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      </div>

      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#050608]/92">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" className="shrink-0">
            <BrandLogo />
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-slate-400 md:flex">
            <a href="#platform" className="transition hover:text-slate-100">
              Platform
            </a>
            <a href="#architecture" className="transition hover:text-slate-100">
              Architecture
            </a>
            <a href="#metrics" className="transition hover:text-slate-100">
              Metrics
            </a>
            <a href="#faq" className="transition hover:text-slate-100">
              FAQ
            </a>
            <Link to="/pricing" className="transition hover:text-slate-100">
              Pricing
            </Link>
          </nav>
          <div className="flex items-center gap-2">
            <Link
              to="/auth"
              className="hidden rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-300 transition hover:border-white/25 hover:text-white sm:block"
            >
              Sign in
            </Link>
            <Link
              to="/auth"
              search={{ mode: "signup" }}
              className="rounded-lg bg-white px-3.5 py-1.5 text-sm font-semibold text-[#050608] transition hover:bg-slate-200"
            >
              Get access
            </Link>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        {/* ── Hero ──────────────────────────────────────────────── */}
        <section className="mx-auto max-w-7xl px-4 pb-16 pt-16 sm:px-6 md:pt-24">
          <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-indigo-400/25 bg-indigo-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-300">
                <Sparkles size={12} /> E-ticaret satıcıları için yapay zekâ
              </div>
              <h1 className="mt-5 text-4xl font-extrabold leading-[1.08] tracking-tight text-white sm:text-5xl xl:text-6xl">
                Piyasa sinyallerini{" "}
                <span className="bg-gradient-to-r from-indigo-300 via-white to-emerald-300 bg-clip-text text-transparent">
                  kârlı ürün kararlarına
                </span>{" "}
                çevir.
              </h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-400 sm:text-lg">
                Aroless; Ürün Bulucu, Trend Radar, mağaza denetimi, finans motoru ve 14'lü AI
                Konsey'i tek panelde birleştirir. Talep, rekabet ve gerçek maliyet aynı ekranda
                hesaplanır — ve her skorun arkasındaki kanıt görünür.
              </p>

              <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-300">
                {[
                  "Kaynak bazlı kanıt",
                  "Supabase RLS ile satır düzeyi güvenlik",
                  "Kayıt anında hoş geldin kredisi",
                ].map((item) => (
                  <li key={item} className="inline-flex items-center gap-1.5">
                    <BadgeCheck size={15} className="text-emerald-400" /> {item}
                  </li>
                ))}
              </ul>

              <div className="mt-8 flex flex-wrap items-center gap-4">
                <Link
                  to="/auth"
                  search={{ mode: "signup" }}
                  className="sweep-frame group rounded-xl"
                >
                  <span className="relative z-[1] flex h-11 items-center gap-2 rounded-[11px] bg-gradient-to-r from-indigo-500 to-indigo-400 px-6 text-sm font-semibold text-white transition group-hover:brightness-110">
                    Ücretsiz başla
                    <ArrowRight
                      size={16}
                      className="transition-transform group-hover:translate-x-0.5"
                    />
                  </span>
                </Link>
                <a
                  href="#platform"
                  className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/15 px-5 text-sm font-semibold text-slate-200 transition hover:border-white/30 hover:bg-white/5"
                >
                  Nasıl çalışıyor?
                </a>
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1.5">
                  <Zap size={13} className="text-indigo-300" /> Kredi kullanımı — sürpriz fatura yok
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Lock size={13} className="text-emerald-400" /> Başlamak için kredi kartı gerekmez
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Rocket size={13} className="text-slate-400" /> Kayıt sonrası hemen kullanılabilir
                </span>
              </div>
            </div>

            {/* Console */}
            <div className="console-log-in">
              <AgentConsole />
              <p className="mt-3 text-center text-[11px] text-slate-600">
                Deterministic local simulation — no live systems are touched.
              </p>
            </div>
          </div>

          {/* Ecosystem strip */}
          <div className="mt-16">
            <p className="text-center text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-600">
              Şu platformlar için modelleme yapılır
            </p>
            <div className="mx-auto mt-4 flex max-w-3xl flex-wrap items-center justify-center gap-2">
              {ECOSYSTEMS.map((name) => (
                <span
                  key={name}
                  className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-slate-400"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ── What we do ─────────────────────────────────────────── */}
        <section className="mx-auto max-w-7xl scroll-mt-24 px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
              <Bot size={12} /> What we do
            </span>
            <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-white md:text-4xl">
              Dört adım, tek sonuç: izlenebilir karar.
            </h2>
            <p className="mt-3 text-slate-400">
              Aroless e-ticaret araştırmasını izlenebilir bir hatta dönüştürür — her adımın nasıl
              çalıştığını görmek için kartların üzerine gel.
            </p>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {WHAT_WE_DO.map((card, i) => (
              <div
                key={card.title}
                onMouseMove={(e) => {
                  const el = e.currentTarget;
                  const r = el.getBoundingClientRect();
                  el.style.setProperty("--mx", `${e.clientX - r.left}px`);
                  el.style.setProperty("--my", `${e.clientY - r.top}px`);
                }}
                className={`wwd-card group relative overflow-hidden rounded-2xl border border-white/10 bg-[#0F1117]/70 p-6 backdrop-blur-xl transition duration-300 hover:-translate-y-1.5 ${
                  card.accent === "emerald"
                    ? "hover:border-emerald-400/40"
                    : "hover:border-indigo-400/40"
                }`}
                style={{ animationDelay: `${i * 90}ms` }}
              >
                {/* hover-follow spotlight + glow wash */}
                <span
                  aria-hidden
                  className={`pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100 ${
                    card.accent === "emerald"
                      ? "bg-[radial-gradient(240px_circle_at_var(--mx,50%)_var(--my,50%),rgba(16,185,129,0.14),transparent_70%)]"
                      : "bg-[radial-gradient(240px_circle_at_var(--mx,50%)_var(--my,50%),rgba(99,102,241,0.16),transparent_70%)]"
                  }`}
                />
                <span
                  aria-hidden
                  className={`pointer-events-none absolute -right-14 -top-14 size-36 rounded-full blur-3xl transition duration-500 group-hover:opacity-90 ${
                    card.accent === "emerald" ? "bg-emerald-500/10" : "bg-indigo-500/15"
                  }`}
                />

                <div className="relative flex items-start justify-between">
                  <span
                    className={`grid size-11 place-items-center rounded-xl border transition duration-300 group-hover:scale-110 ${
                      card.accent === "emerald"
                        ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                        : "border-indigo-400/25 bg-indigo-400/10 text-indigo-300"
                    }`}
                  >
                    <card.icon size={20} />
                  </span>
                  <span className="font-mono text-xs font-semibold tracking-widest text-slate-600 transition group-hover:text-slate-400">
                    {card.step}
                  </span>
                </div>
                <h3 className="relative mt-5 text-lg font-bold leading-snug text-white">
                  {card.title}
                </h3>
                <p className="relative mt-2 text-sm leading-relaxed text-slate-400">{card.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Capabilities Simulator ────────────────────────────── */}
        <section id="platform" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
              <Zap size={12} /> Instant value engine
            </span>
            <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-white md:text-4xl">
              Motoru kurmadan dene. Kayıt yok, ağ yok.
            </h2>
            <p className="mt-3 text-slate-400">
              Bir kategori seç ve çok adımlı hattı çalıştır. Tüm veri yerelde hazır olduğu için
              demo anında ve tamamen deterministik çalışır.
            </p>
          </div>
          <div className="mt-10">
            <CapabilitySimulator />
          </div>
        </section>

        {/* ── Architecture ───────────────────────────────────────── */}
        <section id="architecture" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-400/25 bg-indigo-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-300">
              <Network size={12} /> System architecture
            </span>
            <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-white md:text-4xl">
              Uçtan uca izlenebilen bir hat
            </h2>
            <p className="mt-3 text-slate-400">
              Veri toplama → kaynak doğrulama → puanlama → konsey raporu. Her adım deterministik
              ve tekrarlanabilir.
            </p>
          </div>

          <div className="mt-10">
            <AgentTopology />
          </div>

          {/* Bento capability grid */}
          <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {BENTO.map((card) => (
              <div
                key={card.title}
                className={`group relative overflow-hidden rounded-2xl border border-white/10 bg-[#0F1117]/88 p-6 transition duration-300 hover:-translate-y-1 hover:border-white/20 ${
                  card.span ?? ""
                }`}
              >
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-16 -top-16 size-40 rounded-full bg-indigo-500/0 blur-3xl transition duration-500 group-hover:bg-indigo-500/15"
                />
                <div className="grid size-10 place-items-center rounded-xl border border-indigo-400/20 bg-indigo-400/10">
                  <card.icon size={18} className="text-indigo-300" />
                </div>
                <h3 className="mt-4 font-semibold text-white">{card.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{card.text}</p>
              </div>
            ))}
          </div>

          {/* Compliance banner */}
          <div className="mt-4 flex flex-col items-start gap-5 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-r from-[#0F1117] via-[#0F1117]/90 to-[#0F1117] p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-emerald-400/20 bg-emerald-400/10">
                <FileText size={18} className="text-emerald-300" />
              </div>
              <div>
                <p className="font-semibold text-white">Veri ve erişim</p>
                <p className="mt-1 text-sm text-slate-400">
                  Supabase RLS ile satır düzeyi yetkilendirme · KVKK aydınlatma ve veri işleme
                  sözleşmesi · ödemeler Paddle üzerinden
                </p>
              </div>
            </div>
            <Link
              to="/legal/$slug"
              params={{ slug: "kvkk-aydinlatma-metni" }}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 px-3.5 py-2 text-xs font-semibold text-slate-200 transition hover:border-emerald-400/40 hover:text-emerald-300"
            >
              Yasal metinler <ArrowRight size={13} />
            </Link>
          </div>
        </section>

        {/* ── Metrics ────────────────────────────────────────────── */}
        <section id="metrics" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-20 sm:px-6">
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#0F1117]/88">
            <div className="border-b border-white/10 px-6 py-5 text-center">
              <h2 className="text-2xl font-extrabold tracking-tight text-white md:text-3xl">              Simülasyon referansları
            </h2>
              <p className="mx-auto mt-2 max-w-xl text-sm text-slate-400">
                Aşağıdaki değerler ürünün nasıl ölçtüğünü göstermek için yerel demo verisiyle
                üretilir; gerçek sonuçlar kullanılan veri kaynağına göre değişir.
              </p>
              <p className="mx-auto mt-2 max-w-xl text-[11px] text-amber-300/80">
                Aşağıdaki 4 değer <strong>simülasyon / demo referansıdır</strong> — gerçek üretim
                metrikleri değil. Fiyatlandırmayla karıştırılmamalı.
              </p>
            </div>
            <div className="grid grid-cols-2 divide-x divide-y divide-white/5 lg:grid-cols-4 lg:divide-y-0">
              {METRICS.map((m) => (
                <div key={m.label} className="relative px-6 py-8 text-center">
                  {m.sim && (
                    <span className="absolute right-3 top-3 rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300">
                      Sim*
                    </span>
                  )}
                  <div className="text-3xl font-extrabold tracking-tight text-white md:text-4xl">
                    {m.value}
                    {m.sim && <span className="align-super text-[10px] text-amber-300">*</span>}
                  </div>
                  <div className="mt-2 text-xs uppercase tracking-wide text-slate-500">
                    {m.label}
                  </div>
                  {m.note && <div className="mt-1 text-[10px] text-slate-600">{m.note}</div>}
                </div>
              ))}
            </div>
            <div className="border-t border-white/10 px-6 py-3 text-center text-[10px] leading-relaxed text-slate-500">
              * <strong>Simülasyon değeri</strong> — lokal deterministik demo payload’ları üzerinden
              ölçülmüştür. Canlı trafik, veri kaynağı ve kullanım profiline göre değişir.{" "}
              <Link
                to="/pricing"
                className="underline decoration-slate-600 underline-offset-4 hover:text-slate-300"
              >
                Gerçek fiyatlar için /pricing →
              </Link>
            </div>
          </div>
        </section>

        {/* ── Pricing — Tek kaynak: PLANS (src/lib/plans.ts) ─────────── */}
        <section id="pricing-preview" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-400/25 bg-indigo-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-300">
              <CircleDollarSign size={12} /> Tek fiyat kaynağı — PLANS
            </span>
            <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-white md:text-4xl">
              Şeffaf fiyatlandırma. Tüm modüller açık.
            </h2>
            <p className="mt-3 text-sm text-slate-400 sm:text-base">
              Fiyatlar yalnızca{" "}
              <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-white">
                src/lib/plans.ts → PLANS
              </code>{" "}
              üzerinden gelir. Landing, /pricing ve ödeme modalı aynı kaynağı okur — fiyat değişince
              tek yer güncellenir.
            </p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {PLANS.map((p) => (
              <div
                key={p.id}
                className={`relative overflow-hidden rounded-2xl border p-6 ${p.highlight ? "border-indigo-400/40 bg-gradient-to-b from-indigo-500/10 via-[#0F1117]/88 to-[#0F1117]/88 shadow-[0_0_40px_-20px_rgba(99,102,241,0.6)]" : "border-white/10 bg-[#0F1117]/88"}`}
              >
                {p.highlight && (
                  <span className="absolute right-4 top-4 rounded-full bg-gradient-to-r from-indigo-500 to-indigo-400 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
                    En popüler
                  </span>
                )}
                <h3 className="text-lg font-bold text-white">{p.label}</h3>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-4xl font-extrabold tracking-tight text-white">
                    ${p.usd}
                  </span>
                  <span className="text-sm text-slate-500">/ay</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-slate-300">
                    {p.credits} kredi / ay
                  </span>
                  <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
                    Tüm modüller açık
                  </span>
                </div>
                <ul className="mt-4 space-y-1.5 text-sm text-slate-400">
                  {p.features.slice(0, 4).map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check size={14} className="mt-0.5 shrink-0 text-emerald-400" /> {f}
                    </li>
                  ))}
                </ul>
                <Link
                  to="/pricing"
                  className={`mt-6 inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${p.highlight ? "bg-white text-[#050608] hover:bg-slate-200" : "border border-white/15 text-slate-200 hover:bg-white/5"}`}
                >
                  Detaylar <ArrowRight size={14} />
                </Link>
              </div>
            ))}
          </div>
          <p className="mx-auto mt-4 max-w-2xl text-center text-[11px] leading-relaxed text-slate-500">
            Görsel metriklerle fiyat ilişkisi yoktur —{" "}
            <strong className="text-slate-300">%99.9 doğruluk / +%312 ROI</strong> gibi sayılar
            simülasyon kartlarındaki yön gösterici değerlerdir, fatura değildir. Güncel ve bağlayıcı
            fiyatlar her zaman{" "}
            <Link to="/pricing" className="underline underline-offset-4 hover:text-slate-300">
              /pricing
            </Link>{" "}
            ve ödeme adımında gösterilir.
          </p>
        </section>

        {/* ── FAQ ────────────────────────────────────────────────── */}
        <div id="faq" className="scroll-mt-24">
          <FaqSection
            items={FAQ_ITEMS}
            title="Questions, answered"
            subtitle="Everything teams ask before deploying Aroless — and how it actually works."
          />
        </div>

        {/* ── Final CTA ──────────────────────────────────────────── */}
        <section className="mx-auto max-w-5xl px-4 pb-24 sm:px-6">
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0F1117]/92 px-6 py-14 text-center sm:px-12">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -top-32 left-1/2 h-64 w-[40rem] -translate-x-1/2 rounded-full bg-indigo-500/15 blur-3xl"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-24 right-0 h-48 w-96 rounded-full bg-emerald-500/10 blur-3xl"
            />
            <div className="relative">
              <h2 className="mx-auto max-w-2xl text-3xl font-extrabold tracking-tight text-white md:text-4xl">
                İlk analizini dakikalar içinde al.
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-sm text-slate-400 sm:text-base">
                Kayıt ol ve hoş geldin kredinle Ürün Bulucu'yu dene. Kurulum, uzun entegrasyon ya
                da kredi kartı gerekmez.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
                <Link
                  to="/auth"
                  search={{ mode: "signup" }}
                  className="sweep-frame group rounded-xl"
                >
                  <span className="relative z-[1] flex h-12 items-center gap-2 rounded-[11px] bg-gradient-to-r from-indigo-500 to-indigo-400 px-7 text-sm font-semibold text-white transition group-hover:brightness-110">
                    Ücretsiz başla
                    <ArrowRight
                      size={16}
                      className="transition-transform group-hover:translate-x-0.5"
                    />
                  </span>
                </Link>
                <a
                  href="#platform"
                  className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/15 px-6 text-sm font-semibold text-slate-200 transition hover:border-white/30 hover:bg-white/5"
                >
                  Motoru dene
                </a>
              </div>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-xs text-slate-500">
                {["Kredi kartı gerekmez", "Kayıt anında hoş geldin kredisi", "İstediğin zaman iptal"].map((t) => (
                  <span key={t} className="inline-flex items-center gap-1.5">
                    <Check size={13} className="text-emerald-400" /> {t}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── Örnek yorumlar (temsilî — gerçek müşteri yorumu değil) ──── */}
        <div id="examples" className="scroll-mt-24">
          <ExampleReviews
            items={EXAMPLE_REVIEWS}
            title="Temsilî kullanıcı senaryoları"
            subtitle="Ürünün hangi sorunlara cevap verdiğini göstermek için yazılmış örnekler."
          />
        </div>
      </main>

      {/* ── Footer ───────────────────────────────────────────────── */}
      <footer className="relative z-10 border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row sm:px-6">
          <BrandLogo />
          <p className="text-center text-[11px] text-slate-600">
            © {new Date().getFullYear()} Aroless. All interactive demos run on deterministic local
            simulation payloads.
          </p>
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <Link to="/auth" className="hover:text-slate-200">
              Sign in
            </Link>
            <Link to="/pricing" className="hover:text-slate-200">
              Pricing
            </Link>
            <a href="#faq" className="hover:text-slate-200">
              FAQ
            </a>
            <a href="#examples" className="hover:text-slate-200">
              Örnekler
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
