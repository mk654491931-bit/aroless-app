import { useEffect, useState } from "react";
import { Palette } from "lucide-react";

const KEY = "velora-palette";
type PaletteId = "default" | "aurora";

function applyPalette(p: PaletteId) {
  document.documentElement.classList.toggle("palette-aurora", p === "aurora");
}

/** İkinci renk paleti anahtarı — mor/mavi ile zümrüt/turkuaz arasında geçiş yapar. */
export function PaletteToggle({ className = "" }: { className?: string }) {
  const [palette, setPalette] = useState<PaletteId>("default");

  useEffect(() => {
    const saved = (localStorage.getItem(KEY) as PaletteId | null) ?? "default";
    setPalette(saved);
    applyPalette(saved);
  }, []);

  const toggle = () => {
    const next: PaletteId = palette === "default" ? "aurora" : "default";
    setPalette(next);
    localStorage.setItem(KEY, next);
    applyPalette(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Renk paletini değiştir"
      title={palette === "default" ? "Aurora paletine geç" : "Klasik palete geç"}
      className={`inline-flex h-9 items-center gap-2 rounded-full border border-border bg-card/70 px-3 text-xs font-semibold text-foreground backdrop-blur transition-colors hover:bg-accent/40 ${className}`}
    >
      <Palette size={14} className="text-[var(--brand)]" />
      <span className="flex items-center gap-1">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--brand)" }} />
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--brand-2)" }} />
      </span>
      <span className="hidden sm:inline">{palette === "default" ? "Klasik" : "Aurora"}</span>
    </button>
  );
}
