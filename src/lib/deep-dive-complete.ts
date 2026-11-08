import { parseNumber } from "@/lib/money";

/**
 * Sayı yardımcısı — tek para/sayı parserı (`src/lib/money.ts`).
 *
 * NOT: Eski `completeDeepDive` fonksiyonu, AI yanıtında eksik kalan 90 günlük
 * finansal projeksiyonu, içerik takvimini, lansman bütçelerini, pazar
 * doygunluğunu ("2.000+ satıcı"), fiyat basamaklarını ve ölçekleme/çıkış
 * kriterlerini ürünün rakamlarından TÜRETİYORDU. Bu değerlerin hiçbiri ölçüm
 * değildi; arayüzde araştırma sonucu gibi görünüyordu. Fonksiyon kaldırıldı:
 * eksik bölüm artık gösterilmez ve uydurma varsayılanla doldurulmaz.
 */
export function num(v: unknown, fallback = 0): number {
  return parseNumber(v) ?? fallback;
}
