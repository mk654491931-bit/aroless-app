// Isınma/bayat önbelleği — herkese açık AI uçlarının 504 yerine hızlı yanıt
// üretmesini sağlayan katman.
//
// Sözleşme:
//   ready   → taze veri, bekleme yok
//   stale   → bayat veri hemen döner, tazeleme arka planda
//   warming → tarama sürüyor, istek yine ANINDA döner (boş veri)
//   failed  → tarama bitti ve hata verdi (çağıran gerçek hata döndürebilir)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSwrCache,
  seedSwrCache,
  serveStaleWhileRevalidate,
  swrCacheStats,
} from "./swr-cache.server";

type Payload = { items: number[] };
const hasItems = (value: Payload) => value.items.length > 0;
const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

beforeEach(() => {
  clearSwrCache();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  clearSwrCache();
  vi.restoreAllMocks();
});

describe("serveStaleWhileRevalidate", () => {
  it("taze önbellekte beklemeden döner ve üretimi çağırmaz", async () => {
    seedSwrCache<Payload>("k", { items: [1] });
    const build = vi.fn(async () => ({ items: [2] }));
    const result = await serveStaleWhileRevalidate<Payload>({
      key: "k",
      freshMs: 1_000,
      build,
      isValid: hasItems,
    });
    expect(result).toEqual({ data: { items: [1] }, status: "ready" });
    expect(build).not.toHaveBeenCalled();
  });

  it("soğuk önbellekte üretip ready olarak önbelleğe yazar", async () => {
    const first = await serveStaleWhileRevalidate<Payload>({
      key: "cold",
      freshMs: 1_000,
      build: async () => ({ items: [7] }),
    });
    expect(first).toEqual({ data: { items: [7] }, status: "ready" });
    expect(swrCacheStats().entries).toBe(1);

    const second = await serveStaleWhileRevalidate<Payload>({
      key: "cold",
      freshMs: 1_000,
      build: async () => ({ items: [99] }),
    });
    expect(second).toEqual({ data: { items: [7] }, status: "ready" });
  });

  it("süresi yetmezse warming döner, sonra önbellekten gelir", async () => {
    let resolve!: (value: Payload) => void;
    const pending = new Promise<Payload>((r) => {
      resolve = r;
    });

    const first = await serveStaleWhileRevalidate<Payload>({
      key: "slow",
      freshMs: 1_000,
      waitMs: 20,
      build: () => pending,
    });
    expect(first).toEqual({ data: null, status: "warming" });

    resolve({ items: [5] });
    await flush();

    const second = await serveStaleWhileRevalidate<Payload>({
      key: "slow",
      freshMs: 1_000,
      waitMs: 20,
      build: () => pending,
    });
    expect(second).toEqual({ data: { items: [5] }, status: "ready" });
  });

  it("bayat veriyi beklemeden döner ve arka planda tazeler", async () => {
    seedSwrCache<Payload>("stale", { items: [1] }, Date.now() - 60_000);

    const first = await serveStaleWhileRevalidate<Payload>({
      key: "stale",
      freshMs: 1_000,
      build: async () => ({ items: [2] }),
    });
    expect(first).toEqual({ data: { items: [1] }, status: "stale" });

    await flush();
    const second = await serveStaleWhileRevalidate<Payload>({
      key: "stale",
      freshMs: 1_000,
      build: async () => ({ items: [2] }),
    });
    expect(second).toEqual({ data: { items: [2] }, status: "ready" });
  });

  it("geçersiz (boş) sonucu önbelleğe yazmaz", async () => {
    const build = vi.fn(async (): Promise<Payload> => ({ items: [] }));
    const result = await serveStaleWhileRevalidate<Payload>({
      key: "empty",
      freshMs: 1_000,
      waitMs: 20,
      build,
      isValid: hasItems,
    });
    expect(result).toEqual({ data: null, status: "warming" });
    await flush();
    expect(swrCacheStats().entries).toBe(0);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("üretim hatasını 'failed' olarak bildirir", async () => {
    const result = await serveStaleWhileRevalidate<Payload>({
      key: "boom",
      freshMs: 1_000,
      waitMs: 20,
      build: async () => {
        throw new Error("gemini down");
      },
    });
    expect(result).toEqual({ data: null, status: "failed" });
    expect(swrCacheStats().entries).toBe(0);
  });

  it("aynı anahtar için eşzamanlı istekler tek üretim yapar", async () => {
    const build = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { items: [3] };
    });
    const results = await Promise.all([
      serveStaleWhileRevalidate<Payload>({ key: "dedupe", freshMs: 1_000, build }),
      serveStaleWhileRevalidate<Payload>({ key: "dedupe", freshMs: 1_000, build }),
      serveStaleWhileRevalidate<Payload>({ key: "dedupe", freshMs: 1_000, build }),
    ]);
    expect(results.every((r) => r.status === "ready")).toBe(true);
    expect(build).toHaveBeenCalledTimes(1);
  });
});

describe("clearSwrCache / swrCacheStats", () => {
  it("prefix ile yalnızca ilgili anahtarları siler", () => {
    seedSwrCache("trends:A", { items: [1] });
    seedSwrCache("trends:B", { items: [1] });
    seedSwrCache("other", { items: [1] });
    expect(swrCacheStats().entries).toBe(3);

    clearSwrCache("trends:");
    expect(swrCacheStats().entries).toBe(1);

    clearSwrCache();
    expect(swrCacheStats()).toEqual({ entries: 0, inflight: 0 });
  });
});
