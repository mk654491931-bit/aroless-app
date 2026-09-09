import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const KEY = "velora-theme";

type Theme = "dark" | "light";

function preferredTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const saved = localStorage.getItem(KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("light", theme === "light");
  root.classList.toggle("dark", theme === "dark");
}

/** Karanlık / gündüz teması anahtarı — sitenin ana rengini değiştirir. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const initial = preferredTheme();
    setTheme(initial);
    applyTheme(initial);

    const onStorage = (event: StorageEvent) => {
      if (event.key !== KEY || (event.newValue !== "light" && event.newValue !== "dark")) return;
      setTheme(event.newValue);
      applyTheme(event.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem(KEY, next);
    applyTheme(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Gündüz temasına geç" : "Karanlık temaya geç"}
      title={theme === "dark" ? "Gündüz teması" : "Karanlık tema"}
      className={`inline-flex h-9 items-center gap-2 rounded-full border border-border bg-card/70 px-3 text-xs font-semibold text-foreground backdrop-blur transition-colors hover:bg-accent/40 ${className}`}
    >
      {theme === "dark" ? (
        <Sun size={14} className="text-[var(--warning)]" />
      ) : (
        <Moon size={14} className="text-[var(--brand)]" />
      )}
      <span className="hidden sm:inline">{theme === "dark" ? "Gündüz" : "Karanlık"}</span>
    </button>
  );
}
