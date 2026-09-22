// AI önbelleği — ücretsiz plan kota tasarrufunun alt katmanı.
//
// Testler BELLEK içi sözleşmeyi doğrular (kalıcı Supabase katmanı testlerde
// kapalıdır; bkz. `persistEnabled`). Özellikle TTL: kısa ömürlü araç sonuçları
// (ör. 10 dakikalık haberler) bellekte 24 saat kalamaz, yoksa bayat veri taze
// sanılırdı.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cacheGet, cacheKey, cacheSet, cacheStats, cached } from "./ai-cache.server";

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

// Kota/token tasarrufu: aynı anda gelen özdeş istekler TEK AI çağrısında ve TEK
// kalıcı yazmada birleşmeli. Aksi hâlde iki sekme açan bir kullanıcı iki kat
// kota harcar ve ücretsiz plan kotası boşa gider.
describe("cached() istek birleştirme (single-flight)", () => {
  it("eşzamanlı özdeş istekler tek hesaplamada birleşir", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const compute = async () => {
      calls++;
      await gate;
      return { n: calls };
    };
    const parts = ["es-zamanli", Math.random()];

    const pending = [
      cached("flight-scope", parts, compute),
      cached("flight-scope", parts, compute),
      cached("flight-scope", parts, compute),
    ];
    // Tüm çağrılar uçuş kontrolüne ulaşsın: yalnızca BİR hesaplama başlamış olmalı.
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBe(1);
    expect(cacheStats().inflight).toBe(1);

    release();
    const results = await Promise.all(pending);

    expect(calls).toBe(1);
    // Bir çağrı hesapladı, ikisi uçuştaki söze birleşti (ikisi de kota yakmaz).
    expect(results.filter((r) => !r.cache_hit)).toHaveLength(1);
    expect(results.filter((r) => r.cache_hit)).toHaveLength(2);
    expect(results.every((r) => r.data.n === 1)).toBe(true);
    expect(cacheStats().inflight).toBe(0);
  });

  it("hesaplama hatası uçuş kaydını temizler ve sonraki çağrı yeniden dener", async () => {
    const parts = ["hata", Math.random()];
    await expect(
      cached("flight-scope", parts, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(cacheStats().inflight).toBe(0);

    const recovered = await cached("flight-scope", parts, async () => "kurtuldu");
    expect(recovered.data).toBe("kurtuldu");
    expect(recovered.cache_hit).toBe(false);
  });

  it("birleşen çağrılar sayaçta görünür (önbellek isabetinden ayrı)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const before = cacheStats().coalesced;
    const parts = ["sayac", Math.random()];
    const pending = [
      cached("flight-scope", parts, async () => {
        await gate;
        return "v";
      }),
      cached("flight-scope", parts, async () => {
        await gate;
        return "v2";
      }),
    ];
    await new Promise((r) => setTimeout(r, 20));
    release();
    const [a, b] = await Promise.all(pending);

    expect(b.data).toBe("v");
    expect(a.cache_hit).toBe(false);
    expect(b.cache_hit).toBe(true);
    expect(cacheStats().coalesced).toBe(before + 1);
  });
});
