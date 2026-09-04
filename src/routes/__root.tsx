import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { isSupabaseConfigured, supabase } from "@/integrations/supabase/client";
import { initI18n } from "@/lib/i18n";
import { setAutoLanguage } from "@/lib/auto-i18n/runtime";
import i18n from "@/lib/i18n";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { FloatingThemeControls } from "@/components/floating-theme-controls";
import { LanguageSwitcher } from "@/components/language-switcher";

import { AmbientBackground } from "@/components/ambient-background";
import { DeviceGuard } from "@/components/device-guard";
import { AppTopbar } from "@/components/app-topbar";
import { CookieBanner } from "@/components/cookie-banner";
import { SiteFooter } from "@/components/site-footer";
import { AiDisclaimer } from "@/components/ai-disclaimer";
import { ErrorBoundary } from "@/components/error-boundary";
import { useAuth } from "@/hooks/use-auth";
import { PricingModal } from "@/components/pricing-modal";
import { ensureDailyAdminCredits } from "@/lib/admin.functions";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-gradient">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Page not found</h2>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong. Try again or head home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Try again
          </button>
          <a href="/" className="rounded-md border border-input px-4 py-2 text-sm font-medium">
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Aroless — Find Winning Products" },
      {
        name: "description",
        content:
          "AI-powered winning product research for e-commerce. Discover trending products, ad angles, and target audiences with Gemini.",
      },
      { name: "theme-color", content: "#0b0f1a" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "Aroless" },
      { property: "og:title", content: "Aroless — Find Winning Products" },
      {
        property: "og:description",
        content: "AI-powered winning product research for e-commerce.",
      },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "https://aroless.tech/og-image.jpg" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "https://aroless.tech/og-image.jpg" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <script src="https://assets.lemonsqueezy.com/lemon.js" defer />
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  // QueryClientProvider must wrap every component that calls TanStack Query
  // hooks (useQuery/useMutation/...), including the root layout itself.
  // Rendering the provider inside the same component that already called
  // such hooks throws "No QueryClient set" on every page — so the layout
  // body lives in RootLayout, below the provider.
  return (
    <QueryClientProvider client={queryClient}>
      <RootLayout />
    </QueryClientProvider>
  );
}

function RootLayout() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user } = useAuth();
  const [showPricing, setShowPricing] = useState(false);
  // Admin kullanıcıları için günlük 250 kredi (günde bir kez; sunucuda doğrulanır).
  // Ayrıca mk65449131@gmail.com gibi DB allowlist'inde olan hesaplar girişte otomatik
  // admin yapılır (yalnızca supabase is_admin_email onayıyla).
  const dailyCreditsFn = useServerFn(ensureDailyAdminCredits);
  const dailyCredits = useMutation({ mutationFn: () => dailyCreditsFn() });
  useEffect(() => {
    if (!user) return;
    let alive = true;
    const run = () => {
      if (!alive) return;
      dailyCredits.mutate(undefined, {
        onError: () => {
          /* rol/kredi yoksa veya ağ hatası: sessizce geç */
        },
      });
    };
    run();
    const t = setInterval(run, 60 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  const chromeless =
    pathname.startsWith("/auth") ||
    pathname === "/pricing" ||
    pathname.startsWith("/legal") ||
    (pathname === "/" && !user);
  const [lang, setLang] = useState<string>("en");
  useEffect(() => {
    initI18n();
    setLang(i18n.language ?? "en");
    setAutoLanguage(i18n.language);
    document.documentElement.lang = (i18n.language ?? "en").slice(0, 2);
    // Dil değişince: DOM sözlüğünü değiştir, React ağacını tazele ve
    // AI/sunucu kaynaklı içerikleri yeni dilde yeniden çek.
    const onLang = (lng: string) => {
      setAutoLanguage(lng);
      setLang(lng);
      document.documentElement.lang = lng.slice(0, 2);
      queryClient.invalidateQueries();
    };
    i18n.on("languageChanged", onLang);
    // Diğer sekmelerde yapılan dil değişikliğini de anında uygula.
    const onStorage = (e: StorageEvent) => {
      if (e.key === "i18nextLng" && e.newValue && e.newValue !== i18n.language) {
        i18n.changeLanguage(e.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      i18n.off("languageChanged", onLang);
      window.removeEventListener("storage", onStorage);
    };
  }, [queryClient]);

  // Davet/partner linki (?ref=KOD) — kayıt sonrası kullanılmak üzere saklanır
  // ve partner click sayacına (backend, dedupe'lu) beacon gönderilir.
  useEffect(() => {
    try {
      const ref = new URLSearchParams(window.location.search).get("ref");
      if (!ref || !/^[A-Za-z0-9]{4,16}$/.test(ref)) return;
      const code = ref.toUpperCase();
      window.localStorage.setItem("velora.ref", code);
      // Aynı partner kodunun click'i oturum başına bir kez bildirilir (DB de dedupe eder).
      const sessionFlag = `velora.ref.clicked.${code}`;
      if (window.sessionStorage.getItem(sessionFlag)) return;
      window.sessionStorage.setItem(sessionFlag, "1");
      try {
        let visitorKey = window.localStorage.getItem("velora.visitor") ?? "";
        if (!visitorKey) {
          visitorKey = crypto.randomUUID?.() ?? `v${Date.now()}`;
          window.localStorage.setItem("velora.visitor", visitorKey);
        }
        void fetch("/api/public/affiliate-click", {
          method: "POST",
          keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            visitorKey,
            path: window.location.pathname,
          }),
        }).catch(() => {
          /* beacon başarısızsa sorun değil */
        });
      } catch {
        /* beacon isteğe bağlı */
      }
    } catch {
      /* yoksay */
    }
  }, [pathname]);
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    try {
      const { data } = supabase.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
          queryClient.invalidateQueries();
        }
      });
      return () => data.subscription.unsubscribe();
    } catch (error) {
      console.error("Auth cache subscription failed", error);
    }
  }, [queryClient]);
  return (
    <>
      <AmbientBackground />
      <DeviceGuard />
      {chromeless ? (
        <>
          <div className="fixed top-4 right-4 z-50 flex items-center gap-2 rounded-xl border border-white/10 bg-(--surface)/80 px-2 py-1.5 backdrop-blur-xl shadow-lg">
            <LanguageSwitcher />
          </div>
          <FloatingThemeControls />
          <div key={`${pathname}|${lang}`} className="min-w-0 overflow-x-clip page-fade">
            <ErrorBoundary key={pathname}>
              <Outlet />
            </ErrorBoundary>
          </div>
        </>
      ) : (
        <SidebarProvider defaultOpen={false}>
          <div className="flex min-h-screen w-full">
            <AppSidebar onUpgrade={() => setShowPricing(true)} />
            <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden">
              {pathname !== "/" && <AppTopbar />}
              <FloatingThemeControls />
              <div key={`${pathname}|${lang}`} className="min-w-0 overflow-x-clip page-fade">
                <ErrorBoundary key={pathname}>
                  <Outlet />
                </ErrorBoundary>
              </div>
              <div className="mx-auto w-full max-w-6xl px-4 md:px-6">
                <AiDisclaimer />
              </div>
              <SiteFooter />
            </div>
          </div>
        </SidebarProvider>
      )}

      <PricingModal open={showPricing} onClose={() => setShowPricing(false)} />
      <CookieBanner />
      <Toaster position="top-right" richColors />
    </>
  );
}
