import { useEffect, useId, useState, type ReactElement, type ReactNode } from "react";
import { ChevronDown, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getBrandedItem, setBrandedItem } from "@/lib/brand-storage";
import {
  SETTINGS_PANEL_CLOSED,
  SETTINGS_PANEL_KEY,
  SETTINGS_PANEL_OPEN,
  resolveSettingsOpen,
} from "@/lib/settings-panel";

type Props = {
  children: ReactNode;
  /** Tercih yoksa bu genişlikten itibaren açık başlar. */
  defaultOpenMinWidth?: number;
  className?: string;
};

/**
 * Dil / tema / palet / imleç kontrollerini saran açılır-kapanır küme.
 *
 * Tek bir düğme açıp kapatır; tercih kalıcıdır. Kapatıldığında kontroller
 * DOM'dan kalkar — böylece kırpma (overflow) sorunu oluşmaz ve dil menüsü
 * açıldığında panelin dışına taşabilir.
 */
export function SettingsCluster({
  children,
  defaultOpenMinWidth = 768,
  className = "",
}: Props): ReactElement {
  const { t } = useTranslation();
  const panelId = useId();
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const stored = getBrandedItem(SETTINGS_PANEL_KEY);
    setOpen(resolveSettingsOpen(stored, window.innerWidth, defaultOpenMinWidth));

    // Tercih yoksa pencere boyutu değiştiğinde varsayılanı yeniden uygula.
    const onResize = () => {
      if (getBrandedItem(SETTINGS_PANEL_KEY)) return;
      setOpen(resolveSettingsOpen(null, window.innerWidth, defaultOpenMinWidth));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [defaultOpenMinWidth]);

  const toggle = () => {
    setOpen((current) => {
      const next = !current;
      setBrandedItem(SETTINGS_PANEL_KEY, next ? SETTINGS_PANEL_OPEN : SETTINGS_PANEL_CLOSED);
      return next;
    });
  };

  return (
    <div
      className={`relative flex items-center gap-1 ${className}`}
      data-no-translate
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          setOpen(false);
          setBrandedItem(SETTINGS_PANEL_KEY, SETTINGS_PANEL_CLOSED);
        }
      }}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? t("settings_close") : t("settings_open")}
        title={t("settings_panel")}
        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs transition-colors hover:bg-white/10"
      >
        <Settings2 size={13} />
        {!open && <span className="hidden font-medium sm:inline">{t("settings_panel")}</span>}
        <ChevronDown
          size={11}
          className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div
          id={panelId}
          role="group"
          aria-label={t("settings_panel")}
          className="animate-in fade-in-0 zoom-in-95 flex items-center gap-1 duration-150"
        >
          {children}
        </div>
      )}
    </div>
  );
}
