import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Send, X } from "lucide-react";
import { ArolessMark } from "@/components/velora-mark";
import { parsePersistedState } from "@/components/finder-extras";
import { askCopilot } from "@/lib/competitor.functions";

type Msg = { role: "user" | "ai"; text: string };
const KEY = "omni_copilot_pos";

/**
 * Draggable, position-persisting AI Co-Pilot watermark. Click opens the chat
 * overlay (Gemini API 3). Drag it anywhere so it never blocks tables/cards.
 */
export function DraggableCopilot({ context = "dashboard" }: { context?: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const drag = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);
  const askFn = useServerFn(askCopilot);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      const parsed = parsePersistedState(raw, { x: 0, y: 0 });
      if (parsed !== null) {
        setPos(parsed);
        return;
      }
    } catch {
      /* ignore */
    }
    // default anchor: right 24px, bottom 80px (button is 56px tall/wide)
    setPos({ x: window.innerWidth - 24 - 56, y: window.innerHeight - 80 - 56 });
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      drag.current = { dx: e.clientX - (pos?.x ?? 0), dy: e.clientY - (pos?.y ?? 0), moved: false };
    },
    [pos],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag.current) return;
      const x = Math.max(8, Math.min(window.innerWidth - 72, e.clientX - drag.current.dx));
      const y = Math.max(8, Math.min(window.innerHeight - 72, e.clientY - drag.current.dy));
      if (Math.abs(x - (pos?.x ?? 0)) > 3 || Math.abs(y - (pos?.y ?? 0)) > 3)
        drag.current.moved = true;
      setPos({ x, y });
    },
    [pos],
  );

  const onPointerUp = useCallback(() => {
    const moved = drag.current?.moved;
    drag.current = null;
    if (pos) {
      try {
        localStorage.setItem(KEY, JSON.stringify(pos));
      } catch {
        /* ignore */
      }
    }
    if (!moved) setOpen((o) => !o);
  }, [pos]);

  const mut = useMutation({
    mutationFn: (message: string) =>
      askFn({
        data: {
          message,
          context,
          history: msgs
            .slice(-6)
            .map((m) => `${m.role === "user" ? "Kullanıcı" : "Co-Pilot"}: ${m.text}`)
            .join("\n")
            .slice(0, 2000),
        },
      }),
    onSuccess: (r) => setMsgs((m) => [...m, { role: "ai", text: r.reply }]),
    onError: () => setMsgs((m) => [...m, { role: "ai", text: "Bağlantı hatası. Tekrar dene." }]),
  });

  if (!pos) return null;

  return (
    <div className="fixed z-[60]" style={{ left: pos.x, top: pos.y }}>
      {open && (
        <div className="absolute bottom-16 right-0 w-[330px] max-w-[85vw] rounded-2xl border border-white/10 bg-[var(--surface)]/95 backdrop-blur-xl shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
            <span className="text-xs font-semibold flex items-center gap-1.5">
              <ArolessMark size={15} className="text-[var(--brand)]" /> Aroless Co-Pilot
            </span>
            <button
              onClick={() => setOpen(false)}
              className="p-1 rounded hover:bg-white/10"
              aria-label="Kapat"
            >
              <X size={13} />
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto p-3 space-y-2 text-xs">
            {msgs.length === 0 && (
              <p className="text-muted-foreground">
                Ürün, pazar, reklam ya da simülasyon hamlen hakkında sor — canlı mentor gibi
                yanıtlarım.
              </p>
            )}
            {msgs.map((m, i) => (
              <div
                key={i}
                className={`rounded-lg px-2.5 py-1.5 ${m.role === "user" ? "bg-white/10 ml-6" : "bg-[var(--brand)]/15 mr-6"}`}
              >
                {m.text}
              </div>
            ))}
            {mut.isPending && (
              <div className="text-muted-foreground flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" /> Düşünüyor…
              </div>
            )}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const q = input.trim();
              if (!q || mut.isPending) return;
              setMsgs((m) => [...m, { role: "user", text: q }]);
              setInput("");
              mut.mutate(q);
            }}
            className="flex items-center gap-2 p-2 border-t border-white/10"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Sorunu yaz…"
              maxLength={1000}
              className="flex-1 rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5 text-xs outline-none focus:border-[var(--brand)]"
            />
            <button
              type="submit"
              className="p-2 rounded-lg bg-gradient-to-r from-[var(--brand)] to-[var(--brand-2)] text-white"
              aria-label="Gönder"
            >
              <Send size={13} />
            </button>
          </form>
        </div>
      )}
      <button
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="h-14 w-14 rounded-full bg-gradient-to-br from-[var(--brand)] to-[var(--brand-2)] text-white shadow-xl glow grid place-items-center cursor-grab active:cursor-grabbing touch-none select-none"
        aria-label="AI Co-Pilot"
        title="Sürükleyebilirsin · tıkla ve sohbet et"
      >
        <ArolessMark size={26} />
      </button>
    </div>
  );
}
