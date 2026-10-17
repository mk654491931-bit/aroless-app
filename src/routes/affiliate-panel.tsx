import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Handshake, Loader2, Settings as SettingsIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AffiliatePanel } from "@/components/affiliate-panel";
import { useAuth } from "@/hooks/use-auth";
import { getMyAffiliateBadge } from "@/lib/affiliate.functions";

/**
 * AFFILIATE PANELİ — "/affiliate-panel"
 *
 * NEDEN AYRI SAYFA: program tanıtım sayfası (`/affiliate`) herkese açıktır ve
 * başvuru/koşulları anlatır; buradaki ekran ise YALNIZ admin'in affiliate
 * olarak tanımladığı hesabın KENDİ kazancını gösterir. İki farklı işi tek
 * sayfada birleştirmek, tanıtım sayfasını da kişisel veriyle karıştırırdı.
 *
 * ERİŞİM: oturum yoksa `/auth`'a yönlendirilir (dönüş yolu korunur). Onaylı
 * affiliate değilse panel yerine durum açıklaması + başvuru bağlantısı görünür;
 * kişisel kazanç verisi sunucudan hiç istenmez (`AffiliatePanel` kendi
 * sorgusunu yalnız oturum varken kurar ve toplamlar sunucuda kullanıcının
 * kendi satırlarıyla sınırlıdır).
 */
export const Route = createFileRoute("/affiliate-panel")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Affiliate Paneli — Aroless" },
      {
        name: "description",
        content:
          "Affiliate paneliniz: toplam kazancınız, hesabınıza aktarılan ödemeler, ödenmemiş bakiye ve transfer geçmişi.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AffiliatePanelPage,
});

function AffiliatePanelPage() {
  const nav = useNavigate();
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const badgeFn = useServerFn(getMyAffiliateBadge);
  const badgeQ = useQuery({
    queryKey: ["affiliate-badge", user?.id],
    queryFn: () => badgeFn(),
    enabled: !!user,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!loading && !user) {
      nav({
        to: "/auth",
        search: { redirect: `${window.location.pathname}${window.location.search}` },
      });
    }
  }, [user, loading, nav]);

  if (loading || !user || badgeQ.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  const status = badgeQ.data?.status ?? null;
  const isAffiliate = badgeQ.data?.is_affiliate === true;
  const headline =
    status === "pending"
      ? t("affiliate.status_pending_title")
      : status === "revoked"
        ? t("affiliate.status_revoked_title")
        : t("affiliate.status_none_title");
  const body =
    status === "pending"
      ? t("affiliate.status_pending_body")
      : status === "revoked"
        ? t("affiliate.status_revoked_body")
        : t("affiliate.status_none_body");

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-white/10 glass">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg glow bg-gradient-to-br from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)]">
              <Handshake size={18} className="text-white" />
            </div>
            <div className="min-w-0">
              <div className="truncate font-bold leading-tight">{t("affiliate.panel_title")}</div>
              <div className="hidden text-[10px] leading-tight text-muted-foreground sm:block">
                {t("affiliate.panel_subtitle")}
              </div>
            </div>
          </div>
          {/* Mobilde iki buton başlığın altına iner; yatay taşma olmaz. */}
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <Link
              to="/settings"
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10 sm:flex-none"
            >
              <SettingsIcon size={14} /> {t("affiliate.payout_details")}
            </Link>
            <Link
              to="/dashboard"
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10 sm:flex-none"
            >
              <ArrowLeft size={14} /> {t("affiliate.back_to_dashboard")}
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:py-8">
        {!isAffiliate && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
            <h1 className="text-base font-semibold sm:text-lg">{headline}</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
            {status !== "revoked" && (
              <Link
                to="/affiliate"
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-black hover:bg-white/90"
              >
                <Handshake size={14} /> {t("affiliate.apply_cta")}
              </Link>
            )}
          </div>
        )}

        {/* Panel: kazanç toplamları, "para atıldı mı?" durumu, transfer geçmişi,
            affiliate linki/kodu ve ödeme bilgisi formu — hepsi tek yerde. */}
        <AffiliatePanel />
      </main>
    </div>
  );
}
