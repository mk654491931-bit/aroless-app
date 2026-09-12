import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { GripVertical } from "lucide-react";

const KEY = "velora-settings-pos";

type Pos = { x: number; y: number };

type Props = {
  children: ReactNode;
  /** Where the bar starts if the user has never dragged it. */
  anchor?: "top-right" | "bottom-right";
};

const BAR_W = 240;
const BAR_H = 48;
const EDGE_GAP = 8;

function clampPosition(pos: Pos): Pos {
  if (typeof window === "undefined") return pos;
  return {
    x: Math.max(
      EDGE_GAP,
      Math.min(Math.max(EDGE_GAP, window.innerWidth - BAR_W - EDGE_GAP), pos.x),
    ),
    y: Math.max(
      EDGE_GAP,
      Math.min(Math.max(EDGE_GAP, window.innerHeight - BAR_H - EDGE_GAP), pos.y),
    ),
  };
}

function defaultPos(anchor: "top-right" | "bottom-right"): Pos {
  if (typeof window === "undefined") return { x: 12, y: 12 };
  return {
    x: Math.max(12, window.innerWidth - BAR_W - 16),
    y:
      anchor === "bottom-right"
        ? Math.max(12, window.innerHeight - BAR_H - 140) // clear of the Co-Pilot
        : 16,
  };
}

/**
 * Draggable floating chrome (language / palette / theme). Drag it by the grip
 * to move it anywhere; the position persists in localStorage.
 */
export function DraggableSettingsBar({ children, anchor = "top-right" }: Props) {
  const [pos, setPos] = useState<Pos | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    let initial = defaultPos(anchor);
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Pos;
        if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
          initial = parsed;
        }
      }
    } catch {
      /* ignore */
    }
    setPos(clampPosition(initial));

    const onResize = () => setPos((current) => (current ? clampPosition(current) : current));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [anchor]);

  const onGripDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!pos) return;
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
      setDragging(true);
    },
    [pos],
  );

  const onGripMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!drag.current || !pos) return;
      const next = clampPosition({
        x: e.clientX - drag.current.dx,
        y: e.clientY - drag.current.dy,
      });
      setPos(next);
    },
    [pos],
  );

  const onGripUp = useCallback(() => {
    drag.current = null;
    setDragging(false);
    setPos((p) => {
      if (p) {
        try {
          localStorage.setItem(KEY, JSON.stringify(p));
        } catch {
          /* ignore */
        }
      }
      return p;
    });
  }, []);

  if (!pos) return null;

  return (
    <div className="fixed z-50" style={{ left: pos.x, top: pos.y }} data-no-translate>
      <div
        role="toolbar"
        aria-label="Ayarlar (sürüklenebilir)"
        className={`flex max-w-[calc(100vw-16px)] items-center gap-1 overflow-x-auto rounded-xl border border-white/10 bg-(--surface)/90 py-1.5 pr-2 pl-1.5 shadow-[0_12px_40px_-14px_rgba(0,0,0,0.7)] backdrop-blur-xl transition-shadow ${
          dragging ? "shadow-[0_18px_50px_-12px_rgba(99,102,241,0.35)]" : ""
        }`}
      >
        <button
          type="button"
          onPointerDown={onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={onGripUp}
          onPointerCancel={onGripUp}
          aria-label="Ayarları taşı"
          title="Sürükleyerek yerini değiştir"
          className={`grid size-6 shrink-0 cursor-grab touch-none place-items-center rounded-md text-muted-foreground/70 transition-colors hover:bg-white/10 hover:text-foreground active:cursor-grabbing ${
            dragging ? "bg-white/10 text-foreground" : ""
          }`}
        >
          <GripVertical size={13} />
        </button>
        {children}
      </div>
    </div>
  );
}
