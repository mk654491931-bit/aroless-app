/**
 * Kayıt formundaki yasal onay kutularının saf kuralları.
 *
 * Onaylar kontrol edilen (controlled) durumda tutulur; hem kutunun kendi
 * `onCheckedChange`'i hem de etiket metnine tıklama aynı fonksiyonlardan
 * geçer. Böylece mobil tarayıcıların `<label>` tıklamasını forma iletme
 * davranışına bağımlı kalınmaz (iOS Safari `<button>` öğesine iletmez) ve
 * tek tıklama her zaman tam olarak bir kez çevirir.
 */

export type LegalConsent = { terms: boolean; kvkk: boolean; marketing: boolean };

export type ConsentKey = keyof LegalConsent;

/** Tek bir onayı çevirir; diğerlerine dokunmaz. */
export function toggleConsent(value: LegalConsent, key: ConsentKey): LegalConsent {
  switch (key) {
    case "terms":
      return { ...value, terms: !value.terms };
    case "kvkk":
      return { ...value, kvkk: !value.kvkk };
    case "marketing":
      return { ...value, marketing: !value.marketing };
  }
}

/** Kutunun bildirdiği hedef değeri uygular (aynıysa yeni nesne üretmez). */
export function applyConsent(value: LegalConsent, key: ConsentKey, on: boolean): LegalConsent {
  return value[key] === on ? value : toggleConsent(value, key);
}

/** Kayıt için zorunlu iki onay verilmiş mi? (pazarlama isteğe bağlı) */
export function requiredConsentGiven(value: LegalConsent): boolean {
  return value.terms === true && value.kvkk === true;
}
