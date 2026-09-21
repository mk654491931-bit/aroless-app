// Unit tests for the platform-aware discovery job budgets (pure logic — no network).
//
// Bu bütçeler 504 sınıfı hataların tek kaynağıdır: yanlış hesaplanırsa uzun
// Render işi ya çok erken kesilir (istemci zaman aşımı) ya da Vercel'in 60 sn
// limiti aşılır. Bu yüzden her platform varyantı ayrı ayrı sabitlenir.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DISCOVERY_END_TO_END_MS,
  DISCOVERY_MAX_BUDGET_MS,
  DISCOVERY_RETURN_FLOOR_MS,
  DISCOVERY_RETURN_MARGIN_MS,
  JOB_POLL_INTERVAL_MS,
  batchReserveMs,
  councilEnrichCallMs,
  councilEnrichLimit,
  councilLoopDecision,
  discoveryStagePlan,
  clientWaitMs,
  discoveryDispatchPlan,
  discoveryFallbackDecision,
  functionMaxDurationSeconds,
  jobPollingPlan,
  longJobPlan,
  qstashTimeoutSeconds,
  inlineHeavyWorkFits,
  remoteWorkerConfigured,
  runsOnLongLivedHost,
  workerBudgetMs,
  workerJobsUrl,
  workerTargetIsLongLived,
} from "./discovery-jobs.server";
import { COUNCIL_ENRICH_BUDGET_MS, COUNCIL_ENRICH_MIN_MS } from "./council-budget.server";

const MANAGED_KEYS = [
  "NITRO_PRESET",
  "RENDER_SERVICE_ID",
  "DISCOVERY_WORKER_URL",
  "WORKER_URL",
  "QSTASH_TIMEOUT_SECONDS",
  "VERCEL_FUNCTION_MAX_DURATION",
];

/** Clear every budget input so each test states its own platform explicitly. */
function clearBudgetEnv() {
  for (const key of MANAGED_KEYS) vi.stubEnv(key, "");
}

beforeEach(() => {
  vi.unstubAllEnvs();
  clearBudgetEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("functionMaxDurationSeconds", () => {
  it("keeps the current Vercel ceiling (300s) by default", () => {
    // Vercel, fluid compute ile Hobby'de de 300 sn'ye izin veriyor; 60 sn'de
    // kalmak ağır analizi fonksiyon ortasında kesip 504 üretiyordu.
    expect(runsOnLongLivedHost()).toBe(false);
    expect(functionMaxDurationSeconds()).toBe(300);
  });

  it("uses the Render persistent-service budget via NITRO_PRESET", () => {
    vi.stubEnv("NITRO_PRESET", "render_com");
    expect(runsOnLongLivedHost()).toBe(true);
    expect(functionMaxDurationSeconds()).toBe(900);
  });

  it("also detects Render from RENDER_SERVICE_ID", () => {
    vi.stubEnv("RENDER_SERVICE_ID", "srv-abc123");
    expect(runsOnLongLivedHost()).toBe(true);
    expect(functionMaxDurationSeconds()).toBe(900);
  });

  it("honours VERCEL_FUNCTION_MAX_DURATION on Vercel", () => {
    vi.stubEnv("VERCEL_FUNCTION_MAX_DURATION", "300");
    expect(functionMaxDurationSeconds()).toBe(300);
  });

  it("ignores a stale VERCEL_FUNCTION_MAX_DURATION on Render", () => {
    vi.stubEnv("NITRO_PRESET", "render_com");
    vi.stubEnv("VERCEL_FUNCTION_MAX_DURATION", "60");
    expect(functionMaxDurationSeconds()).toBe(900);
  });

  it("clamps the configured value to 900s and falls back below 10s", () => {
    vi.stubEnv("VERCEL_FUNCTION_MAX_DURATION", "5000");
    expect(functionMaxDurationSeconds()).toBe(900);
    vi.stubEnv("VERCEL_FUNCTION_MAX_DURATION", "5");
    expect(functionMaxDurationSeconds()).toBe(300);
  });
});

describe("workerBudgetMs / clientWaitMs", () => {
  it("ürün bulucu her platformda uçtan uca 280 sn sözüne oturur", () => {
    // Ürün kararı: kullanıcı tıkla → sonuç arası en fazla 280 sn bekler.
    // İşçinin hattı koştuğu bütçe bu sözden dönüş payı (20 sn) düşülerek
    // hesaplanır; yoksa hat tam bütçesini kullanınca kullanıcı 285-300 sn
    // bekliyor ve "280 sn'den fazla sürüyor" görüyordu.
    expect(DISCOVERY_END_TO_END_MS).toBe(280_000);
    expect(workerBudgetMs()).toBe(DISCOVERY_MAX_BUDGET_MS);
    expect(DISCOVERY_MAX_BUDGET_MS).toBe(260_000);
    expect(workerBudgetMs() + DISCOVERY_RETURN_MARGIN_MS).toBe(280_000);
    // Sonucu yazmaya pay kalsın: 260 + 16, 300 sn'lik fonksiyon limitini aşmaz.
    expect(DISCOVERY_MAX_BUDGET_MS + 16_000).toBeLessThanOrEqual(300_000);
    expect(clientWaitMs()).toBe(292_000);
  });

  it("falls back to the fast profile when the function budget is narrowed", () => {
    vi.stubEnv("VERCEL_FUNCTION_MAX_DURATION", "60");
    expect(workerBudgetMs()).toBe(44_000);
    expect(clientWaitMs()).toBe(52_000);
  });

  it("Render'ın 900 sn limiti olsa bile hat sözünü aşmaz", () => {
    vi.stubEnv("NITRO_PRESET", "render_com");
    expect(functionMaxDurationSeconds()).toBe(900);
    // Hat bütçesi = uçtan uca söz (280 sn) − dönüş payı (20 sn) = 260 sn.
    expect(workerBudgetMs()).toBe(DISCOVERY_MAX_BUDGET_MS);
    expect(workerBudgetMs()).toBe(260_000);
    expect(DISCOVERY_MAX_BUDGET_MS + DISCOVERY_RETURN_MARGIN_MS).toBe(DISCOVERY_END_TO_END_MS);
    expect(clientWaitMs()).toBe(892_000);
  });

  it("never drops below the safety floors", () => {
    vi.stubEnv("VERCEL_FUNCTION_MAX_DURATION", "10");
    expect(workerBudgetMs()).toBe(25_000);
    expect(clientWaitMs()).toBe(20_000);
  });

  it("hibritte (Vercel tetikler, Render çalıştırır) yoklama penceresini worker'a göre açar", () => {
    // 14'lü konsey 350-400 sn sürer: tetikleyicinin 300 sn'lik limiti geçerli
    // olsaydı istemci 292. saniyede pes eder, kullanıcı sonucu hiç görmezdi.
    vi.stubEnv("WORKER_URL", "https://aroless.onrender.com");
    expect(workerTargetIsLongLived()).toBe(true);
    expect(clientWaitMs()).toBe(892_000);
    expect(clientWaitMs()).toBeGreaterThan(400_000);
  });

  it("DISCOVERY_WORKER_URL de tek başına yeter (ürün bulucu hibriti)", () => {
    vi.stubEnv("DISCOVERY_WORKER_URL", "https://aroless.onrender.com/api/worker");
    expect(clientWaitMs()).toBe(892_000);
  });
});

describe("councilEnrichLimit (kalan süreye göre karne sayısı)", () => {
  it("260 sn'lik hat bütçesinde 4 ürüne karne çıkarır", () => {
    // (260 sn - 5 sn yazma payı) / 62 sn karne = 4 → tek bir ürün kalan süreyi
    // yiyip diğer ürünleri karnesiz bırakamaz.
    expect(councilEnrichLimit(DISCOVERY_MAX_BUDGET_MS)).toBe(4);
    expect(councilEnrichLimit(DISCOVERY_MAX_BUDGET_MS)).toBeLessThan(8);
  });

  it("süre azaldıkça karne sayısı da azalır (sığmayan iş başlatılmaz)", () => {
    expect(councilEnrichLimit(200_000)).toBe(3);
    expect(councilEnrichLimit(130_000)).toBe(2);
    expect(councilEnrichLimit(65_000)).toBe(0);
    expect(councilEnrichLimit(0)).toBe(0);
    expect(councilEnrichLimit(-1_000)).toBe(0);
    expect(councilEnrichLimit(Number.NaN)).toBe(0);
  });

  it("üst sınırı aşmaz", () => {
    expect(councilEnrichLimit(10 * 60_000)).toBe(8);
    expect(councilEnrichLimit(10 * 60_000, 3)).toBe(3);
  });
});

describe("councilEnrichCallMs (sıradaki karne turunun bütçesi)", () => {
  // REGRESYON: hat, kaç karne sığdığını bir kez hesaplayıp çağrı başına 90 sn
  // izin veriyor, üstelik bütçeyi alt sınır olan 62 sn'ye YÜKSELTİYORDU. Kalan
  // süre 20 sn iken bile 62 sn'lik tur başlıyor ve uçtan uca süre aşılıyordu.
  it("kalan süre tam karneye yetmiyorsa 0 döner — tur hiç başlamaz", () => {
    expect(councilEnrichCallMs(20_000, 10_000)).toBe(0);
    expect(councilEnrichCallMs(70_000, 10_000)).toBe(0);
    expect(councilEnrichCallMs(Number.NaN, 10_000)).toBe(0);
  });

  it("kalan süreye göre kırpılır ve dönüş payını asla yemez", () => {
    // 100 sn kaldı: 100 − 10 (dönüş) − 3 (kuyruk) = 87 sn.
    expect(councilEnrichCallMs(100_000, 10_000)).toBe(87_000);
  });

  it("her durumda üst sınıra saygı duyar ve sözü aşmaz", () => {
    expect(councilEnrichCallMs(500_000, 10_000)).toBe(COUNCIL_ENRICH_BUDGET_MS);
    for (const left of [20_000, 62_000, 100_000, 200_000, 500_000]) {
      const call = councilEnrichCallMs(left, 10_000);
      if (call > 0) {
        expect(call).toBeGreaterThanOrEqual(COUNCIL_ENRICH_MIN_MS);
        expect(call + 10_000).toBeLessThanOrEqual(left);
      }
    }
  });
});

describe("jobPollingPlan", () => {
  it("yoklama penceresi UÇTAN UCA sözdür: 280 sn (tıkla → sonuç)", () => {
    expect(jobPollingPlan()).toEqual({
      pollMaxMs: DISCOVERY_END_TO_END_MS,
      pollIntervalMs: JOB_POLL_INTERVAL_MS,
    });
    expect(jobPollingPlan().pollMaxMs).toBe(280_000);
    expect(JOB_POLL_INTERVAL_MS).toBe(2_000);
    // Pencere işi her zaman kapsamalı: işçi bütçesi + dönüş payı > söz olamaz.
    expect(jobPollingPlan().pollMaxMs).toBeGreaterThanOrEqual(
      workerBudgetMs() + DISCOVERY_RETURN_MARGIN_MS,
    );
    expect(DISCOVERY_MAX_BUDGET_MS).toBe(DISCOVERY_END_TO_END_MS - DISCOVERY_RETURN_MARGIN_MS);
  });

  it("Render'da eski 892 sn bekleme kalktı: pencere uçtan uca 280 sn", () => {
    vi.stubEnv("NITRO_PRESET", "render_com");
    const plan = jobPollingPlan();
    expect(plan.pollMaxMs).toBe(280_000);
    // İş 260 sn'de bittiği için kullanıcı 14 dakika boşuna beklemez...
    expect(plan.pollMaxMs).toBeLessThan(400_000);
    // ...ama yoklama iş bütçesinden uzun olmalı ki sonuç yazılmadan pes etmesin.
    expect(plan.pollMaxMs).toBeGreaterThan(workerBudgetMs());
  });

  it("uzak worker tanımlı olsa bile pencere uçtan uca söze göre kalır", () => {
    vi.stubEnv("WORKER_URL", "https://aroless.onrender.com");
    expect(jobPollingPlan().pollMaxMs).toBe(280_000);
  });
});

describe("qstashTimeoutSeconds", () => {
  it("stays inside the Vercel limit by default", () => {
    expect(qstashTimeoutSeconds()).toBe(298);
  });

  it("uses 890s on Render", () => {
    vi.stubEnv("NITRO_PRESET", "render_com");
    expect(qstashTimeoutSeconds()).toBe(890);
  });

  it("follows the worker when only DISCOVERY_WORKER_URL is set (hybrid setup)", () => {
    vi.stubEnv("DISCOVERY_WORKER_URL", "https://aroless.tech/api/worker");
    expect(workerTargetIsLongLived()).toBe(true);
    // Tetikleyici hâlâ Vercel'de: kendi istek bütçesi Vercel limitine göre kalır...
    expect(functionMaxDurationSeconds()).toBe(300);
    // ...ama QStash işçiye göre beklemeli, yoksa 504 döner.
    expect(qstashTimeoutSeconds()).toBe(890);
  });

  it("accepts an explicit override", () => {
    vi.stubEnv("QSTASH_TIMEOUT_SECONDS", "120");
    expect(qstashTimeoutSeconds()).toBe(120);
  });

  it("clamps the override to 900s and ignores values below 15s", () => {
    vi.stubEnv("QSTASH_TIMEOUT_SECONDS", "5000");
    expect(qstashTimeoutSeconds()).toBe(900);
    vi.stubEnv("QSTASH_TIMEOUT_SECONDS", "5");
    expect(qstashTimeoutSeconds()).toBe(298);
  });
});

// 504'ün kaldırıldığı yer: işin hangi yolla çalışacağı tek karar noktasından
// (dispatch plan) belirlenir. Render'da QStash anahtarı girilmemiş olsa bile iş
// arka plana gider; anahtar girilmemiş bir Vercel kurulumunda ise tek yol vardır.
describe("discoveryDispatchPlan", () => {
  const qstashEnv = { QSTASH_TOKEN: "qs-token", JOB_WORKER_SECRET: "shared-secret" };

  it("QStash anahtarları varsa QStash kullanır", () => {
    expect(discoveryDispatchPlan(qstashEnv)).toBe("qstash");
    expect(discoveryDispatchPlan({ ...qstashEnv, RENDER_SERVICE_ID: "srv-1" })).toBe("qstash");
  });

  it("Render'da QStash yoksa süreç içi arka plan kullanır (504 yok)", () => {
    expect(discoveryDispatchPlan({ RENDER_SERVICE_ID: "srv-1" })).toBe("in-process");
    expect(discoveryDispatchPlan({ NITRO_PRESET: "render_com" })).toBe("in-process");
  });

  it("yalnızca anahtarlardan biri varsa QStash seçilmez", () => {
    expect(discoveryDispatchPlan({ RENDER_SERVICE_ID: "srv-1", QSTASH_TOKEN: "qs" })).toBe(
      "in-process",
    );
  });

  it("Render'da arka plan işi elle kapatılırsa inline'a düşer", () => {
    expect(discoveryDispatchPlan({ RENDER_SERVICE_ID: "srv-1", BACKGROUND_JOBS: "false" })).toBe(
      "inline",
    );
  });

  it("sunucusuz ortamda QStash yoksa inline kalır", () => {
    expect(discoveryDispatchPlan({ VERCEL: "1" })).toBe("inline");
    expect(discoveryDispatchPlan({})).toBe("inline");
  });

  it("RENDER_SERVICE_ID'yi kalıcı servis olarak algılar", () => {
    expect(runsOnLongLivedHost({ RENDER_SERVICE_ID: "srv-1" })).toBe(true);
    expect(runsOnLongLivedHost({ VERCEL: "1" })).toBe(false);
    expect(workerTargetIsLongLived({ DISCOVERY_WORKER_URL: "https://x/api/worker" })).toBe(true);
  });
});

// Ağır işler (AI Konsey vb.) için en iyi yol. Sözleşme: sunucusuz ortamda
// "inline" DÖNMEZ — ya uzak worker'a gider ya da açık hata üretir. Böylece
// 504 yapısal olarak imkânsız hale gelir.
describe("longJobPlan (504 garantisi)", () => {
  const qstashEnv = { QSTASH_TOKEN: "qs-token", JOB_WORKER_SECRET: "shared-secret" };

  it("Render'da süreç içi arka plan kuyruğunu seçer", () => {
    expect(longJobPlan({ RENDER_SERVICE_ID: "srv-1", ...qstashEnv })).toBe("in-process");
    expect(longJobPlan({ NITRO_PRESET: "render_com" })).toBe("in-process");
    expect(longJobPlan({ NITRO_PRESET: "node-server" })).toBe("in-process");
  });

  it("Vercel'de QStash + uzak worker varsa işi worker'a yollar", () => {
    expect(
      longJobPlan({ VERCEL: "1", ...qstashEnv, WORKER_URL: "https://aroless.onrender.com" }),
    ).toBe("qstash-worker");
    expect(
      longJobPlan({
        VERCEL: "1",
        ...qstashEnv,
        DISCOVERY_WORKER_URL: "https://aroless.onrender.com/api/worker",
      }),
    ).toBe("qstash-worker");
  });

  it("Vercel'de worker yoksa 300 sn'lik limite sığdırıp istek İÇİNDE koşar", () => {
    // Hobby'de fonksiyon limiti 300 sn: konsey `fast` profille (245 sn rezerv +
    // 10 sn dönüş payı) aynı istekte tamamlanır. Worker yok diye özelliği
    // kapatmak yerine çalıştırıp zamanında bitirmek doğru davranıştır.
    expect(longJobPlan({ VERCEL: "1" })).toBe("inline");
    // QStash var ama worker adresi yok → işi Render'a gönderemeyiz: yine inline.
    expect(longJobPlan({ VERCEL: "1", ...qstashEnv })).toBe("inline");
    // Worker var ama QStash yok → tetikleyici işi yayınlayamaz: yine inline.
    expect(longJobPlan({ VERCEL: "1", WORKER_URL: "https://aroless.onrender.com" })).toBe("inline");
    // Açıkça 300 sn yazılmış kurulum.
    expect(longJobPlan({ VERCEL: "1", VERCEL_FUNCTION_MAX_DURATION: "300" })).toBe("inline");
  });

  it("fonksiyon limiti 120 sn'nin altındaysa istek içinde koşmaz", () => {
    // Ağır hat bu limite sığmaz: koşmak 504 üretirdi. Hızlı ve açık hata döner.
    expect(longJobPlan({ VERCEL: "1", VERCEL_FUNCTION_MAX_DURATION: "60" })).toBe("unavailable");
    // Geçersiz (10'un altındaki) değer Vercel'in 300 sn varsayılanına düşer
    // → yine inline koşabiliriz (bkz. `platformDurationSeconds`).
    expect(longJobPlan({ VERCEL: "1", VERCEL_FUNCTION_MAX_DURATION: "5" })).toBe("inline");
    expect(inlineHeavyWorkFits({ VERCEL: "1", VERCEL_FUNCTION_MAX_DURATION: "60" })).toBe(false);
    expect(inlineHeavyWorkFits({ VERCEL: "1" })).toBe(true);
  });

  it("yerel geliştirmede inline kalır (istek süresi sınırı yok)", () => {
    expect(longJobPlan({})).toBe("inline");
    expect(longJobPlan(qstashEnv)).toBe("inline");
  });
});

describe("workerJobsUrl", () => {
  it("yolu her zaman /api/jobs yapar", () => {
    expect(workerJobsUrl({ WORKER_URL: "https://aroless.onrender.com/" })).toBe(
      "https://aroless.onrender.com/api/jobs",
    );
    expect(
      workerJobsUrl({ DISCOVERY_WORKER_URL: "https://aroless.onrender.com/api/worker" }),
    ).toBe("https://aroless.onrender.com/api/jobs");
    // WORKER_URL öncelikli.
    expect(
      workerJobsUrl({
        WORKER_URL: "https://worker.onrender.com",
        DISCOVERY_WORKER_URL: "https://other.dev/api/worker",
      }),
    ).toBe("https://worker.onrender.com/api/jobs");
  });

  it("tanımsız veya güvensiz adreste boş döner", () => {
    expect(workerJobsUrl({})).toBe("");
    expect(workerJobsUrl({ WORKER_URL: "http://insecure.local" })).toBe("");
    expect(workerJobsUrl({ WORKER_URL: "bu bir url değil" })).toBe("");
  });
});

describe("remoteWorkerConfigured", () => {
  it("iki değişkenden birini de tanır", () => {
    expect(remoteWorkerConfigured({ WORKER_URL: "https://x.dev" })).toBe(true);
    expect(remoteWorkerConfigured({ DISCOVERY_WORKER_URL: "https://x.dev/api/worker" })).toBe(true);
    expect(remoteWorkerConfigured({})).toBe(false);
  });
});

describe("discoveryStagePlan (280 sn'lik hattın aşama planı)", () => {
  it("dönüş payını her zaman dışarıda bırakır ve bütçesini aşmaz", () => {
    for (const budget of [20_000, 60_000, 130_000, 240_000, 280_000, 900_000]) {
      const plan = discoveryStagePlan(budget);
      expect(plan.returnFloorMs).toBe(DISCOVERY_RETURN_FLOOR_MS);
      expect(plan.usableMs).toBe(Math.max(10_000, budget - DISCOVERY_RETURN_FLOOR_MS));
      // Hiçbir aşama planı bütçesinden büyük olamaz: erken aşamalar + konsey
      // rezervi, kullanılabilir süreyi asla aşmaz.
      expect(
        plan.prepMs + plan.generationMs + plan.verifyReserveMs + plan.councilReserveMs,
      ).toBeLessThanOrEqual(plan.usableMs);
    }
  });

  it("280 sn'de konsey karneye yer AÇIKÇA ayrılır (son aşamalar aç kalmaz)", () => {
    const plan = discoveryStagePlan(DISCOVERY_MAX_BUDGET_MS);
    expect(plan.prepMs).toBeGreaterThan(0);
    expect(plan.generationMs).toBeGreaterThanOrEqual(20_000);
    expect(plan.generationMs).toBeLessThanOrEqual(75_000);
    // Konsey rezervi en az bir karnelik (COUNCIL_ENRICH_MIN_MS) olmalı.
    expect(plan.councilReserveMs).toBeGreaterThanOrEqual(COUNCIL_ENRICH_MIN_MS);
    // Hazırlık + zeminli tur + konsey, dönüş payına dokunmadan sığar.
    expect(plan.prepMs + plan.generationMs + plan.councilReserveMs).toBeLessThan(plan.usableMs);
  });

  it("hızlı profilde (≤75 sn) hazırlık ve konsey atlanır, açı 3'e düşer", () => {
    const plan = discoveryStagePlan(60_000);
    expect(plan.prepMs).toBe(0);
    expect(plan.councilReserveMs).toBe(0);
    expect(plan.councilTargetCount).toBe(0);
    expect(plan.angleCount).toBe(3);
  });

  it("280 sn'de daha çok zeminli açı koşar (paralel olduğu için ek duvar saati yok)", () => {
    expect(discoveryStagePlan(DISCOVERY_MAX_BUDGET_MS).angleCount).toBe(8);
  });

  it("hattın GERÇEK bütçesi (uçtan uca söz − dönüş payı) için aşama sayıları", () => {
    // Üretimde hat `workerBudgetMs()` alır (260 sn); plan bu sayıya göre kurulur.
    expect(workerBudgetMs()).toBe(260_000);
    const plan = discoveryStagePlan(workerBudgetMs());
    expect(plan.budgetMs).toBe(260_000);
    // Bu sayılar hat kalitesinin can alıcı yeridir: değişirse kalite adımları
    // sessizce kısalmış demektir, bu yüzden açıkça sabitlenir.
    expect(plan.usableMs).toBe(250_000);
    // Hazırlık SERİ bir adımdır (zeminli tur ondan sonra başlar): eskiden 40 sn'ye
    // kadar çıkıp ilk AI çağrısını geciktiriyordu. Üst sınır 14 sn; asıl canlı
    // veri `verifyProduct` katmanından gelir, hazırlık onun yerini tutmaz.
    expect(plan.prepMs).toBe(14_000);
    expect(plan.generationMs).toBe(60_000);
    expect(plan.judgePerProductMs).toBe(12_500);
    expect(plan.verifyReserveMs).toBe(15_000);
    expect(plan.councilReserveMs).toBe(75_000);
    // Karne turu EN İYİ 3 ürünle sınırlı: döngü tüm ürünleri gezip bütçenin son
    // saniyesine kadar yakmaz (eskiden "tıkla → sonuç" hep ~4,5 dk oluyordu).
    expect(plan.councilTargetCount).toBe(3);
    // Erken aşamalar + konsey rezervi kullanılabilir sürenin içinde kalır.
    expect(plan.prepMs + plan.generationMs + plan.councilReserveMs).toBe(149_000);
  });

  it("konsey rezervi hedef karne sayısına göre ayrılır ve bütçeye sığar", () => {
    const plan = discoveryStagePlan(workerBudgetMs());
    const beforeCouncil =
      plan.prepMs +
      plan.generationMs +
      batchReserveMs(plan.judgePerProductMs, 6, plan.judgeConcurrency) +
      plan.verifyReserveMs;
    // Konsey öncesi tüm aşamalar + karne rezervi kullanılabilir süreye sığar:
    // hat kendi kendine biter, platform onu kesmez (504 yok).
    expect(beforeCouncil + plan.councilReserveMs).toBeLessThanOrEqual(plan.usableMs);
    // Hedef sayı yükselirse rezerv de yükselir; sayı 3 ile sabitlendi.
    expect(plan.councilReserveMs).toBeGreaterThanOrEqual(COUNCIL_ENRICH_MIN_MS);
  });

  it("gerçekçi zaman çizelgesinde konsey karnesine yer KALIR (ve ölçülen bütçe yeter)", () => {
    const plan = discoveryStagePlan(workerBudgetMs());
    // 6 adaylık tören: hazırlık + zeminli tur + hakem turu + canlı doğrulama
    // düşüldükten sonra konseye kalan süre en az bir karneye yetmeli.
    const judgeNeed = batchReserveMs(plan.judgePerProductMs, 6, plan.judgeConcurrency);
    const leftAtCouncil =
      plan.usableMs - plan.prepMs - plan.generationMs - judgeNeed - plan.verifyReserveMs;
    expect(judgeNeed).toBe(37_500);
    // Karne rezervi (75 sn) zaten ayrıldığı için konseye 123,5 sn kalır.
    expect(leftAtCouncil).toBe(123_500);
    const carnetMs = councilEnrichCallMs(leftAtCouncil, plan.returnFloorMs);
    // Çağrı başına üst sınır 90 sn; kalan süre bunun üstünde olduğu için kırpılır.
    expect(carnetMs).toBe(90_000);
    expect(carnetMs).toBeGreaterThanOrEqual(COUNCIL_ENRICH_MIN_MS);
    // Karne başladığında kalan süreyi AŞMAZ: hat sözünü bozamaz.
    expect(carnetMs + plan.returnFloorMs).toBeLessThanOrEqual(leftAtCouncil);
  });

  it("karne rezervden hızlı biterse süre boşa gitmez; sığmıyorsa hiç başlatılmaz", () => {
    const plan = discoveryStagePlan(workerBudgetMs());
    // İlk karne 20 sn'de bitti (önbellek isabeti) → 80 sn kaldı → ikinci sığar.
    expect(councilEnrichCallMs(100_000 - 20_000, plan.returnFloorMs)).toBe(67_000);
    // 30 sn sürdüyse kalan 70 sn tam karneye (62 sn) yetmez → başlatılmaz.
    expect(councilEnrichCallMs(100_000 - 30_000, plan.returnFloorMs)).toBe(0);
  });
});

describe("280 sn sözü — uçtan uca zaman çizelgesi simülasyonu", () => {
  /**
   * Hattı AŞAMA AŞAMA simüle eder (AI çağrısı yok, saf aritmetik): her aşama en
   * kötü durumda penceresini tam kullanır ve karne turu bütçesini tam harcar.
   * Amaç: hangi senaryoda olursa olsun hat sözünü (280 sn) aşmasın, karne de
   * sığmadığında hiç başlamasın.
   */
  function simulate(products: number, stageMsOverride?: number) {
    const budget = workerBudgetMs();
    const plan = discoveryStagePlan(budget);
    let t = 0;
    if (stageMsOverride === undefined) {
      t += plan.prepMs; // hazırlık (paralel: en yavaş kaynak kadar)
      t += plan.generationMs; // zeminli açı turu (pencere sınırlı)
      t += batchReserveMs(plan.judgePerProductMs, products, plan.judgeConcurrency);
      t += 12_000 + plan.verifyReserveMs; // çapraz eşleşme + canlı doğrulama
    } else {
      t += stageMsOverride;
    }
    const deadline = budget;
    let carnets = 0;
    const failures = 0;
    for (let i = 0; i < products; i++) {
      const carnetMs = councilEnrichCallMs(deadline - t, plan.returnFloorMs);
      const action = councilLoopDecision({ carnetMs, remaining: products - i, failures });
      if (action !== "carnet") break;
      t += carnetMs; // en kötü durum: karne bütçesini tamamen kullanır
      carnets += 1;
    }
    return { t, carnets, plan, budget };
  }

  it("planlı aşamalarla: hattın sonu dönüş tabanını, kullanıcının gördüğü süre 280 sn'yi aşmaz", () => {
    const { t, carnets, plan, budget } = simulate(6);
    expect(carnets).toBeGreaterThanOrEqual(1); // en az bir ürün karne alır
    expect(t).toBeLessThanOrEqual(budget - plan.returnFloorMs);
    // Uçtan uca söz: hat + dönüş payı.
    expect(t + DISCOVERY_RETURN_MARGIN_MS).toBeLessThanOrEqual(DISCOVERY_END_TO_END_MS);
    // İstemci penceresi işi her zaman kapsar (erken pes etmez).
    expect(jobPollingPlan().pollMaxMs).toBeGreaterThanOrEqual(t + DISCOVERY_RETURN_MARGIN_MS);
  });

  it("aşamalar hızlı bittiğinde artan süre karneye dönüşür (2 ürün karne alır)", () => {
    const { carnets, t, budget, plan } = simulate(6, 60_000);
    expect(carnets).toBe(2);
    expect(t).toBeLessThanOrEqual(budget - plan.returnFloorMs);
  });

  it("süre yetersizse karne HİÇ başlatılmaz (yarım karne üretilmez, söz aşılmaz)", () => {
    // Aşamalar 200 sn sürdü → kalan 60 sn, tam karne (62 sn) sığmaz.
    const { carnets, t } = simulate(6, 200_000);
    expect(carnets).toBe(0);
    expect(t).toBe(200_000);
  });

  it("ürün sayısı artse bile hat sözü bozulmaz", () => {
    for (const products of [1, 3, 6, 8]) {
      const { t, plan, budget } = simulate(products);
      expect(t).toBeLessThanOrEqual(budget - plan.returnFloorMs);
      expect(t + DISCOVERY_RETURN_MARGIN_MS).toBeLessThanOrEqual(DISCOVERY_END_TO_END_MS);
    }
  });
});

describe("councilLoopDecision (karne döngüsünün durma koşulları)", () => {
  it("süre ve bütçe varsa karneye devam eder", () => {
    expect(councilLoopDecision({ carnetMs: 87_000, remaining: 4, failures: 0 })).toBe("carnet");
    expect(councilLoopDecision({ carnetMs: 62_000, remaining: 1, failures: 1 })).toBe("carnet");
  });

  it("kalan süre tam karneye yetmiyorsa durur (yarım karne üretilmez)", () => {
    expect(councilLoopDecision({ carnetMs: 0, remaining: 3, failures: 0 })).toBe("stop-time");
  });

  it("motorlar üst üste susarsa kalan süreyi yakmaz", () => {
    expect(councilLoopDecision({ carnetMs: 87_000, remaining: 3, failures: 2 })).toBe(
      "stop-failures",
    );
    expect(councilLoopDecision({ carnetMs: 87_000, remaining: 3, failures: 1 })).toBe("carnet");
  });

  it("karnesi olmayan ürün kalmadıysa döngü biter", () => {
    expect(councilLoopDecision({ carnetMs: 87_000, remaining: 0, failures: 0 })).toBe("done");
  });
});

describe("batchReserveMs (ürün sayısına göre aşama süresi)", () => {
  it("paralelliğe göre beklenen duvar saatini verir", () => {
    expect(batchReserveMs(10_000, 5, 2)).toBe(30_000);
    expect(batchReserveMs(10_000, 1, 2)).toBe(10_000);
    expect(batchReserveMs(10_000, 6, 3)).toBe(20_000);
  });

  it("boş listede sıfır döner (aşama hiç başlamaz)", () => {
    expect(batchReserveMs(10_000, 0, 2)).toBe(0);
  });
});

/**
 * Arka plan yolu kurulamadığında Find Winners hata döndürmemeli: Vercel Hobby
 * 300 sn verir, hat 260 sn'de biter ve dönüş payına 20 sn kalır — yani istek
 * içinde koşmak platform duvarının altında kalır.
 */
describe("arka plan yolu düşerse ürün bulucu istek içinde koşar", () => {
  it("yol kurulduysa arka plan tercih edilir", () => {
    expect(discoveryFallbackDecision({ backgroundStarted: true, platformFits: false })).toBe(
      "background",
    );
  });

  it("yol düştü ama platform limiti yetiyorsa istek içinde koşar (hata değil)", () => {
    expect(discoveryFallbackDecision({ backgroundStarted: false, platformFits: true })).toBe(
      "inline",
    );
  });

  it("limit ağır hatta yetmiyorsa açık hata döner (kredi harcanmadan)", () => {
    expect(discoveryFallbackDecision({ backgroundStarted: false, platformFits: false })).toBe(
      "error",
    );
  });

  it("Vercel Hobby (300 sn) istek içi koşmaya yeter, 60 sn yetmez", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_FUNCTION_MAX_DURATION", "300");
    expect(discoveryFallbackDecision({ backgroundStarted: false })).toBe("inline");
    vi.stubEnv("VERCEL_FUNCTION_MAX_DURATION", "60");
    expect(discoveryFallbackDecision({ backgroundStarted: false })).toBe("error");
  });
});
