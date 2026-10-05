import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  claimDiscoveryStep,
  clientDrivesChain,
  DISCOVERY_HEARTBEAT_MS,
  discoveryChainHealth,
  discoveryRunnerMode,
  MIN_SLICE_BUDGET_MS,
  STALE_STEP_TAKEOVER_MS,
} from "./product-discovery-runner.server";

/**
 * SAHİPLENME TESTİ İÇİN SAHTE DEPO.
 *
 * `claimDiscoveryStep` tek gerçek karar noktasıdır: hangi adımın koşacağını
 * o belirler. Bu yüzden veritabanı katmanı taklit edilip KARARIN kendisi
 * sınanır; ağ çağrısı yapılmaz.
 */
const jobsMock = vi.hoisted(() => ({
  readDiscoveryJob: vi.fn(),
  readDiscoveryCheckpoint: vi.fn(),
  advanceDiscoveryStatus: vi.fn(),
  saveDiscoveryCheckpoint: vi.fn(),
  touchDiscoveryRun: vi.fn(),
  failAndRefund: vi.fn(),
  finishDiscoveryJob: vi.fn(),
  writeDiscoveryProgress: vi.fn(),
}));

vi.mock("./product-discovery-jobs.server", () => jobsMock);

/** Ölçülen iş satırının varsayılanı: `deep` koşuyor, satır TAZE. */
function jobRecord(over: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    userId: "user-1",
    status: "processing",
    discoveryStatus: "deep_analysis",
    discoveryProgress: 90,
    discoveryStep: "deep",
    chargedCredits: 1,
    stats: null,
    error: null,
    updatedAt: Date.now(),
    ...over,
  };
}

function checkpoint(done: string[]) {
  return { v: 1 as const, done, shortlist: [], votes: [] };
}

/**
 * SÜRÜCÜ SEÇİMİ SÖZLEŞMESİ.
 *
 * Bu testler, canlıda görülen "14 ajan çalışmıyor" hatasının YAPISAL nedenini
 * kilitler: zincir tek bir taşıyıcıya (QStash) bağlıydı ve anahtarlardan biri
 * eksikse hat sessizce ölüyordu. Artık her kurulum bir taşıyıcı bulur.
 */
describe("discoveryRunnerMode", () => {
  it("üç anahtar da TAM ise QStash yolunu seçer", () => {
    expect(
      discoveryRunnerMode({
        QSTASH_TOKEN: "tok",
        JOB_WORKER_SECRET: "secret",
        QSTASH_CURRENT_SIGNING_KEY: "sig",
      }),
    ).toBe("qstash");
  });

  it("İMZA anahtarı olmasa da token + işçi sırrı yeterlidir", () => {
    // Ölçülen hata: üçüncü anahtar (QSTASH_CURRENT_SIGNING_KEY) şart koşulduğu
    // için iki anahtarlı kurulumlarda kuyruk "kurulu" görünüyor ama her teslimat
    // 401 alıyor ve iş hiç ilerlemiyordu. Artık adım ucu yayıncının ilettiği
    // `x-job-secret` başlığını da kabul ettiği için iki anahtar YETERLİDİR.
    expect(
      discoveryRunnerMode({
        QSTASH_TOKEN: "tok",
        JOB_WORKER_SECRET: "secret",
        NITRO_PRESET: "vercel",
      }),
    ).toBe("qstash");
  });

  it("kalıcı süreçte QStash olmadan süreç içi arka planı seçer", () => {
    expect(discoveryRunnerMode({ NITRO_PRESET: "node-server" })).toBe("in-process");
  });

  it("hiçbiri yoksa istek içi (istemci yoklamalı) yola düşer", () => {
    expect(discoveryRunnerMode({})).toBe("inline");
  });

  it("arka plan işleri kapatılmışsa süreç içi yolu seçmez", () => {
    expect(discoveryRunnerMode({ NITRO_PRESET: "node-server", BACKGROUND_JOBS: "false" })).toBe(
      "inline",
    );
  });
});

describe("dilim bütçesi eşiği", () => {
  it("bir DİLİMİ başlatmak için anlamlı bir alt sınır vardır", () => {
    // Eskiden 25 sn'lik ADIM eşiği vardı çünkü bir adım tek istekte koşuyordu.
    // İş artık dilimlere bölündüğü için kapı küçüldü: bir dilim kadar süre
    // kaldıysa adım başlar, yetmiyorsa dürüstçe durur (ilerleme ara noktada).
    expect(MIN_SLICE_BUDGET_MS).toBeGreaterThanOrEqual(3_000);
    expect(MIN_SLICE_BUDGET_MS).toBeLessThan(10_000);
  });
});

/**
 * KİM SAHİPLENİR — QStash kurulu iken yoklama ADIM ÇALISTIRMAZ.
 *
 * Ölçülen hata: yoklama isteği her koşulda zinciri sürdürüyordu. Kuyruğa
 * yayınlanan adım tarayıcının isteği içinde önce sahiplenildiği için ağır iş
 * yine tek HTTP isteğinde koşuyor, istek platform tavanına dayanıyor ve
 * kullanıcı "Arka plan analizi zaman aşımına uğradı" kartını görüyordu.
 * Kuyruk kurmanın var oluş sebebi tam olarak bu işi taşımamaktı.
 */
/**
 * ÖLÜ ADIM KİLİTLENMESİN — KALP ATIŞI SÖZLEŞMESİ.
 *
 * Ölçülen hata (ikinci kaynak): `final` adımı çalışırken durumu DEĞİŞMEZ
 * (`deep_analysis` → `deep_analysis`), dolayısıyla `updated_at` hiç yenilenmiyordu.
 * Adım platform tarafından ortasında kesilirse satır "çalışıyor" görünür ama
 * ölü kalıyordu: `clientDrivesChain` onu taze sayıp devralmıyor, watchdog
 * tetiklenmiyor, iş `processing`e sonsuza kadar kilitleniyordu. Kullanıcı
 * ekranda "Analiz sunucuda çalışmaya devam ediyor" yazısını yarım saat gördü.
 */
describe("calisan adım canlı görünür (sessiz kilitlenme kapatılır)", () => {
  it("kalp atışı, devralma eşiğinden KISA aralıklarla gelir", () => {
    // Çok sık olursa devralma hiç çalışmaz (ölü sürücü canlı sanılır).
    // Çok seyrek olursa çalışan adım bayat sanılır (iş ikiye katlanır).
    expect(DISCOVERY_HEARTBEAT_MS).toBeLessThan(STALE_STEP_TAKEOVER_MS);
    // Ve eşiğin çok altında: iki atış arasında güvenli marj kalsın.
    expect(DISCOVERY_HEARTBEAT_MS).toBeLessThanOrEqual(Math.floor(STALE_STEP_TAKEOVER_MS / 2));
  });

  it("devralma eşiği kurtarma gecikmesini 300 sn sözünün altında tutar", () => {
    // Eşik aynı zamanda kurtarma gecikmesidir: QStash teslimatı düşerse zinciri
    // tarayıcı bu süre sonra devralır. 90 sn idi; 2-3 kesintide toplam süre
    // 300 sn'yi aşıyordu. Kalp atışı aralığının (20 sn) üç katı yarışı hâlâ
    // imkânsız kılar ama kurtarmayı hızlandırır.
    expect(STALE_STEP_TAKEOVER_MS).toBe(60_000);
  });

  it("ölü sürücü bıraktığı satır YİNE DE devralınabilir", () => {
    // Kalp atışı durduğunda `updated_at` bayatlar → yoklama devralır.
    // Ölçülen hata bu yolun `final`de hiç işlemediğiydi.
    const now = 1_000_000;
    expect(clientDrivesChain("qstash", now - STALE_STEP_TAKEOVER_MS - 1, now)).toBe(true);
  });
});

describe("clientDrivesChain", () => {
  const now = 1_000_000;

  it("qstash kurulu ve hat taze yazıyorsa YOKLAMA yalnız izler", () => {
    expect(clientDrivesChain("qstash", now - 2_000, now)).toBe(false);
  });

  it("qstash kurulu ve hat bayatladiysa YOKLAMA devralır", () => {
    // Kuyruk sessizce öldüyse (publish başarısız, teslimat düştü) iş bırakılmaz.
    expect(clientDrivesChain("qstash", now - STALE_STEP_TAKEOVER_MS - 1, now)).toBe(true);
  });

  it("satır zamanı okunamadıysa yoklama devralır", () => {
    // Kanıt yoksa işi bırakmaktansa sürdürmek dürüst olanı yapar.
    expect(clientDrivesChain("qstash", null, now)).toBe(true);
  });

  it("kuyruk kurulu DEĞİLSE yoklama sürücüdür (mevcut davranış)", () => {
    expect(clientDrivesChain("inline", now - 1_000, now)).toBe(true);
    expect(clientDrivesChain("in-process", now - 1_000, now)).toBe(true);
  });

  it("eşik tam olarak STALE_STEP_TAKEOVER_MS'de dönüşür", () => {
    expect(clientDrivesChain("qstash", now - STALE_STEP_TAKEOVER_MS, now)).toBe(true);
    expect(clientDrivesChain("qstash", now - STALE_STEP_TAKEOVER_MS + 1, now)).toBe(false);
  });
});

/**
 * TEŞHİS — /health artık hangi anahtarın eksik olduğunu SÖYLER.
 *
 * Ölçülen hata: `/health` iki ayrı hesaplayıcı kullanıyordu. Biri token + sır
 * arayıp "qstash" diyor, diğeri (zincirin kendisi) üçüncü anahtarı da
 * istiyordu. Panel "qstash" derken hat `inline` çalışıyor, kullanıcı ise
 * zaman aşımı görüyordu. Sessiz çelişki teşhisi imkânsız kılıyordu.
 */
/**
 * `final` KİLİDİ — "300 saniyeden fazla dönüyor" BELİRTİSİNİN KÖKÜ.
 *
 * Ölçülen hata: `final`ın durumu `deep` ile AYNI (`deep_analysis`) olduğu ve
 * `deep` bittiğinde satır taze kaldığı için QStash teslimatı "başka biri
 * koşuyor" sanılıp yutuluyordu. Adım ucu 200 döndüğü için QStash yeniden
 * denemiyor; son adım ancak satır 90 sn sonra bayatlayınca istemci devralınca
 * koşuyordu. Bu testler kilidin artık SATIRIN YAŞINA değil ARA NOKTAYA
 * baktığını kilitler.
 */
describe("final adımının kilidi (sıradaki adım bekletilmez)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobsMock.readDiscoveryCheckpoint.mockResolvedValue(null);
  });

  it("deep BİTER BİTMEZ final HEMEN sahiplenilir (taze satır engel değildir)", async () => {
    jobsMock.readDiscoveryJob.mockResolvedValue(jobRecord({ updatedAt: Date.now() }));
    jobsMock.advanceDiscoveryStatus.mockResolvedValue(true);

    const claim = await claimDiscoveryStep(
      "run-1",
      "final",
      checkpoint(["scrape_filter", "gemini", "deep"]),
    );

    expect(claim.state).toBe("claimed");
    // Kilit `deep_analysis → deep_analysis` KENDİNE geçişiyle alınır.
    expect(jobsMock.advanceDiscoveryStatus).toHaveBeenCalledWith(
      expect.objectContaining({ from: "deep_analysis", to: "deep_analysis", step: "final" }),
    );
  });

  it("deep HENÜZ BİTMEDİYSE final beklemede kalır (sıra bozulmaz)", async () => {
    jobsMock.readDiscoveryJob.mockResolvedValue(jobRecord());

    const claim = await claimDiscoveryStep(
      "run-1",
      "final",
      checkpoint(["scrape_filter", "gemini"]),
    );

    expect(claim.state).toBe("in-progress");
    expect(jobsMock.advanceDiscoveryStatus).not.toHaveBeenCalled();
  });

  it("ara nokta çağırandan gelmediyse burada okunur", async () => {
    jobsMock.readDiscoveryJob.mockResolvedValue(jobRecord());
    jobsMock.readDiscoveryCheckpoint.mockResolvedValue(
      checkpoint(["scrape_filter", "gemini", "deep"]),
    );
    jobsMock.advanceDiscoveryStatus.mockResolvedValue(true);

    const claim = await claimDiscoveryStep("run-1", "final");

    expect(jobsMock.readDiscoveryCheckpoint).toHaveBeenCalledWith("run-1");
    expect(claim.state).toBe("claimed");
  });

  it("çalışan `deep` taze satırda ÇALINMAZ (pahalı adım ikiye katlanmaz)", async () => {
    jobsMock.readDiscoveryJob.mockResolvedValue(jobRecord({ updatedAt: Date.now() }));

    const claim = await claimDiscoveryStep(
      "run-1",
      "deep",
      checkpoint(["scrape_filter", "gemini"]),
    );

    expect(claim.state).toBe("in-progress");
    expect(jobsMock.advanceDiscoveryStatus).not.toHaveBeenCalled();
  });

  it("ÖLÜ `deep` bayat satırda KENDİNE GEÇİŞLE devralınır (geri alma yok)", async () => {
    // Ölçülen hata: eski kod `deep_analysis → gemini_shortlist` geri geçişini
    // deniyordu; bu geçiş durum makinesinde TANIMLI OLMADIĞI için
    // `canTransition` reddediyor ve ölü adım 20 dakikalık watchdog'a kadar
    // kurtarılamıyordu. Kilit artık TEK bir kendine geçişle tazelenir.
    jobsMock.readDiscoveryJob.mockResolvedValue(
      jobRecord({ updatedAt: Date.now() - STALE_STEP_TAKEOVER_MS - 1 }),
    );
    jobsMock.advanceDiscoveryStatus.mockResolvedValue(true);

    const claim = await claimDiscoveryStep(
      "run-1",
      "deep",
      checkpoint(["scrape_filter", "gemini"]),
    );

    expect(claim.state).toBe("claimed");
    expect(jobsMock.advanceDiscoveryStatus).toHaveBeenCalledTimes(1);
    expect(jobsMock.advanceDiscoveryStatus).toHaveBeenCalledWith(
      expect.objectContaining({ from: "deep_analysis", to: "deep_analysis", step: "deep" }),
    );
  });

  it("ÖLÜ `gemini` de aynı yol ile devralınır", async () => {
    jobsMock.readDiscoveryJob.mockResolvedValue(
      jobRecord({
        discoveryStatus: "gemini_shortlist",
        discoveryStep: "gemini",
        updatedAt: Date.now() - STALE_STEP_TAKEOVER_MS - 1,
      }),
    );
    jobsMock.advanceDiscoveryStatus.mockResolvedValue(true);

    const claim = await claimDiscoveryStep("run-1", "gemini", checkpoint(["scrape_filter"]));

    expect(claim.state).toBe("claimed");
    expect(jobsMock.advanceDiscoveryStatus).toHaveBeenCalledWith(
      expect.objectContaining({ from: "gemini_shortlist", to: "gemini_shortlist" }),
    );
  });

  it("iş terminal ise adım hiç sahiplenilmez", async () => {
    jobsMock.readDiscoveryJob.mockResolvedValue(jobRecord({ status: "completed" }));

    const claim = await claimDiscoveryStep(
      "run-1",
      "final",
      checkpoint(["scrape_filter", "gemini", "deep"]),
    );

    expect(claim.state).toBe("terminal");
    expect(jobsMock.advanceDiscoveryStatus).not.toHaveBeenCalled();
  });
});

describe("discoveryChainHealth", () => {
  it("üç anahtar da tam ise qstash ve eksik yok", () => {
    const health = discoveryChainHealth({
      QSTASH_TOKEN: "tok",
      JOB_WORKER_SECRET: "secret",
      QSTASH_CURRENT_SIGNING_KEY: "sig",
    } as never);
    expect(health.mode).toBe("qstash");
    expect(health.missing).toEqual([]);
  });

  it("İMZA anahtarı eksik olsa da hat qstash'a düşer (ikinci kabul yolu)", () => {
    const health = discoveryChainHealth({
      QSTASH_TOKEN: "tok",
      JOB_WORKER_SECRET: "secret",
    } as never);
    // Yayıncı `x-job-secret` başlığını zaten iletiyor; teslimat imzasız da
    // olsa doğrulanabilir. Eksik anahtar listelenmez.
    expect(health.mode).toBe("qstash");
    expect(health.missing).toEqual([]);
  });

  it("hiçbir anahtar yoksa ZORUNLU ikisini de listeler", () => {
    const health = discoveryChainHealth({} as never);
    expect(health.missing).toEqual(["QSTASH_TOKEN", "JOB_WORKER_SECRET"]);
  });

  it("eksik anahtar ADLARI döner, DEĞERLERİ asla", () => {
    // Sır sızdıran bir teşhis kabul edilemez.
    const health = discoveryChainHealth({
      QSTASH_TOKEN: "tok-gizli",
      JOB_WORKER_SECRET: "sir-gizli",
    } as never);
    expect(JSON.stringify(health)).not.toContain("gizli");
  });
});
