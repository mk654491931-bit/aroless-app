import type { WinningProduct } from "@/lib/gemini.functions";

/**
 * Motor/agent yanıtlarından ürün listesini güvenle çıkarır.
 * Server-function adaptörleri sürüme göre sonucu doğrudan veya `result`,
 * `data` ya da `value` zarfı içinde döndürebilir; hepsini tek noktada açarız.
 * Boş/null → [] döner, asla patlamaz.
 */
export function toProductList(res: unknown): WinningProduct[] {
  const seen = new Set<object>();

  const visit = (value: unknown, depth: number): WinningProduct[] => {
    if (depth > 6 || value === null || typeof value !== "object") return [];
    if (Array.isArray(value)) {
      return value.filter((item) => item !== null && typeof item === "object") as WinningProduct[];
    }

    const object = value as Record<string, unknown>;
    if (seen.has(object)) return [];
    seen.add(object);

    for (const key of ["products", "results"]) {
      const candidate = object[key];
      if (Array.isArray(candidate)) {
        return candidate.filter((item) => item !== null && typeof item === "object") as WinningProduct[];
      }
    }

    // TanStack Start/server adapters may add one or more response envelopes.
    for (const key of ["result", "data", "value", "response"]) {
      const products = visit(object[key], depth + 1);
      if (products.length > 0) return products;
    }
    return [];
  };

  return visit(res, 0);
}
