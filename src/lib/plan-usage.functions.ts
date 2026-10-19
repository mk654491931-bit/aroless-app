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

/**
 * Admin bakiyesini 250'ye getirir (günde bir kez).
 *
 * NEDEN AYRI UÇ: profili okuyan her istekte `user_roles` sorgulamak, admin
 * OLMAYAN kullanıcılar için de her 15 saniyede fazladan sorgu demekti. Bu uç
 * yalnız istemci `isAdmin` bilgisini aldıktan sonra çağrılır; sonuç admin
 * dışında hızlıca `{ok:false}` döner. Böylece admin 250 jetonu görür, diğer
 * kullanıcıların profil okuması yavaşlamaz.
 */
export const ensureMyAdminBalance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: boolean }> => {
    const { ensureAdminBalance } = await import("./plan-usage.server");
    return { ok: await ensureAdminBalance(context.userId) };
  });
