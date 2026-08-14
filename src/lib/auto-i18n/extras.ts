/** Hand-maintained strings coming from shared UI primitives (shadcn). */
export const EXTRAS: Record<string, Record<string, string>> = {
  "Toggle Sidebar": { tr: "Kenar çubuğunu aç/kapat", es: "Alternar barra lateral", de: "Seitenleiste umschalten", fr: "Basculer la barre latérale", ar: "تبديل الشريط الجانبي" },
  Close: { tr: "Kapat", es: "Cerrar", de: "Schließen", fr: "Fermer", ar: "إغلاق" },
  More: { tr: "Daha fazla", es: "Más", de: "Mehr", fr: "Plus", ar: "المزيد" },
  "Previous slide": { tr: "Önceki", es: "Diapositiva anterior", de: "Vorherige Folie", fr: "Diapositive précédente", ar: "الشريحة السابقة" },
  "Next slide": { tr: "Sonraki", es: "Diapositiva siguiente", de: "Nächste Folie", fr: "Diapositive suivante", ar: "الشريحة التالية" },
  "Go to previous page": { tr: "Önceki sayfa", es: "Página anterior", de: "Vorherige Seite", fr: "Page précédente", ar: "الصفحة السابقة" },
  "Go to next page": { tr: "Sonraki sayfa", es: "Página siguiente", de: "Nächste Seite", fr: "Page suivante", ar: "الصفحة التالية" },
  Previous: { tr: "Önceki", es: "Anterior", de: "Zurück", fr: "Précédent", ar: "السابق" },
  Next: { tr: "Sonraki", es: "Siguiente", de: "Weiter", fr: "Suivant", ar: "التالي" },
  "Page not found": { tr: "Sayfa bulunamadı", es: "Página no encontrada", de: "Seite nicht gefunden", fr: "Page introuvable", ar: "الصفحة غير موجودة" },
  "Go home": { tr: "Ana sayfaya dön", es: "Ir al inicio", de: "Zur Startseite", fr: "Accueil", ar: "الصفحة الرئيسية" },
  "Try again": { tr: "Tekrar dene", es: "Reintentar", de: "Erneut versuchen", fr: "Réessayer", ar: "حاول مرة أخرى" },
  "This page didn't load": { tr: "Bu sayfa yüklenemedi", es: "Esta página no se cargó", de: "Diese Seite wurde nicht geladen", fr: "Cette page ne s'est pas chargée", ar: "لم يتم تحميل هذه الصفحة" },
  "Something went wrong. Try again or head home.": { tr: "Bir şeyler ters gitti. Tekrar deneyin veya ana sayfaya dönün.", es: "Algo salió mal. Inténtalo de nuevo o vuelve al inicio.", de: "Etwas ist schiefgelaufen. Versuche es erneut oder gehe zur Startseite.", fr: "Une erreur s'est produite. Réessayez ou revenez à l'accueil.", ar: "حدث خطأ ما. حاول مرة أخرى أو عد إلى الرئيسية." },
};

export function extrasFor(lang: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [src, map] of Object.entries(EXTRAS)) {
    const v = map[lang];
    if (v) out[src] = v;
  }
  return out;
}
