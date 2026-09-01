import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ProviderHealth = {
  id: string;
  failures: number;
  healthy: boolean;
  keyCount: number;
};

/**
 * AI sağlayıcı sağlık durumunu döndürür (yalnızca admin).
 * Provider health, key pool boyutu, circuit breaker durumu ve görev zincirleri dahil.
 */
export const getProviderHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ providers: ProviderHealth[] }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) return { providers: [] };

    const {
      getProviderHealth: getHealth,
      getKeyPoolSizes,
      TASK_CHAINS,
    } = await import("@/lib/ai-router.server");

    const health = getHealth();
    const poolSizes = getKeyPoolSizes();

    const providers: ProviderHealth[] = Object.entries(health).map(([id, h]) => ({
      id,
      failures: h.failures,
      healthy: h.healthy,
      keyCount: poolSizes[id] ?? 0,
    }));

    // Task chain bilgisini de ekleyebiliriz (gelecekte dashboard'da göstermek için)
    void TASK_CHAINS;

    return { providers };
  });
