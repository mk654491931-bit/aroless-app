import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableLiteMode, isLiteDevice, isLiteMode, prefersReducedMotion } from "./fluidity";

/** Basit <html> class listesi + sahte pencere/depolama. */
function fakeDom() {
  const classes = new Set<string>();
  const listeners = new Map<string, Set<() => void>>();
  const classList = {
    contains: (c: string) => classes.has(c),
    add: (c: string) => {
      classes.add(c);
    },
    remove: (c: string) => {
      classes.delete(c);
    },
    toggle: (c: string, on?: boolean) => {
      if (on) classes.add(c);
      else classes.delete(c);
    },
  };
  const windowStub = {
    matchMedia: (query: string) => ({
      matches: query.includes("reduced-motion") ? reducedMotion : false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
    dispatchEvent: (event: unknown) => {
      const type = (event as { type?: string }).type ?? "";
      for (const handler of listeners.get(type) ?? []) handler();
      return true;
    },
    addEventListener: (type: string, handler: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(handler);
    },
    removeEventListener: (type: string, handler: () => void) => {
      listeners.get(type)?.delete(handler);
    },
    setTimeout: () => 0,
    clearTimeout: () => {},
  };
  return { classes, classList, windowStub, listeners };
}

let reducedMotion = false;
let dom: ReturnType<typeof fakeDom>;

beforeEach(() => {
  reducedMotion = false;
  dom = fakeDom();
  vi.stubGlobal("document", { documentElement: { classList: dom.classList }, hidden: false });
  vi.stubGlobal("window", dom.windowStub);
  vi.stubGlobal("sessionStorage", { setItem: () => {}, getItem: () => null });
  vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 8 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("prefersReducedMotion / isLiteDevice", () => {
  it("treats reduced motion as a lite device", () => {
    reducedMotion = true;
    expect(prefersReducedMotion()).toBe(true);
    expect(isLiteDevice()).toBe(true);
  });

  it("flags low-core and low-memory hardware", () => {
    vi.stubGlobal("navigator", { hardwareConcurrency: 2, deviceMemory: 8 });
    expect(isLiteDevice()).toBe(true);

    vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 2 });
    expect(isLiteDevice()).toBe(true);
  });

  it("flags data-saver connections", () => {
    vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 8, connection: { saveData: true } });
    expect(isLiteDevice()).toBe(true);
  });

  it("leaves capable devices untouched", () => {
    expect(isLiteDevice()).toBe(false);
  });
});

describe("enableLiteMode", () => {
  it("adds the perf-lite class and remembers it for the session", () => {
    const setItem = vi.fn();
    vi.stubGlobal("sessionStorage", { setItem, getItem: () => null });
    expect(isLiteMode()).toBe(false);
    enableLiteMode("test");
    expect(isLiteMode()).toBe(true);
    expect(dom.classes.has("perf-lite")).toBe(true);
    expect(setItem).toHaveBeenCalledWith("aroless.perf-lite", "1");
  });

  it("is idempotent and notifies listeners only once", () => {
    let events = 0;
    dom.windowStub.addEventListener("fluidity:lite", () => {
      events += 1;
    });
    enableLiteMode("test");
    enableLiteMode("test");
    expect(events).toBe(1);
  });
});
