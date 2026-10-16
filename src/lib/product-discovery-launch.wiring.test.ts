/**
 * LANSMAN KAPISI — BAĞLANTI TESTİ (ölü export'a ve sessizce düşen alana karşı).
 *
 * Bu testin varlık sebebi, bu depoda ÖLÇÜLMÜŞ iki hata sınıfıdır:
 *
 *   1. ÖLÜ EXPORT: bir yetenek yalnız kendi testinde çalışıyor, ÇALIŞAN HATTA
 *      hiç çağrılmıyor olabilir (`top-products.wiring.test.ts` başlığında
 *      belgeli).
 *   2. ZOD ALANI DÜŞÜRÜR: şemada tanımlanmayan alan katmanlar arasında sessizce
 *      kaybolur ve arayüz "hesaplanmadı" sanır (`supplier-economics.ts`).
 *
 * Bu yüzden iki şey AYNI ANDA ölçülür: kanıtın hatta bağlandığı ve şemadan
 * geçerken kaybolmadığı.
 */
import { describe, expect, it } from "vitest";

import { assessLaunch, LaunchReadinessSchema } from "./launch-readiness";
import { SupplierEvidenceSchema } from "./supplier-economics";
import { extractMicOffers } from "./mic-supplier.server";
import { DiscoveryWinnerSchema } from "./product-discovery.functions";
import { NormalizedProductSchema } from "./product-discovery.types";

const read = (p: string) => import("node:fs").then((fs) => fs.readFileSync(p, "utf8"));

describe("MIC kaynağı hatta BAĞLI (ölü kaynak değil)", () => {
  it("tedarik adımı MIC'i AliExpress ile PARALEL çağırır ve teklifleri birleştirir", async () => {
    const src = await read("src/lib/product-discovery-pipeline.server.ts");
    expect(src).toContain('await import("./mic-supplier.server")');
    expect(src).toContain("fetchMicOffers(niche)");
    // Paralellik: iki kaynak tek `allSettled` içinde (sıralı olsaydı dilim
    // bütçesi iki kat yanardı).
    expect(src).toContain("await Promise.allSettled([");
    expect(src).toContain("...aeOffers,");
    // MIC'in ölçmediği alanlar NULL'dur — uydurulmaz.
    expect(src).toContain("sold: null,");
  });

  it("kohort rakip sayısı üretilir ve ürünle birlikte taşınır", async () => {
    const src = await read("src/lib/product-discovery-pipeline.server.ts");
    expect(src).toContain("cohortCompetitorCounts(survivors.map((row) => row.name))");
    expect(src).toContain("cohortCompetitors: competitorCounts[i]");
  });

  it("lansman kararı üretilir ve ürüne YAZILIR (arayüz okuyabilsin)", async () => {
    const src = await read("src/lib/product-discovery-pipeline.server.ts");
    expect(src).toContain('from "./launch-readiness"');
    expect(src).toContain("assessLaunch({");
    expect(src).toContain("row.launch?.launchable === true");
    expect(src).toContain("cohortCompetitors: competitorCounts[i],");
    // Karar AYNI nesnede taşınır: "cohort var, karar yok" yarım bağlama olmaz.
    expect(src).toMatch(/cohortCompetitors: competitorCounts\[i\],\s*launch,/);
    // Ölçümden gelen girdiler: MOQ/FOB marj ve fiyatla birlikte verilir.
    expect(src).toContain("moqUnits: row.supplier?.moqUnits ?? null");
    expect(src).toContain("supplierPriceHighUsd: row.supplier?.supplierPriceHighUsd ?? null");
  });

  it("kart kararı gösterir (sunucuda üretilen kararı yeniden hesaplamaz)", async () => {
    const card = await read("src/features/finder/components/discovery-winner-card.tsx");
    expect(card).toContain("winner.launch");
    expect(card).toContain("launch.gates.map");
    expect(card).toContain("launch.firstOrderUsd");
  });
});

describe("kanıt KATMANLARDAN geçerken düşmez (zod regresyonu)", () => {
  const launch = {
    launchable: true,
    gates: [
      {
        id: "sourcing" as const,
        label: "Tedarik",
        state: "pass" as const,
        value: "$22",
        detail: "ölçüldü",
      },
    ],
    passed: 1,
    failed: 0,
    unknown: 4,
    blockers: [],
    firstOrderUsd: 660,
    summary: "Atılabilir — 1/1 kapı geçti.",
  };

  it("NormalizedProduct şeması `launch` ve `cohortCompetitors`ı korur", () => {
    const parsed = NormalizedProductSchema.parse({
      fingerprint: "fp-air-fryer",
      name: "Air Fryer 6 Qt",
      cohortCompetitors: 3,
      launch,
    });
    expect(parsed.launch?.launchable).toBe(true);
    expect(parsed.launch?.firstOrderUsd).toBe(660);
    expect(parsed.cohortCompetitors).toBe(3);
  });

  it("DiscoveryWinner şeması (istemci sözleşmesi) ikisini de korur", () => {
    const parsed = DiscoveryWinnerSchema.parse({
      name: "Air Fryer 6 Qt",
      cohortCompetitors: 3,
      launch,
    });
    expect(parsed.launch?.launchable).toBe(true);
    expect(parsed.cohortCompetitors).toBe(3);
  });

  it("MOQ/FOB aralığı tedarik kanıtından geçerken düşmez", () => {
    const parsed = SupplierEvidenceSchema.parse({
      samples: 1,
      supplierPriceUsd: 13,
      supplierLowUsd: 13,
      supplierHighUsd: 13,
      supplierPriceHighUsd: 15,
      listPriceUsd: null,
      discountPct: null,
      soldTotal: null,
      store: "Guangdong Yuecheng Electric Appliance Co., Ltd.",
      shipFrom: "",
      url: "https://yuecheng2026.en.made-in-china.com/product/x/China-a.html",
      moqUnits: 1200,
      moqUnit: "pieces",
    });
    expect(parsed.moqUnits).toBe(1200);
    expect(parsed.supplierPriceHighUsd).toBe(15);
  });

  it("karar eklenmeden ÖNCE yazılmış kayıtlar okunabilir kalır (eski sonuçlar kırılmaz)", () => {
    const winner = DiscoveryWinnerSchema.parse({ name: "Eski Ürün" });
    expect(winner.launch ?? null).toBeNull();
    expect(winner.cohortCompetitors ?? null).toBeNull();
    const product = NormalizedProductSchema.parse({ fingerprint: "fp-eski", name: "Eski Ürün" });
    expect(product.launch ?? null).toBeNull();
  });

  it("bozuk karar gövdesi kaydın TAMAMINI düşürmez (fail-soft)", () => {
    // Panel eski/bozuk bir gövde gördüğünde ürün kartı boş kalmamalı: karar
    // `null` olur, ürün kalır.
    const winner = DiscoveryWinnerSchema.parse({
      name: "Air Fryer",
      launch: { launchable: "evet", gates: "yok" },
    });
    expect(winner.name).toBe("Air Fryer");
    expect(winner.launch ?? null).toBeNull();
  });
});

describe("MIC ayrıştırıcısı LANSMAN kararı için yeterli ölçüm üretir", () => {
  it("gerçek kart örneğinden MOQ + FOB aralığı çıkar (uçtan uca karar girdisi)", () => {
    // Canlı sayfadan alınan kart yapısı (2026-10-16 ölçümü).
    const html = `<html><body><div class="prod-list"><div class="list-node "><div class="list-node-content cf"><div class="prod-content"><div class="prod-info">
      <h2 class="product-name" title="1,480 Pieces MOQ Type Air Fryer"> <a href="https://x.en.made-in-china.com/product/AbCdEf/X.html">Air Fryer</a> </h2>
      <a class="product-detail" href="https://x.en.made-in-china.com/product/AbCdEf/X.html">
        <div class="product-property">
          <div class="info price-info"><strong class="price">US$<span>17.96</span>-<span>22.45</span></strong><span class="price_hint"> (FOB Price)</span></div>
          <div class="info">1,480 Pieces<span class="price_hint"> (MOQ)</span></div>
        </div>
      </a>
      <div class="company-name-wrapper"><div class="company-name-txt"><a href="https://x.en.made-in-china.com" class="compnay-name J-compnay-name">NB Hantai Industrial Co., Ltd.</a></div></div>
    </div></div></div></div></body></html>`;
    const [offer] = extractMicOffers(html);
    expect(offer.moqUnits).toBe(1480);
    expect(offer.unitPriceUsd).toBe(17.96);
    expect(offer.unitPriceHighUsd).toBe(22.45);
    expect(offer.store).toBe("NB Hantai Industrial Co., Ltd.");
  });

  it("karar şeması üretilen kararı doğrular (şema ile üretici ayrışmaz)", () => {
    expect(LaunchReadinessSchema.safeParse(assessForSchema()).success).toBe(true);
  });
});

/** `assessLaunch` çıktısını şemayla doğrulamak için küçük bir yardımcı. */
function assessForSchema() {
  // Doğrudan `assessLaunch` çağrılır — şema ile üreticinin ayrışmasını önler.
  return assessLaunch({
    priceUsd: 59.9,
    grossMarginPct: 55,
    supplierPriceUsd: 22,
    supplierPriceHighUsd: 25,
    moqUnits: 100,
    moqUnit: "pieces",
    cohortCompetitors: 2,
  });
}
