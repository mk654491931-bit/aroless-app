import { describe, expect, it } from "vitest";
import { isSidebarItemActive } from "./sidebar-active";

describe("isSidebarItemActive", () => {
  it("hash'siz sayfalarda yolu eşleştirir", () => {
    const loc = { pathname: "/dashboard", hash: "" };
    expect(isSidebarItemActive({ url: "/dashboard" }, loc, 1)).toBe(true);
    expect(isSidebarItemActive({ url: "/" }, loc, 0)).toBe(false);
  });

  it("hub kökünde yalnız ilk aracı aktif yapar", () => {
    const loc = { pathname: "/tools/finance", hash: "" };
    expect(isSidebarItemActive({ url: "/tools/finance", hash: "reverse-cost" }, loc, 0)).toBe(true);
    expect(isSidebarItemActive({ url: "/tools/finance", hash: "landed-cost" }, loc, 1)).toBe(false);
  });

  it("hash varsa yalnız o aracı aktif yapar", () => {
    const loc = { pathname: "/tools/finance", hash: "#landed-cost" };
    expect(isSidebarItemActive({ url: "/tools/finance", hash: "reverse-cost" }, loc, 0)).toBe(
      false,
    );
    expect(isSidebarItemActive({ url: "/tools/finance", hash: "landed-cost" }, loc, 1)).toBe(true);
  });

  it("başka rotadaki aracı aktif göstermez", () => {
    const loc = { pathname: "/tools/growth", hash: "" };
    expect(isSidebarItemActive({ url: "/tools/finance", hash: "reverse-cost" }, loc, 0)).toBe(
      false,
    );
  });
});
