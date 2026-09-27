// ============================================================================
// PRODUCT DISCOVERY SONUÇ DÖNÜŞTÜRÜCÜSÜ.
//
// İKİ FARKLI ÜRÜN ŞEKLİ VAR, ARADA ADAPTÖR GEREKİYOR:
//   * Eski hat (`generateProducts`) AI'ın yazdığı İŞ PLANI ürünleri döner:
//     tedarik fiyatı, marj, reklam açıları, platform stratejisi… Çoğu ALAN
//     MODEL TAHMİNİDİR.
//   * Yeni hat ÖLÇÜLMÜŞ KANIT döner: gerçek fiyat, gerçek kullanıcı puanı,
//     gerçek kaynak bağlantısı ve 14 ajanın oy puanı. Tedarik/maliyet
//     BİLİNMEZ — çünkü kazımada yoktur ve uydurulmamalıdır.
//
// DÜRÜSTLÜK KURALI: Ölçülmeyen alan BOŞ string / 0 / [] bırakılır. Bir
// kozmetik dolgu ("Marj: %45") koymak ürünü satılabilir gösterir ama yanlıştı;
// kullanıcı kazımayla doğrulanamaz. Boş alan arayüzde zaten "—" olarak ele
// alınır (bkz. `winner-score.ts`: tüm `ScorableProduct` alanları opsiyoneldir).
//
// Dolu doldurulan alanlar YALNIZCA ölçülmüş veriden türetilir; rekabet
// seviyesi ve trend puanı deterministik sinyalden gelir, konsayl skoru ise
// 14 ajanın gerçek oyudur.
// ============================================================================

import type { WinningProduct } from "@/lib/gemini.functions";
import type { DiscoveryWinner } from "@/lib/product-discovery.functions";

/** Deterministik rekabet sinyalini arayüzün üç seviyeli etiketine çevirir. */
function competitionLabel(score: number): WinningProduct["competition_level"] {
  if (score >= 70) return "High";
  if (score >= 45) return "Medium";
  return "Low";
}

const usd = (value: number | null): string =>
  value === null || !Number.isFinite(value) || value <= 0 ? "" : `$${value.toFixed(2)}`;

/**
 * Kazanan satırları arayüzün beklediği ürün şekline çevirir.
 *
 * `siblings` aynı koşudaki diğer kazananlardır; "rakipler" alanı onlarla
 * doldurulur — çünkü aynı nişten çıkan diğer ürünler gerçekten rakip adayıdır
 * (uydurma şirket adı yok).
 */
export function toWinningProducts(
  rows: readonly DiscoveryWinner[],
  siblings: readonly DiscoveryWinner[] = [],
): WinningProduct[] {
  return rows.map((row) => {
    const price = usd(row.priceUsd);
    const ratingText =
      row.rating !== null
        ? `· ${row.rating.toFixed(1)} puan${row.ratingCount ? ` (${row.ratingCount} değerlendirme)` : ""}`
        : "· puan ölçülemedi";
    const evidence = row.evidence.slice(0, 2).join(" ");
    const whyWinning = `14 ajan puanı ${Math.round(row.councilScore)}/100 · güven ${Math.round(
      row.confidenceScore,
    )}/100${evidence ? ` · ${evidence}` : ""}`;

    const rivals = siblings
      .filter((other) => other.fingerprint && other.fingerprint !== row.fingerprint)
      .slice(0, 3)
      .map((other) => other.name);

    return {
      name: row.name,
      description:
        row.notes ||
        `${row.sources.join(", ") || "kaynak"} üzerinden kazındı · ${row.dataCompleteness}/5 alan doğrulandı`,
      why_winning: whyWinning,
      // Ölçülmedi: kazımada hedef kitle verisi yok.
      target_audience: "",
      // AI bu koşuda reklam açısı üretmedi ($0 kuralı: AI yalnız iki adımda).
      ad_angles: [],
      // Tedarik maliyeti BİLİNMİYOR (kazınmadı, uydurulmaz).
      supplier_price_usd: "",
      selling_price_usd: price,
      profit_margin_pct: 0,
      startup_cost_usd: "",
      platform_fit: row.seller ? [row.seller] : [],
      platform_strategy: "",
      competitor_examples: rivals,
      supplier_links: [],
      alibaba_links: [],
      cost_breakdown: {
        supplier_cost: "",
        shipping_cost: "",
        platform_fee: "",
        ad_spend: "",
        net_profit: "",
        net_margin_pct: 0,
      },
      competition_level: competitionLabel(row.signals.competition),
      trend_score: row.signals.demand,
      emoji: "📦",
      competitor_prices: row.seller
        ? [
            {
              store: row.seller,
              price: price || "—",
              note: row.notes.slice(0, 120),
              url: row.url,
            },
          ]
        : [],
      // Kanıt yoğunluğu: 5 ölçülebilir alandan kaçı gerçekten doldu.
      health_score: Math.round(row.dataCompleteness * 20),
      data_sources: row.sources,
      confidence_reason: `Veri bütünlüğü ${row.dataCompleteness}/5${ratingText} · ön skor ${Math.round(
        row.preScore,
      )}`,
      // NOT: `council` alanı BİLEREK yazılmaz. O alan eski hattın tam AI
      // yönetici raporu (`CouncilSummary`) şeklindedir; yalnız puandan bir
      // nesne uydurmak kartta “yönetici raporu var” yanıltması yaratırdı.
      // Konsayl skoru zaten `why_winning` ve `confidence_reason` içinde duruyor.
    } satisfies WinningProduct;
  });
}
