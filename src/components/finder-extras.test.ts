import { describe, expect, it } from "vitest";
import { parsePersistedState } from "@/components/finder-extras";

describe("parsePersistedState", () => {
  it("returns null for null raw input", () => {
    expect(parsePersistedState(null, [])).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parsePersistedState("{ not json", [])).toBeNull();
    expect(parsePersistedState("undefined", [])).toBeNull();
  });

  it("accepts arrays when the initial value is an array", () => {
    const raw = JSON.stringify(["Amazon", "Shopify"]);
    expect(parsePersistedState(raw, [])).toEqual(["Amazon", "Shopify"]);
    expect(parsePersistedState(raw, [] as string[])).toEqual(["Amazon", "Shopify"]);
  });

  it("rejects non-arrays when the initial value is an array", () => {
    expect(parsePersistedState(JSON.stringify("Amazon"), [])).toBeNull();
    expect(parsePersistedState(JSON.stringify({ a: 1 }), [])).toBeNull();
    expect(parsePersistedState(JSON.stringify(5), [])).toBeNull();
    expect(parsePersistedState(JSON.stringify(null), [])).toBeNull();
  });

  it("accepts primitives of the matching type", () => {
    expect(parsePersistedState(JSON.stringify("US"), "TR")).toBe("US");
    expect(parsePersistedState(JSON.stringify(70), 0)).toBe(70);
    expect(parsePersistedState(JSON.stringify(true), false)).toBe(true);
  });

  it("rejects primitives of a mismatched type", () => {
    expect(parsePersistedState(JSON.stringify("70"), 0)).toBeNull();
    expect(parsePersistedState(JSON.stringify(70), "")).toBeNull();
    expect(parsePersistedState(JSON.stringify("1"), true)).toBeNull();
    expect(parsePersistedState(JSON.stringify(null), "")).toBeNull();
  });

  it("accepts plain objects when the initial value is an object", () => {
    const raw = JSON.stringify({ a: 1, b: ["x"] });
    expect(parsePersistedState(raw, {})).toEqual({ a: 1, b: ["x"] });
  });

  it("rejects arrays, strings and null when the initial value is an object", () => {
    expect(parsePersistedState(JSON.stringify([1, 2]), {})).toBeNull();
    expect(parsePersistedState(JSON.stringify("x"), {})).toBeNull();
    expect(parsePersistedState(JSON.stringify(null), {})).toBeNull();
  });

  it("returns the parsed value unchanged (no mutation)", () => {
    const raw = JSON.stringify({ deep: { nested: [1, 2, 3] } });
    const parsed = parsePersistedState(raw, {});
    expect(parsed).toEqual({ deep: { nested: [1, 2, 3] } });
  });
});