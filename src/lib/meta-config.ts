/**
 * Meta Pixel — tarayıcı ve sunucu tarafının PAYLAŞTIĞI sabitler.
 *
 * Ayrı dosya olmasının nedeni: Conversions API (sunucu) ile tarayıcı pikseli
 * aynı kimliği ve aynı `event_id` biçimini kullanmak ZORUNDA. İki yerde ayrı
 * yazılırsa Meta aynı satın almayı iki kez sayar (çift `Purchase`).
 */
export const META_PIXEL_ID = "1144034978511312";

/**
 * Çift sayımı önleyen olay kimliği — Paddle İŞLEM kimliğinden türetilir.
 *
 * Aynı işlem için tarayıcı ve sunucu aynı kimliği gönderdiğinde Meta ikinci
 * olayı tekilleştirir. Yenilemelerde her işlem kimliği farklı olduğu için her
 * tahsilat ayrı bir satın alma olarak sayılır (istenen davranış).
 */
export function purchaseEventId(transactionId: string | null | undefined): string | null {
  const id = typeof transactionId === "string" ? transactionId.trim() : "";
  return id ? `purchase-${id}` : null;
}
