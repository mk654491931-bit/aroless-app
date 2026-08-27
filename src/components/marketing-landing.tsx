import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Search,
  Sparkles,
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
} from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";

const FEATURES = [
  {
    icon: Search,
    title: "Ürün Bulucu",
    text: "20 farklı analiz açısıyla üretilen adaylar, Winner Score ile 0–100 arası puanlanır.",
  },
  {
    icon: Globe,
    title: "Ülke + platform hassasiyeti",
    text: "22 platform, 21 ülke: komisyon, teslimat süresi, KDV ve sertifika bariyerleri hesaba katılır.",
  },
  {
    icon: Gauge,
    title: "Gerçek birim ekonomisi",
    text: "Tedarik, kargo, komisyon, iade ve reklam maliyetiyle net kâr — uydurma değil, kaynaklı.",
  },
  {
    icon: Radar,
    title: "Trend radarı & haber akışı",
    text: "Saatlik güncellenen e-ticaret gelişmeleri ve yükselen trendler.",
  },
  {
    icon: Gamepad2,
    title: "Mağaza simülatörü",
    text: "30 günlük sezonlar, rakipler, kampanya takvimi ve nakit akışıyla risksiz pratik.",
  },
  {
    icon: GraduationCap,
    title: "Akademi",
    text: "XP, seviye ve rozetlerle ilerleyen uçtan uca e-ticaret müfredatı.",
  },
];

const STEPS = [
  {
    n: "01",
    t: "Niş, ülke ve platformunu seç",
    d: "Bütçe ve hedef kitleyi belirt, motoru çalıştır.",
  },
  {
    n: "02",
    t: "Puanlanmış ürünleri incele",
    d: "Winner Score, kâr tablosu ve neden seçildi/elendi gerekçeleri.",
  },
  {
    n: "03",
    t: "Karşılaştır ve harekete geç",
    d: "Yan yana karşılaştırma, SEO kiti, reklam senaryoları ve dışa aktarma.",
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

export function MarketingLanding() {
  const [demoIndex, setDemoIndex] = useState(0);
  const [niche, setNiche] = useState("");
  const [demoContext, setDemoContext] = useState("Ev yaşam");
  const demo = DEMOS[demoIndex];

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
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[var(--surface)]/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <BrandLogo />
          <nav className="hidden items-center gap-5 text-sm text-muted-foreground md:flex">
            <a href="#features" className="hover:text-foreground">
              Özellikler
            </a>
            <a href="#how" className="hover:text-foreground">
              Nasıl çalışır
            </a>
            <Link to="/pricing" className="hover:text-foreground">
              Fiyatlandırma
            </Link>
            <a href="#faq" className="hover:text-foreground">
              SSS
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Link
              to="/auth"
              className="rounded-lg border border-white/10 px-3 py-1.5 text-sm hover:bg-white/10"
            >
              Giriş yap
            </Link>
            <Link
              to="/auth"
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
            >
              Ücretsiz başla
            </Link>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 pb-16 pt-16 text-center md:pt-24">
        <div className="mx-auto mb-5 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider">
          <Sparkles size={12} className="text-[oklch(0.75_0.18_265)]" /> Yapay zekâ destekli ürün
          araştırması
        </div>
        <h1 className="mx-auto max-w-3xl text-4xl font-extrabold leading-tight md:text-6xl">
          Kazandıran ürünü <span className="text-gradient">tahminle değil</span>, veriyle bul
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground md:text-lg">
          Aroless; ülke ve platform bazında komisyon, kargo, KDV ve reklam maliyetini hesaba katarak
          gerçekçi kâr projeksiyonu çıkarır. Ürünü bulur, doğrular, satış materyalini hazırlar.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/auth"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground"
          >
            Ücretsiz başla <ArrowRight size={16} />
          </Link>
          <a
            href="#demo"
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-5 py-3 text-sm font-semibold hover:bg-white/5"
          >
            Nişini test et <Search size={16} />
          </a>
          <Link
            to="/pricing"
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-5 py-3 text-sm font-semibold hover:bg-white/5"
          >
            Fiyatları gör
          </Link>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Check size={13} /> Kredi kartı gerekmez
          </span>
          <span className="inline-flex items-center gap-1">
            <Check size={13} /> Tek tıkla Google ile giriş
          </span>
          <span className="inline-flex items-center gap-1">
            <Check size={13} /> 6 dil desteği
          </span>
        </div>

        <div className="mx-auto mt-14 grid max-w-4xl grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { k: "22", v: "Platform" },
            { k: "21", v: "Ülke pazarı" },
            { k: "20", v: "Analiz açısı" },
            { k: "0–100", v: "Winner Score" },
          ].map((s) => (
            <div key={s.v} className="glass rounded-2xl p-4">
              <div className="text-2xl font-extrabold text-gradient">{s.k}</div>
              <div className="text-xs text-muted-foreground">{s.v}</div>
            </div>
          ))}
        </div>

        <div id="demo" className="mx-auto mt-12 max-w-5xl scroll-mt-24 text-left">
          <div className="glass overflow-hidden rounded-3xl border-white/15 shadow-2xl shadow-black/20">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground/90">
                <span className="grid h-6 w-6 place-items-center rounded-lg bg-primary/15 text-primary">
                  <ScanSearch size={14} />
                </span>
                Fırsat taraması · {demoContext}
              </div>
              <span className="inline-flex items-center gap-1.5 text-[11px] text-profit">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-profit" /> Canlı analiz
              </span>
            </div>
            <div className="border-b border-white/10 bg-white/[0.025] px-4 py-4 sm:px-6">
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
                      className="h-10 w-full rounded-xl border border-white/10 bg-black/10 pl-9 pr-3 text-sm outline-none transition placeholder:text-muted-foreground/70 focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
                >
                  Önizlemeyi güncelle <ArrowRight size={15} />
                </button>
              </form>
              <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Hızlı niş seçimi">
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
                    className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
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
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    demoIndex === index
                      ? "border-primary/60 bg-primary/15 text-foreground"
                      : "border-white/10 bg-white/[0.03] text-muted-foreground hover:bg-white/10 hover:text-foreground"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="grid gap-5 p-4 sm:p-6 md:grid-cols-[1.15fr_0.85fr]">
              <div className="rounded-2xl border border-white/10 bg-black/10 p-4 sm:p-5">
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
                  <div className="shrink-0 rounded-2xl border border-profit/30 bg-profit/10 px-3 py-2 text-center">
                    <div className="text-2xl font-extrabold text-profit">{demo.score}</div>
                    <div className="text-[9px] font-semibold uppercase tracking-wider text-profit/80">
                      Winner Score
                    </div>
                  </div>
                </div>
                <div className="mt-6 grid grid-cols-3 gap-2">
                  {demo.metrics.map(([label, value]) => (
                    <div key={label} className="rounded-xl bg-white/5 p-3">
                      <p className="text-[10px] text-muted-foreground">{label}</p>
                      <p className="mt-1 text-sm font-bold">{value}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex flex-col justify-between rounded-2xl border border-primary/20 bg-primary/10 p-4 sm:p-5">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <BarChart3 size={16} className="text-primary" /> Sinyal özeti
                  </div>
                  <div className="mt-5 space-y-4">
                    {demo.signals.map(([label, value, width]) => (
                      <div key={label}>
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">{label}</span>
                          <span className="font-medium text-foreground">{value}</span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                          <div className={`h-full rounded-full bg-primary ${width}`} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-6 flex items-center gap-2 border-t border-white/10 pt-4 text-xs text-muted-foreground">
                  <CircleDollarSign size={15} className="text-profit" />
                  <span>
                    İlk test bütçesi: <strong className="text-foreground">{demo.budget}</strong>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-center text-2xl font-bold md:text-3xl">
          Bir araştırma ekibinin yaptığını tek panelde yapar
        </h2>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="glass rounded-2xl p-5">
              <f.icon size={20} className="text-[oklch(0.75_0.18_265)]" />
              <h3 className="mt-3 font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-center text-2xl font-bold md:text-3xl">Üç adımda sonuç</h2>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="glass rounded-2xl p-5">
              <div className="text-xs font-bold tracking-widest text-[oklch(0.75_0.18_265)]">
                {s.n}
              </div>
              <h3 className="mt-2 font-semibold">{s.t}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="glass rounded-3xl p-8 text-center">
          <div className="mx-auto mb-3 flex items-center justify-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <ShieldCheck size={14} /> Şeffaf skorlama
          </div>
          <h2 className="text-2xl font-bold md:text-3xl">Her puanın gerekçesi görünür</h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground">
            Winner Score paneli; doğrulanmış ve tahmini sinyalleri, kullanılan ağırlıkları ve kaynak
            bağlantılarını gösterir. Elenen ürünler için de neden elendiği (komisyon, teslimat,
            sertifika bariyeri) listelenir.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2 text-xs">
            {[
              "Trend skoru × 0.55",
              "Net marj eşiği",
              "Rekabet yoğunluğu",
              "Kargo & gümrük",
              "Sertifika bariyeri",
            ].map((c) => (
              <span key={c} className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                {c}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-3xl px-4 py-16">
        <h2 className="text-center text-2xl font-bold md:text-3xl">Sık sorulanlar</h2>
        <div className="mt-8 space-y-3">
          {FAQ.map((f) => (
            <details key={f.q} className="glass rounded-2xl p-4">
              <summary className="cursor-pointer text-sm font-semibold">{f.q}</summary>
              <p className="mt-2 text-sm text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-4 pb-24">
        <div className="glass rounded-3xl p-8 text-center">
          <Cpu size={22} className="mx-auto text-[oklch(0.75_0.18_265)]" />
          <h2 className="mt-3 text-2xl font-bold md:text-3xl">Bugün ilk kazandıran ürününü bul</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Kaydol, hedef pazarını seç, motoru çalıştır.
          </p>
          <Link
            to="/auth"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground"
          >
            <TrendingUp size={16} /> Ücretsiz hesap oluştur
          </Link>
        </div>
      </section>
    </div>
  );
}
