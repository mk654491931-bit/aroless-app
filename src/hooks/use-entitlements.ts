import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { getFullProfile } from "@/lib/analysis.functions";
import { checkIsAdmin } from "@/lib/admin.functions";

const ADMIN_EMAIL = "mryetenek@gmail.com";
const PAID_TIERS = ["starter", "pro", "business", "enterprise"];

export type Entitlements = {
  loading: boolean;
  tier: string;
  isAdmin: boolean;
  isPaid: boolean;
  /** Free (non-admin) users only get product search. */
  locked: boolean;
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
  const isAdmin =
    !!(adminQ.data as { isAdmin?: boolean } | undefined)?.isAdmin ||
    user?.email?.toLowerCase() === ADMIN_EMAIL;
  const isPaid = PAID_TIERS.includes(tier.toLowerCase());

  return {
    loading: loading || profileQ.isLoading || adminQ.isLoading,
    tier,
    isAdmin,
    isPaid,
    locked: !isAdmin && !isPaid,
  };
}
