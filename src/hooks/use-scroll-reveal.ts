import { useEffect, useRef } from "react";

/**
 * Adds `is-revealed` to every `[data-reveal]` element inside the ref'd root
 * as it scrolls into view. Staggering is handled via `--reveal-delay`.
 */
export function useScrollReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (nodes.length === 0) return;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (reduced || typeof IntersectionObserver === "undefined") {
      nodes.forEach((n) => n.classList.add("is-revealed"));
      return;
    }

    nodes.forEach((n) => n.classList.add("reveal"));

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target as HTMLElement;
          el.classList.add("is-revealed");
          io.unobserve(el);
        });
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.12 },
    );

    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, []);

  return ref;
}
