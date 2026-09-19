/**
 * Açılır-kapanır ayar kümesinin (dil / tema / palet / imleç) saf kuralları.
 *
 * Kullanıcının tercihi markalı anahtar sözlüğüyle (`aroless-settings-open`)
 * saklanır; tercih yoksa dar ekranda kapalı, geniş ekranda açık başlar.
 */

export const SETTINGS_PANEL_KEY = "aroless-settings-open";

export const SETTINGS_PANEL_OPEN = "open";
export const SETTINGS_PANEL_CLOSED = "closed";

/**
 * Başlangıç durumu: kayıtlı tercih (open/closed) her zaman kazanır; tercih
 * yoksa görünüm genişliği `defaultOpenMinWidth` eşiğini geçtiyse açık başlar.
 */
export function resolveSettingsOpen(
  stored: string | null,
  viewportWidth: number,
  defaultOpenMinWidth: number,
): boolean {
  if (stored === SETTINGS_PANEL_OPEN) return true;
  if (stored === SETTINGS_PANEL_CLOSED) return false;
  return viewportWidth >= defaultOpenMinWidth;
}
