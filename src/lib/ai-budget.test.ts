// ============================================================================
// BÜTÇE TESTLERİ — "10 SANİYELİK DİLİM" SÖZÜNÜN GERÇEKTEN TUTULMASI.
//
// ÖLÇÜLEN HATA: dilim bütçesi yalnız Gemini yolunda uygulanıyordu. Anahtarlar
// tükendiğinde `callGemini` üç yedeğe düşüyordu ve HİÇBİRİ süreye bağlı
// değildi:
//   • `runPoolWithFailover` → düğüm başına 45 sn, döngüde süre kontrolü YOK,
//   • `callLovableAI`/`callGatewayResponses` → fetch'te hiç zaman aşıtı YOK,
//   • `directFallback`/`tryOpenAIPool` → ANAHTAR × MODEL turu, süre kontrolü YOK,
//   • `runCouncilWave` → `Promise.allSettled` TÜM rolleri bekliyor.
//
// Sonuç: "10 saniyelik dilim" fiilen dakikalarca koşuyor, hat 280 sn'lik sözü
// aşıyor ve kullanıcı "çok uzun sürüyor" diyordu. Bu testler her yolun
// bütçeye bağlandığını KALICI olarak sabitler.
// ============================================================================

import { describe, expect, it } from "vitest";

import { gatewayAttemptMs, openAiAttemptMs } from "./ai.server";
import { poolAttemptMs } from "./ai-pool.server";
import { runCouncilSlice } from "./product-discovery-council-ai.server";
import type { NormalizedProduct } from "./product-discovery.types";

/** Test ürünü — konsey istemi yalnız alan adlarını okur. */
function product(index: number): NormalizedProduct {
  return {
    id: `p${index}`,
    name: `Ürün ${index}`,
    brand: "Marka",
    seller: "Satıcı",
    category: "kategori",
    priceUsd: 10 + index,
    rating: 4,
    ratingCount: 10,
    inStock: true,
    sources: ["kaynak"],
    url: "https://example.com",
    notes: "",
    preScore: 50,
    dataCompleteness: 3,
    fingerprint: `fp${index}`,
  } as unknown as NormalizedProduct;
}

describe("dilim bütçesi — model denemesi süreleri", () => {
  it("sınır verilmezse eski varsayılanlar korunur (davranış değişmez)", () => {
    expect(openAiAttemptMs(undefined)).toBe(12_000);
    expect(gatewayAttemptMs(undefined)).toBe(45_000);
    expect(poolAttemptMs({ prompt: "x" })).toBe(45_000);
  });

  it("OpenAI uyumlu deneme kalan süreye kırpılır", () => {
    const now = 1_000_000;
    // 10 sn'lik dilimde kalan 3 sn → 12 sn beklenmez, 3 sn'de kapanır.
    expect(openAiAttemptMs(now + 3_000, now)).toBe(3_000);
    // Kalan süre 12 sn'den büyükse varsayılan korunur.
    expect(openAiAttemptMs(now + 30_000, now)).toBe(12_000);
  });

  it("ağ geçidi denemesi kalan süreye kırpılır (eskiden zaman aşıtı yoktu)", () => {
    const now = 1_000_000;
    expect(gatewayAttemptMs(now + 5_000, now)).toBe(5_000);
    expect(gatewayAttemptMs(now + 120_000, now)).toBe(45_000);
  });

  it("havuz düğümü kalan süreyle sınırlanır, süre bitince deneme yapılmaz", () => {
    const now = 1_000_000;
    expect(poolAttemptMs({ prompt: "x", deadlineAt: now + 4_000 }, now)).toBe(4_000);
    // Süre tamamen bitti → deneme başlatılmaz (0 = "düğüm deneme").
    expect(poolAttemptMs({ prompt: "x", deadlineAt: now - 1 }, now)).toBe(0);
    // Kalan süre çok kısaysa en az süreye yükseltilir (anlamsız 0 ms olmaz).
    expect(poolAttemptMs({ prompt: "x", deadlineAt: now + 10 }, now)).toBe(1_000);
  });
});

describe("konsey dalgası — dilim penceresini aşmaz", () => {
  it("yavaş bir rol dalga süresini uzatmaz; rol deterministiğe düşer", async () => {
    const products = [product(1), product(2)];
    const started = Date.now();
    // İki rolden biri DİLİM PENCERESİNİ AŞAN bir çağrı yapsın: asla dönmez.
    // Diğeri normalde döner. `Promise.allSettled` ikisini de bekliyordu, yani
    // dalga süresizce kilitleniyor ve 10 sn'lik dilim sözü tutulmuyordu.
    const result = await runCouncilSlice(products, "niş", {
      sliceDeadlineAt: Date.now() + 700,
      minCallMs: 100,
      concurrency: 2,
      call: async (_prompt, deadlineAt) => {
        const left = deadlineAt - Date.now();
        if (left > 500) {
          // Pencerenin çok üstünde: asla çözülmeyen söz.
          return new Promise<string>(() => {});
        }
        return JSON.stringify({ scores: [{ i: 1, score: 70, note: "iyi" }] });
      },
    });
    const elapsed = Date.now() - started;

    // Dalga pencereyi AŞMADI (geniş tolerans: olay döngüsü gecikmesi için).
    expect(elapsed).toBeLessThan(3_000);
    // Dalga kısmi döndü: roller sıradaki dilimde devam edecek.
    expect(result.partial).toBe(true);
  });

  it("pencere dolduğunda yeni dalga başlatılmaz, kısmi durum korunur", async () => {
    const products = [product(1), product(2)];
    // Süre YETERSİZ: `minCallMs` içinden büyük → dalga hiç başlamaz.
    const result = await runCouncilSlice(products, "niş", {
      sliceDeadlineAt: Date.now() + 50,
      minCallMs: 4_000,
      call: async () => JSON.stringify({ scores: [] }),
    });
    expect(result.partial).toBe(true);
    // Hiç rol konuşmadı ama durum yine taşınır (ilerleme kaybolmaz).
    expect(result.state.done).toEqual([]);
    expect(result.consensus).toEqual([]);
  });
});
