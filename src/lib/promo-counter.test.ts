/**
 * PROMOSYON SAYACI — ATOMİK KONTENJAN SÖZLEŞMESİ.
 *
 * Kapsam: `reservePromoRedemption` / `releasePromoRedemption` kararları.
 *
 * Neden bu kadar dar: sayaç eskiden okuma → +1 → yazma ile artırılıyordu ve
 * eşzamanlı iki sahiplenme `max_redemptions` sınırını aşıyordu. Bu testler
 * atomik RPC'nin dönüş kodlarının doğru yorumlandığını kilitler; RPC'nin
 * kendisi (SQL) migrasyon testinde kaynak olarak doğrulanır.
 *
 * $0 çalışır: ağ ve veritabanı yoktur.
 */
import { describe, expect, it, vi } from "vitest";

import {
  releasePromoRedemption,
  reservePromoRedemption,
  type PromoCounterClient,
} from "./promo-counter";

function fakeClient(response: { data: unknown; error: { message: string } | null }): {
  rpc: ReturnType<typeof vi.fn>;
} {
  return { rpc: vi.fn(async () => response) };
}

describe("reservePromoRedemption", () => {
  it("kontenjan ayrıldığında reserved:true / atomic:true döner", async () => {
    const client = fakeClient({ data: true, error: null });
    await expect(
      reservePromoRedemption(client as unknown as PromoCounterClient, "code-1"),
    ).resolves.toEqual({ reserved: true, atomic: true });
    expect(client.rpc).toHaveBeenCalledWith("increment_promo_redemption", { _code_id: "code-1" });
  });

  it("tükenmiş/pasif kodda reserved:false döner (çağıran REDDETMELİ)", async () => {
    const client = fakeClient({ data: false, error: null });
    await expect(
      reservePromoRedemption(client as unknown as PromoCounterClient, "code-1"),
    ).resolves.toEqual({ reserved: false, atomic: true });
  });

  it("RPC yoksa eski usule düşer: rezervasyonu ENGELLEMEZ", async () => {
    const client = fakeClient({ data: null, error: { message: "Could not find the function" } });
    await expect(
      reservePromoRedemption(client as unknown as PromoCounterClient, "code-1"),
    ).resolves.toEqual({ reserved: true, atomic: false });
  });

  it("RPC fırlatırsa da akışı bozmaz", async () => {
    const client = {
      rpc: vi.fn(async () => {
        throw new Error("network");
      }),
    };
    await expect(
      reservePromoRedemption(client as unknown as PromoCounterClient, "code-1"),
    ).resolves.toEqual({ reserved: true, atomic: false });
  });
});

describe("releasePromoRedemption", () => {
  it("ayrılan kontenjanı geri bırakır", async () => {
    const client = fakeClient({ data: null, error: null });
    await releasePromoRedemption(client as unknown as PromoCounterClient, "code-9");
    expect(client.rpc).toHaveBeenCalledWith("release_promo_redemption", { _code_id: "code-9" });
  });

  it("hata durumunda sessiz kalır (kullanıcı akışı bozulmaz)", async () => {
    const client = {
      rpc: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    await expect(
      releasePromoRedemption(client as unknown as PromoCounterClient, "code-9"),
    ).resolves.toBeUndefined();
  });
});
