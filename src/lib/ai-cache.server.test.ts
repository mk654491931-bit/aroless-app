// AI önbelleği — ücretsiz plan kota tasarrufunun alt katmanı.
//
// Testler BELLEK içi sözleşmeyi doğrular (kalıcı Supabase katmanı testlerde
// kapalıdır; bkz. `persistEnabled`). Özellikle TTL: kısa ömürlü araç sonuçları
// (ör. 10 dakikalık haberler) bellekte 24 saat kalamaz, yoksa bayat veri taze
// sanılırdı.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cacheGet, cacheKey, cacheSet, cached } from "./ai-cache.server";

afterEach(() => {
  vi.useRealTimers();
});

describe("cacheSet / cacheGet", () => {
  it("yazılan değeri okur", async () => {
    const key = `test:${Math.random()}`;
    await cacheSet(key, "test", { v: 1 }, 60_000);
    expect(await cacheGet<{ v: number }>(key)).toEqual({ v: 1 });
  });

  it("kısa TTL süresi dolunca kayıt düşer", async () => {
    vi.useFakeTimers();
    const key = `ttl:${Math.random()}`;
    await cacheSet(key, "test", { v: "haber" }, 10 * 60_000);
    expect(await cacheGet(key)).toEqual({ v: "haber" });

    vi.advanceTimersByTime(9 * 60_000);
    expect(await cacheGet(key)).toEqual({ v: "haber" });

    vi.advanceTimersByTime(2 * 60_000);
    expect(await cacheGet(key)).toBeNull();
  });

  it("varsayılan TTL 24 saatlik tavana kırpılır", async () => {
    vi.useFakeTimers();
    const key = `clamp:${Math.random()}`;
    // 10 yıl istemek kalıcı katmanın sözleşmesini bozmamalı.
    await cacheSet(key, "test", { v: 1 }, 10 * 365 * 24 * 60 * 60_000);
    vi.advanceTimersByTime(24 * 60 * 60_000 - 1);
    const stillThere = await cacheGet(key);
    expect(stillThere).toEqual({ v: 1 });
  });
});

describe("cached()", () => {
  it("aynı girdide ikinci kez hesaplamaz (kota yanmaz)", async () => {
    let calls = 0;
    const parts = ["rakip-analizi", Math.random()];
    const first = await cached("test-scope", parts, async () => {
      calls++;
      return { n: calls };
    });
    const second = await cached("test-scope", parts, async () => {
      calls++;
      return { n: calls };
    });

    expect(first.cache_hit).toBe(false);
    expect(second.cache_hit).toBe(true);
    expect(second.data).toEqual({ n: 1 });
    expect(calls).toBe(1);
  });

  it("farklı girdide yeniden hesaplar", async () => {
    let calls = 0;
    await cached("test-scope", ["a", Math.random()], async () => {
      calls++;
      return calls;
    });
    await cached("test-scope", ["b", Math.random()], async () => {
      calls++;
      return calls;
    });
    expect(calls).toBe(2);
  });

  it("anahtar üretimi deterministik", async () => {
    const one = await cacheKey("scope", ["A ", "b"]);
    const two = await cacheKey("scope", ["a", "B"]);
    expect(one).toBe(two);
    expect(one.startsWith("scope:")).toBe(true);
  });
});
