import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

/**
 * Route chunks are lazy-loaded, so every navigation (and every SSR-hydrated
 * `ssr: false` route, e.g. /auth) has a pending window. Without a pending
 * component that window is a plain white page — show a branded loader instead.
 */
function RoutePending() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-background px-4">
      <div
        aria-hidden
        className="h-10 w-10 animate-spin rounded-full border-2 border-[var(--brand)] border-t-transparent"
      />
      <div className="flex items-center gap-2.5">
        <img src="/logo-mark.png" alt="" className="h-7 w-7 object-contain" />
        <span className="text-sm font-light uppercase tracking-[0.3em] text-foreground/80">
          Aroless
        </span>
      </div>
    </div>
  );
}

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Ağır AI/veri çağrılarını gereksiz yere tekrarlamayalım.
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        retry: 1,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: { retry: 0 },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Link üzerine gelince rotayı önden yükle → sayfa geçişleri anında hissettirir.
    defaultPreload: "intent",
    defaultPreloadDelay: 60,
    defaultPreloadStaleTime: 30 * 1000,
    // Rota yüklenirken beyaz ekran yerine markalı bir yüklenme ekranı göster.
    // 100ms'den kısa yüklemelerde hiç görünmez (flaş yok), göründüğünde en az
    // 250ms kalır (titreme yok).
    defaultPendingComponent: RoutePending,
    defaultPendingMs: 100,
    defaultPendingMinMs: 250,
  });

  return router;
};
