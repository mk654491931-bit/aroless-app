import { useEffect, useRef, useState } from "react";

/**
 * Cloudflare Turnstile (invisible CAPTCHA).
 * VITE_TURNSTILE_SITE_KEY tanımlı değilse hiçbir şey render etmez ve
 * doğrulama akışı sunucu tarafında da otomatik atlanır.
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

  useEffect(() => {
    if (!SITE_KEY) return;
    if (window.turnstile) {
      setReady(true);
      return;
    }
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => setReady(true);
    document.head.appendChild(s);
  }, []);

  useEffect(() => {
    if (!SITE_KEY || !ready || !ref.current || !window.turnstile) return;
    const id = window.turnstile.render(ref.current, {
      sitekey: SITE_KEY,
      size: "invisible",
      callback: (token: string) => onToken(token),
      "error-callback": () => onToken(""),
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
  return <div ref={ref} className="mt-2" />;
}
