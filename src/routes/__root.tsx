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
import { supabase } from "@/integrations/supabase/client";
import { initI18n } from "@/lib/i18n";
import { setAutoLanguage } from "@/lib/auto-i18n/runtime";
import i18n from "@/lib/i18n";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { PaletteToggle } from "@/components/palette-toggle";
import { LanguageSwitcher } from "@/components/language-switcher";

import { AmbientBackground } from "@/components/ambient-background";
import { AppTopbar } from "@/components/app-topbar";
import { CookieBanner } from "@/components/cookie-banner";
import { SiteFooter } from "@/components/site-footer";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-gradient">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Page not found</h2>
        <div className="mt-6">
          <Link to="/" className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  useEffect(() => { reportLovableError(error, { boundary: "tanstack_root_error_component" }); }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">Something went wrong. Try again or head home.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button onClick={() => { router.invalidate(); reset(); }} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Try again</button>
          <a href="/" className="rounded-md border border-input px-4 py-2 text-sm font-medium">Go home</a>
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
      { title: "Velora — Find Winning Products" },
      { name: "description", content: "AI-powered winning product research for e-commerce. Discover trending products, ad angles, and target audiences with Gemini." },
      { name: "theme-color", content: "#0b0f1a" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "Velora" },
      { property: "og:title", content: "Velora — Find Winning Products" },
      { property: "og:description", content: "AI-powered winning product research for e-commerce." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" },
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
      <head><HeadContent /></head>
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
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const chromeless = pathname.startsWith("/auth");
  const [lang, setLang] = useState<string>("en");
  useEffect(() => {
    initI18n();
    setLang(i18n.language ?? "en");
    setAutoLanguage(i18n.language);
    // Dil değişince: DOM sözlüğünü değiştir, React ağacını tazele ve
    // AI/sunucu kaynaklı içerikleri yeni dilde yeniden çek.
    const onLang = (lng: string) => {
      setAutoLanguage(lng);
      setLang(lng);
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

  // Davet linki (?ref=KOD) — kayıt sonrası kullanılmak üzere saklanır.
  useEffect(() => {
    try {
      const ref = new URLSearchParams(window.location.search).get("ref");
      if (ref && /^[A-Za-z0-9]{4,16}$/.test(ref)) {
        window.localStorage.setItem("velora.ref", ref.toUpperCase());
      }
    } catch { /* yoksay */ }
  }, [pathname]);
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        queryClient.invalidateQueries();
      }
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient]);
  return (
    <QueryClientProvider client={queryClient}>
      <AmbientBackground />
      {chromeless ? (
        <>
          <div className="fixed top-4 right-4 z-50 flex items-center gap-2 rounded-xl border border-white/10 bg-[var(--surface)]/80 px-2 py-1.5 backdrop-blur-xl shadow-lg">
            <LanguageSwitcher />
            <PaletteToggle />
            <ThemeToggle />
          </div>
          <div key={pathname} className="page-fade"><Outlet /></div>
        </>

      ) : (
        <SidebarProvider defaultOpen={false}>
          <div className="flex min-h-screen w-full">
            <AppSidebar />
            <div className="flex-1 min-w-0">
              {pathname !== "/" && <AppTopbar />}
              {pathname === "/" && (
                <>
                  <div className="fixed bottom-4 right-4 z-40 flex items-center gap-2"><PaletteToggle /><ThemeToggle /></div>
                  <SidebarTrigger className="fixed bottom-4 left-4 z-50 h-9 w-9 rounded-lg border border-white/10 bg-[var(--surface)]/90 backdrop-blur hover:bg-white/10" />
                </>
              )}
              <div key={pathname} className="page-fade"><Outlet /></div>
              <SiteFooter />
            </div>
          </div>
        </SidebarProvider>
      )}

      <CookieBanner />
      <Toaster position="top-right" richColors />
    </QueryClientProvider>
  );
}
