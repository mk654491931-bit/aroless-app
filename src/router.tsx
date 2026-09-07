import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { installStaleChunkRecovery } from "./lib/deploy-race-recovery";

// Client-only (server'de window yok). Her yayında hash'li chunk adları
// değiştiği için, eski bir sayfada kalan tarayıcı artık var olmayan chunk'ları
// isteyip boş sayfayla kalabiliyordu. Hydration'dan önce kurulan bu listener,
// böyle bir yayın yarışında sayfayı otomatik olarak tazeler.
installStaleChunkRecovery();

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
