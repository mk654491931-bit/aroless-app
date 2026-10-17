import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * BULUCU HERO — "Bir sonraki kazanan ürününü bul".
 *
 * NEDEN AYRI BİLEŞEN: bu blok artık sayfanın editoryal başlığı; hem tipografi
 * hem hareket koreografisi (giriş sırası, tek seferlik parlama, çizilen
 * hairline) burada tek yerde durur. `index.tsx` 1500+ satır ve bu düzeni oraya
 * gömmek, sayfa dosyasını okunamaz hâle getirirdi.
 *
 * TASARIM KARARI — PREMIUM AMA SAKİN:
 *   • Kart/glow/aurora EKLENMEZ. Bu sayfanın tek "kahraman nesnesi" arama
 *     formudur (bkz. `styles.css` sadeleştirme katmanı); başlığa ikinci bir
 *     parlak kart koymak formla görsel olarak yarışır ve sayfayı ağırlaştırır.
 *     Bu yüzden "kurumsal" his TİPOGRAFİ, BOŞLUK ve İNCE KENARLARLA verilir.
 *   • Metin ve ölçüler MEVCUT ÇEVİRİ anahtarlarından gelir
 *     (`hero_1`, `hero_2`, `ui.hero_sub2`, `ui.f1..f4`, `common.*`): yeni bir
 *     iddia/pazarlama metni uydurulmaz, yalnız sunumu değişir.
 *   • HAREKET MALİYETİ: tüm animasyonlar yalnız `transform` ve
 *     `background-position` üzerinde ve YALNIZ BİR KEZ koşar (sürekli döngü
 *     yok). Giriş sırası CSS ile verilir (`.stagger-in`), JS zamanlayıcı yok.
 *     `prefers-reduced-motion` açıkken global kural animasyonları kapatır;
 *     gradyanın yarıda donmaması için CSS'te sabit konuma çekilir.
 */
export function FinderHero(): React.JSX.Element {
  const { t } = useTranslation();
  const features = [t("ui.f1"), t("ui.f2"), t("ui.f3"), t("ui.f4")];

  return (
    <section className="finder-hero relative mb-8 md:mb-10">
      {/* Giriş koreografisi: her doğrudan çocuk sırayla belirir (CSS, JS yok). */}
      <div className="stagger-in">
        {/* Editoryal üst satır: canlı araştırma rozeti + kurumsal kimlik yazısı */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {/* Mobilde harf aralığı daraltılır: uzun dillerde (tr/de) rozet taşmaz. */}
          <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-border/70 bg-card/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground sm:px-3 sm:tracking-[0.22em]">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-emerald-400" />
            <span className="min-w-0">{t("ui.live_research")}</span>
          </span>
          <span className="hidden items-center gap-2 text-[10px] font-medium uppercase tracking-[0.3em] text-muted-foreground/70 md:inline-flex">
            {t("app_name")}
            <span aria-hidden className="h-px w-5 bg-border" />
            {t("tagline")}
          </span>
        </div>

        {/* Başlık: solda ince marka çizgisi, iki satır net hiyerarşi */}
        <div className="mt-6 flex items-stretch gap-3.5 md:mt-7 md:gap-5">
          <span aria-hidden className="finder-hero-bar" />
          <h1 className="min-w-0 wrap-break-word text-balance text-[1.75rem] font-semibold leading-[1.1] tracking-[-0.02em] sm:text-[2.4rem] sm:leading-[1.08] md:text-[3rem]">
            <span className="block text-foreground">{t("hero_1")}</span>
            <span className="finder-hero-phrase block pb-1">{t("hero_2")}</span>
          </h1>
        </div>

        <p className="mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground md:text-[0.95rem]">
          {t("ui.hero_sub2")}
        </p>

        {/* Güven şeridi: düz metin yerine hairline çipler (kurumsal görünüm) */}
        <ul className="mt-6 flex flex-wrap items-center gap-2">
          {features.map((f) => (
            <li
              key={f}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card/50 px-2.5 py-1 text-[11px] text-muted-foreground"
            >
              <ShieldCheck size={11} className="shrink-0 text-emerald-400" />
              {f}
            </li>
          ))}
        </ul>

        <div aria-hidden className="finder-hero-rule mt-7" />
      </div>
    </section>
  );
}
