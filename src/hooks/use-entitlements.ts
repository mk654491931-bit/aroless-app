import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { getFullProfile } from "@/lib/analysis.functions";
import { checkIsAdmin } from "@/lib/admin.functions";
import { tierLevel, quotaFor } from "@/lib/plans";

const PAID_TIERS = ["starter", "pro", "business", "enterprise"];
/** Ücretsiz kullanıcıya açık modül grupları. */
export const FREE_GROUPS = ["library"];
/** Ücretsiz kullanıcıya açık tekil araçlar (Ürün Bulucu + temel sayfalar). */
export const FREE_ITEMS = [
  "product_finder",
  "dashboard",
  "compare",
  "notifications",
  "partner_dashboard",
];
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
  });
  const adminQ = useQuery({
    queryKey: ["is-admin", user?.id],
    queryFn: () => adminFn(),
    enabled: !!user,
  });

  const tier = String(
    (profileQ.data as { subscription_tier?: string } | undefined)?.subscription_tier ?? "Free",
  );
  const isAdmin = !!(adminQ.data as { isAdmin?: boolean } | undefined)?.isAdmin;
  const isPaid = PAID_TIERS.includes(tier.toLowerCase());

  const level: 0 | 1 | 2 | 3 = isAdmin ? 3 : tierLevel(tier);
  // Ücretsiz kullanıcı: sadece Kazanan Ürün Radarı (ürün arama). Ücretli: tüm modüller.
  const canUse = (groupId: string) => isAdmin || isPaid || FREE_GROUPS.includes(groupId);
  const quota = quotaFor(level);

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
