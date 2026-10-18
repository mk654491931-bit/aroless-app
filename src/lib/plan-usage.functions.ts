import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { UsageSnapshot } from "./plan-usage.server";

/**
 * Bu ayın paket kullanımı (sol bar / üst bar / ayarlar).
 *
 * NEDEN SUNUCU: sayaç `credit_usage_log`dan okunur ve o tablo kullanıcıya
 * yalnız SELECT verir; gruplama/limit birleştirmesi tek yerde (sunucuda)
 * yapılır ki arayüz ile limit kapısı AYNI sayıyı konuşsun.
 */
export const getMyPlanUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<UsageSnapshot> => {
    const { planUsageSnapshot } = await import("./plan-usage.server");
    return planUsageSnapshot(context.userId);
  });
