import { useEffect, useState } from "react";
import { SLOGANS } from "../constants";

export function RotatingSlogan() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % SLOGANS.length), 3600);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="mt-6 flex justify-center">
      <div className="premium-card rounded-full px-5 py-2 h-10 flex items-center gap-2 overflow-hidden">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[oklch(0.66_0.15_255)] animate-pulse-soft" />
        <span key={i} className="text-sm font-semibold text-foreground/90 animate-rise-in whitespace-nowrap">
          {SLOGANS[i]}
        </span>
      </div>
    </div>
  );
}
