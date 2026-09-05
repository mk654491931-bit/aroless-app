import { useCallback, useEffect, useState } from "react";
import { History, Lightbulb, X } from "lucide-react";

/**
 * localStorage'dan okunan bir değeri `initial` ile aynı şekilde olduğunda
 * döndürür; uyumsuz/bozuk değerlerde null (çağıran varsayılanını korur).
 *
 * Eski sürümlerden kalan yanlış tipteki değerler (örn. dizi bekleyen
 * anahtarda string) `.map`/`.some` çağrılarında "x is not a function" ile
 * tüm panonun kırmızı hataya düşmesine yol açıyordu.
 */
export function parsePersistedState<T>(raw: string | null, initial: T): T | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (Array.isArray(initial)) {
    if (!Array.isArray(parsed)) return null;
  } else if (initial !== null && typeof initial === "object") {
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  } else if (initial === null) {
    if (parsed !== null) return null;
  } else if (typeof parsed !== typeof initial) {
    return null;
  }
  return parsed as T;
}

/** Persist any finder setting in localStorage so a search survives reloads. */
export function usePersistentState<T>(
  key: string,
  initial: T,
): [T, (v: T | ((p: T) => T)) => void] {
  const [value, setValue] = useState<T>(initial);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      const parsed = parsePersistedState(raw, initial);
      if (parsed !== null) setValue(parsed);
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, [key]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }, [key, value, hydrated]);

  return [value, setValue];
}

const RECENT_KEY = "velora.finder.recent";
const MAX_RECENT = 8;

export function useRecentSearches() {
  const [recent, setRecent] = usePersistentState<string[]>(RECENT_KEY, []);
  const push = useCallback(
    (q: string) => {
      const v = q.trim();
      if (!v) return;
      setRecent((prev) =>
        [v, ...prev.filter((x) => x.toLowerCase() !== v.toLowerCase())].slice(0, MAX_RECENT),
      );
    },
    [setRecent],
  );
  const remove = useCallback(
    (q: string) => setRecent((prev) => prev.filter((x) => x !== q)),
    [setRecent],
  );
  const clear = useCallback(() => setRecent([]), [setRecent]);
  return { recent, push, remove, clear };
}

export const NICHE_IDEAS = [
  "smart home gadgets",
  "pet grooming",
  "home gym recovery",
  "skincare devices",
  "car accessories",
  "baby sleep",
  "kitchen organizers",
  "outdoor camping",
  "desk setup",
  "hair styling tools",
];

/** Recent searches + one-tap niche ideas. Purely additive helper above the results. */
export function FinderMemoryBar({
  recent,
  onPick,
  onRemove,
  onClear,
}: {
  recent: string[];
  onPick: (q: string) => void;
  onRemove: (q: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="mx-auto mt-3 max-w-5xl space-y-2">
      {Array.isArray(recent) && recent.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            <History size={11} /> Son aramalar
          </span>
          {recent.map((r) => (
            <span
              key={r}
              className="group inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs hover:bg-white/10"
            >
              <button type="button" onClick={() => onPick(r)} className="max-w-[160px] truncate">
                {r}
              </button>
              <button
                type="button"
                aria-label={`${r} kaydını sil`}
                onClick={() => onRemove(r)}
                className="opacity-40 transition group-hover:opacity-100"
              >
                <X size={10} />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={onClear}
            className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            temizle
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <Lightbulb size={11} /> Niş önerileri
        </span>
        {NICHE_IDEAS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onPick(n)}
            className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-muted-foreground transition hover:bg-white/10 hover:text-foreground"
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
