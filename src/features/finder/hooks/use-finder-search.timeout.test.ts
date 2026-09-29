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

  it("yoklama döngüsü terminal duruma kadar SÜRER (sabit tavanla ölmez)", async () => {
    const src = await read(HOOK);
    // Ön plan bittiğinde iş "ölmez": yavaşlayan yoklama sürer, terminal durumda
    // sonuç teslim edilir. Kullanıcı yalnız bilgilendirilir.
    expect(src).toContain("PIPELINE_BACKGROUND_WAIT_MS");
    // ÖLÇÜLEN HATA: döngü 520 sn'de "still-running" dönüp KAPANIYORDU. Ekranda
    // dönen "çalışıyor" yazısı yarım saat görünürken yoklama çoktan ölmüştü
    // ve QStash teslimatı takılırsa "bayat satırı devral" mekanizması hiç
    // çalışmıyordu. Döngü artık yalnız çok uzak bir tavana kadar sürer ve
    // o tavanı aşınca da sessizce ölmek yerine GERÇEK SEBEP yazar.
    expect(src).toContain("PIPELINE_HARD_CAP_MS");
    expect(src).not.toContain('reason: "still-running", paid: true');
    expect(src).toContain('state.error ?? "pipeline_stalled"');
  });

  it("koşu kimliği kalıcıdır: sayfa yenilenince sonuç ekrana döner", async () => {
    const src = await read(HOOK);
    // "Sayfayı kapatıp geri dön" mesajı ancak runId saklanıyorsa tutar.
    // Önceden runId yalnız yerel değişkendi: döngü bitince ya da sayfa
    // kapanınca kayboluyor, dönüşte ne ürün ne hata görünüyordu.
    expect(src).toContain("ACTIVE_RUN_KEY");
    expect(src).toContain("writeStoredRun");
    expect(src).toContain("readStoredRun");
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

/**
 * HATIN GERÇEK HATASI SAKLANMAZ.
 *
 * Ölçülen hata: iş `failed` olduğunda `fallback: true` dönüyordu, yani kullanıcı
 * sunucudaki hatayı hiç görmeden ikinci bir tam aramayı (klasik hat, 280 sn)
 * izliyordu; o da bittiğinde ekranda yalnız "zaman aşımına uğradı" yazıyordu.
 * Gerçek sebep — ne olursa olsun — ekrana hiç ulaşmıyordu.
 */
describe("sessiz ölüm kapatılır: takılan koşu dürüstçe başarısız olur", () => {
  it("sunucu watchdog'u ilerleme yoksa işi failed yapar", async () => {
    const src = await read("src/lib/product-discovery.functions.ts");
    // Ölçülen belirti: satır `processing`e KALICI takılıyordu (QStash
    // teslimatı 401 alır, yeniden denemeler biter, adım sonrakini
    // yayınlamaz). Ne completed ne failed olduğu için kullanıcı ekranda
    // "çalışıyor" yazısını YARIM SAAT gördü ve mesaj hiç değişmedi.
    expect(src).toContain("STALLED_RUN_ABANDON_MS");
    expect(src).toContain("stalled_no_carrier");
    // Kredi de bir kez iade edilmeli: kullanıcı ürün de alamadı.
    expect(src).toContain("failAndRefund");
  });

  it("sessiz ölüm kullanıcıya anlaşılır sebep olarak yazılır", async () => {
    const src = await read("src/features/finder/utils/discovery-result.ts");
    expect(src).toContain("stalled_no_carrier");
    expect(src).toContain("Kredin iade edildi");
  });
});


describe("gerçek hat durumunda klasik hat devreye girmez", () => {
  it("başarısız iş `fallback: false` döner", async () => {
    const src = await read(HOOK);
    const failedAt = src.indexOf('state.status === "failed"');
    expect(failedAt).toBeGreaterThan(-1);
    const branch = src.slice(failedAt, failedAt + 1400);
    expect(branch).toContain("fallback: false");
    expect(branch).toContain("state.error ?? \"pipeline_failed\"");
  });

  it("boş sonuç da ikinci bir aramayı tetiklemez", async () => {
    const src = await read(HOOK);
    const emptyAt = src.indexOf('reason: "empty_result"');
    expect(emptyAt).toBeGreaterThan(-1);
    expect(src.slice(emptyAt - 120, emptyAt + 40)).toContain("fallback: false");
  });

  it("klasik hat YALNIZ altyapı hatasında devreye girer", async () => {
    const src = await read(HOOK);
    // Yapısal kontrol: `gen.mutate(vars)` çağrısı, `!outcome.fallback` ve
    // `still-running` dallarının ALTINDA olmalı — yani gerçek hat hatası
    // klasik hatta asla düşmez.
    const genAt = src.indexOf("gen.mutate(vars)");
    const failedGuardAt = src.indexOf("if (!outcome.fallback)");
    const stillRunningAt = src.indexOf('outcome.reason === "still-running"');
    expect(genAt).toBeGreaterThan(-1);
    expect(failedGuardAt).toBeGreaterThan(-1);
    expect(stillRunningAt).toBeGreaterThan(-1);
    expect(failedGuardAt).toBeLessThan(stillRunningAt);
    expect(stillRunningAt).toBeLessThan(genAt);
  });

  it("gerçek hata kullanıcıya Türkçe sebep olarak yazılır", async () => {
    const src = await read(HOOK);
    expect(src).toContain("describeDiscoveryFailure(outcome.reason)");
    expect(src).toContain("Arama motoru çalışamadı");
  });
});
