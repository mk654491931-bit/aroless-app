import { useCallback, useEffect, useRef, useState } from "react";
import { Moon, Sun, Palette, GripVertical } from "lucide-react";

const THEME_KEY = "velora-theme";
const PALETTE_KEY = "velora-palette";
const POS_KEY = "velora-float-pos";

type Theme = "dark" | "light";
type PaletteId = "default" | "aurora";

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("light", theme === "light");
  root.classList.toggle("dark", theme === "dark");
}

function applyPalette(p: PaletteId) {
  document.documentElement.classList.toggle("palette-aurora", p === "aurora");
}

/**
 * Floating, draggable theme + palette toggle.
 * Kullanıcı ekran üzerinde sürükleyip konumlandırabilir;
 * tercihleri localStorage'da saklanır.
 */
export function FloatingThemeControls({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("dark");
  const [palette, setPalette] = useState<PaletteId>("default");
  const [dragging, setDragging] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<HTMLDivElement>(null);
  const startPos = useRef({ x: 0, y: 0 });
  const startMouse = useRef({ x: 0, y: 0 });

  // Load from localStorage
  useEffect(() => {
    const savedTheme = (localStorage.getItem(THEME_KEY) as Theme | null) ?? "dark";
    const savedPalette = (localStorage.getItem(PALETTE_KEY) as PaletteId | null) ?? "default";
    const savedPos = localStorage.getItem(POS_KEY);
    setTheme(savedTheme);
    setPalette(savedPalette);
    applyTheme(savedTheme);
    applyPalette(savedPalette);
    if (savedPos) {
      try {
        setPos(JSON.parse(savedPos));
      } catch {
        /* ignore */
      }
    }
  }, []);

  const toggleTheme = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  }, [theme]);

  const togglePalette = useCallback(() => {
    const next: PaletteId = palette === "default" ? "aurora" : "default";
    setPalette(next);
    localStorage.setItem(PALETTE_KEY, next);
    applyPalette(next);
  }, [palette]);

  // Drag handlers
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      setDragging(true);
      const rect = dragRef.current?.getBoundingClientRect();
      startPos.current = { x: rect?.left ?? 0, y: rect?.top ?? 0 };
      startMouse.current = { x: e.clientX, y: e.clientY };
    },
    [],
  );

  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - startMouse.current.x;
      const dy = e.clientY - startMouse.current.y;
      const newX = Math.max(8, Math.min(window.innerWidth - 56, startPos.current.x + dx));
      const newY = Math.max(8, Math.min(window.innerHeight - 56, startPos.current.y + dy));
      setPos({ x: newX, y: newY });
    };

    const onUp = () => {
      setDragging(false);
      const rect = dragRef.current?.getBoundingClientRect();
      if (rect) {
        const finalPos = { x: rect.left, y: rect.top };
        setPos(finalPos);
        localStorage.setItem(POS_KEY, JSON.stringify(finalPos));
      }
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
  }, [dragging]);

  const style: React.CSSProperties = pos
    ? { position: "fixed" as const, left: pos.x, top: pos.y, zIndex: 9999 }
    : { position: "fixed" as const, bottom: 16, right: 16, zIndex: 9999 };

  return (
    <div
      ref={dragRef}
      className={`select-none ${className}`}
      style={{ ...style, touchAction: "none" }}
    >
      {collapsed ? (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="group flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card/90 shadow-lg backdrop-blur-xl transition-all hover:scale-105 hover:shadow-xl"
          title="Tema kontrollerini aç"
        >
          <GripVertical
            size={16}
            className="text-muted-foreground transition-colors group-hover:text-foreground"
          />
        </button>
      ) : (
        <div className="flex items-center gap-1.5 rounded-2xl border border-border bg-card/90 p-1.5 shadow-xl backdrop-blur-xl transition-all">
          {/* Drag handle */}
          <div
            onPointerDown={onPointerDown}
            className="flex h-8 w-6 cursor-grab items-center justify-center rounded-lg hover:bg-accent/40 active:cursor-grabbing"
            title="Sürükle"
          >
            <GripVertical size={14} className="text-muted-foreground" />
          </div>

          {/* Theme toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Gündüz temasına geç" : "Karanlık temaya geç"}
            title={theme === "dark" ? "Gündüz teması" : "Karanlık tema"}
            className="flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold transition-colors hover:bg-accent/40"
          >
            {theme === "dark" ? (
              <Sun size={14} className="text-[var(--warning)]" />
            ) : (
              <Moon size={14} className="text-[var(--brand)]" />
            )}
            <span className="hidden sm:inline">{theme === "dark" ? "Gündüz" : "Karanlık"}</span>
          </button>

          {/* Palette toggle */}
          <button
            type="button"
            onClick={togglePalette}
            aria-label="Renk paletini değiştir"
            title={palette === "default" ? "Aurora paletine geç" : "Klasik palete geç"}
            className="flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold transition-colors hover:bg-accent/40"
          >
            <Palette size={14} className="text-[var(--brand)]" />
            <span className="hidden sm:inline">
              {palette === "default" ? "Klasik" : "Aurora"}
            </span>
          </button>

          {/* Collapse */}
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="flex h-8 w-8 items-center justify-center rounded-xl text-xs text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
            title="Küçült"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
