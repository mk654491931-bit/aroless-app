/**
 * ÜCRETSİZ OKUYUCU ÖNBELLEĞİ — kota koruması.
 *
 * Jina Reader anahtarsız katmanda ~20 istek/dk; her arama ~57-75K token
 * harcıyor. Aynı nişi iki sekme/iki kullanıcı aynı anda ararsa iki kez
 * okumak ücretsiz kotayı boşa yakar. `cached()` tek uçuşu birleştirir;
 * boş sonuç ise 3 saat değil 15 dakika saklanır (geçici engel kalıcı
 * "ürün yok" sonucuna dönüşmesin).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { cachedReaderRows } from "./product-discovery-reader.server";

afterEach(() => {
  vi.useRealTimers();
});

describe("cachedReaderRows", () => {
  it("eşzamanlı özdeş okumalar TEK yüklemeye birleşir", async () => {
    let loads = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const parts = [`flight-${Math.random()}`];
    const load = async () => {
      loads += 1;
      await gate;
      return [];
    };

    const pending = [
      cachedReaderRows("reader-test", parts, load),
      cachedReaderRows("reader-test", parts, load),
      cachedReaderRows("reader-test", parts, load),
    ];
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(loads).toBe(1);

    release();
    const results = await Promise.all(pending);
    expect(loads).toBe(1);
    expect(results).toEqual([[], [], []]);
  });

  it("başarılı okuma ikinci kez ağa gitmez", async () => {
    let loads = 0;
    const parts = [`success-${Math.random()}`];
    const load = async () => {
      loads += 1;
      return [{ title: "ölçülmüş ürün" }] as never[];
    };

    const first = await cachedReaderRows("reader-test", parts, load);
    const second = await cachedReaderRows("reader-test", parts, load);

    expect(loads).toBe(1);
    expect(second).toEqual(first);
  });

  it("boş sonuç 15 dakika sonra yeniden denenir (3 saat kilitlenmez)", async () => {
    vi.useFakeTimers();
    let loads = 0;
    const parts = [`empty-${Math.random()}`];
    const load = async () => {
      loads += 1;
      return [];
    };

    await cachedReaderRows("reader-test", parts, load);
    await cachedReaderRows("reader-test", parts, load);
    expect(loads).toBe(1);

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000 + 1_000);
    await cachedReaderRows("reader-test", parts, load);
    expect(loads).toBe(2);
  });
});
