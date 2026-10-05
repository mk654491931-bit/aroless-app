// ============================================================================
// ABONELİK AKTİVASYON DOĞRULAMA — ödeme bitti mi, gerçekten başladı mı?
//
// ÖLÇÜLEN İKİ HATA (bu modülün varoluş sebebi):
//
//   1. "Abonelik başlatıldı" hiç görünmüyordu. Paddle.js ödeme bittiğinde
//      `checkout.completed` olayı yayar, ama bu olay TEK BAŞINA abonelik
//      başlatmış sayılmaz. Gerçek başlangıç Paddle'ın WEBHOOK'u Supabase'e
//      yazdığı andır. İkisi ARASI ZAMAN FARKLIDIR (saniyeler). Kullanıcı
//      ödeme ekranından çıkıp profile baktığında webhook hâlâ işliyor olabilir
//      ve plan "Free" görünürdü. Kullanıcı haklı olarak "ödedim ama abonelik
//      başlamadı" diyordu.
//
//   2. İndirimli alışverişte tetiklenmiyordu. `initializePaddle`aynı token +
//      ortam için ÖRNEK ÖNBELLEKLEME yapar ve sonraki çağrılarda
//      verilen `eventCallback`'i YOK SAYAR. İlk checkout'u `onEvent` vermeden
//      açan bir yol (pricing-card) varsa, sonraki tüm checkout'larda olay
//      dinleyicisi hiç kurulmaz — indirimli ödemede de, tam fiyatlı ödemede de.
//
// ÇÖZÜM (iki parça):
//   • `confirmationStep` — SAF ve test edilebilir karar: "doğrulandı mı,
//     yoksa tekrar mı deneyeceğiz, yoksa zaman aşımı mı?"
//   • `useSubscriptionConfirmation` — bu kararı kullanan, profili yoklayan
//     istemci hook'u. Ödeme bitti işaretinden sonra profil sorgusunu
//     ÇEREZİ ATLAYARAK tekrar tekrar sorgular; plan "Free" olmaktan çıkar
//     çıkmaz, dürüstçe "zaman aşımı" der.
//
// DÜRÜSTLÜK KURALI: doğrulanmayan bir şey "başladı" diye YAZILMAZ. Webhook
// gelmezse kullanıcıya "başlatıldı" değil "doğrulanamadı" denir. Bu, kod
// tabanının temel ilkesidir: ölçülmemiş şey ölçülmüş gibi sunulmaz.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Abonelik doğrulama durumu.
 *
 * `timeout` ve `error` ayrı tutulur çünkü ikisi de "başlamadı" demektir ama
 * farklı sebeplerdir; ikisini de "başladı" gibi göstermek yanlış olur.
 */
export type ConfirmationStatus = "idle" | "pending" | "confirmed" | "timeout" | "error";

/** Ücretsiz plan adları — bunlar "abonelik başlamadı" demektir. */
const FREE_TIER_NAMES = new Set(["free", "", "null", "undefined"]);

/**
 * Plan ücretli mi?
 *
 * Boş string / null / undefined "ücretsiz" sayılır. Bu bilinçli: webhook henüz
 * yazmadıysa profil `null` döner ve o an "başladı" demek, olmayan bir şeyi
 * iddia etmektir.
 */
export function isPaidTier(tier: string | null | undefined): boolean {
  return !FREE_TIER_NAMES.has(
    String(tier ?? "")
      .trim()
      .toLowerCase(),
  );
}

/** Paddle.js `checkout.completed` olayını tanır — indirim durumundan BAĞIMSIZ. */
export function isCheckoutCompleted(event: unknown): boolean {
  return (
    !!event &&
    typeof event === "object" &&
    "name" in event &&
    (event as { name?: unknown }).name === "checkout.completed"
  );
}

/**
 * Doğrulama adımı — SAF, ağ/React yok, doğrudan test edilebilir.
 *
 * SIRA ÖNEMLİ: önce "zaten ücretli mi?" sorusu. Aksi hâlde ücretli bir
 * kullanıcı (yenileme ödemesi) gereksizce `maxAttempts` kez bekletilirdi.
 */
export function confirmationStep(args: {
  tier: string | null | undefined;
  attempt: number;
  maxAttempts: number;
  intervalMs: number;
}): { status: ConfirmationStatus; delayMs: number | null; done: boolean } {
  if (isPaidTier(args.tier)) return { status: "confirmed", delayMs: null, done: true };
  if (args.attempt >= args.maxAttempts) return { status: "timeout", delayMs: null, done: true };
  return { status: "pending", delayMs: args.intervalMs, done: false };
}

export type SubscriptionConfirmationOptions = {
  /** Ödeme bitti mi? false ise hiçbir sorgu yapılmaz. */
  enabled: boolean;
  /** Mevcut plan (profil sorgusundan). */
  tier?: string | null;
  /** Profili yeniden oku. Önbellek ATLANIR — sunucudan taze veri şart. */
  refetch: () => Promise<unknown>;
  /** Doğrulandığında çağrılır (paket gerçekten tanımlandı). */
  onConfirmed?: () => void;
  /** Zaman aşımında çağrılır — "başladı" DEĞİL, "doğrulanamadı". */
  onTimeout?: () => void;
  maxAttempts?: number;
  intervalMs?: number;
};

/**
 * Ödeme sonrası abonelik aktivasyonunu doğrular.
 *
 * Webhook asenkron olduğu için profil ilk sorguda hâlâ "Free" olabilir. Bu
 * hook, ödeme bitti işaretinden sonra profili yoklar ve gerçekten ücretli
 * olana kadar bekler. Bulamazsa dürüstçe zaman aşımı bildirir.
 */
export function useSubscriptionConfirmation(opts: SubscriptionConfirmationOptions): {
  status: ConfirmationStatus;
  attempts: number;
} {
  const { enabled, tier, refetch, onConfirmed, onTimeout } = opts;
  const maxAttempts = opts.maxAttempts ?? 10;
  const intervalMs = opts.intervalMs ?? 1_500;
  const qc = useQueryClient();
  const [status, setStatus] = useState<ConfirmationStatus>("idle");
  const [attempts, setAttempts] = useState(0);
  const attemptRef = useRef(0);
  const stoppedRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      stoppedRef.current = false;
      attemptRef.current = 0;
      setStatus("idle");
      setAttempts(0);
      return;
    }
    if (stoppedRef.current) return;
    stoppedRef.current = true;
    let cancelled = false;

    const stop = (next: ConfirmationStatus) => {
      if (cancelled) return;
      setStatus(next);
      if (next === "confirmed") onConfirmed?.();
      if (next === "timeout") onTimeout?.();
    };

    const run = async () => {
      let lastError: unknown = null;
      for (let attempt = 0; attempt <= maxAttempts; attempt++) {
        if (cancelled) return;
        attemptRef.current = attempt;
        setAttempts(attempt);
        // Önbellek atlanır: 15 sn'lik staleTime, webhook'un yazdığı yeni planı
        // göstermeyi engellerdi. Sunucudan taze okumak zorunlu.
        try {
          await qc.invalidateQueries({ queryKey: ["profile"] });
          const fresh = (await refetch()) as
            { subscription_tier?: string | null } | null | undefined;
          lastError = null;
          const step = confirmationStep({
            tier: fresh?.subscription_tier,
            attempt,
            maxAttempts,
            intervalMs,
          });
          if (step.status === "confirmed") return stop("confirmed");
          if (step.status === "timeout") return stop("timeout");
          await new Promise((r) => setTimeout(r, step.delayMs ?? intervalMs));
        } catch (e) {
          lastError = e;
          const step = confirmationStep({ tier, attempt, maxAttempts, intervalMs });
          if (step.status === "timeout") return stop("error");
          await new Promise((r) => setTimeout(r, step.delayMs ?? intervalMs));
        }
      }
      // Döngü bitti: gerçek durum son alınan hataya göre raporlanır.
      return stop(lastError ? "error" : "timeout");
    };

    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { status, attempts };
}
