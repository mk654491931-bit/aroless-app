import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * BULUCU HERO — "Bir sonraki kazanan ürününü bul".
 *
 * NEDEN AYRI BİLEŞEN: bu blok artık sayfanın editoryal başlığı; hem tipografi
 * hem hareket koreografisi (giriş sırası, tek geçişli parlama, ortadan çizilen
 * hairline) burada tek yerde durur. `index.tsx` 1500+ satır ve bu düzeni oraya
 * gömmek, sayfa dosyasını okunamaz hâle getirirdi.
 *
 * TASARIM KARARI — ORTALANMIŞ, PREMIUM AMA SAKİN:
 *   • Kompozisyon SİMETRİK: rozet iki hairline arasında ortada, başlık iki
 *     satır hâlinde (üstte harf aralıklı kicker, altta marka gradyanlı display),
 *     altında elmas süsü, ortada güven çipleri ve ortadan açılan alt çizgi.
 *     Sola dayalı "rapor başlığı" hissi yerine davet eden bir merkez.
 *   • METİN KOMPOZİSYONU DOKUNULMAZ: kicker, display başlık, elmas, alt çizgi
 *     ve güven çipleri bu dosyada birebir korunur; hareket onların ETRAFINDA
 *     yaşar, üzerine yeni bir metin/kart eklenmez.
 *   • Kart EKLENMEZ. Bu sayfanın tek "kahraman nesnesi" arama formudur (bkz.
 *     `styles.css` sadeleştirme katmanı); başlığa ikinci bir parlak kart koymak
 *     formla görsel olarak yarışır. Premium his TİPOGRAFİ, BOŞLUK, HARF ARALIĞI
 *     ve İNCE ÇİZGİLERLE verilir; çevredeki dekoratif katman arkadaki çok
 *     yavaş nefes alan ışıktır (`finder-hero-aura`, `filter: blur()` YOK —
 *     ışık doğrudan `radial-gradient` ile üretilir).
 *   • Metin MEVCUT ÇEVİRİ anahtarlarından gelir (`hero_1`, `hero_2`,
 *     `ui.hero_sub2`, `ui.f1..f4`, `app_name`, `tagline`): yeni bir iddia
 *     uydurulmaz, yalnız sunum değişir.
 *   • HAREKET MALİYETİ: giriş animasyonları yalnız `transform` ve
 *     `background-position` üzerinde ve YALNIZ BİR KEZ koşar. Sürekli döngü
 *     yalnız dört küçük katmanda vardır (arka ışık + hairline ışık zerresi +
 *     canlı nokta pingi + elmas nabzı); hepsi `transform`/`opacity` ile
 *     çalışır, layout ya da `filter` tetiklemez. Giriş sırası CSS ile verilir
 *     (`.stagger-in`); JS zamanlayıcı/rAF döngüsü yok. Kaydırma sırasında
 *     `html.is-scrolling`
 *     bu katmanları duraklatır; `prefers-reduced-motion` global kuralı
 *     animasyonları sıfırlar ve gradyan sabit konuma çekilir.
 */
export function FinderHero(): React.JSX.Element {
  const { t } = useTranslation();
  const features = [t("ui.f1"), t("ui.f2"), t("ui.f3"), t("ui.f4")];

  return (
    <section className="finder-hero relative isolate mx-auto mb-8 max-w-3xl text-center md:mb-10">
      {/* Çevre ışığı: metnin ARKASINDA, çok yavaş nefes alan marka halesi.
          Dekoratif; ekran okuyucudan ve metin akışından tamamen ayrı. */}
      <span aria-hidden className="finder-hero-aura" />

      {/* Giriş koreografisi: her doğrudan çocuk sırayla belirir (CSS, JS yok). */}
      <div className="stagger-in">
        {/* Üst satır: iki yanda hairline, ortada canlı araştırma rozeti. */}
        <div className="flex items-center justify-center gap-3 sm:gap-4">
          <span aria-hidden className="finder-hero-flank hidden w-8 sm:block sm:w-14" />
          <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-border/70 bg-card/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground sm:px-3 sm:tracking-[0.22em]">
            <span
              aria-hidden
              className="finder-hero-live-dot size-1.5 shrink-0 rounded-full bg-emerald-400"
            />
            <span className="min-w-0">{t("ui.live_research")}</span>
          </span>
          <span
            aria-hidden
            className="finder-hero-flank finder-hero-flank-rev hidden w-8 sm:block sm:w-14"
          />
        </div>

        {/* Başlık: kicker + marka gradyanlı display, tek h1 içinde ortalanır. */}
        <h1 className="mt-6 flex flex-col items-center gap-2.5 md:mt-7 md:gap-3">
          {/* Kicker: iki yanında mikro çizgi taşır (başlığın üst çapası). */}
          <span className="finder-hero-kicker">
            <span aria-hidden className="finder-hero-kicker-rule" />
            <span className="text-[10px] font-medium uppercase tracking-[0.3em] text-muted-foreground sm:text-xs sm:tracking-[0.38em]">
              {t("hero_1")}
            </span>
            <span aria-hidden className="finder-hero-kicker-rule finder-hero-kicker-rule-rev" />
          </span>
          {/* `text-balance`: iki satıra kırıldığında satırlar dengeli dağılır. */}
          <span className="finder-hero-phrase wrap-break-word text-balance text-[1.75rem] font-semibold leading-[1.06] tracking-[-0.035em] sm:text-[2.45rem] md:text-[3.05rem]">
            {t("hero_2")}
          </span>
        </h1>

        {/* Elmas süsü: hairline — elmas — hairline (başlığı alt bölümden ayırır). */}
        <div
          aria-hidden
          className="finder-hero-crest mt-6 flex items-center justify-center gap-2.5"
        >
          <span className="finder-hero-flank w-10 sm:w-16" />
          <span className="finder-hero-diamond" />
          <span className="finder-hero-flank finder-hero-flank-rev w-10 sm:w-16" />
        </div>

        <p className="mx-auto mt-5 max-w-xl text-pretty text-sm leading-relaxed text-muted-foreground md:text-[0.95rem]">
          {t("ui.hero_sub2")}
        </p>

        {/* Güven şeridi: düz metin yerine hairline çipler, ortada hizalı. */}
        <ul className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {features.map((f) => (
            <li
              key={f}
              className="finder-hero-chip inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card/50 px-2.5 py-1 text-[11px] text-muted-foreground"
            >
              <ShieldCheck size={11} className="shrink-0 text-emerald-400" />
              {f}
            </li>
          ))}
        </ul>

        <div aria-hidden className="finder-hero-rule mt-7" />
      </div>

      {/* Kurumsal kimlik: başlığın altında imza gibi duran ince satır. */}
      <p className="mt-4 hidden items-center justify-center gap-2.5 text-[10px] font-medium uppercase tracking-[0.3em] text-muted-foreground/70 sm:flex">
        {t("app_name")}
        <span aria-hidden className="h-px w-5 bg-border" />
        {t("tagline")}
      </p>
    </section>
  );
}
