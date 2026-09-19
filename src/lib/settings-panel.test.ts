// Unit tests for the collapsible settings panel defaults.
import { describe, expect, it } from "vitest";
import { resolveSettingsOpen } from "./settings-panel";

const NARROW = 420;
const WIDE = 1440;

describe("resolveSettingsOpen", () => {
  it("opens by default on a wide viewport", () => {
    expect(resolveSettingsOpen(null, WIDE, 768)).toBe(true);
  });

  it("stays collapsed by default on a narrow viewport", () => {
    expect(resolveSettingsOpen(null, NARROW, 768)).toBe(false);
  });

  it("honours an explicit saved preference over the viewport", () => {
    expect(resolveSettingsOpen("open", NARROW, 768)).toBe(true);
    expect(resolveSettingsOpen("closed", WIDE, 768)).toBe(false);
  });

  it("treats an unknown or empty saved value as no preference", () => {
    expect(resolveSettingsOpen("", WIDE, 768)).toBe(true);
    expect(resolveSettingsOpen("", NARROW, 768)).toBe(false);
    expect(resolveSettingsOpen("banana", NARROW, 768)).toBe(false);
  });

  it("uses the provided breakpoint for the default", () => {
    // Topbar kümesi daha yüksek eşik kullanır: 1024 genişlikte kapalı başlar.
    expect(resolveSettingsOpen(null, 1024, 1280)).toBe(false);
    expect(resolveSettingsOpen(null, 1280, 1280)).toBe(true);
  });
});
