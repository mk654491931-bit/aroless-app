// Bridge from product cards → seo/creative tabs.
// Extracted so card and tab code can live in separate modules without circular imports.

type BridgeKey = "seo" | "creative";

const runRefs: Record<BridgeKey, ((name: string) => void) | null> = { seo: null, creative: null };

export function setRunRef(key: BridgeKey, fn: ((name: string) => void) | null): void {
  runRefs[key] = fn;
}

export function requestRun(target: BridgeKey, name: string): void {
  setTimeout(() => runRefs[target]?.(name), 0);
}
