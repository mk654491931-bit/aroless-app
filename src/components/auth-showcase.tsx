import {
  Search,
  Globe,
  Gauge,
  Radar,
  Gamepad2,
  GraduationCap,
  ArrowDown,
  Sparkles,
  Cpu,
  ShieldCheck,
} from "lucide-react";
import { ArolessMark } from "@/components/velora-mark";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";

const FEATURES = [
  { icon: Search, title: "Ürün Bulucu", text: "20 analiz açısı ile üretilen adaylar, Winner Score ile 0–100 puanlanır." },
  { icon: Globe, title: "Ülke + platform hassasiyeti", text: "22 platform, 21 ülke: komisyon, teslimat, KDV ve sertifika bariyerleri." },
  { icon: Gauge, title: "Gerçek birim ekonomisi", text: "Tedarik, kargo, komisyon, iade ve reklam maliyetiyle kaynaklı net kâr." },
  { icon: Radar, title: "Trend radarı", text: "Saatlik güncellenen e-ticaret gelişmeleri ve yükselen ürün sinyalleri." },
  { icon: Gamepad2, title: "Mağaza simülatörü", text: "30 günlük sezonlar, rakipler ve nakit akışıyla risksiz pratik." },
  { icon: GraduationCap, title: "Akademi", text: "XP, seviye ve rozetlerle ilerleyen uçtan uca e-ticaret müfredatı." },
];

const STEPS = [
  { n: "01", t: "Niş, ülke ve platform seç", d: "Bütçeni ve hedef kitleni belirt, motoru çalıştır." },
  { n: "02", t: "Puanlanmış ürünleri incele", d: "Winner Score, kâr tablosu ve neden seçildi/elendi gerekçeleri." },
  { n: "03", t: "Karşılaştır ve harekete geç", d: "Yan yana karşılaştırma, SEO kiti, reklam senaryoları, dışa aktarma." },
];

const STATS = [
  { k: "12M+", v: "taranan ürün sinyali" },
  { k: "22", v: "pazar yeri & platform" },
  { k: "21", v: "ülke ekonomisi" },
  { k: "3x", v: "hibrit AI modeli" },
];

export function AuthShowcase() {
  const ref = useScrollReveal<HTMLDivElement>();

  return (
    <div ref={ref} className="relative mx-auto w-full max-w-6xl px-4 sm:px-5">
      {/* ---------- Intro cover ---------- */}
      <section className="flex min-h-[80svh] flex-col items-center justify-center py-12 text-center sm:min-h-[86svh] sm:py-16">
        <div className="animate-rise-in inline-flex items-center gap-2 rounded-full border border-border bg-card/40 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground backdrop-blur sm:px-3.5 sm:text-[11px] sm:tracking-[0.28em]">
          <Sparkles className="h-3.5 w-3.5 animate-pulse-soft" />
          AI Commerce OS
        </div>

        <div
          className="animate-rise-in mt-6 flex w-full items-center justify-center gap-3 sm:mt-8 sm:gap-4"
          style={{ animationDelay: "80ms" }}
        >
          <ArolessMark size={44} className="shrink-0 sm:hidden" />
          <ArolessMark size={64} className="hidden shrink-0 sm:block" />
          <h1
            className="min-w-0 font-extralight uppercase leading-none tracking-[0.18em] sm:tracking-[0.3em]"
            style={{ fontSize: "clamp(1.75rem,8vw,4.5rem)" }}
            aria-label="Aroless"
          >
            {"AROLESS".split("").map((ch, i) => (
              <span
                key={`${ch}-${i}`}
                aria-hidden
                className="velora-letter velora-shine"
                style={{ animationDelay: `${i * 0.09}s` }}
              >
                {ch}
              </span>
            ))}
          </h1>
        </div>

        <p
          className="animate-rise-in mx-auto mt-6 max-w-2xl text-balance text-sm text-muted-foreground sm:mt-7 sm:text-base md:text-xl"
          style={{ animationDelay: "160ms" }}
        >
          Kazandıran ürünü <span className="text-gradient font-semibold">tahminle değil, veriyle</span> buluyoruz.
          Aroless; ülke ve platform bazında komisyon, kargo, KDV ve reklam maliyetini hesaba katarak gerçekçi kâr
          projeksiyonu çıkarır — ürünü bulur, doğrular, satış materyalini hazırlar.
        </p>

        <div
          className="animate-rise-in mt-8 grid w-full max-w-3xl grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-4"
          style={{ animationDelay: "240ms" }}
        >
          {STATS.map((s) => (
            <div key={s.k} className="premium-card min-w-0 px-3 py-3.5 sm:py-4">
              <div className="text-lg font-semibold sm:text-xl md:text-2xl">{s.k}</div>
              <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground sm:text-[11px]">
                {s.v}
              </div>
            </div>
          ))}
        </div>

        <a
          href="#signin"
          className="animate-rise-in card-lift mt-9 inline-flex items-center gap-2 rounded-full border border-border bg-card/50 px-5 py-2.5 text-sm text-muted-foreground backdrop-blur hover:text-foreground sm:mt-10"
          style={{ animationDelay: "320ms" }}
        >
          Keşfet, sonra giriş yap
          <ArrowDown className="h-4 w-4 animate-bounce" />
        </a>
      </section>

      {/* ---------- What we do ---------- */}
      <section className="py-12 sm:py-14">
        <h2 data-reveal className="text-center text-xl font-semibold sm:text-2xl md:text-3xl">
          Biz ne yapıyoruz?
        </h2>
        <p
          data-reveal
          className="mx-auto mt-3 max-w-xl text-center text-sm text-muted-foreground"
          style={{ ["--reveal-delay" as string]: "80ms" }}
        >
          Araştırmadan reklama kadar tüm e-ticaret zincirini tek panelde topluyoruz.
        </p>
        <div className="mt-8 grid gap-3 sm:mt-10 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <div
              key={f.title}
              data-reveal
              className="premium-card card-lift p-4 sm:p-5"
              style={{ ["--reveal-delay" as string]: `${(i % 3) * 90}ms` }}
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border bg-card/60">
                <f.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 text-sm font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- How it works ---------- */}
      <section className="py-12 sm:py-14">
        <h2 data-reveal className="text-center text-xl font-semibold sm:text-2xl md:text-3xl">
          Nasıl çalışır?
        </h2>
        <div className="mt-8 grid gap-3 sm:mt-10 sm:gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <div
              key={s.n}
              data-reveal
              className="premium-card p-4 sm:p-5"
              style={{ ["--reveal-delay" as string]: `${i * 110}ms` }}
            >
              <div className="text-[11px] font-semibold tracking-[0.3em] text-[var(--brand)]">{s.n}</div>
              <h3 className="mt-3 text-sm font-semibold">{s.t}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{s.d}</p>
            </div>
          ))}
        </div>

        <div
          data-reveal
          className="mt-9 flex flex-wrap items-center justify-center gap-3 text-xs text-muted-foreground sm:mt-10 sm:gap-4"
        >
          <span className="inline-flex items-center gap-1.5"><Cpu className="h-3.5 w-3.5" /> Hibrit AI motoru</span>
          <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Kaynaklı tahminler</span>
          <span className="inline-flex items-center gap-1.5"><Globe className="h-3.5 w-3.5" /> 21 ülke ekonomisi</span>
        </div>
      </section>

      {/* separator so the showcase never collides with the auth card */}
      <div aria-hidden className="mx-auto h-px w-full max-w-3xl bg-border/70" />
    </div>
  );
}
