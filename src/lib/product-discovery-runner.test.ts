import { describe, expect, it } from "vitest";

import {
  clientDrivesChain,
  DISCOVERY_HEARTBEAT_MS,
  discoveryChainHealth,
  discoveryRunnerMode,
  MIN_STEP_BUDGET_MS,
  STALE_STEP_TAKEOVER_MS,
} from "./product-discovery-runner.server";

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
    expect(discoveryRunnerMode({ NITRO_PRESET: "render_com" })).toBe("in-process");
  });

  it("hiçbiri yoksa istek içi (istemci yoklamalı) yola düşer", () => {
    expect(discoveryRunnerMode({})).toBe("inline");
  });

  it("arka plan işleri kapatılmışsa süreç içi yolu seçmez", () => {
    expect(discoveryRunnerMode({ NITRO_PRESET: "render_com", BACKGROUND_JOBS: "false" })).toBe(
      "inline",
    );
  });
});

describe("adım bütçesi eşiği", () => {
  it("bir adımı başlatmak için anlamlı bir alt sınır vardır", () => {
    // Bu eşiğin altında adım başlatılmaz: yarıda kesilen bir adım, adımın
    // "çalışıyor" işaretinde kalmasına ve sürücünün onu devralmak zorunda
    // kalmasına yol açardı.
    expect(MIN_STEP_BUDGET_MS).toBeGreaterThanOrEqual(10_000);
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

  it("devralma eşiği yine de mevcut sözleşmeyi korur", () => {
    // Kalp atışı eşiği DEĞİŞTİRMEZ; yalnızca satırı taze tutar.
    expect(STALE_STEP_TAKEOVER_MS).toBe(90_000);
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
