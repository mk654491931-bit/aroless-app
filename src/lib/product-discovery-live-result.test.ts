/**
 * CANLI SONUÇ SÖZÜ — "kullanıcı her zaman gerçek ürün görür".
 *
 * NEDEN BU TEST: kalite kapısı eklendiğinde en büyük risk, kapının listeyi
 * boşaltması ve kullanıcının yine "dönüyor ama sonuç yok" ekranını görmesidir.
 * Burada GERÇEK `final` adımı koşar (kayıt katmanı taklit edilir, saf
 * sıralama/kapı kodu gerçek) ve üç şeyi birlikte kanıtlar:
 *
 *   1. Kullanıcıya giden liste BOŞ DEĞİL (kapı ne yaparsa yapsın).
 *   2. Listede gösterilebilir ÜRÜN SATIRI var (fiyat/isim taşıyan gerçek
 *      kayıtlar) — yalnız oy satırı değil.
 *   3. Kalite kapısı zayıf adayı gerçekten dışarıda bırakıyor ve bunu
 *      not olarak dürüstçe söylüyor.
 *
 * Ağ YOK, AI YOK, $0.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const jobsMock = vi.hoisted(() => ({
  failAndRefund: vi.fn(),
  finishDiscoveryJob: vi.fn(),
  readDiscoveryJob: vi.fn(),
  writeDiscoveryProgress: vi.fn(),
}));

vi.mock("./product-discovery-jobs.server", () => jobsMock);

import { executeProductDiscoveryStep } from "./product-discovery-steps.server";
import { normalizeRaw } from "./product-discovery-filter.server";
import { parseDiscoveryResult } from "./product-discovery.functions";
import type { NormalizedProduct, RawProduct } from "./product-discovery.types";

const input = { niche: "air fryer", country: "US", platform: "General", topN: 5 };

/** Ölçülmüş bir aday: fiyat, puan, stok ve kanıt adresi taşır. */
function good(index: number): NormalizedProduct {
  const row: RawProduct = {
    title: `Air Fryer ${index} 5.5L`,
    brand: "Acme",
    seller: "shop",
    priceUsd: 59.9 + index,
    rating: 4.6,
    ratingCount: 210,
    inStock: true,
    source: "test",
    url: `https://shop.test/p/${index}`,
    notes: `4.6 puan · ${210 + index} değerlendirme`,
  };
  const product = normalizeRaw(row);
  return {
    ...product,
    salesVolume: 900 + index * 10,
    viewed90d: 4000 + index * 100,
    sources: ["bing-shopping", "google-trends"],
    preScore: 70,
    signals: { demand: 80, competition: 60, margin: 75, rating: 80, availability: 90 },
  };
}

/** Kanıtsız, zayıf aday: kapının dışarıda bırakması gereken satır. */
function junk(): NormalizedProduct {
  const product = normalizeRaw({ title: "Şüpheli Jenerik Ürün", source: "test" });
  return {
    ...product,
    preScore: 10,
    signals: { demand: 20, competition: 20, margin: 30, rating: 20, availability: 20 },
  };
}

const row = (candidateId: string, councilScore: number) => ({
  candidateId,
  councilScore,
  confidenceScore: 80,
  coverage: 1,
  votes: 14,
  evidence: [] as string[],
});

describe("final adımı kullanıcıya HER ZAMAN gerçek ürün listesi verir", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobsMock.readDiscoveryJob.mockResolvedValue({ stats: null });
    jobsMock.finishDiscoveryJob.mockResolvedValue(true);
    jobsMock.writeDiscoveryProgress.mockResolvedValue(true);
  });

  it("zayıf adayı eler ama kalıcı sonuçta gerçek ürünler kalır", async () => {
    const goods = [1, 2, 3, 4].map(good);
    const weak = junk();
    const batch = [...goods, weak];
    const consensus = [
      ...goods.map((p, i) => row(p.fingerprint, 84 - i * 4)),
      row(weak.fingerprint, 12),
    ];

    const outcome = await executeProductDiscoveryStep({
      step: "final",
      runId: "run-live",
      userId: "user-1",
      input,
      batch,
      consensus,
      deadlineAt: Date.now() + 10_000,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(jobsMock.finishDiscoveryJob).toHaveBeenCalledTimes(1);

    // 1) Liste boş DEĞİL ve 4 iyi adayın tamamı içinde.
    expect(outcome.topProducts!.length).toBeGreaterThanOrEqual(3);
    const ids = outcome.topProducts!.map((p) => p.id);
    for (const p of goods) expect(ids).toContain(p.fingerprint);
    // 2) Zayıf aday kazanan olarak sunulmaz.
    expect(ids).not.toContain(weak.fingerprint);

    // 3) Kalıcı sonuca yazılan sözleşme de aynı: istemci buradan okur.
    const [, payload] = jobsMock.finishDiscoveryJob.mock.calls[0] as [
      string,
      { products: NormalizedProduct[]; topProducts: { id: string; title: string; final_score: number; selection_reason: string }[] },
    ];
    expect(payload.topProducts).toHaveLength(outcome.topProducts!.length);
    // Kullanıcı GERÇEK ürün satırları görür: başlık ve gerekçe dolu.
    for (const p of payload.topProducts) {
      expect(p.title).not.toBe("İsimsiz ürün");
      expect(p.title.trim().length).toBeGreaterThan(0);
      expect(p.selection_reason).toContain("Trend gücü");
      expect(p.selection_reason).not.toContain("ölçülmedi");
    }

    // 4) İstemcinin okuduğu yol (ham DB sonucu) aynı listeyi görür.
    const parsed = parseDiscoveryResult({
      products: payload.products,
      topProducts: payload.topProducts,
    });
    expect(parsed.topProducts.length).toBe(outcome.topProducts!.length);
    expect(parsed.topProducts[0]!.id).toBe(ids[0]);
  });

  it("havuz tamamen zayıfsa bile liste boş kalmaz (taban)", async () => {
    const weaks = [1, 2, 3].map((i) => ({ ...junk(), fingerprint: `weak-${i}` }));
    const outcome = await executeProductDiscoveryStep({
      step: "final",
      runId: "run-weak",
      userId: "user-1",
      input,
      batch: weaks,
      consensus: weaks.map((p, i) => row(p.fingerprint, 20 - i * 4)),
      deadlineAt: Date.now() + 10_000,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.topProducts!.length).toBeGreaterThan(0);
    expect(jobsMock.finishDiscoveryJob).toHaveBeenCalledTimes(1);
  });
});
