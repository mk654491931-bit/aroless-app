import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { reconcileMySubscription } from "@/lib/paddle.functions";
import {
  clearPlanPurchasePending,
  lastPlanReconcileAt,
  markPlanReconcileAttempt,
  planPollingDone,
  planPurchasePendingAge,
  shouldReconcilePlan,
} from "@/lib/plan-sync";

/**
 * ÖDEME SONRASI TAZELEME — uygulama kabuğunda bir kez koşar.
 *
 * NEDEN: paket yalnız Paddle webhook'una bağlıydı. Webhook gecikirse/kaçarsa
 * kullanıcı ödediği hâlde "Free" kalıyordu. Ödeme modalı artık bekleyen bir
 * işaret bırakıyor; bu hook işaret varken Paddle'ın kendi kaydından tazeleme
 * isteyip profili yeniliyor. Paket görününce işaret silinir; süre dolunca
 * dürüstçe vazgeçilir (sonsuz yoklama yok).
 */
export function usePlanSync(tier: string | null | undefined, loading: boolean): void {
  const { user } = useAuth();
  const qc = useQueryClient();
  const reconcileFn = useServerFn(reconcileMySubscription);
  const attempts = useRef(0);
  const busy = useRef(false);

  useEffect(() => {
    if (!user || loading) return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled || busy.current) return;
      const pendingAgeMs = planPurchasePendingAge();
      if (planPollingDone({ tier, pendingAgeMs, attempts: attempts.current })) {
        if (pendingAgeMs === null) return;
        // Paket göründüyse ya da sınır doldu → işareti temizle.
        clearPlanPurchasePending();
        return;
      }
      if (
        !shouldReconcilePlan({
          tier,
          pendingAgeMs,
          lastReconcileAt: lastPlanReconcileAt(),
          attempts: attempts.current,
        })
      ) {
        // Webhook'un yazmasını bekle: yalnız profil tazelenir (ucuz).
        await qc.invalidateQueries({ queryKey: ["profile"] });
        return;
      }

      busy.current = true;
      attempts.current += 1;
      markPlanReconcileAttempt();
      try {
        const result = await reconcileFn();
        if (result.ok) {
          await qc.invalidateQueries({ queryKey: ["profile"] });
          await qc.invalidateQueries({ queryKey: ["plan-usage"] });
        }
      } catch (error) {
        // Tazeleme başarısız → yoklama sürer, kullanıcıya hata gösterilmez
        // (ödeme akışı zaten tamamlandı; burada yalnız yetki yansıtılır).
        console.warn("[Paddle] plan tazeleme başarısız:", error);
      } finally {
        busy.current = false;
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), 5_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [user, loading, tier, qc, reconcileFn]);
}
