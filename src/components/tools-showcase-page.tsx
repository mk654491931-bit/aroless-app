/**
 * ARAÇ MERKEZİ — halka açık tanıtım sayfası (/tools).
 *
 * NEDEN VAR: 22 AI aracı uygulamanın içinde çalışıyordu ama dışarıdan bakan bir
 * ziyaretçi (ya da Aroless'i tanıtan bir ortak) hangi araçların olduğunu hiçbir
 * yerde göremiyordu; araçların tek girişi giriş yapmış kullanıcının kenar
 * çubuğuydu. Public sayfa olmadan araçların varlığı "linki olan bilir" hâline
 * düşer.
 *
 * LİSTE KODDAN GELİR: modüller, araç adları ve hedef rotalar burada elle
 * yazılmaz — `tools-catalog.ts` okunur. Böylece sunucuya yeni bir `ToolId`
 * eklendiğinde sayfanın ondan habersiz kalması derleme/test aşamasında yakalanır
 * (test: `tools-catalog.test.ts`).
 *
 * KAPI: araç kartlarının linkleri gerçek araç ekranlarına gider; giriş
 * yapmamış ziyaretçiyi o ekran kendi kapısıyla (/auth) karşılar. Bu yüzden
 * sayfa burada hak talebi üretmez, yalnız listeler.
 */
import { Link } from "@tanstack/react-router";
import { ArrowRight, BadgeCheck, Coins, Wrench } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { TOOL_ENTRY_COUNT, TOOL_HUBS } from "@/lib/tools-catalog";

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card/40 px-4 py-3">
      <p className="text-xl font-extrabold tracking-tight text-foreground">{value}</p>
      <p className="mt-0.5 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

export function ToolsShowcasePage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 md:px-6">
      <div className="mb-10 flex flex-wrap items-center justify-between gap-3">
        <BrandLogo />
        <div className="flex items-center gap-2">
          <Link
            to="/pricing"
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent/20"
          >
            Fiyatları gör
          </Link>
          <Link
            to="/auth"
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
          >
            Ücretsiz başla
          </Link>
        </div>
      </div>

      {/* HERO */}
      <header className="max-w-3xl">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          <Wrench className="h-3.5 w-3.5" /> Araç merkezi
        </span>
        {/*
          Başlık TEK metin düğümü: parçalara bölünürse sözlük çevirisi parça
          parça uygulanır ve cümle sırası dile göre bozulur (landing'deki aynı
          kural).
        */}
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight md:text-5xl">
          Tüm AI araçlarını tek panelde çalıştır.
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Ürün bulmadan tedarik görüşmesine, gerçek maliyet hesabından listing optimizasyonuna kadar
          tüm araçlar aynı panelde çalışır; her çıktı risk, aksiyon ve varsayım olarak geri döner.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            to="/auth"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Ücretsiz başla <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            to="/affiliate"
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card/40 px-5 py-3 text-sm font-medium transition-colors hover:bg-accent/20"
          >
            <Coins className="h-4 w-4" /> Affiliate programını gör
          </Link>
        </div>
        <div className="mt-6 grid max-w-md gap-3 sm:grid-cols-2">
          <Stat value={TOOL_ENTRY_COUNT} label="AI araç" />
          <Stat value={TOOL_HUBS.length} label="araç modülü" />
        </div>
      </header>

      {/* MODÜLLER */}
      <section className="mt-14">
        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Araç modülleri</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Her modül kendi ekranında çalışır ve girdilerini tek yerde toplar. Ücretsiz plan Ürün
          Bulucu'yu kapsar; araç modülleri paket seçildiğinde açılır.
        </p>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {TOOL_HUBS.map((hub) => (
            <div
              key={hub.id}
              className="flex flex-col rounded-2xl border border-border bg-card/40 p-5 transition-colors hover:bg-accent/10"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="flex items-center gap-2 text-base font-bold tracking-tight">
                  <span aria-hidden="true">{hub.emoji}</span> {hub.title}
                </h3>
                <Link
                  to={hub.route}
                  className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[var(--brand,var(--primary))] transition-opacity hover:opacity-80"
                >
                  Modülü aç <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{hub.summary}</p>
              <ul className="mt-4 flex flex-wrap gap-2">
                {hub.tools.map((tool) => (
                  <li
                    key={tool.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/40 px-2.5 py-1 text-[11px] text-muted-foreground"
                  >
                    <BadgeCheck className="h-3 w-3 text-[var(--profit,var(--primary))]" />
                    {tool.label}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* KAPANIŞ */}
      <section className="mt-14 rounded-3xl border border-border bg-card/40 p-8 text-center backdrop-blur">
        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Araçlar paketle açılır</h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground">
          Paketler arasındaki fark modül erişimi değil, aylık kullanım kotasıdır: hangi paketi
          seçersen tüm araç modülleri açık olur. Ücretsiz plan Ürün Bulucu ve hoş geldin kredisiyle
          başlar.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/auth"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Ücretsiz başla <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            to="/pricing"
            className="inline-flex items-center gap-2 rounded-xl border border-border px-5 py-3 text-sm font-medium transition-colors hover:bg-accent/20"
          >
            Paketleri karşılaştır
          </Link>
        </div>
        <p className="mt-4 text-[11px] text-muted-foreground">
          Araç çıktıları karar desteklidir; kesin satış veya kâr garantisi vermez.
        </p>
      </section>
    </div>
  );
}
