import { describe, expect, it } from "vitest";
import { asArray } from "./query-guards";

describe("asArray", () => {
  it("passes real arrays through", () => {
    expect(asArray([1, 2, 3])).toEqual([1, 2, 3]);
    expect(asArray([])).toEqual([]);
  });

  it("turns undefined into an empty array", () => {
    expect(asArray(undefined)).toEqual([]);
  });

  it("turns null into an empty array", () => {
    expect(asArray(null)).toEqual([]);
  });

  it("turns a non-array error object (the server-fn leak shape) into an empty array", () => {
    // This is the exact shape that crashed production: the client resolved a
    // JSON 500 with `{error: ...}` as query data, and `?? []` could not catch it.
    expect(asArray({ error: "boom", message: "gateway 500" })).toEqual([]);
  });

  it("turns other primitives into an empty array", () => {
    expect(asArray("favorites")).toEqual([]);
    expect(asArray(42)).toEqual([]);
    expect(asArray(true)).toEqual([]);
  });

  it("preserves the element type for typed consumers", () => {
    const rows = asArray<{ id: string }>([{ id: "a" }]);
    expect(rows[0].id).toBe("a");
  });
});