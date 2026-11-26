import { useCallback, useEffect, useState } from "react";
import { readWatchlist, toggleWatchlist, writeWatchlist } from "@/lib/watchlist";

/** Modüle özel kaydet/çıkar listesi; sunucuya gönderilmez. */
export function useWatchlist(scope: string) {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    setIds(readWatchlist(scope));
  }, [scope]);

  const toggle = useCallback(
    (id: string) => {
      setIds((current) => writeWatchlist(scope, toggleWatchlist(current, id)));
    },
    [scope],
  );

  const clear = useCallback(() => {
    setIds(writeWatchlist(scope, []));
  }, [scope]);

  return {
    ids,
    count: ids.length,
    has: (id: string) => ids.includes(id),
    toggle,
    clear,
  };
}
