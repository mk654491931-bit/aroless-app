import { useEffect, useRef, useState } from "react";

import { COOKIE_CONSENT_EVENT, hasMarketingConsent } from "@/lib/cookie-consent";
import { clearMetaBrowserCookies, trackMetaEvent } from "@/lib/meta-pixel";

/**
 * Meta Pixel'in yaşam döngüsü:
 *   • Pazarlama izni verilmişse pikseli yükler,
 *   • her rota değişiminde `PageView` gönderir (SPA olduğu için şart),
 *   • izin aynı sekmede banner'dan veya başka sekmede değişirse tepki verir.
 *
 * Olayların kendisi (CompleteRegistration, InitiateCheckout, Purchase) ilgili
 * akışlarda `trackMetaEvent` ile gönderilir.
 */
export function MetaPixel({ pathname }: { pathname: string }) {
  const [allowed, setAllowed] = useState(false);
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    const sync = () => setAllowed(hasMarketingConsent());
    sync();
    window.addEventListener(COOKIE_CONSENT_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(COOKIE_CONSENT_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  useEffect(() => {
    if (!allowed) {
      // İzin geri çekilirse sayaç sıfırlanır: yeniden izin verildiğinde
      // aynı sayfa için PageView tekrar gönderilebilsin. Daha önce yazılmış
      // `_fbp`/`_fbc` pazarlama çerezleri de silinir.
      lastPath.current = null;
      clearMetaBrowserCookies();
      return;
    }
    // Aynı yol için tekrar gönderim yok (React StrictMode / yeniden render).
    // A → B → A gezintisinde son yol farklı olduğu için her görüntüleme sayılır.
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    trackMetaEvent("PageView");
  }, [allowed, pathname]);

  return null;
}
