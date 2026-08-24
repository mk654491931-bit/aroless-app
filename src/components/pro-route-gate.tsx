import { useState, type ComponentType } from "react";
import { useEntitlements } from "@/hooks/use-entitlements";
import { LockedPanel } from "@/components/upgrade-gate";
import { PricingModal } from "@/components/pricing-modal";

/**
 * Sayfa seviyesinde paywall. Ücretsiz kullanıcılar (admin/ücretli değilse)
 * içerik yerine kilit panelini görür; tıklayınca paket ekranı açılır.
 * Ürün Bulucu (ana sayfa) bu kapının dışındadır — ücretsiz kullanıma açıktır.
 */
export function ProRouteGate({ children }: { children: React.ReactNode }) {
  const { isPaid, isAdmin, loading } = useEntitlements();
  const [showPricing, setShowPricing] = useState(false);

  if (loading) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center text-sm text-muted-foreground">
        Yükleniyor…
      </div>
    );
  }

  if (isPaid || isAdmin) return <>{children}</>;

  return (
    <main className="min-h-[70vh] px-4 py-16">
      <LockedPanel
        onUpgrade={() => setShowPricing(true)}
        title="Bu modül PRO paketlere özel"
        note="Ücretsiz plan yalnızca Ürün Bulucu'yu ve 2 hoş geldin kredisini kapsar. 14'lü AI Konsey ve diğer 13 gelişmiş AI aracı Starter, Pro ve Business paketlerinde açılır."
      />
      <PricingModal open={showPricing} onClose={() => setShowPricing(false)} />
    </main>
  );
}

/** Route `component:` alanı için sarmalayıcı. */
export function withProGate<P extends object>(Component: ComponentType<P>) {
  return function ProGated(props: P) {
    return (
      <ProRouteGate>
        <Component {...props} />
      </ProRouteGate>
    );
  };
}
