/**
 * DOM çeviri katmanının SAF karar fonksiyonu (DOM yok — test edilebilir).
 *
 * SORUN (ölçüldü): katman, bir metin düğümünün ilk gördüğü metni "kaynak"
 * olarak hatırlıyordu. React aynı düğümü SONRADAN farklı bir metinle
 * güncellediğinde (skor, fiyat, durum, sayaç) katman hâlâ ESKİ kaynağı
 * çeviriyor ve yeni içeriğin ÜSTÜNE eski metni yazıyordu. Sonuç: çeviri
 * açıkken dinamik değerler donuyor, hatta dil değişince bazı ekranlar eski
 * metni gösteriyordu.
 *
 * ÇÖZÜM: mevcut metin ne kaynağa ne de bilinen çeviriye eşitse, o metin YENİ
 * kaynaktır. Böylece React'in yazdığı içerik her zaman kazanır.
 */

export type TextResolution = {
  /** Düğüme yazılacak metin (çeviri yoksa kaynağın kendisi). */
  text: string;
  /**
   * Hatırlanacak kaynak metin. `null` → bu düğüm için eşleme YOK; katman
   * düğümü "sahiplenmemiş" sayar ve dil değişiminde kaynağa döndürmez.
   */
  source: string | null;
};

/**
 * Bir metin düğümünün akıbetini belirler.
 *
 * @param current       Düğümün ŞU ANKİ metni.
 * @param storedSource  Katmanın daha önce kaydettiği kaynak (yoksa null).
 * @param storedTarget  Kaydedilen kaynağın bilinen çevirisi (yoksa null).
 * @param translate     Kaynak → çeviri; çeviri yoksa null.
 */
export function resolveNodeText(args: {
  current: string;
  storedSource: string | null | undefined;
  storedTarget: string | null | undefined;
  translate: (source: string) => string | null;
}): TextResolution {
  const { current, translate } = args;
  const storedSource = args.storedSource ?? null;
  const storedTarget = args.storedTarget ?? null;

  let source: string;
  if (storedSource == null) {
    // İlk kez görülen düğüm: mevcut metin kaynaktır.
    source = current;
  } else if (current === storedSource) {
    // React kaynağı yeniden yazdı (ör. aynı metinle yeniden çizim).
    source = storedSource;
  } else if (storedTarget != null && current === storedTarget) {
    // Düğüm hâlâ bizim yazdığımız çeviriyi taşıyor.
    source = storedSource;
  } else {
    // İçerik DEĞİŞTİ: eski kaynak artık geçersiz. Yeni metin yeni kaynaktır.
    source = current;
  }

  const target = translate(source);
  if (target == null || target === source) {
    // Çeviri yok: kaynağı göster ve eşlemeyi bırak (dil değişiminde tekrar
    // çevirmeye çalışmanın anlamı yok, ama yeni içerik gelirse yakalanır).
    return { text: source, source: null };
  }
  return { text: target, source };
}
