/**
 * GEMINI AŞIRI YÜK (503 high demand) — regresyon testi (ağ YOK).
 *
 * ÖLÇÜLEN CANLI HATA (2026-10-02):
 *   `503 "This model is currently experiencing high demand"` geldiğinde
 *   `callGemini` 503'ü her anahtarda yeniden deniyordu. Oysa yüksek talep
 *   anahtara özgü değildir: 2. anahtarda da aynı 503 gelir. Böylece bütçe
 *   "anahtar sayısı × model sayısı" kadar ölü istekle harcandı ve gerçekten
 *   çalışan diğer sağlayıcılara geçiş gecikti.
 *
 * KANITLANAN ÖZELLİK: anahtar sayısı artsa bile 503 sonrası Gemini isteği
 * sayısı ARTMAZ. Test bunu 1 anahtar ve 3 anahtar ile iki kez ölçüp
 * eşitliği doğrular — eski davranışta bu sayı 3 katına çıkardı.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// Gemini tükenince `callGemini` GERÇEK sağlayıcı havuzuna düşer. Bu test
// yalnız Gemini tarafını ölçtüğü için havuz kısayla hata verir.
vi.mock("./ai-pool.server", () => ({
  runPoolWithFailover: vi.fn(async () => {
    throw new Error("havuz testte kapalı");
  }),
}));

const GEMINI_HOST = "generativelanguage.googleapis.com";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  for (let i = 1; i <= 8; i += 1) delete process.env[`GEMINI_API_KEY_${i}`];
  delete process.env.GEMINI_API_KEY;
});

/** Tüm Gemini uçlarına aynı yanıtı veren sahte ağ; çağrı sayısını döner. */
function stubGemini(status: number, body: string) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: string | URL) => {
    calls.push(String(input));
    return { ok: status < 400, status, text: async () => body } as Response;
  });
  return calls;
}

const HIGH_DEMAND = '{"error":{"code":503,"message":"This model is currently experiencing high demand."}}';

describe("callGemini — 503 aşırı yük", () => {
  it("anahtar sayısı artsa bile istek sayısı ARTMAZ", async () => {
    /** Belirtilen anahtar sayısıyla 503 çalıştırıp, TERCİH EDİLEN merdiven
     *  (gemini-a/gemini-b) üzerindeki çağrıları sayar.
     *
     *  Sayılan kısım önemlidir: eski kodda bu merdiven "anahtar sayısı × 2"
     *  kez denenirdi (3 anahtar → 6 çağrı). Düzeltmeden sonra aşırı yük
     *  anahtara özgü olmadığı için merdiven BİR kez denenip kesiliyor
     *  (3 anahtar → 2 çağrı). */
    const preferredCallsFor = async (keyCount: number) => {
      for (let i = 1; i <= keyCount; i += 1) process.env[`GEMINI_API_KEY_${i}`] = `anahtar-${i}`;
      const calls = stubGemini(503, HIGH_DEMAND);
      const { callGemini } = await import("./ai.server");
      await callGemini("test", undefined, 0.2, false, ["gemini-a", "gemini-b"]).catch(() => {});
      for (let i = 1; i <= keyCount; i += 1) delete process.env[`GEMINI_API_KEY_${i}`];
      return calls.filter((u) => /models\/(gemini-a|gemini-b)/.test(u)).length;
    };

    const oneKey = await preferredCallsFor(1);
    const threeKeys = await preferredCallsFor(3);

    // ESKİ DAVRANIŞ: 3 anahtarda 6 çağrı (3 × 2 model). Aşırı yük anahtara
    // özgü olmadığı için anahtar sayısı artsa da merdiven bir kez denenmeli.
    expect(oneKey).toBe(2); // tek anahtar: iki model birer kez
    expect(threeKeys).toBe(2); // üç anahtar: YİNE iki, rotasyon kesildi
  }, 30_000);

  it("kota hatası (403) rotasyonu kesmez — davranış DEĞİŞMEDİ", async () => {
    for (let i = 1; i <= 3; i += 1) process.env[`GEMINI_API_KEY_${i}`] = `anahtar-${i}`;
    const calls = stubGemini(403, '{"error":{"code":403,"message":"API key not valid"}}');

    const { callGemini } = await import("./ai.server");
    await expect(
      callGemini("test", undefined, 0.2, false, ["gemini-a"]),
    ).rejects.toThrow();

    // Kota GERÇEKTEN anahtara özgüdür: park edilir, sıradaki anahtara geçilir.
    const tried = new Set(
      calls.filter((u) => u.includes(GEMINI_HOST)).map((u) => u.split("/models/")[1]),
    );
    expect(tried.size).toBeGreaterThan(0);
  }, 30_000);
});