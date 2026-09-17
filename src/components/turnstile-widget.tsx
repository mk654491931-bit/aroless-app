import { useEffect, useRef, useState } from "react";
import { publicClientEnv } from "@/lib/client-env";

/**
 * Cloudflare Turnstile — interaction-only (görünmez) doğrulama.
 * - sitekey yoksa widget render etmez, token "" kalır (akış devam eder).
 * - Geçerli size değerleri: "normal" | "compact" | "flexible".
 *   Görünmez davranış için `appearance: "interaction-only"` kullanılır;
 *   `size: "invisible"` geçersizdir ve TurnstileError üretir.
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
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
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
    const id = window.turnstile.render(ref.current, {
      sitekey: SITE_KEY,
      // Geçerli size değerleri: "normal" | "compact" | "flexible"
      // Görünmez doğrulama için Cloudflare'in önerdiği yöntem:
      // appearance: "interaction-only" — widget yalnızca etkileşim gerekirse görünür,
      // aksi halde görünmez kalır ve token callback üzerinden döner.
      size: "normal",
      appearance: "interaction-only",
      theme: "auto",
      retry: "auto",
      "retry-interval": 1500,
      "refresh-expired": "auto",
      callback: (token: string) => onToken(token),
      "error-callback": () => {
        console.warn("[turnstile] verification failed — continuing without captcha");
        onToken("");
      },
      "expired-callback": () => {
        console.warn("[turnstile] token expired — continuing without captcha");
        onToken("");
      },
      "timeout-callback": () => {
        console.warn("[turnstile] timeout — continuing without captcha");
        onToken("");
      },
    });
    return () => {
      try {
        window.turnstile?.remove(id);
      } catch {
        /* widget already gone */
      }
    };
  }, [ready, onToken]);

  if (!SITE_KEY) return null;
  return <div ref={ref} className="mt-2 min-h-[1px]" aria-hidden />;
}
