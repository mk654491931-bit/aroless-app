/**
 * Promosyon kodu kullanım sayacı — ATOMİK kontenjan ayırma.
 *
 * NEDEN: sayaç uygulamada okuma → +1 → yazma ile artırılıyordu. İki eşzamanlı
 * sahiplenme aynı değeri okuyup aynı değeri yazdığında `times_redeemed` eksik
 * kalıyor ve `max_redemptions` sınırı aşılabiliyordu. Artık artırma veritabanında
 * tek atomik UPDATE'tir (`increment_promo_redemption`); sınır aynı ifadenin
 * içinde kontrol edilir.
 *
 * GERİYE UYUMLULUK: RPC henüz uygulanmamış bir ortamda (migration sırası
 * karışırsa) sayaç tamamen durmasın diye `atomic: false` döneriz; çağıran eski
 * yöntemle sayar. Sınır kontrolü yine çağıran tarafta yapılmıştır, yani
 * davranış eskisinden KÖTÜ olmaz — yalnız eskisi kadar iyi olur.
 */

/** Yalnız ihtiyaç duyduğumuz RPC yüzeyi (Supabase istemcisiyle uyumlu). */
export type PromoCounterClient = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export type PromoReservation = {
  /** Kontenjan ayrıldı mı? `false` → kod tükendi/pasif/süresi dolmuş. */
  reserved: boolean;
  /** Atomik RPC çalıştı mı? `false` → çağıran eski usulle saymalı. */
  atomic: boolean;
};

/**
 * Bir kullanım kontenjanı ayırır.
 *
 * Dönüş sözleşmesi:
 *   • `{ reserved: true,  atomic: true  }` → sayıldı, devam edilebilir.
 *   • `{ reserved: false, atomic: true  }` → kod tükendi; sahiplenme REDDEDİLMELİ.
 *   • `{ reserved: true,  atomic: false }` → RPC yok; eski usulle sayılmalı.
 */
export async function reservePromoRedemption(
  client: PromoCounterClient,
  codeId: string,
): Promise<PromoReservation> {
  try {
    const { data, error } = await client.rpc("increment_promo_redemption", { _code_id: codeId });
    if (error) return { reserved: true, atomic: false };
    return { reserved: data === true, atomic: true };
  } catch {
    return { reserved: true, atomic: false };
  }
}

/**
 * Yazma hatasında ayrılan kontenjanı geri bırakır.
 *
 * Sessizdir: iade edilemeyen bir kontenjan, kullanıcıya gösterilecek bir hata
 * değildir ve asıl işlemi (kayıt/kod sahiplenme) bozmamalıdır.
 */
export async function releasePromoRedemption(
  client: PromoCounterClient,
  codeId: string,
): Promise<void> {
  try {
    await client.rpc("release_promo_redemption", { _code_id: codeId });
  } catch {
    /* sayaç şişmesi kabul edilebilir; kullanıcı akışı bozulmaz */
  }
}
