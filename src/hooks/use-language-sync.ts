import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import i18n, { changeAppLanguage } from "@/lib/i18n";
import { shouldAdoptProfileLanguage, storedLanguagePreference } from "@/lib/language-preference";

/**
 * Hesapta kayıtlı dil tercihini (profiles.language) siteye uygular.
 *
 * Sayfa başına bir kez çalışır; kural `lib/language-preference.ts` içinde saf
 * fonksiyon olarak yaşar. Ağ hatasında sessizce vazgeçer — dil senkronu
 * uygulamayı asla kırmaz.
 */
export function useLanguageSync(): void {
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        // Await'ler initI18n()'in ( __root ilk effect) çalışmış olmasını garanti eder.
        const { data } = await supabase.auth.getSession();
        const userId = data.session?.user?.id;
        if (!userId || !i18n.isInitialized) return;

        const { data: row } = await supabase
          .from("profiles")
          .select("language")
          .eq("id", userId)
          .maybeSingle();
        if (!alive) return;

        const next = shouldAdoptProfileLanguage({
          profileLanguage: (row as { language?: string } | null)?.language,
          storedLanguage: storedLanguagePreference(),
          activeLanguage: i18n.language,
        });
        if (next) changeAppLanguage(next);
      } catch {
        /* sessizce yoksay */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
}
