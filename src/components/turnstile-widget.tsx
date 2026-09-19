import { useEffect, useRef, useState } from "react";
import { publicClientEnv } from "@/lib/client-env";
import { TURNSTILE_SCRIPT_SRC, turnstileWidgetOptions } from "@/lib/turnstile-config";

/**
 * Cloudflare Turnstile — interaction-only (görünmez) doğrulama.
 * - sitekey yoksa widget render etmez, token "" kalır (akış devam eder).
 * - Widget ayarları `lib/turnstile-config.ts` içinde tek kaynaktan gelir
 *   (mobil için `size: "flexible"`, agresif retry aralığı yok).
 * - callback / error-callback / expired-callback her durumda token akışını korur.
 */
declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      remove: (id: string) => void;
      reset?: (id?: string) => void;
      execute?: (id?: string) => void;
    };
  }
}

const SITE_KEY = publicClientEnv.turnstileSiteKey;

export function turnstileConfigured(): boolean {
  return Boolean(SITE_KEY);
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types -- inferred JSX return is clearer than annotation
export function TurnstileWidget({
  onToken,
}: {
  onToken: (token: string) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!SITE_KEY) {
      onToken("");
      return;
    }
    if (window.turnstile) {
      setReady(true);
      return;
    }
    const s = document.createElement("script");
    s.src = TURNSTILE_SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => setReady(true);
    s.onerror = () => {
      console.warn("[turnstile] script load failed — falling back to no-captcha");
      onToken("");
    };
    document.head.appendChild(s);
  }, [onToken]);

  useEffect(() => {
    if (!SITE_KEY || !ready || !ref.current || !window.turnstile) return;
    const id = window.turnstile.render(ref.current, turnstileWidgetOptions(SITE_KEY, onToken));
    return () => {
      try {
        window.turnstile?.remove(id);
      } catch {
        /* widget already gone */
      }
    };
  }, [ready, onToken]);

  if (!SITE_KEY) return null;
  // Genişlik kapsayıcıya bırakılır: dar ekranda widget taşarsa kart ölçüsü
  // değişir ve form açılıp kapanıyormuş gibi görünür.
  return <div ref={ref} className="mt-2 w-full overflow-hidden" aria-hidden />;
}
