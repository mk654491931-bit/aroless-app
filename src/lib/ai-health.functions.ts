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
 * Provider health, key pool boyutu ve circuit breaker durumu dahil.
 */
export const getProviderHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ providers: ProviderHealth[] }> => {
    // Admin kontrolü
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) return { providers: [] };

    // Dinamik import ile provider health + key pool bilgisi
    const { getProviderHealth: getHealth } = await import("@/lib/ai-router.server");
    const { geminiKeyPool, groqKeyPool, openRouterKeyPool, togetherKeyPool } = await import(
      "@/lib/ai.server"
    );

    const health = getHealth();
    const keyPools: Record<string, number> = {
      cerebras: 2,
      sambanova: 2,
      groq: groqKeyPool().length,
      gemini: geminiKeyPool().length,
      together: togetherKeyPool().length,
      openrouter: openRouterKeyPool().length,
      huggingface: 5,
      bedrock: 2,
    };

    const providers: ProviderHealth[] = Object.entries(health).map(([id, h]) => ({
      id,
      failures: h.failures,
      healthy: h.healthy,
      keyCount: keyPools[id] ?? 0,
    }));

    return { providers };
  });
