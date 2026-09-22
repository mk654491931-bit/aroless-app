// Araç önbellek politikası — ücretsiz plan kota tasarrufunun sözleşmesi.
//
// Buradaki testler iki hatayı engellemek için var:
//  1. Yeni bir araç eklenip önbellek politikası tanımlanmazsa her tıklama kotayı
//     yakar (maliyet), ve
//  2. tazeliği kritik bir araç (haberler) uzun önbelleğe alınırsa kullanıcı
//     bayat veriyi "canlı" sanır (kalite/uydurma riski).
import { describe, expect, it } from "vitest";
import { cacheKey } from "./ai-cache.server";
import { TOOL_PROVIDER } from "./tools-prompts.server";
import {
  TOOL_CACHE_TIERS,
  TOOL_CACHE_TTL_MS,
  isCacheableToolResult,
  isKnownTool,
  toolCacheParts,
  toolCacheTtlMs,
} from "./tools-cache.server";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("araç önbellek TTL politikası", () => {
  it("her aracın bir ömrü var (yeni araç sessizce önbelleksiz kalamaz)", () => {
    // `satisfies Record<ToolId, number>` derleme zamanında korur; bu test
    // çalışma zamanında da doğrular ki politika haritası araç listesinden
    // kopmasın.
    const declared = Object.keys(TOOL_PROVIDER).sort();
    const cached = Object.keys(TOOL_CACHE_TTL_MS).sort();
    expect(cached).toEqual(declared);
    expect(cached).toHaveLength(19);
  });

  it("tazelik kademeleri doğru sırada ve güvenli aralıkta", () => {
    expect(TOOL_CACHE_TIERS.live).toBeLessThan(TOOL_CACHE_TIERS.market);
    expect(TOOL_CACHE_TIERS.market).toBeLessThan(TOOL_CACHE_TIERS.structural);
    // Alt sınır: birkaç saniyelik önbellek kotaya hiçbir şey kazandırmaz.
    expect(TOOL_CACHE_TIERS.live).toBeGreaterThanOrEqual(5 * MINUTE);
    // Üst sınır: kalıcı katmanın 24 saatlik sınırını aşan bir TTL yazılamaz.
    expect(TOOL_CACHE_TIERS.structural).toBeLessThanOrEqual(DAY);
  });

  it("haberler canlı kademede, hesaplayıcılar yapısal kademede", () => {
    // Haber 10 dakikadan uzun yaşarsa kullanıcı geçmiş haberi "şimdi" sanır.
    expect(toolCacheTtlMs("news")).toBe(TOOL_CACHE_TIERS.live);
    // Landed cost aynı girdi için aynı sonucu verir; uzun önbellek doğrudur.
    expect(toolCacheTtlMs("landed-cost")).toBe(TOOL_CACHE_TIERS.structural);
    expect(toolCacheTtlMs("price-strategy")).toBe(TOOL_CACHE_TIERS.market);
  });

  it("bilinmeyen araç önbelleğe alınmaz", () => {
    expect(isKnownTool("landed-cost")).toBe(true);
    expect(isKnownTool("uydurma-arac")).toBe(false);
    expect(toolCacheTtlMs("uydurma-arac")).toBeNull();
  });
});

describe("önbellek anahtarı", () => {
  it("girdi sırası değişse de aynı anahtarı üretir", () => {
    const a = toolCacheParts("landed-cost", { urun: "Kedi Tırmalama", adet: "500" });
    const b = toolCacheParts("landed-cost", { adet: "500", urun: "Kedi Tırmalama" });
    expect(a).toEqual(b);
  });

  it("dil farklıysa farklı anahtar üretir (TR kullanıcı EN sonucu almaz)", async () => {
    const tr = await cacheKey(
      "tool:landed-cost",
      toolCacheParts("landed-cost", { urun: "x", uiLang: "tr" }),
    );
    const en = await cacheKey(
      "tool:landed-cost",
      toolCacheParts("landed-cost", { urun: "x", uiLang: "en" }),
    );
    expect(tr).not.toBe(en);
  });

  it("farklı araç aynı girdiyle çakışmaz", async () => {
    const parts = { urun: "x" };
    const one = await cacheKey("tool:reverse-cost", toolCacheParts("reverse-cost", parts));
    const two = await cacheKey("tool:landed-cost", toolCacheParts("landed-cost", parts));
    expect(one).not.toBe(two);
  });
});

describe("isCacheableToolResult", () => {
  it("dolu sonucu kabul eder", () => {
    expect(
      isCacheableToolResult({
        headline: "Landed cost 12.4$ / adet",
        metrics: [{ label: "COGS", value: "8.10$" }],
        bullets: [],
      }),
    ).toBe(true);
  });

  it("boş/degrade sonucu reddeder (boş sonuç saatlerce servis edilmesin)", () => {
    expect(isCacheableToolResult(null)).toBe(false);
    expect(isCacheableToolResult(undefined)).toBe(false);
    expect(isCacheableToolResult("metin")).toBe(false);
    // Yalnızca başlık: metrik ve madde yok → kullanılabilir analiz değil.
    expect(isCacheableToolResult({ headline: "Sonuç", bullets: [], metrics: [] })).toBe(false);
    // Boş başlık: sağlayıcı cevap veremedi.
    expect(
      isCacheableToolResult({ headline: "  ", bullets: ["a"], metrics: [{ label: "x" }] }),
    ).toBe(false);
  });
});
