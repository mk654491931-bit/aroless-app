import type { H10Product } from "./hydrogen10";
import { rowsToCsv } from "./module-export";

/**
 * Hidrojen10 ürün tablosunu CSV'ye çevirir.
 *
 * Filtrelenmiş sonuçlar ekranda kalıyordu; satın alma ekibi aynı listeyi
 * tabloya/CRM'e aktaramıyordu. Her satır bir ürün, her sütun kanıtlanmış
 * fiyat/puan/stok alanıdır.
 */
export function buildHydrogen10Csv(products: readonly H10Product[]): string {
  return rowsToCsv([
    [
      "Urun",
      "Marka",
      "Kategori",
      "Teklif sayisi",
      "Kaynak sayisi",
      "En iyi fiyat USD",
      "Yerel fiyat",
      "Para birimi",
      "En iyi puan",
      "Yorum sayisi",
      "Stokta",
      "Son gorulme",
      "Kaynak",
      "Kaynak URL",
    ],
    ...products.map((product) => {
      const firstOffer = product.offers[0];
      return [
        product.title,
        product.brand,
        product.category,
        product.offers.length,
        product.sourceCount,
        product.bestPriceUsd ?? "",
        product.bestPriceLocalMinor === null ? "" : (product.bestPriceLocalMinor / 100).toFixed(2),
        product.bestPriceCurrency,
        product.bestRating ?? "",
        product.bestRatingCount ?? "",
        product.inStock === null ? "" : product.inStock ? "evet" : "hayir",
        product.lastSeenAt ?? "",
        firstOffer?.source ?? "",
        firstOffer?.sourceUrl ?? "",
      ];
    }),
  ]);
}
