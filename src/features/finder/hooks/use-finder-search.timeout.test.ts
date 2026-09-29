/**
 * ZAMAN AŞIMI ÖLÜ NOKTA DEĞİLDİR — BAĞLANTI TESTİ.
 *
 * Bu testin varlık sebebi: kullanıcı canlıda tekrar tekrar "Arka plan analizi
 * zaman aşımına uğradı" kartı gördü ve bunu üreten yer istemci tarafındaki
 * `armSafetyTimer` idi. O zamanlayıcı sunucunun bütçesini DEĞİL, yalnız
 * istemcinin uygulama bekleme penceresini ölçüyordu; o anda iş sunucuda çalışıyor
 * ve sonucunu yazmış oluyordu. Kullanıcı hem ürünü hem kredisini kaybediyordu.
 *
 * Sözleşme (kilitlenmesi gereken):
 *   1. Bekleme penceresi dolduğunda HATA KARTI üretilmez.
 *   2. Bunun yerine "hâlâ çalışıyor" durumu açılır.
 *   3. Klasik hattın `DISCOVERY_JOB_TIMEOUT` hatası da aynı duruma düşer.
 */
import { describe, expect, it } from "vitest";

const read = (p: string) => import("node:fs").then((fs) => fs.readFileSync(p, "utf8"));
const HOOK = "src/features/finder/hooks/use-finder-search.ts";

describe("istemci bekleme bütçesi ölü nokta üretmez", () => {
  it("güvenlik zamanlayıcısı HATA KARTI kurmaz, 'hâlâ çalışıyor' açar", async () => {
    const src = await read(HOOK);
    const start = src.indexOf("const armSafetyTimer");
    expect(start).toBeGreaterThan(-1);
    // Zamanlayıcının gövdesi, `gen` mutation tanımına kadar.
    const body = src.slice(start, src.indexOf("const gen = useMutation"));
    expect(body).toContain("setStillRunning(true)");
    // Ölümcül hata yolu tamamen kaldırıldı.
    expect(body).not.toContain("setSearchError");
    expect(body).not.toContain("DISCOVERY_JOB_TIMEOUT");
  });

  it("zaman aşımı hatası gelen hata mesajları da 'hâlâ çalışıyor' durumuna düşer", async () => {
    const src = await read(HOOK);
    expect(src).toContain("/DISCOVERY_JOB_(COUNCIL_TAIL_)?TIMEOUT/");
    const handler = src.slice(src.indexOf("onError: (err: Error) => {"));
    // Klasik hattın onError'ı da kırmızı kart kurmamalı.
    expect(handler).toContain("setStillRunning(true)");
  });

  it("yoklama döngüleri ön planı aşınca arka planda devam eder", async () => {
    const src = await read(HOOK);
    // Ön plan bittiğinde iş "ölmez": yavaşlayan yoklama sürer, terminal durumda
    // sonuç teslim edilir. Kullanıcı yalnız bilgilendirilir.
    expect(src).toContain("PIPELINE_BACKGROUND_WAIT_MS");
    expect(src).toContain('reason: "still-running"');
  });

  it("bu durum arayüzde hata kartı DEĞİL, bilgi şeridi olarak görünür", async () => {
    const route = await read("src/routes/index.tsx");
    expect(route).toContain("stillRunning");
    // "Sonuç bulunamadı" kartı, iş hâlâ sürerken gösterilmemeli.
    expect(route).toContain("results.length === 0 && !stillRunning");
    expect(route).toContain("Analiz sunucuda çalışmaya devam ediyor");
  });

  it("arama BAŞLATILMADAN önce kurulum denetimi yapılır", async () => {
    const src = await read(HOOK);
    // Sıralama kilitlidir: denetim, `pipeline.mutate` ÖNCESİ gelir.
    const preflightAt = src.indexOf("blockingSetupIssues(report)");
    const startAt = src.lastIndexOf("pipeline.mutate(vars)");
    expect(preflightAt).toBeGreaterThan(-1);
    expect(startAt).toBeGreaterThan(-1);
    expect(preflightAt).toBeLessThan(startAt);
    // Engellenirse kullanıcıya düzeltilebilir sebep yazılır ve iş BAŞLATILMAZ.
    expect(src).toContain("kredi harcanmadı");
    expect(src).toContain("Arama motoru kurulmamış");
  });

  it("denetim alınamazsa arama yine başlar (kontrol asla kilitlemez)", async () => {
    const src = await read(HOOK);
    // Rapor gelmezse klasik davranış: hat denenir.
    expect(src).toContain("pipeline.mutate(vars);\n        });");
  });
});
