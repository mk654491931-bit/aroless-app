import { describe, expect, it } from "vitest";

import { discoveryRunnerMode, MIN_STEP_BUDGET_MS } from "./product-discovery-runner.server";

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
