import { describe, expect, it } from "vitest";

import {
  clientDrivesChain,
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

  it("İMZA anahtarı yoksa QStash'i 'çalışıyor' SAYMAZ", () => {
    // Ölçülen hata: token + worker sırrı varken adım ucu her teslimatı (doğru
    // biçimde) 401 ile reddediyordu; yani kuyruk "kurulu" görünüyor ama iş
    // hiçbir zaman koşmuyordu. İmza anahtarı olmadan QStash yolu SEÇİLMEZ.
    expect(
      discoveryRunnerMode({
        QSTASH_TOKEN: "tok",
        JOB_WORKER_SECRET: "secret",
        NITRO_PRESET: "vercel",
      }),
    ).toBe("inline");
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
