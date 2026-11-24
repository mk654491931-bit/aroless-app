import { useEffect, useState } from "react";

import { COOKIE_CONSENT_EVENT, hasMarketingConsent } from "@/lib/cookie-consent";
import { trackMetaEvent } from "@/lib/meta-pixel";

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
    if (!allowed) return;
    trackMetaEvent("PageView");
  }, [allowed, pathname]);

  return null;
}
