/**
 * Eğitim simülatörünün yerel durum anahtarı — bilinçli olarak bağımsız ve hafif.
 *
 * NEDEN AYRI DOSYA: `training-tab.tsx` ağır bir bileşendir ve lazy yüklenir.
 * Anahtarı oradan import etmek, tüm bileşeni ana sayfanın ana paketine
 * çekerdi. Bu modül yalnızca bir string ve tek bir localStorage okuması
 * içerir; ana sayfanın başlangıç görevleri listesi bunu gerçek bir sinyal
 * olarak kullanır.
 */
export const SIMULATOR_STATE_KEY = "omni-training-run-v1";

/** Simülatörde kaydedilmiş bir koşu var mı? (Hata durumunda false.) */
export function hasSimulatorProgress(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return !!window.localStorage.getItem(SIMULATOR_STATE_KEY);
  } catch {
    return false;
  }
}
