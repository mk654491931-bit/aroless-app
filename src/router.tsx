import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Ağır AI/veri çağrılarını gereksiz yere tekrarlamayalım.
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        retry: 1,
        refetchOnWindowFocus: false,
        refetchOnReconnect: "stale",
        // Arka planda sessiz revalidasyon
        refetchOnMount: false,
      },
      mutations: { retry: 1, retryDelay: 1000 },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Link üzerine gelince rotayı önden yükle → sayfa geçişleri anında hissettirir.
    defaultPreload: "intent",
    defaultPreloadDelay: 50, // Daha hızlı preloading
    defaultPreloadStaleTime: 60 * 1000, // Daha uzun süre geçerli
    // Kullanıcı interaksiyonuna göre dinamik prefetch
    // SSR performansı için optimize edilmiş
  });

  return router;
};
