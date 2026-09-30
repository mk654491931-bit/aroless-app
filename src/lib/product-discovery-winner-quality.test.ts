/**
 * ÇIKTI KALİTESİ — sözleşme testleri (AI YOK, AĞ YOK, $0).
 *
 * Kullanıcının isteği: "çıktı kalitesi çok yüksek olsun, gerçekten iyi ürünler
 * bulunsun". Bu dosya o sözü ÖLÇÜLEBİLİR hâle getirir:
 *
 *   1. TEKİLLEŞTİRME KANITI KAYBETMEZ: aynı ürünün iki satırından biri fiyatı,
 *      diğeri puanı taşıyorsa birleşen satır İKİSİNİ de taşır ve bütünlük
 *      puanı yükselir. Eski davranış "en dolu satırı seç, gerisini at"tı.
 *   2. ÖLÇÜLEN HACİM PUANA GİRER: AI anahtarı olmadığında konseyin TAMAMI
 *      deterministiktir; satış hacmi ve çoklu kaynak kanıtı olan ürün, kanıtı
 *      olmayanla aynı puanı ALMAMALIDIR.
 *   3. AJAN İSTEMİ ÖLÇÜLENİ GÖRÜR: ajan "bu ürün gerçekten satıyor mu?"
 *      sorusunu cevaplayacak sayıları görmeden puan verirse puanlar ayrışmaz.
 *   4. NİHAİ KAPI + TABAN: kanıtsız/düşük oylu satır kazanan olarak
 *      sunulmaz, AMA liste asla boşalmaz (en az 3 kazanan geri alınır).
 */
import { describe, expect, it } from "vitest";

import { filterAndPreRank, normalizeRaw } from "./product-discovery-filter.server";
import {
  buildTopProducts,
  isWinnerWorthy,
  MIN_DELIVERED_WINNERS,
  runFinalRankStep,
  winnerQualityScore,
} from "./product-discovery-pipeline.server";
import { buildAgentPrompt } from "./product-discovery-council-ai.server";
import {
  deterministicVotes,
  runCouncilOnProducts,
  salesDemandScore,
  sourceStrength,
  viewsDemandScore,
} from "./product-discovery-council.server";
import type { NormalizedProduct, RawProduct } from "./product-discovery.types";

const raw = (over: Partial<RawProduct> = {}): RawProduct => ({
  title: "Test Ürünü Pro 2000W",
  brand: "",
  seller: "",
  priceUsd: 29.99,
  rating: 4.2,
  ratingCount: 120,
  inStock: true,
  source: "test",
  url: "",
  notes: "",
  ...over,
});

/* ------------------------------------------------- 1. Tekilleştirme kanıtı */

describe("tekilleştirme ÖLÇÜLMÜŞ kanıtı kaybetmez", () => {
  it("bir satırdaki fiyat ile diğerindeki puanı TEK satırda birleştirir", () => {
    const { survivors, stats } = filterAndPreRank(
      [
        // A: fiyat var, puan/stok/adres yok.
        raw({
          title: "CASABREWS CM5418 Compact Espresso Machine",
          brand: "CASABREWS",
          priceUsd: 139.99,
          rating: null,
          ratingCount: null,
          inStock: null,
          url: "",
          notes: "",
        }),
        // B: fiyat yok, ama puan/hacim/stok ve kanıt adresi var.
        raw({
          title: "Casabrews CM5418 20 Bar Espresso Machine",
          brand: "Casabrews",
          priceUsd: null,
          rating: 4.5,
          ratingCount: 88,
          inStock: true,
          url: "https://b.example/p",
          notes: "88 değerlendirme",
        }),
      ],
      { nicheMomentumPct: 10, nicheEngagement: 100 },
    );

    // İki yazım aynı modele (CM5418) bağlandı.
    expect(stats.rejectedByDuplicate).toBe(1);
    expect(survivors).toHaveLength(1);

    const merged = survivors[0]!;
    // TEK bir satır artık HER İKİ ölçümü de taşıyor.
    expect(merged.priceUsd).toBe(139.99);
    expect(merged.rating).toBe(4.5);
    expect(merged.ratingCount).toBe(88);
    expect(merged.inStock).toBe(true);
    expect(merged.url).toBe("https://b.example/p");
    // Bütünlük birleşmiş kanıt üzerinden yeniden hesaplanır → 5/5.
    expect(merged.dataCompleteness).toBe(5);
    expect(merged.preScore).toBeGreaterThan(0);
  });
});

/* ----------------------------------------------------- 2. Deterministik oy */

describe("ölçülen hacim ve kaynak sayısı konsey oyuna girer", () => {
  const withVolume = (
    title: string,
    sales: number | null,
    sources: string[],
  ): NormalizedProduct => ({
    ...normalizeRaw(raw({ title, priceUsd: 89.9 })),
    salesVolume: sales,
    sources,
  });

  it("satış hacmi ve görüntülenme eğrileri ölçülmüşü ödüllendirir", () => {
    expect(salesDemandScore(null)).toBeNull();
    expect(salesDemandScore(0)).toBeNull();
    expect(salesDemandScore(10_000)!).toBeGreaterThan(salesDemandScore(100)!);
    expect(viewsDemandScore(null)).toBeNull();
    expect(viewsDemandScore(10_000)!).toBeGreaterThan(viewsDemandScore(100)!);
    expect(sourceStrength([])).toBe(0);
    expect(sourceStrength(["a", "b", "c", "d"])).toBe(24);
  });

  it("hacimli ürünün talep ajanları daha yüksek puanlar", () => {
    const rich = deterministicVotes(withVolume("Air Fryer X", 5000, ["a", "b", "c"]));
    const thin = deterministicVotes(withVolume("Air Fryer Y", null, []));
    const pick = (votes: typeof rich, key: string) =>
      votes.find((v) => v.agentKey === key)!.score;
    expect(pick(rich, "trend_hunter")).toBeGreaterThan(pick(thin, "trend_hunter"));
    expect(pick(rich, "cro")).toBeGreaterThan(pick(thin, "cro"));
  });

  it("konsey skoru ölçülmüş kanıtla yükselir (AI anahtarı olmadan)", async () => {
    const both = await runCouncilOnProducts([
      withVolume("Air Fryer X", 5000, ["a", "b", "c"]),
      withVolume("Air Fryer Y", null, []),
    ]);
    expect(both).toHaveLength(2);
    for (const c of both) expect(c.votes).toBe(14);
    expect(both[0]!.councilScore).toBeGreaterThan(both[1]!.councilScore);
  });
});

/* ---------------------------------------------------------- 3. Ajan istemi */

describe("ajan istemi ölçülen sayıları görür", () => {
  const product: NormalizedProduct = {
    ...normalizeRaw(
      raw({
        title: "Ninja Air Fryer Pro 8QT",
        brand: "Ninja",
        seller: "Walmart",
        priceUsd: 129.99,
        rating: 4.6,
        ratingCount: 1204,
        source: "bing-shopping",
        url: "https://example.com",
      }),
    ),
    salesVolume: 2100,
    viewed90d: 1000,
    sources: ["bing-shopping", "google-trends"],
  };

  it("satış/görüntülenme/kaynak sayısını isteme yazar", () => {
    const prompt = buildAgentPrompt(
      { key: "cmo", name: "CMO Agent", task: "Audience fit" },
      [product],
      "air fryer",
    );
    expect(prompt).toContain("satış 2100");
    expect(prompt).toContain("görüntülenme 1000/90g");
    expect(prompt).toContain("2 kaynak");
    // Ölçülmemiş bir alanı sormaya çağırmaz (uydurma yasağı).
    expect(prompt).not.toContain("tedarik maliyeti");
  });
});

/* ------------------------------------------------- 4. Nihai kalite kapısı */

const candidate = (id: string, completeness: number): NormalizedProduct => ({
  ...normalizeRaw(raw({ title: `Ürün ${id}`, priceUsd: 40 })),
  fingerprint: id,
  dataCompleteness: completeness,
});

const row = (id: string, councilScore: number, confidenceScore = 80) => ({
  candidateId: id,
  councilScore,
  confidenceScore,
  coverage: 1,
  votes: 14,
  evidence: [] as string[],
});

describe("nihai kalite sıralaması ve kapısı", () => {
  it("eşit konsey oyunda KANITI derin olan öne geçer", () => {
    const rich = winnerQualityScore(row("a", 70), { dataCompleteness: 5 });
    const thin = winnerQualityScore(row("b", 70), { dataCompleteness: 1 });
    expect(rich).toBeGreaterThan(thin);
  });

  it("kanıtsız + düşük oylu satır 'kazanan' sayılmaz", () => {
    expect(isWinnerWorthy(row("x", 20), { dataCompleteness: 1 })).toBe(false);
    expect(isWinnerWorthy(row("x", 60), { dataCompleteness: 1 })).toBe(true);
    expect(isWinnerWorthy(row("x", 20), { dataCompleteness: 5 })).toBe(false);
    // Ürün kaydı yoksa eleme yapılmaz (bakamadığımız için değil).
    expect(isWinnerWorthy(row("x", 5), null)).toBe(true);
  });

  it("zayıf adayı eler, yerine daha iyi kazananı alır", () => {
    const byId = new Map<string, NormalizedProduct>([
      ["p90", candidate("p90", 5)],
      ["p88", candidate("p88", 5)],
      ["p86", candidate("p86", 4)],
      ["p84", candidate("p84", 4)],
      ["junk", candidate("junk", 1)],
      ["worse", candidate("worse", 1)],
    ]);
    const result = runFinalRankStep(
      [
        row("p90", 90),
        row("p88", 88),
        row("p86", 86),
        row("p84", 84),
        row("junk", 20),
        row("worse", 15),
      ] as never,
      5,
      byId,
    );
    expect(result.ok).toBe(true);
    const ids = (result.consensus as unknown as { candidateId: string }[]).map((r) => r.candidateId);
    expect(ids).not.toContain("junk");
    expect(ids).not.toContain("worse");
    expect(ids).toHaveLength(4);
    expect(result.notes.join(" ")).toContain("kalite kapısına takıldı");
  });

  it("havuz tamamen zayıfsa liste BOŞALMAZ (taban korunur)", () => {
    const byId = new Map<string, NormalizedProduct>([
      ["a", candidate("a", 1)],
      ["b", candidate("b", 1)],
      ["c", candidate("c", 0)],
    ]);
    const result = runFinalRankStep(
      [row("a", 18), row("b", 12), row("c", 6)] as never,
      5,
      byId,
    );
    // Kapı hepsini elerdi ama taban gereği boş olmayan bir liste teslim edilir.
    // Taban 3'ten 1'e düşürüldü: kırılgan nişlerde 5 ürün gelmeyebiliyor ve
    // 3'lü taban listeyi yine eliyordu, yani kullanıcı boş sonuçla kalıyordu.
    expect(result.consensus.length).toBeGreaterThanOrEqual(1);
    expect(result.consensus.length).toBe(MIN_DELIVERED_WINNERS);
    expect(result.notes.join(" ")).toContain("geri alındı");
  });
});

/* --------------------------------------------------- 5. Gerekçe zenginliği */

describe("nihai gerekçe ölçülmüş kanıtı da söyler", () => {
  it("kanıt derinliği ve çoklu kaynak gerekçeye yazılır", () => {
    const { top_products } = buildTopProducts([
      {
        fingerprint: "fp",
        name: "Air Fryer Pro",
        councilScore: 82,
        confidenceScore: 71,
        priceUsd: 59.9,
        dataCompleteness: 5,
        sources: ["bing-shopping", "google-trends"],
        signals: { demand: 80, margin: 75, competition: 65 },
      },
    ]);
    const reason = top_products[0]!.selection_reason;
    expect(reason).toContain("Kanıt 5/5 dolu");
    expect(reason).toContain("2 kaynak doğruladı");
    // İstenen üç ölçüt hâlâ yerinde.
    expect(reason).toMatch(/Trend gücü \d+\/100/);
    expect(reason).toMatch(/Marj skoru \d+\/100/);
    expect(reason).toMatch(/Rekabet (düşük|yüksek)/);
  });

  it("kanıt ölçülmediyse gerekçeye uydurma sayı eklenmez", () => {
    const { top_products } = buildTopProducts([
      { fingerprint: "fp", name: "Ölçüsüz", councilScore: 50, priceUsd: 20 },
    ]);
    const reason = top_products[0]!.selection_reason;
    expect(reason).not.toContain("Kanıt");
    expect(reason).not.toContain("kaynak doğruladı");
  });
});
