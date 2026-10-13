/**
 * AFFILIATE PROGRAMI — halka açık tanıtım sayfası (/affiliate).
 *
 * NEDEN VAR: program uygulamanın içinde (Ayarlar → Affiliate) çalışıyordu ama
 * dışarıdan bakan bir influencer programın varlığını, oranını ve koşullarını
 * hiçbir yerde göremiyordu. Tanıtım sayfası olmadan başvuru akışı fiilen
 * "linki olan bilir" hâline düşer.
 *
 * SAYILAR KODDAN GELİR: oran, 12 aylık pencere, $75 eşiği ve 30 günlük bekleme
 * burada elle yazılmaz — `affiliate.ts` / `affiliate-payout.ts` sabitlerinden
 * okunur. Böylece sayfa, sunucunun gerçekte uyguladığı kuraldan sapamaz
 * (test: `affiliate-program-page.test.tsx`).
 */
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  Coins,
  FileText,
  Percent,
  ShieldCheck,
  Ticket,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import {
  COMMISSION_MAX_MONTHS,
  DEFAULT_COMMISSION_RATE_PCT,
  MIN_PAYOUT_CENTS,
} from "@/lib/affiliate";
import { PAYOUT_HOLD_DAYS } from "@/lib/affiliate-payout";
import { BrandLogo } from "@/components/brand-logo";

const TERMS_HREF = "/legal/affiliate-program-sartlari";

const STEPS = [
  {
    icon: ShieldCheck,
    title: "1 · Başvur",
    body: "Ayarlar → Affiliate panelinden kitleni ve kanallarını beyan edip program şartlarını kabul ederek başvur. Başvurun admin onayına düşer.",
  },
  {
    icon: Ticket,
    title: "2 · Kodunu al",
    body: "Onaydan sonra hesabına özel bir affiliate kodu tanımlanır. Paylaşacağın link `/auth?promo=KOD` biçimindedir.",
  },
  {
    icon: Coins,
    title: "3 · Paylaş, komisyon biriksin",
    body: `Kodunla gelen her müşteri aboneliğini sürdürdüğü sürece her yenileme ödemesinden %${DEFAULT_COMMISSION_RATE_PCT} komisyon yazılır — bir müşteri için en fazla ${COMMISSION_MAX_MONTHS} ay.`,
  },
  {
    icon: Wallet,
    title: "4 · Ödemeni al",
    body: `Ödenebilir bakiyen $${MIN_PAYOUT_CENTS / 100} eşiğini geçtiğinde ödeme Wise veya IBAN ile yapılır. Her komisyon, iade riskine karşı ödemeden önce ${PAYOUT_HOLD_DAYS} gün bekletilir.`,
  },
] as const;

const RULES = [
  {
    icon: Percent,
    title: `%${DEFAULT_COMMISSION_RATE_PCT} oran`,
    body: "Sabit oran; hesabına özel farklı bir oran tanımlanırsa panelde ve ödeme kaydında o görünür.",
  },
  {
    icon: CalendarClock,
    title: `En fazla ${COMMISSION_MAX_MONTHS} ay`,
    body: "Müşteri kaç ay ücretli kaldıysa o kadar. Aboneliğini bırakırsa komisyon o ay durur; 12 ay sonrası yeni komisyon doğmaz.",
  },
  {
    icon: Coins,
    title: `${PAYOUT_HOLD_DAYS} gün bekleme`,
    body: "İade/chargeback ödemeden sonra gelirse para geri alınamaz; bu yüzden komisyon ödenmeden önce bekletilir.",
  },
  {
    icon: Wallet,
    title: `$${MIN_PAYOUT_CENTS / 100} eşiği`,
    body: "Altındaki bakiyeler birikir ve devreder. Ödeme manuel ve dönemsel yapılır; referans numarasıyla kaydedilir.",
  },
  {
    icon: TriangleAlert,
    title: "İade mahsubu",
    body: "İade edilen veya itiraza uğrayan ödemenin komisyonu düşülür. Bu ay 12 aylık pencereyi tüketmez.",
  },
  {
    icon: BadgeCheck,
    title: "Doğrulanmış hesap şartı",
    body: "Komisyon yalnız admin onaylı (verified) hesaplara yazılır. Askıya alınan hesabın yeni komisyonu doğmaz.",
  },
] as const;

const FAQ = [
  {
    q: "Kodum takipçilere indirim veriyor mu?",
    a: "Hayır. Affiliate kodu komisyonun kime gideceğini belirler; uygulama indirim hesaplamaz. İndirimler tek kaynaktan (Paddle paneli) yönetilir — orada aynı metinle bir indirim tanımlarsan takipçin onu kullanabilir.",
  },
  {
    q: "Ödeme ne zaman yapılır?",
    a: `Ödenebilir bakiyen $${MIN_PAYOUT_CENTS / 100} eşiğini geçtiğinde. Her komisyon ayrıca ${PAYOUT_HOLD_DAYS} gün bekler; beklemedeki tutar ödenemez. Ödeme tarihini garanti etmiyoruz — ödemeler manuel yapılır.`,
  },
  {
    q: "Vergi numarası vermek zorunda mıyım?",
    a: "Hayır, opsiyoneldir ve ödeme için şart değildir. Bazı ülkelerde banka veya Wise yüksek tutarlı transferlerde isteyebilir; o durumda bilgi sana iletilecektir. Vergi/mükellefiyet yükümlülüğü sana aittir.",
  },
  {
    q: "Kendi hesabımdan alım yaparsam?",
    a: "Kendine atıf yasaktır. Aynı cihazdan kendi kodunla açılan ikinci hesap atıf üretmez ve tespit edilirse komisyon ödenmez.",
  },
  {
    q: "Başvurum ne zaman onaylanır?",
    a: 'Başvurular elle incelenir: kanal kitle ve uyum kontrolü yapılır. Onaylandığında panelde durumun "Onaylı Affiliate" olur ve kodun aktifleşir.',
  },
] as const;

export function AffiliateProgramPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 md:px-6">
      <div className="mb-10 flex items-center justify-between gap-3">
        <BrandLogo />
        <Link
          to="/auth"
          className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
        >
          Başvuru için giriş yap
        </Link>
      </div>

      {/* HERO */}
      <header className="max-w-3xl">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          <Coins className="h-3.5 w-3.5" /> Affiliate programı
        </span>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight md:text-5xl">
          Getirdiğin müşteri ücretli kaldıkça{" "}
          <span className="text-gradient">%{DEFAULT_COMMISSION_RATE_PCT} komisyon</span>
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Aylık yinelenen komisyon, bir müşteri için en fazla{" "}
          <b className="text-foreground">{COMMISSION_MAX_MONTHS} ay</b> — müşteri kaç ay ücretli
          kaldıysa o kadar. Eşik {`$${MIN_PAYOUT_CENTS / 100}`}, bekleme {PAYOUT_HOLD_DAYS} gün,
          ödeme Wise veya IBAN ile.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            to="/auth"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Programı başlat <ArrowRight className="h-4 w-4" />
          </Link>
          <a
            href={TERMS_HREF}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card/40 px-5 py-3 text-sm font-medium transition-colors hover:bg-accent/20"
          >
            <FileText className="h-4 w-4" /> Program şartları
          </a>
        </div>
      </header>

      {/* NASIL ÇALIŞIR */}
      <section className="mt-14">
        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Nasıl çalışır?</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="rounded-2xl border border-border bg-card/40 p-5 backdrop-blur transition-colors hover:bg-accent/10"
            >
              <Icon className="h-5 w-5 text-[var(--brand,var(--primary))]" />
              <p className="mt-3 text-sm font-semibold text-foreground">{title}</p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* KURALLAR — sayılar koddan gelir, elle yazılmaz */}
      <section className="mt-14">
        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
          Komisyon ve ödeme kuralları
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Aşağıdaki sayılar platformun gerçekte uyguladığı kurallardır. Panelde ve ödeme kaydında da
          aynı değerler görünür.
        </p>
        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {RULES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-2xl border border-border bg-card/40 p-5">
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-[var(--brand,var(--primary))]" />
                <p className="text-sm font-semibold text-foreground">{title}</p>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* SSS */}
      <section className="mt-14">
        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Sık sorulanlar</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {FAQ.map((item) => (
            <div key={item.q} className="rounded-2xl border border-border bg-card/40 p-5">
              <p className="text-sm font-semibold text-foreground">{item.q}</p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* KAPANIŞ CTA */}
      <section className="mt-14 rounded-3xl border border-border bg-card/40 p-8 text-center backdrop-blur">
        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
          Başvurun birkaç dakika sürer
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground">
          Kitle/kanal beyanı ve şartların kabulü yeterli. Onaydan sonra affiliate kodun panelde
          görünür; kazancını ve beklemede/ödenebilir bakiyeni aynı yerden takip edersin.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/auth"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Giriş yap ve başvur <ArrowRight className="h-4 w-4" />
          </Link>
          <a
            href={TERMS_HREF}
            className="inline-flex items-center gap-2 rounded-xl border border-border px-5 py-3 text-sm font-medium transition-colors hover:bg-accent/20"
          >
            Şartları oku
          </a>
        </div>
        <p className="mt-4 text-[11px] text-muted-foreground">
          Başvuru ve ödemeler manuel ilerler; onay süresi garanti edilmez. Ödeme tarihi vaat
          edilmez.
        </p>
      </section>
    </div>
  );
}
