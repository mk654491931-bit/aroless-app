import { rowsToCsv } from "./module-export";

/** Niche scan'in ekranda gösterdiği ölçülmüş aday alanları. */
export type DiscoveryExportProduct = {
  name: string;
  brand?: string | null;
  seller?: string | null;
  category?: string | null;
  priceUsd?: number | null;
  rating?: number | null;
  salesVolume?: number | null;
  viewed90d?: number | null;
  councilScore?: number | null;
  sources?: readonly string[];
  url?: string | null;
};

/**
 * Niş taraması sonucunu CSV'ye çevirir.
 *
 * Ekrandaki pazar yapısı raporu ekip içinde paylaşılamıyordu. Ölçülmemiş alan
 * boş kalır; "0" uydurulmaz. Kaynaklar tek hücrede birleşir.
 */
export function buildDiscoveryCsv(products: readonly DiscoveryExportProduct[]): string {
  return rowsToCsv([
    [
      "Urun",
      "Marka",
      "Satici",
      "Kategori",
      "Fiyat USD",
      "Puan",
      "Satis",
      "90 gun goruntulenme",
      "Aday puani",
      "Kaynaklar",
      "URL",
    ],
    ...products.map((product) => [
      product.name,
      product.brand ?? "",
      product.seller ?? "",
      product.category ?? "",
      product.priceUsd ?? "",
      product.rating ?? "",
      product.salesVolume ?? "",
      product.viewed90d ?? "",
      product.councilScore ?? "",
      (product.sources ?? []).join(" + "),
      product.url ?? "",
    ]),
  ]);
}
