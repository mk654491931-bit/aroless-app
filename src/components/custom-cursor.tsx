import { useEffect, useRef } from "react";
import { CURSOR_KEY } from "./cursor-toggle";

/**
 * Tüm siteyi kapsayan, gece/gündüz temasına uyumlu özel imleç.
 * - Sadece `html.cursor-enabled` varken ve fine-pointer cihazlarda çalışır.
 * - Aç/kapa durumu `localStorage velora-cursor` + `html.cursor-enabled` üzerinden tüm sekmelerde senkron.
 * - Performans: tek bir rAF ile dot+ring güncellenir, reduced-motion'da animasyon yok.
 */
export function CustomCursor() {
  const dotRef = useRef<HTMLDivElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const dot = dotRef.current;
    const ring = ringRef.current;
    if (!dot || !ring) return;

    const coarse = window.matchMedia("(pointer: coarse)").matches;
    if (coarse) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // reduced-motion'da da imleç gösterilir ama hareketsiz kalır (rAF yok)
    }

    let enabled = document.documentElement.classList.contains("cursor-enabled");
    let visible = false;
    let raf = 0;
    const target = { x: -100, y: -100 };
    const cur = { x: -100, y: -100 };
    const ringCur = { x: -100, y: -100 };

    const applyVisible = (v: boolean) => {
      visible = v;
      dot.style.opacity = v && enabled ? "1" : "0";
      ring.style.opacity = v && enabled ? "1" : "0";
    };

    const syncEnabled = () => {
      enabled = document.documentElement.classList.contains("cursor-enabled");
      if (!enabled) {
        applyVisible(false);
        cancelAnimationFrame(raf);
        raf = 0;
        return;
      }
      // aktifken görünürlük fare hareketine bırakılır
    };

    const onMove = (e: PointerEvent) => {
      if (!enabled) return;
      target.x = e.clientX;
      target.y = e.clientY;
      if (!visible) applyVisible(true);
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const onLeave = () => applyVisible(false);
    const onEnter = () => {
      if (enabled) applyVisible(true);
    };

    const tick = () => {
      // dot anında takip eder, ring yumuşak lerp
      cur.x = target.x;
      cur.y = target.y;
      ringCur.x += (target.x - ringCur.x) * 0.14;
      ringCur.y += (target.y - ringCur.y) * 0.14;

      dot.style.transform = `translate3d(${cur.x}px, ${cur.y}px, 0) translate(-50%, -50%)`;
      ring.style.transform = `translate3d(${ringCur.x}px, ${ringCur.y}px, 0) translate(-50%, -50%)`;

      const dx = target.x - ringCur.x;
      const dy = target.y - ringCur.y;
      if (Math.abs(dx) < 0.2 && Math.abs(dy) < 0.2) {
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    // Hover'da büyüt
    const onOver = (e: PointerEvent) => {
      if (!enabled) return;
      const t = e.target as HTMLElement | null;
      const interactive = !!t?.closest("a, button, [role='button'], input, select, textarea, [data-cursor-hover]");
      ring.style.transform += "";
      ring.classList.toggle("is-hover", interactive);
      dot.classList.toggle("is-hover", interactive);
    };

    // Sekmeler arası senkron: storage + custom event + mutation
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === CURSOR_KEY) syncEnabled();
    };
    const onCustom = () => syncEnabled();

    const mo = new MutationObserver(() => syncEnabled());
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerover", onOver, { passive: true });
    document.addEventListener("mouseleave", onLeave);
    document.addEventListener("mouseenter", onEnter);
    window.addEventListener("storage", onStorage);
    window.addEventListener("velora:cursor", onCustom as EventListener);
    syncEnabled();

    return () => {
      cancelAnimationFrame(raf);
      mo.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerover", onOver as EventListener);
      document.removeEventListener("mouseleave", onLeave);
      document.removeEventListener("mouseenter", onEnter);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("velora:cursor", onCustom as EventListener);
    };
  }, []);

  return (
    <>
      <div ref={dotRef} aria-hidden className="custom-cursor-dot" />
      <div ref={ringRef} aria-hidden className="custom-cursor-ring" />
    </>
  );
}
