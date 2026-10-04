/**
 * FINAL ADIMI — "ÜRÜNLERİ DOĞRUDAN ÇIKAR" SÖZLEŞMESİ.
 *
 * NEDEN BU TEST: kullanıcının şikâyeti "dönüyor ama ürün çıkmıyor"du. Zincirin
 * son adımı 14 ajanın kazananlarını ÜRÜN SATIRLARIYLA birleştirir ve kalıcı
 * sonuca yazar; istemci ürünleri YALNIZ oradan okur. Eski eşleme yalnız
 * parmak izine baktığı için, konsey bir ürünün parmak izini boş görüp sıra
 * anahtarı (`P7`) yazdığında kazanan ürün listeden DÜŞÜYORDU — sonuç: boş ya
 * da eksik liste.
 *
 * Bu test ağ çağrısı yapmaz: veritabanı katmanı taklit edilir, saf sıralama ve
 * sözleşme kodu (products + top_products) gerçek haliyle koşar.
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
import type { NormalizedProduct } from "./product-discovery.types";

const input = { niche: "air fryer", country: "US", platform: "General", topN: 5 };

/** Ölçülmüş bir aday ürün. `fingerprint` BİLEREK boş verilebilir. */
function candidate(index: number, fingerprint = ""): NormalizedProduct {
  return {
    name: `Air Fryer ${index}`,
    brand: "Acme",
    seller: "shop",
    category: "",
    priceUsd: 59.9,
    rating: 4.6,
    ratingCount: 210,
    inStock: true,
    sources: ["test"],
    url: "https://example.test/p",
    notes: "",
    viewed90d: null,
    id: `p-${index}`,
    imageUrl: "",
    salesVolume: 900,
    fingerprint,
    preScore: 70,
    signals: { demand: 80, competition: 60, margin: 75, rating: 80, availability: 90 },
    dataCompleteness: 5,
    missingFields: [],
    source: "scraped",
  };
}

/** Konseyin gerçek çıktı biçimi: `candidateId` parmak izi YA DA `P7` olur. */
function consensusRow(index: number, candidateId = "") {
  return {
    candidateId: candidateId || `P${index}`,
    name: `Air Fryer ${index}`,
    councilScore: 96 - index,
    votes: 14,
    coverage: 1,
    disagreement: 0,
    confidenceScore: 82,
    minScore: 60,
    maxScore: 98,
    evidence: ["ölçülen fiyat bandı sağlıklı"],
  };
}

describe("final adımı ürünleri doğrudan çıkarır", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobsMock.readDiscoveryJob.mockResolvedValue({ stats: null });
    jobsMock.finishDiscoveryJob.mockResolvedValue(true);
  });

  it("parmak izi OLMAYAN adaylarda bile 5 ürünü kalıcı sonuca yazar", async () => {
    const batch = Array.from({ length: 6 }, (_, i) => candidate(i + 1));
    const consensus = Array.from({ length: 6 }, (_, i) => consensusRow(i + 1));

    const outcome = await executeProductDiscoveryStep({
      step: "final",
      runId: "run-1",
      userId: "user-1",
      input,
      batch,
      consensus,
      deadlineAt: Date.now() + 10_000,
    });

    expect(outcome.ok).toBe(true);
    expect(jobsMock.finishDiscoveryJob).toHaveBeenCalledTimes(1);

    const [, payload] = jobsMock.finishDiscoveryJob.mock.calls[0] as [string, {
      // Kazanan ürünler konsey skorunu ÜZERİNDE taşır (14 ajanın oyu).
      products: (NormalizedProduct & { councilScore?: number })[];
      topProducts: { id: string; title: string; final_score: number; selection_reason: string }[];
    }];
    // 14 ajanın seçtiği kazananlar KAYBOLMAZ: en yüksek skorlu 5 ürün teslim edilir.
    expect(payload.products).toHaveLength(5);
    expect(payload.products.map((p) => p.name)).toEqual([
      "Air Fryer 1",
      "Air Fryer 2",
      "Air Fryer 3",
      "Air Fryer 4",
      "Air Fryer 5",
    ]);
    expect(payload.products[0]!.councilScore).toBe(95);
    // Dış sözleşme de aynı ürünlerden üretilir.
    expect(payload.topProducts).toHaveLength(5);
    expect(payload.topProducts[0]!.title).toBe("Air Fryer 1");
  });

  it("normal parmak izli koşuda sözleşme değişmez", async () => {
    const batch = Array.from({ length: 3 }, (_, i) => candidate(i + 1, `fp-${i + 1}`));
    const consensus = Array.from({ length: 3 }, (_, i) => consensusRow(i + 1, `fp-${i + 1}`));const outcome = await executeProductDiscoveryStep({
      step: "final",
      runId: "run-1",
      userId: "user-1",
      input,
      batch,
      consensus,
      deadlineAt: Date.now() + 10_000,
    });
    expect(outcome.ok).toBe(true);
    const [, payload] = jobsMock.finishDiscoveryJob.mock.calls[0] as [string, { products: NormalizedProduct[] }];
    expect(payload.products.map((p) => p.name)).toEqual(["Air Fryer 1", "Air Fryer 2", "Air Fryer 3"]);
  });

  it("AJAN ÜRÜN VERİSİ DEĞİŞTİREMEZ — halüsinasyon kaynak alanına YAZILMAZ", async () => {
    // AJAN KORUMASI: konsey satırı modelden geçtiği için "her şeyi yazabilir"
    // görünür, ama ürünün üstüne YALNIZ skor + gerekçe yazılır. Kaynak
    // kaydının adı, fiyatı, adresi ve görseli ölçülmüştür.
    //
    // Kapatılan kırılma: konsenyus satırı `name` alanı taşır. Bu satır kaynağa
    // değil MODELE bağlı olduğunda, modelin uydurduğu bir ürün adı nihai
    // ürüne sızabilirdi — "AI ürün verisi üretmez" ilkesi sessizce bozulurdu.
    const batch = [candidate(1, "fp-1")];
    const hallucinated = {
      ...consensusRow(1, "fp-1"),
      // Modelin uydurduğu alanlar — HİBİRİ kaynağa geçmemeli.
      name: "Uydurma Ürün",
      priceUsd: 29.99,
      url: "https://hallucinated.test/p",
      imageUrl: "https://hallucinated.test/img.jpg",
    };

    await executeProductDiscoveryStep({
      step: "final",
      runId: "run-1",
      userId: "user-1",
      input,
      batch,
      consensus: [hallucinated] as never,
      deadlineAt: Date.now() + 10_000,
    });

    const [, payload] = jobsMock.finishDiscoveryJob.mock.calls[0] as [
      string,
      { products: Record<string, unknown>[]; topProducts: { title: string }[] },
    ];
    const winner = payload.products[0]!;
    // Kaynak alanları DEĞİŞMEZ.
    expect(winner.name).toBe("Air Fryer 1");
    expect(winner.priceUsd).toBe(59.9);
    expect(winner.url).toBe("https://example.test/p");
    expect(winner.imageUrl).toBe("");
    // Ajanın katkısı YALNIZ analiz alanındadır.
    expect(winner.councilScore).toBe(95);
    // Dış sözleşmede de modelin adı görünmez.
    expect(payload.topProducts[0]!.title).toBe("Air Fryer 1");
  });
});
