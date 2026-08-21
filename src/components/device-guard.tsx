import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getVisitorId } from "@/lib/fingerprint";
import { registerDeviceFingerprint } from "@/lib/signup.functions";

/**
 * Oturum açan her kullanıcı için cihaz parmak izini bir kez kaydeder.
 * Aynı cihazdan/IP'den açılan ikinci hesaba ücretsiz başlangıç kredisi verilmez.
 */
export function DeviceGuard() {
  const registerFn = useServerFn(registerDeviceFingerprint);

  useEffect(() => {
    let cancelled = false;

    const run = async (userId: string) => {
      const key = `aroless.fp.${userId}`;
      try {
        if (window.sessionStorage.getItem(key)) return;
      } catch { /* yoksay */ }
      try {
        const visitorId = await getVisitorId();
        if (!visitorId || cancelled) return;
        const res = await registerFn({ data: { visitorId } });
        try { window.sessionStorage.setItem(key, "1"); } catch { /* yoksay */ }
        if (res?.freeTierBlocked && !cancelled) {
          toast.warning("Bu cihazda ücretsiz başlangıç kredisi daha önce kullanıldı, tekrar verilmedi.");
        }
      } catch { /* parmak izi kaydı akışı engellemez */ }
    };

    void supabase.auth.getUser().then(({ data }) => {
      if (data.user) void run(data.user.id);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user) void run(session.user.id);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [registerFn]);

  return null;
}
