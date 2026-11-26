import { describe, expect, it } from "vitest";
import {
  normalizeWatchlist,
  toggleWatchlist,
  watchlistStorageKey,
  writeWatchlist,
} from "./watchlist";

describe("watchlist", () => {
  it("bozuk değerleri ve tekrarları temizler", () => {
    expect(normalizeWatchlist(null)).toEqual([]);
    expect(normalizeWatchlist(["a", "a", "", 4, null])).toEqual(["a", "4"]);
  });

  it("en son eklenen kimliği başa alır ve tekrar tıklamada çıkarır", () => {
    expect(toggleWatchlist(["a", "b"], "c")).toEqual(["c", "a", "b"]);
    expect(toggleWatchlist(["a", "b"], "a")).toEqual(["b"]);
    expect(toggleWatchlist(["a"], "")).toEqual(["a"]);
  });

  it("kapsamı güvenli depolama anahtarına çevirir", () => {
    expect(watchlistStorageKey("viral ads/2026")).toBe("aroless:watchlist:v1:viral-ads-2026");
  });

  it("localStorage yokken (SSR/test) çökmeden liste döner", () => {
    expect(writeWatchlist("viral", ["x"])).toEqual(["x"]);
  });
});
