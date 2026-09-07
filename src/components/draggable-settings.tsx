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
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Pos;
        if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
          setPos({ x: parsed.x, y: parsed.y });
          return;
        }
      }
    } catch {
      /* ignore */
    }
    setPos(defaultPos(anchor));
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
      const x = Math.max(8, Math.min(window.innerWidth - 140, e.clientX - drag.current.dx));
      const y = Math.max(8, Math.min(window.innerHeight - 52, e.clientY - drag.current.dy));
      setPos({ x, y });
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
        className={`flex items-center gap-1 rounded-xl border border-white/10 bg-(--surface)/90 py-1.5 pr-2 pl-1.5 shadow-[0_12px_40px_-14px_rgba(0,0,0,0.7)] backdrop-blur-xl transition-shadow ${
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
