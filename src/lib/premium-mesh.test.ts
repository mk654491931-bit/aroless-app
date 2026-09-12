import { describe, expect, it } from "vitest";
import {
  MESH_LINK_BUCKETS,
  MESH_LINK_DISTANCE,
  MESH_MAX_DPR,
  MESH_MAX_NODES,
  MESH_MIN_NODES,
  MESH_TARGET_FPS,
  createFrameGate,
  meshDpr,
  meshLinkBucket,
  meshLinkStrength,
  meshNodeCount,
} from "./premium-mesh";

describe("meshDpr", () => {
  it("clamps the ratio so the canvas is never 4x the raster", () => {
    expect(meshDpr(2)).toBe(MESH_MAX_DPR);
    expect(meshDpr(3)).toBe(MESH_MAX_DPR);
    expect(meshDpr(1)).toBe(1);
  });

  it("falls back to 1 for a missing or bogus ratio", () => {
    expect(meshDpr(Number.NaN)).toBe(1);
    expect(meshDpr(0)).toBe(1);
    expect(meshDpr(-2)).toBe(1);
  });
});

describe("meshNodeCount", () => {
  it("caps the O(n²) link work on large viewports", () => {
    expect(meshNodeCount(3840, 2160)).toBe(MESH_MAX_NODES);
  });

  it("keeps a visible floor on tiny viewports", () => {
    expect(meshNodeCount(320, 480)).toBe(MESH_MIN_NODES);
    expect(meshNodeCount(0, 0)).toBe(MESH_MIN_NODES);
  });

  it("stays within bounds for any input, including garbage", () => {
    for (const [w, h] of [
      [1280, 720],
      [1920, 1080],
      [Number.NaN, 800],
      [-100, 400],
      [1e9, 1e9],
    ]) {
      const count = meshNodeCount(w as number, h as number);
      expect(Number.isInteger(count)).toBe(true);
      expect(count).toBeGreaterThanOrEqual(MESH_MIN_NODES);
      expect(count).toBeLessThanOrEqual(MESH_MAX_NODES);
    }
  });
});

describe("meshLinkStrength", () => {
  it("is 1 at zero distance and 0 at or beyond the cutoff", () => {
    expect(meshLinkStrength(0, 0)).toBe(1);
    expect(meshLinkStrength(MESH_LINK_DISTANCE, 0)).toBe(0);
    expect(meshLinkStrength(0, MESH_LINK_DISTANCE)).toBe(0);
    expect(meshLinkStrength(500, 500)).toBe(0);
  });

  it("decays monotonically and matches the hypotenuse (not axis distance)", () => {
    const near = meshLinkStrength(30, 40); // distance 50
    expect(near).toBeCloseTo(1 - 50 / MESH_LINK_DISTANCE, 6);
    const far = meshLinkStrength(60, 80); // distance 100
    expect(far).toBeLessThan(near);
    // Two nodes 100 apart on each axis are 141 apart → outside the cutoff.
    expect(meshLinkStrength(100, 100)).toBe(0);
  });

  it("never returns NaN or negative values", () => {
    for (const [dx, dy] of [
      [Number.NaN, 0],
      [0, Number.NaN],
      [-90, -90],
      [Number.POSITIVE_INFINITY, 0],
    ]) {
      const value = meshLinkStrength(dx as number, dy as number);
      expect(Number.isNaN(value)).toBe(false);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe("meshLinkBucket", () => {
  it("maps the strength range onto the full bucket range", () => {
    expect(meshLinkBucket(1)).toBe(MESH_LINK_BUCKETS - 1);
    expect(meshLinkBucket(2)).toBe(MESH_LINK_BUCKETS - 1);
    expect(meshLinkBucket(0.0001)).toBe(0);
  });

  it("is monotonic, so a stronger link never gets a dimmer bucket", () => {
    let previous = -1;
    for (let i = 0; i <= 20; i++) {
      const bucket = meshLinkBucket(i / 20);
      expect(bucket).toBeGreaterThanOrEqual(previous);
      previous = bucket;
    }
  });

  it("stays in range for garbage input", () => {
    for (const strength of [Number.NaN, -1, 0, Number.POSITIVE_INFINITY]) {
      const bucket = meshLinkBucket(strength);
      expect(Number.isInteger(bucket)).toBe(true);
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(MESH_LINK_BUCKETS);
    }
  });

  it("honours a custom bucket count", () => {
    expect(meshLinkBucket(1, 2)).toBe(1);
    expect(meshLinkBucket(0.2, 2)).toBe(0);
    expect(meshLinkBucket(1, 0)).toBe(MESH_LINK_BUCKETS - 1);
  });
});

describe("createFrameGate", () => {
  it("passes the first frame immediately", () => {
    const gate = createFrameGate(30);
    expect(gate(0)).toBe(true);
  });

  it("drops frames inside the interval and passes once it is spent", () => {
    const gate = createFrameGate(30); // 33.33ms
    expect(gate(0)).toBe(true);
    expect(gate(10)).toBe(false);
    expect(gate(30)).toBe(false);
    expect(gate(34)).toBe(true);
    expect(gate(50)).toBe(false);
    expect(gate(68)).toBe(true);
  });

  it("never exceeds the target fps over a simulated second", () => {
    const gate = createFrameGate(MESH_TARGET_FPS);
    let paints = 0;
    for (let now = 0; now <= 1000; now += 1000 / 240) {
      if (gate(now)) paints += 1;
    }
    expect(paints).toBeLessThanOrEqual(MESH_TARGET_FPS + 1);
    expect(paints).toBeGreaterThan(MESH_TARGET_FPS / 2);
  });

  it("tolerates a bogus fps value", () => {
    const gate = createFrameGate(Number.NaN);
    expect(gate(0)).toBe(true);
    expect(gate(1_000)).toBe(true);
  });
});
