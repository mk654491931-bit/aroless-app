import { useEffect, useState } from "react";
import type { WinningProduct } from "@/lib/gemini.functions";

/** Only accepts a real, verifiable product image URL returned by the model. */
export function resolveProductImage(p: WinningProduct): string | null {
  const u = p.image_url?.trim();
  if (!u || !/^https?:\/\//i.test(u)) return null;
  if (/source\.unsplash\.com|loremflickr|picsum\.photos|placehold|via\.placeholder|dummyimage/i.test(u))
    return null;
  return u;
}

// Client-side cache to avoid refetching the same product image.
const _imgCache = new Map<string, string>();

export function useRealProductImage(name: string): string | null {
  const [url, setUrl] = useState<string | null>(() => _imgCache.get(name.toLowerCase()) ?? null);
  useEffect(() => {
    const key = name.toLowerCase();
    const hit = _imgCache.get(key);
    if (hit) {
      setUrl(hit);
      return;
    }
    let cancelled = false;
    fetch(`/api/public/product-image?q=${encodeURIComponent(name)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { url?: string } | null) => {
        if (cancelled || !d?.url) return;
        _imgCache.set(key, d.url);
        setUrl(d.url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [name]);
  return url;
}
