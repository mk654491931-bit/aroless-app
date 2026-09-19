import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { GripVertical } from "lucide-react";
import { getBrandedItem, setBrandedItem } from "@/lib/brand-storage";
import { SettingsCluster } from "@/components/settings-cluster";

const KEY = "aroless-settings-pos";

type Pos = { x: number; y: number };
type Size = { w: number; h: number };

type Props = {
  children: ReactNode;
  /** Where the bar starts if the user has never dragged it. */
  anchor?: "top-right" | "bottom-right";
};

/** Ölçüm alınamazsa kullanılan yedek boyut (kapalıyken de makul kalır). */
const FALLBACK_W = 380;
const FALLBACK_H = 48;
const EDGE_GAP = 8;

export function clampPosition(pos: Pos, size: Size = { w: FALLBACK_W, h: FALLBACK_H }): Pos {
  if (typeof window === "undefined") return pos;
  const maxX = Math.max(EDGE_GAP, window.innerWidth - size.w - EDGE_GAP);
  const maxY = Math.max(EDGE_GAP, window.innerHeight - size.h - EDGE_GAP);
  return {
    x: Math.max(EDGE_GAP, Math.min(maxX, pos.x)),
    y: Math.max(EDGE_GAP, Math.min(maxY, pos.y)),
  };
}

function defaultPos(anchor: "top-right" | "bottom-right", size: Size): Pos {
  if (typeof window === "undefined") return { x: 12, y: 12 };
  return {
    x: Math.max(12, window.innerWidth - size.w - 16),
    y:
      anchor === "bottom-right"
        ? Math.max(12, window.innerHeight - size.h - 140) // clear of the Co-Pilot
        : 16,
  };
}

/**
 * Draggable floating chrome (language / palette / theme / cursor).
 *
 * Kontroller `SettingsCluster` içinde açılıp kapanır: kapalıyken yalnızca
 * kompakt bir düğme kalır. Panel kapatıldığında DOM'dan kalktığı için dil
 * menüsü kırpılmaz (eski `overflow-x-auto` menüyü kesiyordu). Taşımak için
 * tutamaktan sürükle; konum ve açık/kapalı tercihi kalıcıdır.
 */
export function DraggableSettingsBar({ children, anchor = "top-right" }: Props) {
  const { t } = useTranslation();
  const [pos, setPos] = useState<Pos | null>(null);
  const [dragging, setDragging] = useState(false);
  const [size, setSize] = useState<Size>({ w: FALLBACK_W, h: FALLBACK_H });
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let initial = defaultPos(anchor, size);
    try {
      const raw = getBrandedItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Pos;
        if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
          initial = parsed;
        }
      }
    } catch {
      /* ignore */
    }
    setPos(clampPosition(initial, size));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor]);

  // Gerçek boyutu ölç: panel açılıp kapandıkça genişlik değişir, konum
  // sınırları da ona göre güncellenmeli (kapalıyken sağ kenara yanaşabilsin).
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const next: Size = { w: rect.width || FALLBACK_W, h: rect.height || FALLBACK_H };
      setSize((prev) =>
        Math.abs(prev.w - next.w) < 1 && Math.abs(prev.h - next.h) < 1 ? prev : next,
      );
    };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    setPos((current) => (current ? clampPosition(current, size) : current));
  }, [size]);

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
      const next = clampPosition(
        {
          x: e.clientX - drag.current.dx,
          y: e.clientY - drag.current.dy,
        },
        size,
      );
      setPos(next);
    },
    [pos, size],
  );

  const onGripUp = useCallback(() => {
    drag.current = null;
    setDragging(false);
    setPos((p) => {
      if (p) {
        try {
          setBrandedItem(KEY, JSON.stringify(p));
        } catch {
          /* ignore */
        }
      }
      return p;
    });
  }, []);

  if (!pos) return null;

  return (
    <div
      ref={boxRef}
      className="fixed z-50 max-w-[calc(100vw-16px)]"
      style={{ left: pos.x, top: pos.y }}
      data-no-translate
    >
      <div
        role="toolbar"
        aria-label={t("settings_panel")}
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
          aria-label={t("drag_aria")}
          title={t("drag_hint")}
          className={`grid size-6 shrink-0 cursor-grab touch-none place-items-center rounded-md text-muted-foreground/70 transition-colors hover:bg-white/10 hover:text-foreground active:cursor-grabbing ${
            dragging ? "bg-white/10 text-foreground" : ""
          }`}
        >
          <GripVertical size={13} />
        </button>
        <SettingsCluster defaultOpenMinWidth={768}>{children}</SettingsCluster>
      </div>
    </div>
  );
}
