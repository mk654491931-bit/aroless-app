import { Link } from "@tanstack/react-router";
import {
  Search, Sparkles, ShieldCheck, Gauge, Globe, Radar, GraduationCap, Gamepad2,
  ArrowRight, Check, Cpu, TrendingUp,
} from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";

const FEATURES = [
  { icon: Search, title: "Ürün Bulucu", text: "20 farklı analiz açısıyla üretilen adaylar, Winner Score ile 0–100 arası puanlanır." },
  { icon: Globe, title: "Ülke + platform hassasiyeti", text: "22 platform, 21 ülke: komisyon, teslimat süresi, KDV ve sertifika bariyerleri hesaba katılır." },
  { icon: Gauge, title: "Gerçek birim ekonomisi", text: "Tedarik, kargo, komisyon, iade ve reklam maliyetiyle net kâr — uydurma değil, kaynaklı." },
  { icon: Radar, title: "Trend radarı & haber akışı", text: "Saatlik güncellenen e-ticaret gelişmeleri ve yükselen trendler." },
  { icon: Gamepad2, title: "Mağaza simülatörü", text: "30 günlük sezonlar, rakipler, kampanya takvimi ve nakit akışıyla risksiz pratik." },
  { icon: GraduationCap, title: "Akademi", text: "XP, seviye ve rozetlerle ilerleyen uçtan uca e-ticaret müfredatı." },
];

const STEPS = [
  { n: "01", t: "Niş, ülke ve platformunu seç", d: "Bütçe ve hedef kitleyi belirt, motoru çalıştır." },
  { n: "02", t: "Puanlanmış ürünleri incele", d: "Winner Score, kâr tablosu ve neden seçildi/elendi gerekçeleri." },
  { n: "03", t: "Karşılaştır ve harekete geç", d: "Yan yana karşılaştırma, SEO kiti, reklam senaryoları ve dışa aktarma." },
];

const FAQ = [
  { q: "Velora ne yapar?", a: "E-ticaret satıcıları için kazandıran ürünleri bulur, ülke ve platform bazında kârlılığını hesaplar ve pazarlama materyallerini hazırlar." },
  { q: "Ücretsiz deneyebilir miyim?", a: "Evet, kayıt olduğunda başlangıç kredin tanımlanır. Kredi bitince paketlerden birine geçebilirsin." },
  { q: "Veriler gerçek mi?", a: "Tahminler kaynaklarıyla birlikte gösterilir: doğrulanmış sinyaller ve tahmini sinyaller panelde ayrı ayrı listelenir." },
];

export function MarketingLanding() {
  return (
    <div className="relative min-h-screen">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[var(--surface)]/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <BrandLogo />
          <nav className="hidden items-center gap-5 text-sm text-muted-foreground md:flex">
            <a href="#features" className="hover:text-foreground">Özellikler</a>
            <a href="#how" className="hover:text-foreground">Nasıl çalışır</a>
            <Link to="/pricing" className="hover:text-foreground">Fiyatlandırma</Link>
            <a href="#faq" className="hover:text-foreground">SSS</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link to="/auth" className="rounded-lg border border-white/10 px-3 py-1.5 text-sm hover:bg-white/10">Giriş yap</Link>
            <Link to="/auth" className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">Ücretsiz başla</Link>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 pb-16 pt-16 text-center md:pt-24">
        <div className="mx-auto mb-5 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider">
          <Sparkles size={12} className="text-[oklch(0.75_0.18_265)]" /> Yapay zekâ destekli ürün araştırması
        </div>
        <h1 className="mx-auto max-w-3xl text-4xl font-extrabold leading-tight md:text-6xl">
          Kazandıran ürünü <span className="text-gradient">tahminle değil</span>, veriyle bul
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground md:text-lg">
          Velora; ülke ve platform bazında komisyon, kargo, KDV ve reklam maliyetini hesaba katarak gerçekçi kâr
          projeksiyonu çıkarır. Ürünü bulur, doğrular, satış materyalini hazırlar.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link to="/auth" className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground">
            Ücretsiz başla <ArrowRight size={16} />
          </Link>
          <Link to="/pricing" className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-5 py-3 text-sm font-semibold hover:bg-white/5">
            Fiyatları gör
          </Link>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Check size={13} /> Kredi kartı gerekmez</span>
          <span className="inline-flex items-center gap-1"><Check size={13} /> Tek tıkla Google ile giriş</span>
          <span className="inline-flex items-center gap-1"><Check size={13} /> 6 dil desteği</span>
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
      </section>

      <section id="features" className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-center text-2xl font-bold md:text-3xl">Bir araştırma ekibinin yaptığını tek panelde yapar</h2>
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
              <div className="text-xs font-bold tracking-widest text-[oklch(0.75_0.18_265)]">{s.n}</div>
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
            Winner Score paneli; doğrulanmış ve tahmini sinyalleri, kullanılan ağırlıkları ve kaynak bağlantılarını
            gösterir. Elenen ürünler için de neden elendiği (komisyon, teslimat, sertifika bariyeri) listelenir.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2 text-xs">
            {["Trend skoru × 0.55", "Net marj eşiği", "Rekabet yoğunluğu", "Kargo & gümrük", "Sertifika bariyeri"].map((c) => (
              <span key={c} className="rounded-full border border-white/10 bg-white/5 px-3 py-1">{c}</span>
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
          <p className="mt-2 text-sm text-muted-foreground">Kaydol, hedef pazarını seç, motoru çalıştır.</p>
          <Link to="/auth" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground">
            <TrendingUp size={16} /> Ücretsiz hesap oluştur
          </Link>
        </div>
      </section>
    </div>
  );
}
