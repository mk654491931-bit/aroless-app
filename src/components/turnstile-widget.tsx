import { useEffect, useRef, useState, useCallback } from "react";

/**
 * Cloudflare Turnstile (invisible CAPTCHA).
 * VITE_TURNSTILE_SITE_KEY tanımlı değilse widget render etmez ve
 * doğrulama sunucu tarafında otomatik atlanır.
 * Ancak token her zaman "" döner — auth akışı asla kilitlenmez.
 */
declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      remove: (id: string) => void;
    };
  }
}

const SITE_KEY = import.meta.env["VITE_TURNSTILE_SITE_KEY"] as string | undefined;

export function turnstileConfigured(): boolean {
  return Boolean(SITE_KEY);
}

export function TurnstileWidget({ onToken }: { onToken: (token: string) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);

  // Callback'i ref ile sararak tekrar render döngüsünü önle
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  const stableOnToken = useCallback((token: string) => onTokenRef.current(token), []);

  useEffect(() => {
    if (!SITE_KEY) {
      // Site key yoksa token "" olarak kalır — auth akışı devam eder
      onTokenRef.current("");
      return;
    }
    if (window.turnstile) {
      setReady(true);
      return;
    }
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => setReady(true);
    // Hata olursa bile auth akışı devam etsin
    s.onerror = () => {
      console.warn("[turnstile] script load failed — falling back to no-captcha");
      onTokenRef.current("");
    };
    document.head.appendChild(s);
  }, []);

  useEffect(() => {
    if (!SITE_KEY || !ready || !ref.current || !window.turnstile) return;
    const id = window.turnstile.render(ref.current, {
      sitekey: SITE_KEY,
      size: "invisible",
      callback: (token: string) => stableOnToken(token),
      "error-callback": () => {
        // Turnstile başarısız olursa bile auth devam etsin
        console.warn("[turnstile] verification failed — continuing without captcha");
        stableOnToken("");
      },
    });
    return () => {
      try {
        window.turnstile?.remove(id);
      } catch {
        /* widget already gone */
      }
    };
  }, [ready, stableOnToken]);

  if (!SITE_KEY) return null;
  return <div ref={ref} className="mt-2" />;
}
