import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  Search,
  ShieldCheck,
  Gauge,
  Globe,
  Radar,
  GraduationCap,
  Gamepad2,
  ArrowRight,
  Check,
  Cpu,
  TrendingUp,
  BarChart3,
  CircleDollarSign,
  ScanSearch,
  Zap,
  Target,
  Layers,
  Rocket,
  Star,
  FileText,
  Shield,
  CheckCircle,
} from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { openCookiePreferences } from "@/components/cookie-banner";

const FEATURES = [
  {
    icon: Search,
    title: "Ürün Bulucu",
    text: "20 farklı analiz açısıyla üretilen adaylar, Winner Score ile 0–100 arası puanlanır.",
    gradient: "from-blue-500/20 to-cyan-500/20",
    iconColor: "text-cyan-400",
  },
  {
    icon: Globe,
    title: "Ülke + platform hassasiyeti",
    text: "22 platform, 21 ülke: komisyon, teslimat süresi, KDV ve sertifika bariyerleri hesaba katılır.",
    gradient: "from-emerald-500/20 to-teal-500/20",
    iconColor: "text-emerald-400",
  },
  {
    icon: Gauge,
    title: "Gerçek birim ekonomisi",
    text: "Tedarik, kargo, komisyon, iade ve reklam maliyetiyle net kâr — uydurma değil, kaynaklı.",
    gradient: "from-amber-500/20 to-orange-500/20",
    iconColor: "text-amber-400",
  },
  {
    icon: Radar,
    title: "Trend radarı & haber akışı",
    text: "Saatlik güncellenen e-ticaret gelişmeleri ve yükselen trendler.",
    gradient: "from-violet-500/20 to-purple-500/20",
    iconColor: "text-violet-400",
  },
  {
    icon: Gamepad2,
    title: "Mağaza simülatörü",
    text: "30 günlük sezonlar, rakipler, kampanya takvimi ve nakit akışıyla risksiz pratik.",
    gradient: "from-pink-500/20 to-rose-500/20",
    iconColor: "text-pink-400",
  },
  {
    icon: GraduationCap,
    title: "Akademi",
    text: "XP, seviye ve rozetlerle ilerleyen uçtan uca e-ticaret müfredatı.",
    gradient: "from-sky-500/20 to-indigo-500/20",
    iconColor: "text-sky-400",
  },
];

const STEPS = [
  {
    n: "01",
    t: "Niş, ülke ve platformunu seç",
    d: "Bütçe ve hedef kitleyi belirt, motoru çalıştır.",
    icon: Target,
  },
  {
    n: "02",
    t: "Puanlanmış ürünleri incele",
    d: "Winner Score, kâr tablosu ve neden seçildi/elendi gerekçeleri.",
    icon: Layers,
  },
  {
    n: "03",
    t: "Karşılaştır ve harekete geç",
    d: "Yan yana karşılaştırma, SEO kiti, reklam senaryoları ve dışa aktarma.",
    icon: Rocket,
  },
];

const FAQ = [
  {
    q: "Aroless ne yapar?",
    a: "E-ticaret satıcıları için kazandıran ürünleri bulur, ülke ve platform bazında kârlılığını hesaplar ve pazarlama materyallerini hazırlar.",
  },
  {
    q: "Ücretsiz deneyebilir miyim?",
    a: "Evet, kayıt olduğunda başlangıç kredin tanımlanır. Kredi bitince paketlerden birine geçebilirsin.",
  },
  {
    q: "Veriler gerçek mi?",
    a: "Tahminler kaynaklarıyla birlikte gösterilir: doğrulanmış sinyaller ve tahmini sinyaller panelde ayrı ayrı listelenir.",
  },
];

const TESTIMONIALS = [
  {
    quote:
      "Winner Score sayesinde sezon öncesi elediğim ürünlerin çoğu rakiplerimin vitrininde. Raporlar tek başına bir pazar ekibi gibi çalışıyor.",
    name: "Mert K.",
    role: "İstanbul · Amazon satıcısı",
    initials: "MK",
    gradient: "from-[var(--brand)] to-[var(--brand-2)]",
  },
  {
    quote:
      "Komisyon ve kargo hesabını ülke + platform bazında görmek, pazarlık masasında bize her sezon binlerce dolar kazandırdı.",
    name: "Elif D.",
    role: "İzmir · TikTok Shop satıcısı",
    initials: "ED",
    gradient: "from-emerald-500 to-teal-500",
  },
  {
    quote:
      "Tedarikçi analizi ve sertifika bariyeri uyarıları gümrük sürprizlerini neredeyse sıfırladı. Artık ürünü önce simülatörde test ediyoruz.",
    name: "Can S.",
    role: "Ankara · E-ticaret ihracatçısı",
    initials: "CS",
    gradient: "from-violet-500 to-fuchsia-500",
  },
];

const DEMOS = [
  {
    label: "Ev yaşam",
    product: "Akıllı Mini Projektör",
    platform: "TikTok Shop",
    country: "Almanya",
    score: "87",
    metrics: [
      ["Satış fiyatı", "€79,90"],
      ["Tahmini maliyet", "€31,40"],
      ["Net marj", "%34,8"],
    ],
    signals: [
      ["Talep ivmesi", "Yükseliyor", "w-[82%]"],
      ["Rekabet yoğunluğu", "Düşük", "w-[34%]"],
      ["Kargo uygunluğu", "İyi", "w-[71%]"],
    ],
    budget: "€420",
  },
  {
    label: "Güzellik",
    product: "Isı Kontrollü Saç Fırçası",
    platform: "Shopify",
    country: "Fransa",
    score: "91",
    metrics: [
      ["Satış fiyatı", "€54,90"],
      ["Tahmini maliyet", "€18,60"],
      ["Net marj", "%41,2"],
    ],
    signals: [
      ["Talep ivmesi", "Güçlü", "w-[91%]"],
      ["Rekabet yoğunluğu", "Orta", "w-[52%]"],
      ["Kargo uygunluğu", "İyi", "w-[76%]"],
    ],
    budget: "€280",
  },
  {
    label: "Evcil hayvan",
    product: "Sessiz Otomatik Mama Kabı",
    platform: "Amazon",
    country: "İngiltere",
    score: "84",
    metrics: [
      ["Satış fiyatı", "£64,00"],
      ["Tahmini maliyet", "£26,10"],
      ["Net marj", "%29,6"],
    ],
    signals: [
      ["Talep ivmesi", "Yükseliyor", "w-[74%]"],
      ["Rekabet yoğunluğu", "Düşük", "w-[29%]"],
      ["Kargo uygunluğu", "Orta", "w-[56%]"],
    ],
    budget: "£360",
  },
];

/* Animated counter that ticks up on mount */
function AnimatedStat({ value, label }: { value: string; label: string }) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-center backdrop-blur-sm transition-all duration-500 hover:border-[var(--brand)]/30 hover:bg-white/[0.07]"
    >
      <div className="absolute inset-0 bg-gradient-to-b from-white/[0.06] to-transparent" />
      <div
        className={`relative text-3xl font-extrabold text-gradient transition-all duration-700 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
      >
        {value}
      </div>
      <div
        className={`relative mt-1.5 text-xs text-muted-foreground transition-all duration-700 delay-150 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"}`}
      >
        {label}
      </div>
    </div>
  );
}

/* Section heading with atmospheric halo */
function SectionHead({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="relative text-center">
      <div className="pointer-events-none absolute inset-x-0 top-0 mx-auto h-40 w-[min(500px,80%)] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--brand)_18%,transparent),transparent)] blur-3xl" />
      <h2 className="relative text-2xl font-bold md:text-3xl">{children}</h2>
      {sub && <p className="relative mx-auto mt-3 max-w-xl text-sm text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function MarketingLanding() {
  const [demoIndex, setDemoIndex] = useState(0);
  const [niche, setNiche] = useState("");
  const [demoContext, setDemoContext] = useState("Ev yaşam");
  const [heroReady, setHeroReady] = useState(false);
  const demo = DEMOS[demoIndex];

  useEffect(() => {
    const t = setTimeout(() => setHeroReady(true), 100);
    return () => clearTimeout(t);
  }, []);

  const applyNiche = (value: string) => {
    const next = value.trim();
    if (!next) return;
    setNiche(next);
    const match = DEMOS.findIndex((item) =>
      item.label.toLocaleLowerCase("tr").includes(next.toLocaleLowerCase("tr")),
    );
    if (match >= 0) {
      setDemoIndex(match);
      setDemoContext(DEMOS[match].label);
    } else {
      setDemoContext(next);
    }
  };

  return (
    <div className="relative min-h-screen">
      {/* ---------- Aurora backdrop (first-visit wow factor) ---------- */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute inset-[-25%] bg-[radial-gradient(38%_30%_at_18%_22%,var(--brand)_0%,transparent_62%),radial-gradient(36%_28%_at_82%_28%,var(--brand-2)_0%,transparent_64%),radial-gradient(44%_32%_at_52%_88%,var(--accent-active)_0%,transparent_66%)] opacity-40 blur-[78px] [animation:aurora-swirl_26s_ease-in-out_infinite_alternate]" />
        <div className="absolute left-[-10vw] top-[4vh] h-[46vw] w-[46vw] rounded-full bg-[radial-gradient(circle_at_40%_40%,var(--brand)_0%,transparent_68%)] blur-[68px] opacity-30 [animation:amb-float-a_22s_ease-in-out_infinite_alternate]" />
        <div className="absolute bottom-[-6vh] right-[-8vw] h-[40vw] w-[40vw] rounded-full bg-[radial-gradient(circle_at_60%_60%,var(--brand-2)_0%,transparent_68%)] blur-[68px] opacity-25 [animation:amb-float-b_27s_ease-in-out_infinite_alternate]" />
        {/* Subtle grid */}
        <div className="absolute inset-[-10%] bg-[linear-gradient(to_right,color-mix(in_oklab,var(--brand)_12%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklab,var(--brand)_12%,transparent)_1px,transparent_1px)] bg-[size:72px_72px] opacity-30 [mask-image:radial-gradient(ellipse_80%_70%_at_50%_30%,#000_5%,transparent_78%)] [animation:grid-pan_30s_linear_infinite]" />
        {/* Vignette */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_95%_80%_at_50%_45%,transparent_62%,oklch(0_0_0/0.32)_100%)]" />
      </div>

      {/* ---------- Header ---------- */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[var(--surface)]/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <BrandLogo />
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#features" className="transition-colors hover:text-foreground">
              Özellikler
            </a>
            <a href="#how" className="transition-colors hover:text-foreground">
              Nasıl çalışır
            </a>
            <Link to="/pricing" className="transition-colors hover:text-foreground">
              Fiyatlandırma
            </Link>
            <a href="#faq" className="transition-colors hover:text-foreground">
              SSS
            </a>
          </nav>
          <div className="flex items-center gap-2.5">
            <Link
              to="/auth"
              className="rounded-lg border border-white/10 px-3.5 py-1.5 text-sm transition-all hover:border-white/20 hover:bg-white/10"
            >
              Giriş yap
            </Link>
            <Link
              to="/auth"
              className="glow rounded-lg bg-gradient-to-r from-[var(--brand)] to-[var(--brand-2)] px-4 py-1.5 text-sm font-semibold text-white transition-all hover:scale-[1.03]"
            >
              Ücretsiz başla
            </Link>
          </div>
        </div>
      </header>

      {/* ---------- Hero ---------- */}
      <section className="relative mx-auto max-w-6xl px-4 pb-20 pt-20 text-center md:pt-28">
        {/* Floating orb */}
        <div className="pointer-events-none absolute left-1/2 top-12 h-72 w-72 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,var(--brand)_0%,transparent_65%)] opacity-20 blur-xl [animation:float-slow_7s_ease-in-out_infinite]" />

        <div
          className={`mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground backdrop-blur-sm transition-all duration-700 ${heroReady ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Yapay zekâ destekli ürün araştırması
        </div>

        <h1
          className={`mx-auto max-w-4xl text-4xl font-extrabold leading-[1.08] md:text-6xl lg:text-7xl transition-all duration-700 delay-100 ${heroReady ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}
        >
          Kazandıran ürünü <span className="text-aurora">tahminle değil</span>, veriyle bul
        </h1>

        <p
          className={`mx-auto mt-6 max-w-2xl text-base text-muted-foreground md:text-lg transition-all duration-700 delay-200 ${heroReady ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"}`}
        >
          Aroless; ülke ve platform bazında komisyon, kargo, KDV ve reklam maliyetini hesaba katarak
          gerçekçi kâr projeksiyonu çıkarır. Ürünü bulur, doğrular, satış materyalini hazırlar.
        </p>

        <div
          className={`mt-10 flex flex-wrap items-center justify-center gap-4 transition-all duration-700 delay-300 ${heroReady ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"}`}
        >
          <Link
            to="/auth"
            className="glow group inline-flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-[var(--brand)] to-[var(--brand-2)] px-7 py-3.5 text-sm font-semibold text-white transition-all hover:scale-[1.04] hover:shadow-[0_0_40px_-8px_color-mix(in_oklab,var(--brand)_60%,transparent)]"
          >
            <Zap size={16} className="transition-transform group-hover:scale-110" />
            Ücretsiz başla
            <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
          </Link>
          <a
            href="#demo"
            className="inline-flex items-center gap-2.5 rounded-xl border border-white/15 bg-white/[0.04] px-6 py-3.5 text-sm font-semibold backdrop-blur-sm transition-all hover:border-white/25 hover:bg-white/[0.08]"
          >
            <Search size={16} /> Nişini test et
          </a>
          <Link
            to="/pricing"
            className="inline-flex items-center gap-2.5 rounded-xl border border-white/15 bg-white/[0.04] px-6 py-3.5 text-sm font-semibold backdrop-blur-sm transition-all hover:border-white/25 hover:bg-white/[0.08]"
          >
            Fiyatları gör
          </Link>
        </div>

        <div
          className={`mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2.5 text-xs text-muted-foreground transition-all duration-700 delay-[400ms] ${heroReady ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
        >
          <span className="inline-flex items-center gap-1.5">
            <Check size={13} className="text-emerald-400" /> Kredi kartı gerekmez
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Check size={13} className="text-emerald-400" /> Tek tıkla Google ile giriş
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Check size={13} className="text-emerald-400" /> 6 dil desteği
          </span>
        </div>

        {/* ---------- Animated stat counters ---------- */}
        <div className="mx-auto mt-16 grid max-w-4xl grid-cols-2 gap-3 md:grid-cols-4">
          <AnimatedStat value="22" label="Platform" />
          <AnimatedStat value="21" label="Ülke pazarı" />
          <AnimatedStat value="20" label="Analiz açısı" />
          <AnimatedStat value="0–100" label="Winner Score" />
        </div>

        {/* ---------- Interactive demo preview ---------- */}
        <div id="demo" className="mx-auto mt-16 max-w-5xl scroll-mt-24 text-left">
          <div className="relative overflow-hidden rounded-3xl border border-white/12 bg-white/[0.03] shadow-2xl shadow-black/20 backdrop-blur-xl">
            {/* Top aurora bar */}
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--brand)]/50 to-transparent" />

            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
              <div className="flex items-center gap-2.5 text-xs font-semibold text-foreground/90">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-[var(--brand)]/20 to-[var(--brand-2)]/20 text-[var(--brand)]">
                  <ScanSearch size={14} />
                </span>
                Fırsat taraması · {demoContext}
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-400">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> Canlı
                analiz
              </span>
            </div>

            <div className="border-b border-white/10 bg-white/[0.02] px-4 py-5 sm:px-6">
              <form
                className="flex flex-col gap-3 sm:flex-row sm:items-end"
                onSubmit={(event) => {
                  event.preventDefault();
                  applyNiche(niche);
                }}
              >
                <div className="min-w-0 flex-1">
                  <label htmlFor="landing-niche" className="text-xs font-semibold text-foreground">
                    Kendi nişinle önizle
                  </label>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Bir kategori yaz veya aşağıdaki hazır örneklerden birini seç.
                  </p>
                  <div className="relative mt-2">
                    <Search
                      size={15}
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    />
                    <input
                      id="landing-niche"
                      value={niche}
                      onChange={(event) => setNiche(event.target.value)}
                      placeholder="Örn. evcil hayvan, güzellik, outdoor"
                      className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] pl-9 pr-3 text-sm outline-none transition placeholder:text-muted-foreground/70 focus:border-[var(--brand)]/60 focus:ring-2 focus:ring-[var(--brand)]/20"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="glow group inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[var(--brand)] to-[var(--brand-2)] px-5 text-sm font-semibold text-white transition-all hover:scale-[1.02]"
                >
                  Önizlemeyi güncelle{" "}
                  <ArrowRight
                    size={15}
                    className="transition-transform group-hover:translate-x-0.5"
                  />
                </button>
              </form>
              <div
                className="mt-3.5 flex flex-wrap items-center gap-2"
                aria-label="Hızlı niş seçimi"
              >
                <span className="mr-1 text-[11px] text-muted-foreground">Hızlı seçim:</span>
                {DEMOS.map((item, index) => (
                  <button
                    key={`quick-${item.label}`}
                    type="button"
                    onClick={() => {
                      setNiche(item.label);
                      setDemoIndex(index);
                      setDemoContext(item.label);
                    }}
                    className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] text-muted-foreground transition-all hover:border-[var(--brand)]/40 hover:bg-white/[0.08] hover:text-foreground"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground" aria-live="polite">
                {demoContext === demo.label
                  ? `${demoContext} için seçilmiş örnek fırsatı inceliyorsun.`
                  : `${demoContext} için kişisel bir tarama başlatmaya hazırsın.`}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-4 py-3 sm:px-6">
              <span className="mr-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Pazarını seç
              </span>
              {DEMOS.map((item, index) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => setDemoIndex(index)}
                  aria-pressed={demoIndex === index}
                  className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all ${
                    demoIndex === index
                      ? "border-[var(--brand)]/60 bg-[var(--brand)]/15 text-foreground shadow-[0_0_16px_-6px_color-mix(in_oklab,var(--brand)_50%,transparent)]"
                      : "border-white/10 bg-white/[0.03] text-muted-foreground hover:bg-white/[0.08] hover:text-foreground"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="grid gap-5 p-4 sm:p-6 md:grid-cols-[1.15fr_0.85fr]">
              {/* Product card */}
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                      Kazanan aday
                    </p>
                    <h3
                      key={demo.product}
                      className="mt-2 animate-rise-in text-xl font-bold sm:text-2xl"
                    >
                      {demo.product}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {demo.platform} · {demo.country}
                    </p>
                  </div>
                  <div className="shrink-0 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-center">
                    <div className="text-2xl font-extrabold text-emerald-400">{demo.score}</div>
                    <div className="text-[9px] font-semibold uppercase tracking-wider text-emerald-400/70">
                      Winner Score
                    </div>
                  </div>
                </div>
                <div className="mt-6 grid grid-cols-3 gap-2.5">
                  {demo.metrics.map(([label, value]) => (
                    <div key={label} className="rounded-xl bg-white/[0.05] p-3">
                      <p className="text-[10px] text-muted-foreground">{label}</p>
                      <p className="mt-1.5 text-sm font-bold">{value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Signal summary */}
              <div className="flex flex-col justify-between rounded-2xl border border-[var(--brand)]/20 bg-[var(--brand)]/[0.08] p-4 sm:p-5">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <BarChart3 size={16} className="text-[var(--brand)]" /> Sinyal özeti
                  </div>
                  <div className="mt-5 space-y-4">
                    {demo.signals.map(([label, value, width]) => (
                      <div key={label}>
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">{label}</span>
                          <span className="font-medium text-foreground">{value}</span>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                          <div
                            className={`h-full rounded-full bg-gradient-to-r from-[var(--brand)] to-[var(--brand-2)] ${width} transition-all duration-700`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-6 flex items-center gap-2 border-t border-white/10 pt-4 text-xs text-muted-foreground">
                  <CircleDollarSign size={15} className="text-emerald-400" />
                  <span>
                    İlk test bütçesi: <strong className="text-foreground">{demo.budget}</strong>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Features ---------- */}
      <section id="features" className="relative mx-auto max-w-6xl px-4 py-20">
        <SectionHead sub="Araştırmadan reklama kadar tüm e-ticaret zincirini tek panelde topluyoruz.">
          Bir araştırma ekibinin yaptığını tek panelde yapar
        </SectionHead>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {FEATURES.map((f, i) => (
            <div
              key={f.title}
              className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-white/[0.07] hover:shadow-[0_20px_60px_-20px_oklch(0_0_0/0.6)]"
              style={{ animationDelay: `${i * 0.08}s` }}
            >
              {/* Hover gradient overlay */}
              <div
                className={`absolute inset-0 bg-gradient-to-br ${f.gradient} opacity-0 transition-opacity duration-300 group-hover:opacity-100`}
              />
              <div className="relative">
                <span
                  className={`grid h-12 w-12 place-items-center rounded-xl border border-white/10 bg-white/[0.06] ${f.iconColor} transition-transform duration-300 group-hover:scale-110`}
                >
                  <f.icon size={22} />
                </span>
                <h3 className="mt-4 font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- How it works ---------- */}
      <section id="how" className="relative mx-auto max-w-6xl px-4 py-20">
        <SectionHead sub="Basit üç adımda ilk kazandıran ürünlerini keşfet.">
          Üç adımda sonuç
        </SectionHead>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <div
              key={s.n}
              className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-[var(--brand)]/30 hover:bg-white/[0.07]"
            >
              {/* Number */}
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-[var(--brand)]/20 to-[var(--brand-2)]/20 text-sm font-bold text-[var(--brand)]">
                  {s.n}
                </span>
                <s.icon
                  size={20}
                  className="text-muted-foreground transition-colors group-hover:text-[var(--brand)]"
                />
              </div>
              <h3 className="mt-4 font-semibold">{s.t}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.d}</p>
              {/* Connecting flow line */}
              {i < 2 && (
                <div className="absolute -right-4 top-1/2 hidden h-px w-8 bg-gradient-to-r from-[var(--brand)]/40 to-transparent md:block" />
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Transparency / scoring ---------- */}
      <section className="relative mx-auto max-w-6xl px-4 py-20">
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center backdrop-blur-xl">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.06] to-transparent" />
          <div className="relative">
            <div className="mx-auto mb-3 inline-flex items-center justify-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
              <ShieldCheck size={14} className="text-emerald-400" /> Şeffaf skorlama
            </div>
            <h2 className="text-2xl font-bold md:text-3xl">Her puanın gerekçesi görünür</h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Winner Score paneli; doğrulanmış ve tahmini sinyalleri, kullanılan ağırlıkları ve
              kaynak bağlantılarını gösterir. Elenen ürünler için de neden elendiği (komisyon,
              teslimat, sertifika bariyeri) listelenir.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2 text-xs">
              {[
                "Trend skoru × 0.55",
                "Net marj eşiği",
                "Rekabet yoğunluğu",
                "Kargo & gümrük",
                "Sertifika bariyeri",
              ].map((c) => (
                <span
                  key={c}
                  className="rounded-full border border-white/10 bg-white/[0.05] px-3.5 py-1.5 text-muted-foreground transition-colors hover:border-[var(--brand)]/30 hover:text-foreground"
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Testimonials ---------- */}
      <section className="relative mx-auto max-w-6xl px-4 py-20">
        <SectionHead sub="Aynı ekibi işe almadan, aynı veriye erişin.">
          İhracatçılar Aroless ile hızlanıyor
        </SectionHead>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {TESTIMONIALS.map((t) => (
            <figure
              key={t.name}
              className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-white/[0.07] hover:shadow-[0_20px_60px_-20px_oklch(0_0_0/0.6)]"
            >
              <div className="flex gap-0.5 text-amber-400">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Star key={i} size={13} className="fill-current" />
                ))}
              </div>
              <blockquote className="mt-4 text-sm leading-relaxed text-foreground/90">
                “{t.quote}”
              </blockquote>
              <figcaption className="mt-5 flex items-center gap-3 border-t border-white/10 pt-4">
                <span
                  className={`grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br ${t.gradient} text-xs font-bold text-white`}
                >
                  {t.initials}
                </span>
                <span>
                  <span className="block text-sm font-semibold">{t.name}</span>
                  <span className="block text-[11px] text-muted-foreground">{t.role}</span>
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* ---------- FAQ ---------- */}
      <section id="faq" className="mx-auto max-w-3xl px-4 py-20">
        <SectionHead>Sık sorulanlar</SectionHead>
        <div className="mt-10 space-y-3">
          {FAQ.map((f) => (
            <details
              key={f.q}
              className="group overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-sm transition-all hover:border-white/15"
            >
              <summary className="cursor-pointer px-5 py-4 text-sm font-semibold list-none [&::-webkit-details-marker]:hidden">
                <span className="flex items-center justify-between">
                  {f.q}
                  <span className="text-muted-foreground transition-transform group-open:rotate-45 text-lg leading-none">
                    +
                  </span>
                </span>
              </summary>
              <div className="px-5 pb-4 text-sm leading-relaxed text-muted-foreground">{f.a}</div>
            </details>
          ))}
        </div>
      </section>

      {/* ---------- Final CTA ---------- */}
      <section className="relative mx-auto max-w-4xl px-4 pb-24">
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-10 text-center backdrop-blur-xl">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.06] to-transparent" />
          <div className="pointer-events-none absolute left-1/2 top-0 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,var(--brand)_0%,transparent_65%)] opacity-15 blur-3xl" />
          <div className="relative">
            <Cpu size={24} className="mx-auto text-[var(--brand)]" />
            <h2 className="mt-4 text-2xl font-bold md:text-3xl">
              Bugün ilk kazandıran ürününü bul
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Kaydol, hedef pazarını seç, motoru çalıştır.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                to="/auth"
                className="glow inline-flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-[var(--brand)] to-[var(--brand-2)] px-7 py-3.5 text-sm font-semibold text-white transition-all hover:scale-[1.04]"
              >
                <TrendingUp size={16} /> Ücretsiz hesap oluştur
                <ArrowRight size={16} />
              </Link>
              <Link
                to="/pricing"
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-6 py-3.5 text-sm font-semibold backdrop-blur-sm transition-all hover:border-white/25 hover:bg-white/[0.08]"
              >
                Fiyatları gör
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Footer ---------- */}
      <footer className="relative border-t border-white/10">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--brand)]/30 to-transparent" />
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 md:grid-cols-3 md:px-6">
          <div>
            <BrandLogo />
            <p className="mt-4 max-w-xs text-xs leading-relaxed text-muted-foreground">
              B2B e-ticaret altyapısı: ürün istihbaratı, tedarikçi analizi ve uyum araçları tek bir
              platformda.
            </p>
            <p className="mt-5 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <CheckCircle className="h-3.5 w-3.5 text-emerald-400" /> KVKK uyumlu veri işleme
            </p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Ürün
            </p>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li>
                <a
                  href="#features"
                  className="inline-flex items-center gap-1.5 text-muted-foreground transition-all duration-200 hover:text-foreground hover:translate-x-0.5"
                >
                  Özellikler
                </a>
              </li>
              <li>
                <a
                  href="#how"
                  className="inline-flex items-center gap-1.5 text-muted-foreground transition-all duration-200 hover:text-foreground hover:translate-x-0.5"
                >
                  Nasıl çalışır
                </a>
              </li>
              <li>
                <Link
                  to="/pricing"
                  className="inline-flex items-center gap-1.5 text-muted-foreground transition-all duration-200 hover:text-foreground hover:translate-x-0.5"
                >
                  Fiyatlandırma
                </Link>
              </li>
              <li>
                <a
                  href="#faq"
                  className="inline-flex items-center gap-1.5 text-muted-foreground transition-all duration-200 hover:text-foreground hover:translate-x-0.5"
                >
                  SSS
                </a>
              </li>
            </ul>
          </div>
          <div>
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <Shield className="h-3.5 w-3.5" /> Yasal & Uyum
            </p>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li>
                <Link
                  to="/legal/$slug"
                  params={{ slug: "kullanim-kosullari" }}
                  className="inline-flex items-center gap-1.5 text-muted-foreground transition-all duration-200 hover:text-foreground hover:translate-x-0.5"
                >
                  <FileText className="h-3.5 w-3.5" /> Kullanım Koşulları
                </Link>
              </li>
              <li>
                <Link
                  to="/legal/$slug"
                  params={{ slug: "kvkk-aydinlatma-metni" }}
                  className="inline-flex items-center gap-1.5 text-muted-foreground transition-all duration-200 hover:text-foreground hover:translate-x-0.5"
                >
                  <FileText className="h-3.5 w-3.5" /> KVKK Aydınlatma Metni
                </Link>
              </li>
              <li>
                <button
                  type="button"
                  onClick={openCookiePreferences}
                  className="inline-flex items-center gap-1.5 text-muted-foreground transition-all duration-200 hover:text-foreground hover:translate-x-0.5"
                >
                  <CheckCircle className="h-3.5 w-3.5" /> Çerez Tercihleri
                </button>
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-white/[0.06] px-4 py-5 text-center text-[11px] text-muted-foreground">
          © {new Date().getFullYear()} Aroless. Tüm hakları saklıdır.
        </div>
      </footer>
    </div>
  );
}
