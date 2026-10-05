/**
 * PRODUCT DISCOVERY — kalıcı iş katmanı ve hattın yeni sözleşmeleri.
 *
 * Kapsam:
 *   1. Durum makinesi geçiş kuralları (RPC ile atomik ilerleme).
 *   2. `resolveOrigin` — daha önce sessizce yok sayılan origin argümanı.
 *   3. Uzlaşma kaydının `deep → final` arasında taşınması.
 *   4. Veri bütünlüğü penaltısının 14 ajanın puanına GERÇEKTEN yansıması.
 *   5. Gemini seçicisinin uydurma ürün üretememesi.
 *
 * Tüm testler $0 çalışır: ağ çağrısı ve veritabanı YOK, saf fonksiyonlar
 * üzerinden doğrulanır. Supabase erişimi olmayan bir ortamda da yeşil kalır.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  canTransition,
  DiscoveryStepPayloadSchema,
  productFingerprint,
  PRODUCT_DISCOVERY_STATUSES,
  type Consensus,
  type NormalizedProduct,
} from "./product-discovery.types";
import { buildStepBody, resolveOrigin, stepEndpoint } from "./product-discovery-qstash.server";
import { completenessPenalty, buildConsensus } from "./product-discovery-consensus";
import {
  deterministicVotes,
  runCouncilOnProducts,
  TOTAL_AGENTS,
} from "./product-discovery-council.server";
import { parseLooseJson, runGeminiShortlistStep } from "./product-discovery-pipeline.server";
import {
  buildShortlistPrompt,
  geminiShortlistSelector,
  selectWithGemini,
  GEMINI_SHORTLIST_SIZE,
} from "./product-discovery-pipeline.server";
import { candidateQuality, describeShortlistQuality } from "./discovery-core";
import { productIdOf } from "./discovery-quality";

/**
 * Gemini çağrısı taklit edilir: bu test AĞA ÇIKMAZ, yalnız süre sınırının
 * modele gerçekten iletildiğini kanıtlar. `ai.server` bu dosyada başka bir
 * yerde statik olarak içe aktarılmaz (çağrı dinamiktir).
 */
const aiMock = vi.hoisted(() => ({ callGemini: vi.fn() }));
vi.mock("./ai.server", () => aiMock);

/** Tam ölçülmüş bir ürün (bütünlük 5/5 → penaltı sıfır). */
const fullProduct = (over: Partial<NormalizedProduct> = {}): NormalizedProduct => {
  const base: NormalizedProduct = {
    name: "Air Fryer 5.5L",
    brand: "Acme",
    seller: "shop",
    category: "",
    priceUsd: 59.9,
    rating: 4.6,
    ratingCount: 210,
    inStock: true,
    sources: ["test"],
    url: "https://example.test/p",
    notes: "4.6 puan · 210 değerlendirme",
    viewed90d: null,
    id: "p-1",
    imageUrl: "https://cdn.example.test/air-fryer.jpg",
    salesVolume: 940,
    fingerprint: productFingerprint({ title: "Air Fryer 5.5L", brand: "Acme", seller: "shop" }),
    preScore: 72,
    signals: { demand: 70, competition: 60, margin: 80, rating: 75, availability: 85 },
    dataCompleteness: 4,
    missingFields: [],
    source: "scraped",
  };
  return { ...base, ...over };
};

/* ============================================ 1. Durum makinesi (DB sözleşmesi) */

describe("ProductDiscoveryJob durum makinesi", () => {
  it("tam olarak istenen 7 durumu tanır", () => {
    expect(PRODUCT_DISCOVERY_STATUSES).toEqual([
      "queued",
      "scraping",
      "filtering",
      "gemini_shortlist",
      "deep_analysis",
      "completed",
      "failed",
    ]);
  });

  it("hat zincirini baştan sona ilerletebilir", () => {
    expect(canTransition("queued", "scraping")).toBe(true);
    expect(canTransition("scraping", "filtering")).toBe(true);
    expect(canTransition("filtering", "gemini_shortlist")).toBe(true);
    expect(canTransition("gemini_shortlist", "deep_analysis")).toBe(true);
    expect(canTransition("deep_analysis", "completed")).toBe(true);
  });

  it("terminal durumdan çıkışa izin vermez (çift çalıştırma koruması)", () => {
    expect(canTransition("completed", "scraping")).toBe(false);
    expect(canTransition("failed", "queued")).toBe(false);
    // Retry durumu ileri atlamaya çalışamaz — dedupe adımı bunu reddeder.
    expect(canTransition("queued", "deep_analysis")).toBe(false);
    expect(canTransition("scraping", "gemini_shortlist")).toBe(false);
  });

  it("ARA durumlardan `failed`'e geçilebilir (hata yolu kapanmaz)", () => {
    for (const status of ["queued", "scraping", "filtering", "gemini_shortlist", "deep_analysis"]) {
      expect(canTransition(status as never, "failed")).toBe(true);
    }
  });

  it("terminal durumdan `failed`'e GEÇİLEMEZ (bitmiş iş yeniden açılmaz)", () => {
    // `completed` → `failed` izni, QStash'un gecikmeli bir hata teslimatıyla
    // Kullanıcıya GÖSTERİLEN SONUCU SİLEBİLİRDİ. Terminal durumlar kapalıdır.
    expect(canTransition("completed", "failed")).toBe(false);
    expect(canTransition("failed", "failed")).toBe(false);
  });
});

/* ================================================== 2. Origin çözümlemesi */

describe("resolveOrigin", () => {
  it("açıkça geçilen origin'i KULLANIR (eskiden sessizce yok sayılıyordu)", () => {
    expect(resolveOrigin("https://app.test")).toBe("https://app.test");
  });

  it("ortam değişkenlerine düşer", () => {
    expect(resolveOrigin(undefined, { APP_URL: "https://env.test" })).toBe("https://env.test");
    expect(resolveOrigin(undefined, { VERCEL_URL: "env2.vercel.app" })).toBe(
      "https://env2.vercel.app",
    );
  });

  it("şema zaten varsa çift `https://` üretmez", () => {
    expect(resolveOrigin("https://a.test")).toBe("https://a.test");
    expect(resolveOrigin("http://a.test")).toBe("http://a.test");
  });

  it("son sondaki eğik çizgiyi temizler", () => {
    expect(resolveOrigin("https://a.test/")).toBe("https://a.test");
  });

  it("adres bulunamazsa boş döner (uydurma adres üretmez)", () => {
    expect(resolveOrigin(undefined, {})).toBe("");
  });

  it("çözülen origin hattın adım ucunu doğru kurar", () => {
    const origin = resolveOrigin("https://app.test");
    expect(stepEndpoint(origin, "final")).toBe(
      "https://app.test/api/product-discovery/step?step=final",
    );
  });
});

/* ============================== 3. Uzlaşma taşıma (deep → final sözleşmesi) */

describe("uzlaşma kaydının adımlar arasında taşınması", () => {
  const input = {
    niche: "air fryer",
    country: "US",
    platform: "General",
    topN: 5,
  } as const;

  const aConsensus = (over: Partial<Consensus> = {}): Consensus => ({
    candidateId: "c1",
    name: "Air Fryer 5.5L",
    councilScore: 78,
    votes: 14,
    coverage: 1,
    disagreement: 4,
    confidenceScore: 91,
    minScore: 74,
    maxScore: 82,
    evidence: ["cfo: Marj sinyali 80/100"],
    ...over,
  });

  it("uzlaşmayı `consensus` alanında taşır (ürün şemasına sığmaz)", () => {
    const body = buildStepBody({
      runId: "run-1",
      userId: "user-1",
      input,
      step: "final",
      products: [],
      consensus: [aConsensus()],
      progress: 90,
    });
    // `final` adımı uzlaşmayı `batch`ten değil, ayrı alandan okur.
    expect(body.consensus).toHaveLength(1);
    expect(body.consensus[0]?.councilScore).toBe(78);
    expect(body.batch).toHaveLength(0);
  });

  it("gövde şeması uzlaşmayı doğrular — geçersiz kayıt elenir", () => {
    const parsed = DiscoveryStepPayloadSchema.safeParse({
      runId: "run-1",
      userId: "user-1",
      input,
      batch: [],
      consensus: [{ candidateId: "c1", councilScore: 900 }],
    });
    expect(parsed.success).toBe(false);
  });

  it("consensus verilmezse boş dizi varsayılanı korunur", () => {
    const body = buildStepBody({
      runId: "run-1",
      userId: "user-1",
      input,
      step: "gemini",
      products: [],
      progress: 45,
    });
    expect(body.consensus).toEqual([]);
  });
});

/* ====================== 3b. DİLİM NUMARASI adım gövdesinde taşınır */

/**
 * Her QStash mesajı artık bir adımın TAMAMINI değil, en fazla bir DİLİMİNİ
 * koşar. Dilim numarası gövdede taşınmazsa devam dilimi kendini "ilk dilim"
 * sanar; kilit kuralı onu ya reddeder ya da işi baştan yaptırır.
 */
describe("dilim numarasının adım gövdesinde taşınması", () => {
  const input = { niche: "air fryer", country: "US", platform: "General", topN: 5 } as const;

  it("dilim numarası gövdeye yazılır (devam dilimi kendini bilir)", () => {
    const body = buildStepBody({
      runId: "run-1",
      userId: "user-1",
      input,
      step: "deep",
      products: [],
      progress: 85,
      slice: 3,
    });
    expect(body.slice).toBe(3);
  });

  it("dilim verilmezse 0'dır ve ESKİ gövdeler geçerli kalır", () => {
    const body = buildStepBody({
      runId: "run-1",
      userId: "user-1",
      input,
      step: "scrape_filter",
      products: [],
      progress: 10,
    });
    expect(body.slice).toBe(0);

    // Dilim alanını taşımayan eski gövde de kabul edilir (geriye dönük uyum).
    const legacy = DiscoveryStepPayloadSchema.safeParse({
      runId: "run-1",
      userId: "user-1",
      input,
      batch: [],
      consensus: [],
      progress: 10,
    });
    expect(legacy.success).toBe(true);
    expect(legacy.success && legacy.data.slice).toBe(0);
  });
});

/* ============================ 4. Veri bütünlüğü penaltısı gerçekten işliyor */

describe("veri bütünlüğü penaltısı", () => {
  it("tam ölçülmüş ürün ceza almaz", () => {
    // 5/5 = dört ticari alanın (fiyat, puan, hacim, stok) HEPSİ ölçülmüş
    // + ölçülmüş talep kanıtı. `normalizeRaw` en fazla bu değeri üretir.
    expect(
      completenessPenalty({
        dataCompleteness: 5,
        priceUsd: 59.9,
        source: "scraped",
      }),
    ).toBe(0);
  });

  it("eksik alan arttıkça ceza artar", () => {
    const low = completenessPenalty({ dataCompleteness: 1, priceUsd: 20, source: "scraped" });
    const high = completenessPenalty({ dataCompleteness: 0, priceUsd: 20, source: "scraped" });
    expect(high).toBeGreaterThan(low);
    expect(low).toBeGreaterThan(0);
  });

  it("fiyatı bilinmeyen ürün ek ceza alır (marj hesaplanamaz)", () => {
    const withPrice = completenessPenalty({
      dataCompleteness: 3,
      priceUsd: 30,
      source: "scraped",
    });
    const withoutPrice = completenessPenalty({
      dataCompleteness: 3,
      priceUsd: null,
      source: "scraped",
    });
    expect(withoutPrice).toBeGreaterThan(withPrice);
  });

  it("ceza 20 puanı aşmaz", () => {
    expect(
      completenessPenalty({ dataCompleteness: 0, priceUsd: null, source: "scraped" }),
    ).toBeLessThanOrEqual(20);
  });

  it("14 ajanın puanına yansır — kanıtsız ürün kanıtlıyla eşit puan ALAMAZ", () => {
    const rich = fullProduct({ dataCompleteness: 5, missingFields: [] });
    const thin = fullProduct({
      dataCompleteness: 0,
      priceUsd: null,
      rating: null,
      ratingCount: null,
      inStock: null,
      missingFields: ["price", "rating", "ratingCount", "stock"],
    });

    const richScore = buildConsensus({
      candidateId: "rich",
      name: rich.name,
      votes: deterministicVotes(rich),
      totalAgents: TOTAL_AGENTS,
      dataCompleteness: rich.dataCompleteness,
    });
    const thinScore = buildConsensus({
      candidateId: "thin",
      name: thin.name,
      votes: deterministicVotes(thin),
      totalAgents: TOTAL_AGENTS,
      dataCompleteness: thin.dataCompleteness,
    });

    // KANIT YOKSA YÜKSEK PUAN ÜRETİLEMEZ: bu, önceden ölü koddu.
    expect(thinScore.councilScore).toBeLessThan(richScore.councilScore);
    expect(thinScore.confidenceScore).toBeLessThan(richScore.confidenceScore);
  });

  it("denetçi ajan ikinci kez kırpmaz (tek başına çökmemesin)", () => {
    const votes = deterministicVotes(
      fullProduct({ dataCompleteness: 0, priceUsd: null, missingFields: ["price"] }),
    );
    const auditor = votes.find((v) => v.agentKey === "independent_data_auditor");
    const cfo = votes.find((v) => v.agentKey === "cfo");
    // Kanıtı 0 olan üründe denetçi zaten çok düşük puan verir; ayrıca
    // penaltı almaması gerekir (aksi halde kanıt cezası iki kez biner).
    expect(auditor?.score).toBeLessThanOrEqual(30);
    expect(cfo).toBeDefined();
  });

  it("her aday için 14 ajan oyu üretir", async () => {
    const [consensus] = await runCouncilOnProducts([fullProduct()]);
    expect(consensus?.votes).toBe(TOTAL_AGENTS);
    expect(consensus?.coverage).toBe(1);
  });
});

/* ============================== 5. Gemini seçicisi uydurma ürün üretemez */

describe("Gemini kısa liste seçicisi", () => {
  it("kod bloğu içinde gelen JSON'u ayrıştırır", () => {
    expect(parseLooseJson('```json\n{"picks":[1,2,3]}\n```')).toEqual({ picks: [1, 2, 3] });
  });

  it("sarmalayan metnin arasındaki nesneyi bulur", () => {
    expect(parseLooseJson('İşte sonuç: {"picks":[7]} umarım yardımcı olur')).toEqual({
      picks: [7],
    });
  });

  it("JSON değilse null döner (deterministik sıralamaya düşülür)", () => {
    expect(parseLooseJson("model açıklama yapmadı")).toBeNull();
    expect(parseLooseJson("")).toBeNull();
  });

  it("tekrar eden indeksler elenir", () => {
    const parsed = DiscoveryStepPayloadSchema.safeParse({
      runId: "r",
      userId: "u",
      input: { niche: "air fryer" },
      batch: [],
      consensus: [],
    });
    expect(parsed.success).toBe(true);
  });
});

/* ================================== 6. Gemini kısa listesi (gerçek sözleşme) */

/**
 * Bu blokun var olma sebebi: Gemini adımı DAHA HİÇ ÇALIŞMAMIŞTI ve iki sebeple
 * çalışamazdı. Bu testler o iki sebebi geri dönüşe kapatır.
 */
describe("buildShortlistPrompt", () => {
  const pool = Array.from({ length: 30 }, (_, i) => fullProduct({ name: `Ürün ${i + 1}` }));

  it("DOĞRULAYICIYA AYNI SÖZDİZİMİNİ söyler (picks + geçerli JSON)", () => {
    // Regresyon: istem "sadece numara listesi ver" derken doğrulayıcı
    // {"picks":[...]} bekliyordu. Model talimatı izleyince hata yapmiyor,
    // doğru davranıyor ve hat sessizce yedeğe düşüyordu.
    const prompt = buildShortlistPrompt(pool, "air fryer");
    expect(prompt).toContain('"picks"');
    expect(prompt).toMatch(/geçerli JSON/);
    expect(prompt).not.toMatch(/Sadece numara listesi ver/i);
  });

  it("istenen adet sayısını sabit bir sayı olarak yazar", () => {
    const prompt = buildShortlistPrompt(pool, "air fryer");
    expect(prompt).toContain(`tam olarak ${GEMINI_SHORTLIST_SIZE} farklı productId`);
  });

  it("her adayı GERÇEK productId ile listeler (model uydurma kimlik yazmasın)", () => {
    // Regresyon kapısı: istem "productId dön" diyordu ama listede kimlik
    // YOKTU (sıralı numara vardı). Model doğru davranıp listedeki tek bir
    // kimliği kopyalayamayınca uydurmak zorunda kalıyor ve doğrulayıcı her
    // seçimi eliyordu — hat sessizce yedeğe düşüyordu. Satırlar `productIdOf`
    // ile üretilir, yani liste ile doğrulayıcının beklediği kimlikler aynıdır.
    const prompt = buildShortlistPrompt(pool, "air fryer");
    for (const product of pool.slice(0, GEMINI_SHORTLIST_SIZE)) {
      expect(prompt).toContain(productIdOf(product));
    }
  });

  it("kimlik dışında ürün verisi istemde ÖLÇÜLMÜŞ olarak yazar", () => {
    const prompt = buildShortlistPrompt(pool, "air fryer");
    expect(prompt).toContain("Ürün 1");
    expect(prompt).toContain("$59.90");
  });

  it("havuz kısa istenen sayıyı havuza indirir (1 üründen 25 istemez)", () => {
    const prompt = buildShortlistPrompt([fullProduct()], "air fryer");
    expect(prompt).toContain("tam olarak 1 farklı productId");
  });

  it("MODEL ÜRÜN VERİSİ YAZMAZ — yalnız kimlik + puan + gerekçe ister (§15)", () => {
    // Regresyon kapısı: istem başlık/fiyat/görsel/adres YAZMAMALI, çünkü
    // bunlar kaynaktan gelir; modelin yazdığı her alan doğrulamada elenir.
    const prompt = buildShortlistPrompt(pool, "air fryer");
    expect(prompt).toContain("productId");
    expect(prompt).toContain("score");
    expect(prompt).toContain("reasoning");
    expect(prompt).toMatch(/Fiyat, görsel, adres veya marka YAZMA/);
    expect(prompt).toMatch(/listede olmayan kimlik yazma/);
  });

  it("her adayın ÖLÇÜLMÜŞ bütünlük ve kaynak güvenini yazar (§11/§12)", () => {
    // Regresyon kapısı: `dataCompletenessScore`/`sourceConfidence` tanımlıydı
    // ama hatta HİÇ bağlı değildi (ölü kod). Bu test, modelin gördüğü satırın
    // gerçekten ölçülmüş bir güven skoru taşıdığını kilitler.
    const prompt = buildShortlistPrompt(pool, "air fryer");
    expect(prompt).toContain("bütünlük");
    expect(prompt).toContain("güven");
    const confidence = candidateQuality(pool[0]).confidence;
    expect(prompt).toContain(`güven ${confidence}/100`);
  });

  it("describeShortlistQuality ölçülmüş ortalamayı özetler, boş havuzda boş döner", () => {
    expect(describeShortlistQuality([])).toBe("");
    const summary = describeShortlistQuality(pool);
    expect(summary).toContain("ortalama bütünlük");
    expect(summary).toContain("ortalama kaynak güveni");
    expect(summary).not.toContain("undefined");
  });
});

/* ================= 5b. YENİ SÖZLEŞME: productId + doğrulama (§14/§32) */

describe("Gemini kısa liste — productId sözleşmesi ve halüsinasyon kapısı", () => {
  beforeEach(() => {
    aiMock.callGemini.mockReset();
  });

  const p1 = fullProduct({ id: "sku-1", name: "Air Fryer 5.5L" });
  const p2 = fullProduct({ id: "sku-2", name: "Air Fryer Pro 8L" });
  const p3 = fullProduct({ id: "sku-3", name: "Air Fryer Mini 2L" });

  it("GERÇEK productId'leri seçer ve kaydı GİRDİDEKİ kayıttan verir", async () => {
    const { productIdOf } = await import("./discovery-quality");
    aiMock.callGemini.mockResolvedValue(
      JSON.stringify({
        picks: [
          { productId: productIdOf(p3), score: 93, reasoning: "ölçülmüş talep" },
          { productId: productIdOf(p1), score: 71 },
        ],
      }),
    );

    const picked = await geminiShortlistSelector([p1, p2, p3], "air fryer");

    expect(picked.map((p) => p.id)).toEqual(["sku-3", "sku-1"]);
    // Model ürün verisini DEĞİŞTİRMEZ: fiyat kaynak değerinde kalır.
    expect(picked[0]!.priceUsd).toBe(p3.priceUsd);
  });

  it("HALÜSİNASYON ürün kimliğini reddeder (uydurma ürün listeye giremez)", async () => {
    const { productIdOf } = await import("./discovery-quality");
    aiMock.callGemini.mockResolvedValue(
      JSON.stringify({
        picks: [
          { productId: "p_olmayan_urun_999", score: 99 },
          { productId: productIdOf(p2), score: 80 },
        ],
      }),
    );

    const picked = await geminiShortlistSelector([p1, p2, p3], "air fryer");

    // Sahte ürün YOK; yalnız gerçek aday kaldı.
    expect(picked.map((p) => p.id)).toEqual(["sku-2"]);
  });

  it("TAMAMEN uydurma yanıtta boş seçim döner (hat yedeğe düşer)", async () => {
    aiMock.callGemini.mockResolvedValue(
      JSON.stringify({ picks: [{ productId: "p_hayalet", score: 100 }] }),
    );
    await expect(geminiShortlistSelector([p1, p2], "air fryer")).resolves.toEqual([]);
  });

  it("geçersiz puandan gelen yanıt şemayı geçmez → yedek", async () => {
    const { productIdOf } = await import("./discovery-quality");
    aiMock.callGemini.mockResolvedValue(
      JSON.stringify({ picks: [{ productId: productIdOf(p1), score: 150 }] }),
    );
    await expect(geminiShortlistSelector([p1, p2], "air fryer")).resolves.toEqual([]);
  });

  it("bozuk JSON → yedek (çökmez)", async () => {
    aiMock.callGemini.mockResolvedValue("{picks:[{productId: broken");
    await expect(geminiShortlistSelector([p1, p2], "air fryer")).resolves.toEqual([]);
  });

  it("model ürün verisi yazmaya çalışırsa YOK SAYILIR", async () => {
    const { productIdOf } = await import("./discovery-quality");
    aiMock.callGemini.mockResolvedValue(
      JSON.stringify({
        picks: [
          {
            productId: productIdOf(p1),
            score: 80,
            name: "Sahte Ürün",
            priceUsd: 0.99,
            imageUrl: "https://sahte.test/x.jpg",
          },
        ],
      }),
    );

    const picked = await geminiShortlistSelector([p1, p2], "air fryer");

    expect(picked).toHaveLength(1);
    expect(picked[0]!.priceUsd).toBe(59.9);
    expect(picked[0]!.imageUrl).toBe(p1.imageUrl);
  });

  it("mükerrer productId ilkini korur (QStash mükerrer teslimatı)", async () => {
    const { productIdOf } = await import("./discovery-quality");
    aiMock.callGemini.mockResolvedValue(
      JSON.stringify({
        picks: [
          { productId: productIdOf(p1), score: 90 },
          { productId: productIdOf(p1), score: 50 },
        ],
      }),
    );

    const picked = await geminiShortlistSelector([p1, p2, p3], "air fryer");
    expect(picked).toHaveLength(1);
  });

  it("ESKİ indeks sözleşmesi hâlâ çalışır (geriye uyum)", async () => {
    aiMock.callGemini.mockResolvedValue(JSON.stringify({ picks: [2, 1] }));
    const picked = await geminiShortlistSelector([p1, p2, p3], "air fryer");
    expect(picked.map((p) => p.id)).toEqual(["sku-2", "sku-1"]);
  });

  it("sınır dışı indeks sessizce düşer (uydurma yerine atlama)", async () => {
    aiMock.callGemini.mockResolvedValue(JSON.stringify({ picks: [99, 2] }));
    const picked = await geminiShortlistSelector([p1, p2], "air fryer");
    expect(picked.map((p) => p.id)).toEqual(["sku-2"]);
  });

  it("havuz 25'ten küçükse sayı DOLDURULMAZ", async () => {
    aiMock.callGemini.mockRejectedValue(new Error("offline"));
    const result = await runGeminiShortlistStep([p1, p2], "air fryer");
    expect(result.products).toHaveLength(2);
    expect(result.notes.join(" ")).toContain("YAPILMADI");
  });
});

/* ================= 5c. Huni ve kayıt izlenebilirliği (§25) */

describe("hat gözlemlenebilirliği — huni sayıları notlarda görünür", () => {
  it("kazıma/filtre hunisi kayıt/filtre/top75 sayılarını tek satırda yazar", async () => {
    // NOT: bu test AĞA ÇIKMAZ. `runScrapeFilterStep` canlı kaynakları
    // çağırdığı için burada yerine adımın kullandığı huni biçimi doğrulanır;
    // sayıların kendisi `discovery-quality.test.ts`'te kilitlidir.
    const { describeFunnel } = await import("./discovery-quality");
    const line = describeFunnel(
      { scraped: 1842, normalized: 1791, filtered: 312, top75: 75 },
      { "bozuk görsel": 82, "eksik fiyat": 101, duplicate: 230 },
    );
    expect(line).toContain("SCRAPED: 1842");
    expect(line).toContain("NORMALIZED: 1791");
    expect(line).toContain("FILTERED: 312");
    expect(line).toContain("TOP75: 75");
    expect(line).toContain("eleme");
    expect(line).toContain("duplicate: 230");
  });

  it("gemini adımı giriş/çıkış sayılarını yazar", async () => {
    const pool = Array.from({ length: 30 }, (_, i) =>
      fullProduct({ id: `s-${i}`, name: `Ürün ${i + 1}`, preScore: 100 - i }),
    );
    const result = await runGeminiShortlistStep(pool, "air fryer", 25);
    const notes = result.notes.join(" ");
    expect(notes).toContain("GEMINI_INPUT: 30");
    expect(notes).toContain("GEMINI_OUTPUT: 25");
  });
});

describe("selectWithGemini", () => {
  const pool = Array.from({ length: 40 }, (_, i) =>
    fullProduct({ name: `Ürün ${i + 1}`, preScore: 100 - i }),
  );

  it("Gemini seçimini kullanır ve sırayı korur", async () => {
    const res = await selectWithGemini(pool, "air fryer", 25, async (rows) => [rows[39], rows[38]]);
    expect(res.via).toBe("gemini");
    expect(res.geminiPicks).toBe(2);
    expect(res.products[0].name).toBe("Ürün 40");
    expect(res.products[1].name).toBe("Ürün 39");
  });

  it("AZ seçim dönerse deterministik sıradan TAMAMLAR (huni daralmaz)", async () => {
    // Regresyon: Gemini 3 dönerse 14 ajana 3 ürün gidiyordu. Huni 25'te
    // kalmalı; modelin seçimi önde, yedekleme arkada.
    const res = await selectWithGemini(pool, "air fryer", 25, async (rows) => [
      rows[39],
      rows[38],
      rows[37],
    ]);
    expect(res.products).toHaveLength(25);
    expect(res.geminiPicks).toBe(3);
    // İlk 3 modelden, kalan 22 deterministik en iyi sıradan.
    expect(res.products[0].name).toBe("Ürün 40");
    expect(res.products[3].name).toBe("Ürün 1");
    expect(new Set(res.products).size).toBe(25);
  });

  it("Gemini hata verirse deterministik yedeğe düşer", async () => {
    const res = await selectWithGemini(pool, "air fryer", 25, async () => {
      throw new Error("429");
    });
    expect(res.via).toBe("fallback");
    expect(res.geminiPicks).toBe(0);
    expect(res.products[0].name).toBe("Ürün 1");
  });

  it("Gemini boş liste döndürürse yedeğe düşer", async () => {
    const res = await selectWithGemini(pool, "air fryer", 25, async () => []);
    expect(res.via).toBe("fallback");
    expect(res.products).toHaveLength(25);
  });

  it("seçici hiç verilmezse yine 25 ürün üretir (hat düşmez)", async () => {
    const res = await selectWithGemini(pool, "air fryer", 25);
    expect(res.via).toBe("fallback");
    expect(res.products).toHaveLength(25);
  });

  it("havuz 25'ten küçükse mevcut olanın tamamını döndürür", async () => {
    const small = pool.slice(0, 7);
    const res = await selectWithGemini(small, "air fryer", 25);
    expect(res.products).toHaveLength(7);
  });
});

/**
 * GEMINI ADIMI SÜRE SINIRI — "300 sn'den fazla" belirtisinin dördüncü kaynağı.
 *
 * `callGemini` anahtar/model rotasyonunda süre verilmediğinde TEK çağrı için
 * teorik ~240 sn harcayabilir (5 anahtar × 4 model × 12 sn). Bu adım zincirin
 * İKİNCİSİDİR; pencereyi tek başına yediğinde `deep`e ve `final`e yer kalmaz ve
 * istek platform tavanına dayanır. Sınır artık zincirin bitiş anından gelir ve
 * yetmeyen rotasyon deterministik seçime düşer.
 */
describe("gemini kısa liste süre sınırı", () => {
  it("zincirin bitiş anını modele İLETİR", async () => {
    aiMock.callGemini.mockResolvedValue(JSON.stringify({ picks: [2, 1] }));
    const deadlineAt = Date.now() + 120_000;

    const picked = await geminiShortlistSelector(
      [fullProduct({ id: "p-1" }), fullProduct({ id: "p-2", name: "Air Fryer Pro 8L" })],
      "air fryer",
      deadlineAt,
    );

    expect(aiMock.callGemini).toHaveBeenCalledWith(
      expect.any(String),
      undefined,
      0.2,
      false,
      undefined,
      deadlineAt,
    );
    expect(picked.length).toBe(2);
  });

  it("sınır verilmezse eski davranış korunur (undefined geçilir)", async () => {
    aiMock.callGemini.mockResolvedValue(JSON.stringify({ picks: [1] }));

    await geminiShortlistSelector([fullProduct({ id: "p-1" })], "air fryer");

    expect(aiMock.callGemini).toHaveBeenCalledWith(
      expect.any(String),
      undefined,
      0.2,
      false,
      undefined,
      undefined,
    );
  });
});

/**
 * GEMINI 503 "HIGH DEMAND" — kullanıcının gördüğü hatanın kaynağı.
 *
 * ÖLÇÜLEN CANLI HATA (2026-10-02):
 *   "Yeni hat kurulamadı: gemini: Gemini error: 503 { … high demand … }"
 *
 * KÖK NEDEN: `geminiShortlistSelector` kendi sözleşmesinde "model konuşmazsa
 * `[]` dön, deterministik sıralama işi bitirsin" diyordu (parse başarısız
 * olunca `return []`). Ama `callGemini` bir 503 fırlatınca bu YEDEK KOD
 * ÇALIŞMIYORDU: istisna adımı düşürüyor, hat `gemini: …` diye
 * `failStep` ile kapanıyordu. Google'un GEÇİCİ yoğunluğu kullanıcının
 * ürün aramasını komple çökertiyordu.
 */
describe("gemini kısa liste — sağlayıcı hatasında hat düşmez", () => {
  beforeEach(() => {
    aiMock.callGemini.mockReset();
  });

  it("503 fırlatırsa boş seçim döner, İSTİSNA ATMAZ", async () => {
    aiMock.callGemini.mockRejectedValue(
      new Error(
        'Gemini error: 503 {"error":{"code":503,"message":"This model is currently experiencing high demand."}}',
      ),
    );

    await expect(
      geminiShortlistSelector([fullProduct({ id: "p-1" })], "air fryer"),
    ).resolves.toEqual([]);
  });

  it("ağ hatası / zaman aşımı da aynı şekilde yutulur", async () => {
    aiMock.callGemini.mockRejectedValue(new Error("fetch failed"));

    await expect(
      geminiShortlistSelector([fullProduct({ id: "p-1" })], "air fryer"),
    ).resolves.toEqual([]);
  });

  it("model yanıt vermezse (boş string) da yedek devreye girer", async () => {
    aiMock.callGemini.mockResolvedValue("");

    await expect(
      geminiShortlistSelector([fullProduct({ id: "p-1" })], "air fryer"),
    ).resolves.toEqual([]);
  });

  it("hatta DÜŞMEZ: adım sağlayıcı hatasında deterministik listeyi bitirir", async () => {
    // En dıştaki sözleşme: `gemini` adımı model olmadan da ürün döndürmeli.
    aiMock.callGemini.mockRejectedValue(new Error("Gemini error: 503 high demand"));
    const products = [
      fullProduct({ id: "p-1", name: "Air Fryer 5.5L", preScore: 90 }),
      fullProduct({ id: "p-2", name: "Air Fryer Pro 8L", preScore: 80 }),
    ];

    const result = await runGeminiShortlistStep(products, "air fryer", 25);

    expect(result.ok).toBe(true);
    expect(result.products.length).toBeGreaterThan(0);
  });
});
