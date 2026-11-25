import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { createCheckout, reconcileMySubscription } from "@/lib/paddle.functions";
import { getMyPromoCode } from "@/lib/promo.functions";
import { openPaddleOverlay, openPaddlePlanCheckout } from "@/lib/paddle-checkout";
import {
  isCheckoutCompleted,
  paddleCheckoutValue,
  paddleTransactionId,
  useSubscriptionConfirmation,
} from "@/lib/subscription-confirmation";
import { hasMarketingConsent } from "@/lib/cookie-consent";
import { purchaseEventId } from "@/lib/meta-config";
import { trackMetaEvent } from "@/lib/meta-pixel";
import { clearPlanPurchasePending, markPlanPurchasePending } from "@/lib/plan-sync";
import { getFullProfile } from "@/lib/analysis.functions";
import { useMoney } from "@/lib/currency";
import { X, Check, Sparkles, Zap, Crown } from "lucide-react";
import { PLAN_BY_ID, PLANS, type PlanId } from "@/lib/plans";
import { LEGAL_VERSION } from "@/lib/legal-content";

const ICONS = { Starter: Sparkles, Pro: Zap, Business: Crown } as const;

export function PricingModal({
  open,
  initialPlan = null,
  onClose,
}: {
  open: boolean;
  /** Modala girer girmez ödemesi açılacak paket (ör. /pricing'den gelindiğinde). */
  initialPlan?: PlanId | null;
  onClose: () => void;
}) {
  const checkout = useServerFn(createCheckout);
  const promoFn = useServerFn(getMyPromoCode);
  const reconcileFn = useServerFn(reconcileMySubscription);
  const profileFn = useServerFn(getFullProfile);
  const { currency, rate, fmt, isLive } = useMoney();
  const [loading, setLoading] = useState<PlanId | null>(null);
  const [paid, setPaid] = useState(false);
  // Mesafeli satış onayları. İkisi de ödeme ÖNCESİNDE alınır; biri eksikse
  // satın alma düğmeleri kapalıdır. Derhal ifa onayı, cayma hakkının kaybı
  // bilgisini ayrı bir kutuda taşır (Mesafeli Sözleşmeler Yönetmeliği m.15/1-h).
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [immediateAccepted, setImmediateAccepted] = useState(false);
  const legalReady = legalAccepted && immediateAccepted;
  const qc = useQueryClient();
  const autoRan = useRef<PlanId | null>(null);
  /** Meta Pixel `Purchase` — paket, tutar ve tekilleştirme kimliği. */
  const pendingPlan = useRef<PlanId | null>(null);
  /** Doğrulamanın beklediği paket (React state: ref okuması render'da yapılmaz). */
  const [expectedTier, setExpectedTier] = useState<PlanId | null>(null);
  const purchaseId = useRef<string | null>(null);
  const purchaseValue = useRef<{ value: number; currency: string } | null>(null);

  /**
   * Ödeme bitti olayı — indirimli de indirimsiz de aynı olayla gelir.
   *
   * Ölçülen hata: burada yalnız `event.name === "checkout.completed"` bakılıyordu.
   * Doğru olan bu, ama TETİKLENMESİ garanti değildi: Paddle.js örneği
   * önbelleklediğinden sonraki açılışlarda verilen `eventCallback` yok
   * sayılıyordu. `isCheckoutCompleted` tek doğruluk kaynağı olarak
   * `paddle-checkout.ts` içinde `paddle.Event.on` ile de bağlanır.
   */
  const onCheckoutEvent = useCallback((event: unknown) => {
    if (!isCheckoutCompleted(event)) return;
    // Sunucu (Conversions API) aynı işlem için aynı kimliği gönderir → çift sayım yok.
    purchaseId.current = purchaseEventId(paddleTransactionId(event)) ?? purchaseId.current;
    purchaseValue.current = paddleCheckoutValue(event) ?? purchaseValue.current;
    setPaid(true);
  }, []);

  /**
   * Ödeme bittikten sonra aboneliğin GERÇEKTEN başladığını doğrular.
   *
   * Önceden burada yalnız "Ödeme başarılı" toast'u vardı ve bu, webhook henüz
   * çalışmadan başarı iddia ediyordu. Kullanıcı “abonelik başlatıldı”
   * mesajını göremiyordu; ayrıca indirimli alışverişte hiçbir geri bildirim
   * gelmediği için akış ölü görünüyordu. Artık webhook'un veritabanına
   * yazması beklenir ve yalnızca GERÇEKTEN yazıldığında başarı söylenir.
   */
  const confirmation = useSubscriptionConfirmation({
    enabled: paid,
    // Zaten ücretli bir kullanıcı yeni paketi satın aldığında eski planı
    // "onaylandı" saymayız; webhook yeni paketi yazana kadar beklenir.
    expectedTier,
    refetch: profileFn,
    // Webhook gecikirse Paddle'ın kendi kaydından yazdır: "Paddle başladı
    // diyor ama uygulamada başlamıyor" belirtisi böylece kalıcı olarak çözülür.
    reconcile: async () => {
      const res = await reconcileFn();
      return res.ok ? res.tier : null;
    },
    onConfirmed: () => {
      const plan = pendingPlan.current;
      const paid = purchaseValue.current;
      const eventId = purchaseId.current;
      // Değer veya işlem kimliği yoksa UYDURMA Purchase gönderme: CAPI aynı
      // satın almayı gerçek tutarla zaten gönderir. Bu, indirimli bir ödemede
      // liste fiyatını ciro gibi göstermeyi de engeller.
      if (plan && paid && eventId) {
        trackMetaEvent(
          "Purchase",
          {
            content_name: plan,
            content_type: "product",
            value: paid.value,
            currency: paid.currency,
          },
          eventId,
        );
      }
      // Bekleyen ödeme işareti temizlenir: paket göründü, artık yoklama yok.
      clearPlanPurchasePending();
      void qc.invalidateQueries({ queryKey: ["profile"] });
      void qc.invalidateQueries({ queryKey: ["plan-usage"] });
      toast.success("Aboneliğin başlatıldı!", {
        description: "Paketin aktif ve kredilerin tanımlandı.",
      });
      onClose();
    },
    onTimeout: () => {
      toast.warning("Ödeme alındı, ancak paket henüz doğrulanamadı.", {
        description:
          "Aboneliğin birkaç saniye içinde görünmesi gerekir. Hâlâ “Free” görünüyorsa bir kez sayfayı yenile.",
      });
    },
  });

  /**
   * Bir paketi doğrudan satın al. İçerideki butonlar da, /pricing gibi dış
   * yüzeyler (initialPlan) da bu tek yolu kullanır — böylece ödeme davranışı
   * iki yerde ayrışamaz.
   */
  const subscribe = useCallback(
    async (plan: PlanId) => {
      if (!legalReady) {
        toast.error("Devam etmek için ön bilgilendirme ve cayma onaylarını işaretleyin.");
        return;
      }
      setLoading(plan);
      setPaid(false);
      pendingPlan.current = plan;
      setExpectedTier(plan);
      purchaseId.current = null;
      purchaseValue.current = null;
      // Kalıcı işaret: kullanıcı sekmeyi yenilese/başka sayfaya geçse bile
      // uygulama kabuğu (AppTopbar → usePlanSync) paketi Paddle'dan tazelemeye
      // devam eder. Önceden bu bilgi yalnız açık modalın belleğindeydi.
      markPlanPurchasePending();
      let opened = false;
      let email: string | null | undefined;

      // Hesaba bağlı kod (kayıt sırasında veya `?promo=` linkiyle) ödeme ekranına
      // ön-doldurulur: kullanıcı kodu ikinci kez yazmaz. Okunamazsa (oturum yok /
      // geçici hata) ödeme akışı etkilenmez — kod olmadan devam edilir.
      const promo = await promoFn().catch(() => null);

      try {
        // Önce server transaction'ı kullanılır; userId + plan metadata'sı
        // güvenilir biçimde webhook'a taşınır.
        const session = await checkout({
          data: {
            plan,
            marketingConsent: hasMarketingConsent(),
            legalAccepted: true,
            immediatePerformanceAccepted: true,
          },
        });
        email = session.email;
        purchaseId.current = purchaseEventId(session.transactionId) ?? purchaseId.current;
        opened = await openPaddleOverlay(
          {
            transactionId: session.transactionId,
            clientToken: session.clientToken,
            environment: session.environment,
            priceId: session.priceId,
            email: session.email,
          },
          {
            email: session.email,
            plan,
            promo,
            onEvent: onCheckoutEvent,
            legal: {
              version: LEGAL_VERSION,
              acceptedAt: new Date().toISOString(),
              withdrawalWaived: true,
            },
          },
        );
      } catch (error) {
        console.warn("[Paddle] Server transaction unavailable; using Vite price checkout.", error);
      }

      // Vercel'de yalnızca VITE_PADDLE_* tanımlıysa, Paddle.js fiyat checkout'u
      // doğrudan ilgili planın public price ID'siyle açılır.
      if (!opened) {
        opened = await openPaddlePlanCheckout(plan, {
          email,
          promo,
          onEvent: onCheckoutEvent,
          // Sunucu transaction'ı kullanılamazsa yedek fiyat checkout'una da
          // onay izi yazılır; aksi hâlde kanıt yalnız tarayıcıda kalırdı.
          legal: {
            version: LEGAL_VERSION,
            acceptedAt: new Date().toISOString(),
            withdrawalWaived: true,
          },
        });
      }

      if (opened) {
        trackMetaEvent("InitiateCheckout", {
          content_name: plan,
          content_type: "product",
          value: PLAN_BY_ID[plan].usd,
          currency: "USD",
        });
      } else {
        toast.error("Ödeme penceresi açılamadı. Paddle ayarlarınızı kontrol edin.");
      }
      setLoading(null);
    },
    [checkout, promoFn, onCheckoutEvent, legalReady],
  );

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  // Modal KAPANDIĞINDA doğrulama ve onay durumu sıfırlanır. Ayrı effect:
  // `onClose` her render'da yeni bir fonksiyon olabilir; temizlik effect'ine
  // bağlanırsa kullanıcı kutuyu işaretlerken onaylar sıfırlanabilirdi.
  useEffect(() => {
    if (open) return;
    setPaid(false);
    setLegalAccepted(false);
    setImmediateAccepted(false);
    autoRan.current = null;
    pendingPlan.current = null;
    setExpectedTier(null);
    purchaseId.current = null;
    purchaseValue.current = null;
  }, [open]);

  // /pricing'den gelen `initialPlan`: onaylar verilmeden ödeme AÇILMAZ. İki kutu
  // işaretlendiğinde seçilen paketin ödemesi bir kez açılır.
  useEffect(() => {
    if (!open || !initialPlan || !legalReady) return;
    if (autoRan.current === initialPlan) return;
    autoRan.current = initialPlan;
    void subscribe(initialPlan);
  }, [open, initialPlan, legalReady, subscribe]);

  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pricing-modal-title"
      className="fixed inset-0 z-100 flex min-h-dvh items-stretch justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="glass relative h-full max-h-dvh w-full overflow-y-auto rounded-none p-4 sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-6xl sm:rounded-2xl md:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-white/10"
        >
          <X size={18} />
        </button>
        <div className="text-center mb-6">
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-amber-300">
            <Sparkles size={12} /> Lansmana özel · 1 hafta %50 indirim
          </div>
          <h2 id="pricing-modal-title" className="text-2xl md:text-3xl font-bold">
            Upgrade your <span className="text-gradient">edge</span>
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Tüm modüller her pakette açık. Paket büyüdükçe aylık kullanım hakkın artar.
          </p>
          {currency !== "USD" && (
            <div className="mt-3 inline-flex flex-wrap items-center justify-center gap-2">
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-muted-foreground">
                {isLive ? "Canlı kur" : "Yedek kur"}: 1 USD = {fmt(rate, currency)}
              </span>
            </div>
          )}
        </div>
        <div className="mb-5 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-left text-[11px] leading-relaxed text-muted-foreground">
          <p>
            <strong className="font-semibold text-foreground">Aylık abonelik:</strong> İptal edilene
            kadar her ay otomatik yenilenir. Ödenecek toplam tutar, uygulanan vergilerle birlikte
            Paddle ödeme ekranında gösterilir.
          </p>
          <label className="mt-2.5 flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={legalAccepted}
              onChange={(event) => setLegalAccepted(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[oklch(0.62_0.17_255)]"
            />
            <span>
              <a
                href="/legal/on-bilgilendirme-formu"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-foreground underline underline-offset-2 hover:text-[var(--brand,var(--primary))]"
              >
                Ön Bilgilendirme Formu
              </a>{" "}
              ve{" "}
              <a
                href="/legal/mesafeli-satis-sozlesmesi"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-foreground underline underline-offset-2 hover:text-[var(--brand,var(--primary))]"
              >
                Mesafeli Satış Sözleşmesi
              </a>
              'ni okudum, anladım ve onaylıyorum.
            </span>
          </label>
          <label className="mt-2 flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={immediateAccepted}
              onChange={(event) => setImmediateAccepted(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[oklch(0.62_0.17_255)]"
            />
            <span>
              Hizmetin cayma süresi dolmadan derhal ifasına başlanmasını talep ediyorum; bu nedenle
              14 günlük cayma hakkımı kaybedeceğim konusunda bilgilendirildim.
            </span>
          </label>
          <p className="mt-2 text-[10px] text-muted-foreground/75">
            Hizmete hemen erişmek istemiyorsanız, 14 gün sonra başlatılmak üzere destek ekibimize
            yazabilirsiniz; cayma hakkınız korunur.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {PLANS.map((p) => {
            const Icon = ICONS[p.id];
            return (
              <div
                key={p.id}
                className={`rounded-xl p-6 border ${p.highlight ? "border-[oklch(0.62_0.17_255)] glow bg-linear-to-b from-white/5 to-transparent" : "border-white/10 bg-white/5"}`}
              >
                {p.highlight && (
                  <div className="inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded bg-linear-to-r from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)] mb-2">
                    Most popular
                  </div>
                )}
                <div className="flex items-center gap-2 mb-1">
                  <Icon size={18} className="text-[oklch(0.68_0.15_255)]" />
                  <h3 className="text-lg font-bold">{p.label}</h3>
                </div>
                <div className="mb-1 flex items-baseline gap-2">
                  <span className="text-4xl font-bold">${p.usd.toFixed(0)}</span>
                  <span className="text-sm text-muted-foreground">/ay</span>
                </div>
                <div className="mb-2 flex flex-wrap gap-1.5 text-[11px]">
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-semibold">
                    {p.credits} kredi / ay
                  </span>
                  <span className="rounded-full border border-[oklch(0.68_0.15_255)]/25 bg-[oklch(0.68_0.15_255)]/10 px-2 py-0.5 font-semibold text-[oklch(0.82_0.1_255)]">
                    {p.hydrogen10Runs.toLocaleString("tr-TR")} Hidrojen10 / ay
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-semibold">
                    Tüm modüller açık
                  </span>
                </div>
                {currency !== "USD" && (
                  <div className="mb-4 text-xs text-muted-foreground">
                    ≈ {fmt(p.usd * rate, currency)} / ay · güncel kur ile
                  </div>
                )}
                {currency === "USD" && <div className="mb-4" />}
                <ul className="space-y-2 mb-6">
                  {p.features.map((f) => (
                    <li key={f} className="text-sm flex gap-2">
                      <Check size={16} className="text-[oklch(0.68_0.15_255)] shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => subscribe(p.id)}
                  disabled={loading !== null || confirmation.status === "pending" || !legalReady}

                  className={`w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition ${p.highlight ? "bg-linear-to-r from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)] text-white glow" : "bg-white/10 hover:bg-white/15"} disabled:opacity-60`}
                >
                  {confirmation.status === "pending"
                    ? "Abonelik doğrulanıyor…"
                    : loading === p.id
                      ? "Ödeme sayfası açılıyor…"
                      : `Satın al — ${currency === "USD" ? `$${p.usd.toFixed(2)}` : fmt(p.usd * rate, currency)}/ay`}
                </button>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-center text-muted-foreground mt-4">
          Secure checkout by Paddle. Cancel anytime.{" "}
          {!legalReady && (
            <span className="block text-[11px] text-amber-200/90">
              Devam etmek için yukarıdaki iki onayı işaretleyin.
            </span>
          )}
        </p>
      </div>
    </div>,
    document.body,
  );
}
