import { describe, expect, it } from "vitest";
import { isHashedChunkUrl, isStaleChunkError } from "./deploy-race-recovery";

describe("isHashedChunkUrl", () => {
  it("matches app chunk paths", () => {
    expect(isHashedChunkUrl("/js/routes.BVR0aquR.js")).toBe(true);
    expect(isHashedChunkUrl("https://www.aroless.tech/js/routes.BVR0aquR.js")).toBe(true);
    expect(isHashedChunkUrl("https://www.aroless.tech/js/activity.LRpJtWUm.js")).toBe(true);
    expect(isHashedChunkUrl("/assets/index.DibJFRMs.js")).toBe(true);
  });

  it("rejects non-chunk assets", () => {
    expect(isHashedChunkUrl("/images/logo.png")).toBe(false);
    expect(isHashedChunkUrl("/styles.css")).toBe(false);
    expect(isHashedChunkUrl("https://example.com/other/app.js")).toBe(false);
    expect(isHashedChunkUrl(null)).toBe(false);
    expect(isHashedChunkUrl(undefined)).toBe(false);
  });
});

describe("isStaleChunkError", () => {
  it("recognizes Chromium dynamic-import failures", () => {
    const err = new Error(
      "Failed to fetch dynamically imported module: https://www.aroless.tech/js/routes.BVR0aquR.js",
    );
    expect(isStaleChunkError(err)).toBe(true);
  });

  it("recognizes WebKit/Gecko wording", () => {
    expect(
      isStaleChunkError("error loading dynamically imported module: /js/index.abc12345.js"),
    ).toBe(true);
    expect(isStaleChunkError("Importing a module script failed.")).toBe(true);
  });

  it("recognizes URL-only errors", () => {
    expect(isStaleChunkError("https://www.aroless.tech/js/activity.LRpJtWUm.js")).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isStaleChunkError(new Error("boom"))).toBe(false);
    expect(isStaleChunkError("TypeError: Cannot read properties of null")).toBe(false);
    expect(isStaleChunkError(null)).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
  });
});
