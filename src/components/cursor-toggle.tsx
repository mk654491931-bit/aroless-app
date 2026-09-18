import { useEffect, useState } from "react";
import { MousePointer2, MousePointerClick } from "lucide-react";
import {
  getBrandedItem,
  setBrandedItem,
  BRAND_EVENTS,
  addBrandedEventListener,
  dispatchBrandedEvent,
} from "@/lib/brand-storage";

export const CURSOR_KEY = "aroless-cursor";
export const LEGACY_CURSOR_KEY = "velora-cursor";
const CURSOR_EVENT_NEW = BRAND_EVENTS.cursor.new;
const CURSOR_EVENT_LEGACY = BRAND_EVENTS.cursor.legacy;

function readCursor(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const v = getBrandedItem(CURSOR_KEY);
    if (v === "1" || v === "on" || v === "true") return true;
    if (v === "0" || v === "off" || v === "false") return false;
  } catch {
    /* ignore */
  }
  // varsayılan: kapalı
  return false;
}

function applyCursor(enabled: boolean) {
  const root = document.documentElement;
  root.classList.toggle("cursor-enabled", enabled);
}

export function useCursorEnabled() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setEnabled(readCursor());
    applyCursor(readCursor());
    const onStorage = (e: StorageEvent) => {
      if (e.key !== CURSOR_KEY && e.key !== LEGACY_CURSOR_KEY) return;
      const next = e.newValue === "1" || e.newValue === "on" || e.newValue === "true";
      setEnabled(next);
      applyCursor(next);
    };
    const onCustom = (e: Event) => {
      const detail = (e as CustomEvent<{ enabled: boolean }>).detail;
      if (typeof detail?.enabled === "boolean") {
        setEnabled(detail.enabled);
        applyCursor(detail.enabled);
      }
    };
    window.addEventListener("storage", onStorage);
    const off = addBrandedEventListener(CURSOR_EVENT_NEW, CURSOR_EVENT_LEGACY, onCustom as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      off();
    };
  }, []);
  return enabled;
}

/** Gece/gündüz imleci aç-kapa anahtarı — tüm siteyi etkiler. */
export function CursorToggle({ className = "" }: { className?: string }) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const init = readCursor();
    setEnabled(init);
    applyCursor(init);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== CURSOR_KEY && e.key !== LEGACY_CURSOR_KEY) return;
      const next = e.newValue === "1" || e.newValue === "on" || e.newValue === "true";
      setEnabled(next);
      applyCursor(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    try {
      setBrandedItem(CURSOR_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
    applyCursor(next);
    dispatchBrandedEvent(CURSOR_EVENT_NEW, CURSOR_EVENT_LEGACY, { enabled: next });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={enabled}
      aria-label={enabled ? "Özel imleci kapat" : "Özel imleci aç"}
      title={enabled ? "Özel imleç açık — kapatmak için tıkla" : "Özel imleç kapalı — açmak için tıkla"}
      className={`inline-flex h-9 items-center gap-2 rounded-full border px-3 text-xs font-semibold backdrop-blur transition-colors ${
        enabled
          ? "border-[var(--accent-active)]/40 bg-[var(--accent-active)]/15 text-foreground hover:bg-[var(--accent-active)]/25"
          : "border-border bg-card/70 text-foreground hover:bg-accent/40"
      } ${className}`}
    >
      {enabled ? <MousePointerClick size={14} className="text-[var(--accent-active)]" /> : <MousePointer2 size={14} className="text-muted-foreground" />}
      <span className="hidden sm:inline">{enabled ? "İmleç Açık" : "İmleç Kapalı"}</span>
    </button>
  );
}
