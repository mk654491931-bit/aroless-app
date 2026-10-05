import { useEffect, useRef, useState } from "react";

type CountUpProps = {
  end: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
};

/** Animated counter — eases to `end` once when it enters the viewport. */
export function CountUp({
  end,
  decimals = 0,
  prefix = "",
  suffix = "",
  duration = 1500,
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const startedRef = useRef(false);
  const [value, setValue] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (
      typeof IntersectionObserver === "undefined" ||
      typeof requestAnimationFrame === "undefined"
    ) {
      setValue(end);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || startedRef.current) return;
        startedRef.current = true;
        observer.disconnect();
        const t0 = performance.now();
        const step = (t: number) => {
          const p = Math.min(1, (t - t0) / duration);
          const eased = 1 - Math.pow(1 - p, 3);
          setValue(end * eased);
          if (p < 1) requestAnimationFrame(step);
          else setValue(end);
        };
        requestAnimationFrame(step);
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [end, duration]);

  return (
    <span ref={ref}>
      {prefix}
      {value.toFixed(decimals)}
      {suffix}
    </span>
  );
}
