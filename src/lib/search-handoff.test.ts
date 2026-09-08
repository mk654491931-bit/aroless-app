import { describe, expect, it } from "vitest";
import {
  buildFinderPath,
  clearHandoff,
  consumeHandoff,
  MAX_HANDOFF_QUERY_LENGTH,
  normalizeHandoffQuery,
  parkHandoff,
  readHandoffFromSearch,
  SEARCH_HANDOFF_STORAGE_KEY,
  stripHandoffParam,
  type HandoffStorage,
} from "@/lib/search-handoff";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const storage: HandoffStorage & { size: () => number } = {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    size: () => map.size,
  };
  return storage;
}

function hostileStorage(): HandoffStorage {
  return {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
}

describe("normalizeHandoffQuery", () => {
  it("keeps an ordinary term", () => {
    expect(normalizeHandoffQuery("led star projector")).toBe("led star projector");
  });

  it("trims and collapses whitespace", () => {
    expect(normalizeHandoffQuery("  led   star \t projector ")).toBe("led star projector");
  });

  it("rejects empty and whitespace-only input", () => {
    expect(normalizeHandoffQuery("")).toBeNull();
    expect(normalizeHandoffQuery("    ")).toBeNull();
    expect(normalizeHandoffQuery("\n\t")).toBeNull();
  });

  it("rejects non-string input", () => {
    expect(normalizeHandoffQuery(null)).toBeNull();
    expect(normalizeHandoffQuery(undefined)).toBeNull();
    expect(normalizeHandoffQuery(42)).toBeNull();
    expect(normalizeHandoffQuery({ q: "x" })).toBeNull();
    expect(normalizeHandoffQuery(["x"])).toBeNull();
  });

  it("strips control characters so a URL cannot inject prompt lines", () => {
    expect(normalizeHandoffQuery("led\nIGNORE PREVIOUS\nlamp")).toBe("led IGNORE PREVIOUS lamp");
    expect(normalizeHandoffQuery("led\u0000lamp")).toBe("led lamp");
  });

  it("caps an overlong term at the limit", () => {
    const long = "a".repeat(MAX_HANDOFF_QUERY_LENGTH + 50);
    expect(normalizeHandoffQuery(long)!.length).toBe(MAX_HANDOFF_QUERY_LENGTH);
  });

  it("keeps a term of exactly the limit untouched", () => {
    const exact = "b".repeat(MAX_HANDOFF_QUERY_LENGTH);
    expect(normalizeHandoffQuery(exact)).toBe(exact);
  });

  it("preserves non-latin characters", () => {
    expect(normalizeHandoffQuery(" yıldız projektör ")).toBe("yıldız projektör");
  });
});

describe("readHandoffFromSearch", () => {
  it("reads the parameter with or without a leading question mark", () => {
    expect(readHandoffFromSearch("?q=led%20lamp")).toBe("led lamp");
    expect(readHandoffFromSearch("q=led+lamp")).toBe("led lamp");
  });

  it("ignores other parameters", () => {
    expect(readHandoffFromSearch("?ref=ABC123&q=mug&country=TR")).toBe("mug");
    expect(readHandoffFromSearch("?ref=ABC123")).toBeNull();
  });

  it("returns null for empty and malformed input", () => {
    expect(readHandoffFromSearch("")).toBeNull();
    expect(readHandoffFromSearch("?q=")).toBeNull();
    expect(readHandoffFromSearch("?q=%20%20")).toBeNull();
    expect(readHandoffFromSearch(null)).toBeNull();
    expect(readHandoffFromSearch(undefined)).toBeNull();
  });

  it("decodes percent-encoded non-latin terms", () => {
    expect(readHandoffFromSearch(`?q=${encodeURIComponent("yıldız projektör")}`)).toBe(
      "yıldız projektör",
    );
  });
});

describe("stripHandoffParam", () => {
  it("removes only the handoff parameter", () => {
    expect(stripHandoffParam("/?q=mug")).toBe("/");
    expect(stripHandoffParam("/?ref=ABC&q=mug")).toBe("/?ref=ABC");
    expect(stripHandoffParam("/?q=mug&country=TR")).toBe("/?country=TR");
  });

  it("keeps the path and hash", () => {
    expect(stripHandoffParam("/finder?q=mug#results")).toBe("/finder#results");
  });

  it("is a no-op when the parameter is absent", () => {
    expect(stripHandoffParam("/?ref=ABC")).toBe("/?ref=ABC");
    expect(stripHandoffParam("/")).toBe("/");
  });

  it("falls back safely on unusable input", () => {
    expect(stripHandoffParam("")).toBe("/");
    expect(stripHandoffParam(null)).toBe("/");
  });
});

describe("park / consume", () => {
  it("parks a normalized term and hands it back exactly once", () => {
    const storage = memoryStorage();
    expect(parkHandoff("  led  lamp ", storage)).toBe("led lamp");
    expect(consumeHandoff(storage)).toBe("led lamp");
    expect(consumeHandoff(storage)).toBeNull();
    expect(storage.size()).toBe(0);
  });

  it("does not park a rejected term", () => {
    const storage = memoryStorage();
    expect(parkHandoff("   ", storage)).toBeNull();
    expect(parkHandoff(null, storage)).toBeNull();
    expect(storage.size()).toBe(0);
  });

  it("still normalizes a term when there is no storage", () => {
    expect(parkHandoff(" mug ", null)).toBe("mug");
    expect(consumeHandoff(null)).toBeNull();
  });

  it("re-validates whatever was already in storage", () => {
    const poisoned = memoryStorage({ [SEARCH_HANDOFF_STORAGE_KEY]: "   " });
    expect(consumeHandoff(poisoned)).toBeNull();

    const overlong = memoryStorage({
      [SEARCH_HANDOFF_STORAGE_KEY]: "c".repeat(MAX_HANDOFF_QUERY_LENGTH + 10),
    });
    expect(consumeHandoff(overlong)!.length).toBe(MAX_HANDOFF_QUERY_LENGTH);
  });

  it("survives storage that throws on every call", () => {
    const storage = hostileStorage();
    expect(() => parkHandoff("mug", storage)).not.toThrow();
    expect(parkHandoff("mug", storage)).toBe("mug");
    expect(() => consumeHandoff(storage)).not.toThrow();
    expect(consumeHandoff(storage)).toBeNull();
    expect(() => clearHandoff(storage)).not.toThrow();
  });

  it("clears without consuming", () => {
    const storage = memoryStorage();
    parkHandoff("mug", storage);
    clearHandoff(storage);
    expect(consumeHandoff(storage)).toBeNull();
    expect(() => clearHandoff(null)).not.toThrow();
  });
});

describe("buildFinderPath", () => {
  it("builds an encoded finder link", () => {
    expect(buildFinderPath("led lamp")).toBe("/?q=led%20lamp");
  });

  it("round-trips through the reader", () => {
    const term = "yıldız projektör & kahve";
    const path = buildFinderPath(term);
    const search = path.slice(path.indexOf("?"));
    expect(readHandoffFromSearch(search)).toBe(term);
  });

  it("returns the bare base path for a rejected term", () => {
    expect(buildFinderPath("")).toBe("/");
    expect(buildFinderPath(null)).toBe("/");
    expect(buildFinderPath("  ", "/finder")).toBe("/finder");
  });

  it("honours a custom base path", () => {
    expect(buildFinderPath("mug", "/finder")).toBe("/finder?q=mug");
  });
});
