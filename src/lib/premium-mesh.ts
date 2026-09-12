// ============================================================================
// Ambient node mesh — cost control (pure, unit-tested)
//
// The drifting node mesh is a full-screen canvas that redraws continuously. Its
// naive implementation is the heaviest thing on the page:
//   • an O(n²) link pass per frame (`Math.hypot` is several times slower than a
//     squared-distance compare + one `sqrt`),
//   • a device-pixel-ratio of 2, which quadruples the pixels cleared/filled,
//   • a 60fps loop for motion that is visually identical at 30fps.
//
// These helpers keep that cost bounded and, because they are pure, are the part
// of the renderer we can actually assert on in tests.
// ============================================================================

/** Hard ceiling on nodes: the link pass is O(n²), so this caps the work. */
export const MESH_MAX_NODES = 48;
/** Never fewer than this, or the mesh looks empty on small viewports. */
export const MESH_MIN_NODES = 24;
/** One node per this many CSS pixels (was 1/22k–1/30k, now cheaper). */
export const MESH_AREA_PER_NODE = 42_000;
/** Links longer than this are skipped entirely. */
export const MESH_LINK_DISTANCE = 128;
/** Device pixel ratio is clamped: 2 costs 4x the raster of 1. */
export const MESH_MAX_DPR = 1.5;
/** Canvas redraw target. Slow drifting nodes do not need 60fps. */
export const MESH_TARGET_FPS = 30;

/** Clamped, finite device pixel ratio. */
export function meshDpr(devicePixelRatio: number): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(dpr, MESH_MAX_DPR);
}

/** Node count for a viewport, always within [MESH_MIN_NODES, MESH_MAX_NODES]. */
export function meshNodeCount(width: number, height: number): number {
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  const h = Number.isFinite(height) && height > 0 ? height : 0;
  const target = Math.round((w * h) / MESH_AREA_PER_NODE);
  if (!Number.isFinite(target)) return MESH_MIN_NODES;
  return Math.max(MESH_MIN_NODES, Math.min(MESH_MAX_NODES, target));
}

/**
 * Normalised link strength between two nodes: `1` when they coincide, `0` at or
 * beyond `maxDistance`. Callers skip drawing when it returns `0`.
 */
export function meshLinkStrength(
  dx: number,
  dy: number,
  maxDistance: number = MESH_LINK_DISTANCE,
): number {
  const max = Number.isFinite(maxDistance) && maxDistance > 0 ? maxDistance : MESH_LINK_DISTANCE;
  const distanceSq = dx * dx + dy * dy;
  if (!Number.isFinite(distanceSq) || distanceSq >= max * max) return 0;
  return 1 - Math.sqrt(distanceSq) / max;
}

/**
 * Returns a predicate that is `true` at most `fps` times per second. The first
 * call always passes so the mesh paints immediately.
 */
export function createFrameGate(fps: number = MESH_TARGET_FPS): (now: number) => boolean {
  const safeFps = Number.isFinite(fps) && fps > 0 ? Math.min(fps, 120) : MESH_TARGET_FPS;
  const interval = 1000 / safeFps;
  let last = Number.NEGATIVE_INFINITY;
  return (now: number) => {
    const at = Number.isFinite(now) ? now : last + interval;
    if (at - last < interval) return false;
    last = at;
    return true;
  };
}
