import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";
import { LANGUAGES, type LangCode } from "@/lib/i18n";
import { useState, useEffect, useRef } from "react";

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = LANGUAGES.find((l) => l.code === i18n.language) ?? LANGUAGES[0];

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 px-2.5 py-1.5 text-xs"
        aria-label="Change language"
      >
        <Globe size={13} />
        <span className="text-sm">{current.flag}</span>
        <span className="hidden md:inline uppercase font-medium">{current.code}</span>
      </button>
      {open && (
        <div className="absolute end-0 mt-2 min-w-[10rem] rounded-lg border border-white/10 bg-[oklch(0.20_0.035_265)] shadow-xl z-50 py-1">
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              onClick={() => {
                i18n.changeLanguage(l.code as LangCode);
                setOpen(false);
              }}
              className={`w-full text-start flex items-center gap-2 px-3 py-2 text-sm hover:bg-white/5 ${
                l.code === i18n.language ? "text-[oklch(0.85_0.15_265)]" : ""
              }`}
            >
              <span>{l.flag}</span>
              <span>{l.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}