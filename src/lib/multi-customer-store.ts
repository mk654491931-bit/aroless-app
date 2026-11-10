/**
 * ÜRÜN BULUCU → MULTI CUSTOMER köprüsü.
 *
 * Ürün nesnesini URL'e koymak (uzun/kırılgan) veya global bir React store
 * eklemek yerine son seçilen ürünler tarayıcıda tutulur. Böylece karttaki
 * "Multi Customer" tek tıkla modülü açar; modül yenilense bile seçim kaybolmaz.
 * Yalnız simülasyon için gereken alanlar saklanır; tüm ürün nesnesi kopyalanmaz.
 */

import type { WinningProduct } from "@/lib/gemini.functions";
import { toMultiCustomerProduct, type MultiCustomerProduct } from "@/lib/multi-customer";

const STORAGE_KEY = "aroless:multi-customer:products:v1";
const MAX_STORED = 8;

export type StoredSimulationProduct = {
  key: string;
  product: MultiCustomerProduct;
  name: string;
  imageUrl: string;
  sourceUrl: string;
  winnerScore: number | null;
  savedAt: number;
};

function keyFor(product: MultiCustomerProduct): string {
  return `${product.name}::${product.source ?? ""}`;
}

function readAll(): StoredSimulationProduct[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is StoredSimulationProduct => {
        if (!item || typeof item !== "object") return false;
        const candidate = item as Partial<StoredSimulationProduct>;
        return Boolean(
          candidate.product &&
          typeof candidate.product.name === "string" &&
          candidate.product.name.trim(),
        );
      })
      .slice(0, MAX_STORED);
  } catch {
    return [];
  }
}

function writeAll(items: StoredSimulationProduct[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_STORED)));
  } catch {
    // localStorage kapalı/dolu olabilir; seçim yine de aynı oturumda state ile açılır.
  }
}

export function rememberMultiCustomerProduct(product: WinningProduct): StoredSimulationProduct {
  const simulationProduct = toMultiCustomerProduct(product);
  const item: StoredSimulationProduct = {
    key: keyFor(simulationProduct),
    product: simulationProduct,
    name: product.name,
    imageUrl: product.image_url ?? "",
    sourceUrl: product.source_url ?? "",
    winnerScore: typeof product.winner_score === "number" ? product.winner_score : null,
    savedAt: Date.now(),
  };
  const previous = readAll().filter((entry) => entry.key !== item.key);
  writeAll([item, ...previous]);
  return item;
}

export function getMultiCustomerProducts(): StoredSimulationProduct[] {
  return readAll();
}

export function getSelectedMultiCustomerProduct(): StoredSimulationProduct | null {
  return readAll()[0] ?? null;
}

export function selectMultiCustomerProduct(key: string): StoredSimulationProduct | null {
  const items = readAll();
  const selected = items.find((item) => item.key === key);
  if (!selected) return null;
  writeAll([{ ...selected, savedAt: Date.now() }, ...items.filter((item) => item.key !== key)]);
  return selected;
}

export function clearMultiCustomerProducts(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* yoksay */
  }
}
