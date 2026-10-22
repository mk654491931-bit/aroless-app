/**
 * Paylaşılan sırlar için SABİT ZAMANLI karşılaştırma.
 *
 * `a === b` (ve `String.prototype.localeCompare`) ilk farklı baytta döner; bu
 * da bir saldırganın yanıt süresini ölçerek sırrın ön ekini karakter karakter
 * tahmin etmesine (timing attack) kapı aralar. Sır karşılaştırmaları burada
 * yapılır.
 *
 * Saf JS: `node:crypto` kullanılmaz, çünkü bu modülün tüketicileri (route
 * dosyaları) istemci tarafında da değerlendirilebilir. Uzunluk farkı sızdırılır
 * ama sır uzunluğu tek başına kullanılabilir bir bilgi değildir.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}
