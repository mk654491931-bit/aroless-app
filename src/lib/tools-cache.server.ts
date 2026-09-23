/**
 * Araç sonuçları için önbellek politikası — ücretsiz planın en kritik tasarrufu.
 *
 * NEDEN GEREKLİ: Bu mimaride tükenmesi en kolay kaynak AI sağlayıcı kotalarıdır
 * (QStash'ten bile önce, çünkü her araç çağrısı bir veya daha fazla model
 * isteğidir). Önbellek olmadan aynı girdiyle yapılan ikinci tıklama:
 *
 *   1. aynı AI kotasını ikinci kez yakar → ücretsiz havuz daha hızlı tükenir,
 *   2. kullanıcıyı 30-90 sn bekletir → gecikmeli istekler platform bütçesine
 *      daha çok dayanır (504/`TOOL_WARMING` olasılığı artar),
 *   3. aynı soruya iki farklı cevap üretme riski taşır (kullanıcı "hangisi
 *      doğru?" diye sorar).
 *
 * Önbellek burada **kota tasarrufu** için vardır, kaliteyi düşürmek için değil:
 * aynı girdi aynı analizi hak eder, sonuç yalnızca tazeliği önemli olan
 * araçlarda kısa yaşar. Bu yüzden TTL üç kademelidir.
 */

import type { ToolId } from "./tools-prompts.server";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Kademeler: her aracın verisi ne hızda eskir? */
export const TOOL_CACHE_TIERS = {
  /**
   * CANLI (10 dk): sonuç doğrudan güncel habere/olaya bağlıdır. Uzun önbellek
   * "geçen haftanın haberi"ni taze gibi gösterirdi → kabul edilemez.
   */
  live: 10 * MINUTE,
  /**
   * PİYASA (3 saat): fiyat, komisyon, sıralama, rekabet gibi alanlar gün içinde
   * değişebilir. Üç saat, gün içinde aynı işi yapan kullanıcıya kota tasarrufu
   * sağlarken analizi "dünkü" hâle getirmez.
   */
  market: 3 * HOUR,
  /**
   * YAPISAL (12 saat): hesaplayıcı niteliğindeki araçlar (landed cost, desi,
   * sermaye planı, tedarikçi pazarlığı) aynı girdi için aynı sonucu verir;
   * değişen şey kullanıcının verisidir, o da anahtardadır.
   */
  structural: 12 * HOUR,
} as const;

/**
 * Her aracın önbellek ömrü.
 *
 * `satisfies Record<ToolId, number>` kasıtlıdır: yeni bir araç eklenip burada
 * tanımlanmazsa **derleme hata verir**. Sessizce önbelleksiz kalan bir araç
 * (yani her tıklamada kota yakan bir araç) en pahalı hatadır.
 */
export const TOOL_CACHE_TTL_MS = {
  // --- CANLI ---
  news: TOOL_CACHE_TIERS.live,
  // --- PİYASA ---
  consensus: TOOL_CACHE_TIERS.market,
  "arbitrage-matrix": TOOL_CACHE_TIERS.market,
  "listing-seo": TOOL_CACHE_TIERS.market,
  "review-sentiment": TOOL_CACHE_TIERS.market,
  "price-strategy": TOOL_CACHE_TIERS.market,
  // Tarife oranları ve pazaryeri kuralları gün içinde değişebilir (301 ek vergi,
  // yeni gating listesi): 3 saat, "dünkü oranı" canlı gibi göstermez.
  "hs-classifier": TOOL_CACHE_TIERS.market,
  "compliance-check": TOOL_CACHE_TIERS.market,
  "competitor-intel": TOOL_CACHE_TIERS.market,
  // --- YAPISAL ---
  "supplier-negotiator": TOOL_CACHE_TIERS.structural,
  "offer-analyzer": TOOL_CACHE_TIERS.structural,
  "legitimacy-detector": TOOL_CACHE_TIERS.structural,
  "review-spec-sheet": TOOL_CACHE_TIERS.structural,
  "reverse-cost": TOOL_CACHE_TIERS.structural,
  "landed-cost": TOOL_CACHE_TIERS.structural,
  "capital-planner": TOOL_CACHE_TIERS.structural,
  "desi-optimizer": TOOL_CACHE_TIERS.structural,
  "milestone-shield": TOOL_CACHE_TIERS.structural,
  "bundle-booster": TOOL_CACHE_TIERS.structural,
  "lead-time": TOOL_CACHE_TIERS.structural,
  "ad-hook-extractor": TOOL_CACHE_TIERS.structural,
  "listing-visual": TOOL_CACHE_TIERS.structural,
} satisfies Record<ToolId, number>;

export function isKnownTool(tool: string): tool is ToolId {
  return Object.prototype.hasOwnProperty.call(TOOL_CACHE_TTL_MS, tool);
}

/**
 * Aracın önbellek ömrü (ms). Bilinmeyen araç için `null` → önbelleğe yazılmaz.
 *
 * Bilinmeyen araçta bilinçli olarak önbelleklemeyiz: politikası tanımlanmamış
 * bir çıktıyı saatlerce servis etmek, tazeliği bilinmeyen bir sonucu "canlı"
 * gibi sunmak olurdu.
 */
export function toolCacheTtlMs(tool: string): number | null {
  if (!isKnownTool(tool)) return null;
  return TOOL_CACHE_TTL_MS[tool];
}

/**
 * Önbellek anahtarı parçaları.
 *
 * Anahtar sıralıdır (girdi alanlarının sırası değişse de aynı anahtar çıkar) ve
 * dili de kapsar: istemci `uiLang` alanını `input` içinde gönderir, yani Türkçe
 * isteyen kullanıcı İngilizce sonucu almaz. `cacheKey` değerleri küçük harfe
 * çevirip kırptığı için anahtar kararlıdır.
 */
export function toolCacheParts(tool: string, input: Record<string, string>): unknown[] {
  return [
    tool,
    ...Object.keys(input)
      .sort()
      .map((key) => `${key}=${input[key] ?? ""}`),
  ];
}

/**
 * Sonuç önbelleğe yazılmaya değer mi?
 *
 * SADECE dolu ve kullanılabilir sonuçlar saklanır. Boş/eksik bir çıktıyı
 * (ör. tüm sağlayıcılar meşgulken dönen degrade cevap) önbelleğe yazmak, o
 * girdiyi saatlerce "boş sonuç"a mahkûm ederdi — kullanıcı için bu, uydurma
 * sonuç kadar kötüdür. Başlık + (madde veya metrik) yoksa önbelleğe yazılmaz.
 */
export function isCacheableToolResult(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const result = value as {
    headline?: unknown;
    bullets?: unknown;
    metrics?: unknown;
  };
  const headline = typeof result.headline === "string" && result.headline.trim().length > 0;
  const bullets = Array.isArray(result.bullets) && result.bullets.length > 0;
  const metrics = Array.isArray(result.metrics) && result.metrics.length > 0;
  return headline && (bullets || metrics);
}
