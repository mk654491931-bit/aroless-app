// ============================================================================
// ÖLÇÜLMÜŞ KAZANANLAR — canlı kaynak satırlarını arayüz sözleşmesine çevirir.
//
// NEDEN VAR: `startDiscoveryRun` kalıcı iş kaydı için Supabase servis rolü
// ister. O anahtar yoksa (ör. yalnız anon anahtarla çalışan kurulum) ürün
// bulucu HİÇ aramıyordu ve kullanıcı "Arama motoru kurulmamış" ekranı
// görüyordu. Oysa aynı kazıma hattı (`runScrapeFilterStep`) veritabanına
// yazmadan da çalışabiliyor; bu modül o gerçek satırları `DiscoveryWinner`
// şekline çevirir.
//
// DÜRÜSTLÜK KURALI: Bu yol 14 ajan oyu ÜRETMEZ. `scoreSource: "measured"`
// yazar, puanı ölçülmüş sinyallerden (`preScore`) taşır ve kartta "14 ajan"
// cümlesi kurulmaz. Tedarik/marj gibi ölçülmeyen alanlar `null` kalır.
// ============================================================================

import type { NormalizedProduct } from "./product-discovery.types";
import type { DiscoveryWinner } from "./product-discovery.functions";

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** Ölçülmüş bir satırın kartta gösterilebilir en az bir kanıtı var mı? */
function hasUsableEvidence(p: NormalizedProduct): boolean {
  return (
    p.priceUsd !== null ||
    p.rating !== null ||
    p.ratingCount !== null ||
    p.salesVolume !== null ||
    p.viewed90d !== null ||
    p.imageUrl.trim() !== "" ||
    p.url.trim() !== ""
  );
}

function dedupeKey(p: NormalizedProduct): string {
  return p.fingerprint || p.name.toLocaleLowerCase("tr-TR");
}

/**
 * Normalize edilmiş kaynak satırlarını nihai kazanan sözleşmesine çevirir.
 *
 * Sıra: ön skor → veri bütünlüğü → kaynak sayısı. Aynı ürünün kopyaları
 * parmak iziyle tekilleştirilir; en zengin kayıt kalır (kaynak satırları
 * `filterAndPreRank` içinde zaten birleştirilmiş olabilir, bu ikinci güvenlik).
 */
export function measuredWinnerRows(
  products: readonly NormalizedProduct[],
  topN = 5,
): DiscoveryWinner[] {
  const best = new Map<string, NormalizedProduct>();
  for (const p of products) {
    if (!p || p.name.trim().length < 3) continue;
    if (!hasUsableEvidence(p)) continue;
    const key = dedupeKey(p);
    const incumbent = best.get(key);
    if (!incumbent) {
      best.set(key, p);
      continue;
    }
    // Aynı ürün: daha yüksek skorlu, eşitse daha zengin kanıtlı kayıt kalır.
    const better =
      p.preScore > incumbent.preScore ||
      (p.preScore === incumbent.preScore && p.dataCompleteness > incumbent.dataCompleteness);
    if (better) best.set(key, p);
  }

  const ranked = [...best.values()].sort(
    (a, b) =>
      b.preScore - a.preScore ||
      b.dataCompleteness - a.dataCompleteness ||
      b.sources.length - a.sources.length ||
      a.name.localeCompare(b.name, "tr"),
  );

  return ranked.slice(0, Math.max(1, topN)).map((row) => {
    const evidence: string[] = [];
    if (row.priceUsd !== null) evidence.push(`Fiyat: $${row.priceUsd.toFixed(2)}`);
    if (row.rating !== null) {
      evidence.push(
        `Puan: ${row.rating.toFixed(1)}/5${row.ratingCount !== null ? ` (${row.ratingCount} değerlendirme)` : ""}`,
      );
    }
    if (row.salesVolume !== null) evidence.push(`Satış: ${row.salesVolume.toLocaleString("tr-TR")}`);
    if (row.viewed90d !== null)
      evidence.push(`Görüntülenme: ${row.viewed90d.toLocaleString("tr-TR")}`);
    if (row.supplier?.supplierPriceUsd != null)
      evidence.push(`Toptan: $${row.supplier.supplierPriceUsd.toFixed(2)}`);
    if (row.grossMarginPct != null) evidence.push(`Brüt marj: %${Math.round(row.grossMarginPct)}`);
    if (row.imageUrl.trim() !== "") evidence.push("Ürün görseli kaynaktan doğrulandı");
    if (row.sources.length) evidence.push(`Kaynak: ${row.sources.join(", ")}`);

    const completeness = clamp(Math.round(row.dataCompleteness), 0, 5);
    const confidence = clamp(
      40 + completeness * 9 + Math.min(12, row.sources.length * 4),
      35,
      92,
    );

    return {
      name: row.name,
      brand: row.brand,
      seller: row.seller,
      category: row.category,
      priceUsd: row.priceUsd,
      rating: row.rating,
      ratingCount: row.ratingCount,
      inStock: row.inStock,
      salesVolume: row.salesVolume,
      viewed90d: row.viewed90d,
      sources: row.sources,
      url: row.url,
      imageUrl: row.imageUrl || undefined,
      // Bu alanlar `runScrapeFilterStep` içinde ÖLÇÜLDÜYSE aynen taşınır:
      // tedarik teklifi, brüt marj, kargoya kalan pay, kohort rekabeti ve
      // lansman kararı. Ölçülmediyse `null` kalır — 0 uydurulmaz.
      supplier: row.supplier ?? null,
      grossMarginPct: row.grossMarginPct ?? null,
      feeBudgetUsd: row.feeBudgetUsd ?? null,
      cohortCompetitors: row.cohortCompetitors ?? null,
      launch: row.launch ?? null,
      notes:
        [row.brand, row.seller ? `satıcı ${row.seller}` : ""].filter(Boolean).join(" · ") ||
        "Canlı kaynak satırından ölçüldü.",
      preScore: Number.isFinite(row.preScore) ? Math.round(row.preScore) : 0,
      dataCompleteness: completeness,
      fingerprint: row.fingerprint,
      signals: row.signals,
      // `councilScore` alan adı geriye uyumluluk için korunur; değer 14 ajan
      // oyu değil, ölçülmüş sinyallerin ön skorudur. Arayüz `scoreSource`
      // sayesinde doğru cümleyi kurar.
      councilScore: Number.isFinite(row.preScore) ? Math.round(row.preScore) : 0,
      confidenceScore: confidence,
      votes: 0,
      agreement: completeness / 5,
      evidence: evidence.slice(0, 6),
      qualityGate: null,
      scoreSource: "measured",
    } satisfies DiscoveryWinner;
  });
}
