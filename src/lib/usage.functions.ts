import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeUsageSnapshot, type UsageSnapshot } from "./usage";

type RpcCapable = {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

/**
 * Aylık kullanım anlık görüntüsü (paket limitleri, harcanan/kalan).
 * Limitler sunucuda hesaplanır; istemci yalnızca gösterir.
 */
export const getUsageSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<UsageSnapshot> => {
    const rpc = (context.supabase as unknown as RpcCapable).rpc;
    const { data, error } = await rpc.call(context.supabase, "usage_snapshot", {});
    if (error) {
      console.error("[usage] snapshot failed", error.message);
      return normalizeUsageSnapshot(null);
    }
    return normalizeUsageSnapshot(data);
  });
