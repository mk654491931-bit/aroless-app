import { useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";
import { LANGUAGES, changeAppLanguage, findLanguage, type LangCode } from "@/lib/i18n";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Global dil değiştirici.
 *
 * Menü Radix Popover ile **portal** içinde açılır: sürüklenen ayar barı ve
 * topbar gibi kapsayıcılardaki `overflow` menüyü kesemez, ekranın altında yer
 * yoksa Radix çakışma denetimiyle yukarı açılır. Dışına tıklama, Escape,
 * odak yönetimi ve `aria-*` nitelikleri Radix'ten gelir.
 *
 * Dil değişimi tek noktadan yapılır (`changeAppLanguage`); `<html lang/dir>`,
 * DOM sözlüğü, başlık/meta ve sayfa yeniden çizimi `__root`'taki
 * `languageChanged` dinleyicisinde tüm siteye yayılır.
 */
export function LanguageSwitcher(): ReactElement {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  // "en-US"/"tr_TR" gibi locale'ler de doğru kaydı ve bayrağı bulur.
  const active = findLanguage(i18n.language);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("language")}
          title={t("language")}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs hover:bg-white/10"
        >
          <Globe size={13} />
          <span className="text-sm">{active.flag}</span>
          <span className="hidden font-medium uppercase md:inline">{active.code}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        data-no-translate
        className="w-[11rem] border-white/10 bg-[oklch(0.20_0.035_255)] p-1 text-white"
      >
        <div role="listbox" aria-label={t("language")} className="flex flex-col">
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              type="button"
              role="option"
              aria-selected={l.code === active.code}
              onClick={() => {
                changeAppLanguage(l.code as LangCode);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-start text-sm hover:bg-white/5 ${
                l.code === active.code ? "text-[oklch(0.85_0.15_255)]" : ""
              }`}
            >
              <span>{l.flag}</span>
              <span>{l.label}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
