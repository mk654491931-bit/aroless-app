import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

// ============================================================================
// Click ripple hook.
//
// Moved out of src/routes/auth.tsx, where it was instantiated three times.
//
// Fixed while moving: the 650ms cleanup timers were never cleared, so clicking
// a button and navigating away queued a setState on an unmounted component.
// Pending timers are now cancelled on unmount.
// ============================================================================

const RIPPLE_LIFETIME_MS = 650;

type Ripple = { id: number; x: number; y: number };

export type Ripples = {
  /** Attach to onClick to spawn a ripple at the pointer. */
  spawn: (event: React.MouseEvent<HTMLElement>) => void;
  /** Render inside the (positioned) target element. */
  layer: ReactNode;
};

export function useRipples(): Ripples {
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const timers = useRef<Set<number>>(new Set());

  useEffect(
    () => () => {
      for (const timer of timers.current) window.clearTimeout(timer);
      timers.current.clear();
    },
    [],
  );

  const spawn = useCallback((event: React.MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const id = Date.now() + Math.random();
    setRipples((current) => [
      ...current,
      { id, x: event.clientX - rect.left, y: event.clientY - rect.top },
    ]);
    const timer = window.setTimeout(() => {
      setRipples((current) => current.filter((ripple) => ripple.id !== id));
      timers.current.delete(timer);
    }, RIPPLE_LIFETIME_MS);
    timers.current.add(timer);
  }, []);

  const layer = (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
    >
      {ripples.map((ripple) => (
        <span key={ripple.id} className="energy-ripple" style={{ left: ripple.x, top: ripple.y }} />
      ))}
    </span>
  );

  return { spawn, layer };
}
