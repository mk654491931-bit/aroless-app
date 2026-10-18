import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { getFullProfile } from "@/lib/analysis.functions";
import { checkIsAdmin } from "@/lib/admin.functions";
import { ADMIN_QUOTA, tierLevel, quotaFor } from "@/lib/plans";
import { planLabelFor } from "@/lib/plan-usage";

const PAID_TIERS = ["starter", "pro", "business", "enterprise"];
/** Ücretsiz kullanıcıya açık modül grupları. */
export const FREE_GROUPS = ["library"];
/** Ücretsiz kullanıcıya açık tekil araçlar (Ürün Bulucu + temel sayfalar). */
export const FREE_ITEMS = ["product_finder", "dashboard", "compare", "notifications"];
/** Ücretsiz kullanıcıya kayıt anında bir kez verilen toplam kredi (yenilenmez). */
export const FREE_WELCOME_CREDITS = 2;

export type Entitlements = {
  loading: boolean;
  tier: string;
  isAdmin: boolean;
  isPaid: boolean;
  /** Free (non-admin) users only get product search. */
  locked: boolean;
  /** 0 = ücretsiz, 1 = Starter, 2 = Pro, 3 = Business (admin = 3). */
  level: 0 | 1 | 2 | 3;
  /** Tüm modüller açık — her zaman true. */
  canUse: (groupId: string) => boolean;
  /** Aylık kullanım kotaları. */
  quota: { credits: number; toolRuns: number; councilRuns: number; radarScans: number };
};

export function useEntitlements(): Entitlements {
  const { user, loading } = useAuth();
  const profileFn = useServerFn(getFullProfile);
  const adminFn = useServerFn(checkIsAdmin);

  const profileQ = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: () => profileFn(),
    enabled: !!user,
    // 60 sn + "pencere odağında yenileme YOK" ölçülmüş bir belirtiydi:
    // kullanıcı ödeme yapıp geri döndüğünde paket yazılmış olsa bile rozet
    // bir dakika boyunca "Free" kalıyordu. Artık kısa önbellek + odakta tazeleme.
    staleTime: 15_000,
    gcTime: 300_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const adminQ = useQuery({
    queryKey: ["is-admin", user?.id],
    queryFn: () => adminFn(),
    enabled: !!user,
    staleTime: 300_000,
    gcTime: 600_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  // GÖRÜNEN paket adı KANONİK: veritabanında "pro"/"enterprise"/"ultra" de
  // yazılmış olabilir; kullanıcı her zaman "Pro"/"Business" görmeli.
  const tier = planLabelFor(
    (profileQ.data as { subscription_tier?: string } | undefined)?.subscription_tier,
  );
  const isAdmin = !!(adminQ.data as { isAdmin?: boolean } | undefined)?.isAdmin;
  const isPaid = PAID_TIERS.includes(tier.toLowerCase());

  const level: 0 | 1 | 2 | 3 = isAdmin ? 3 : tierLevel(tier);
  // Admin: her kalemde 250 jeton (ADMIN_QUOTA); free: Find Winner 2 jeton (quotaFor(0)).
  const quota = useMemo(() => (isAdmin ? ADMIN_QUOTA : quotaFor(level)), [isAdmin, level]);
  const canUse = useMemo(() => {
    return (groupId: string) => isAdmin || isPaid || FREE_GROUPS.includes(groupId);
  }, [isAdmin, isPaid]);

  return {
    level,
    canUse,
    quota,
    loading: loading || profileQ.isLoading || adminQ.isLoading,
    tier,
    isAdmin,
    isPaid,
    locked: !isAdmin && !isPaid,
  };
}
