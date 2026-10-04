// ============================================================================
// MODEL YÖNLENDİRME TESTLERİ — saf, ağ YOK.
//
// KAPSAM: kullanıcının sağladığı yeni model ailesinin doğru merdivenlere
// girdiğini ve eski yedeklerin ATILMADIĞINI sabitler. Kalite sıralaması
// burada test EDİLEMEZ (ölçüm gerektirir); test edilebilir olan SÖZLEŞMEDİR:
// tekrarlı slug yok, hepsi OpenRouter biçiminde, alt merdivenler üst
// merdivenin alt kümesi, her modelin gerekçesi yazılı.
// ============================================================================

import { describe, expect, it } from "vitest";

import {
  MODEL_ROUTING_NOTES,
  OPENROUTER_MODELS_BY_TASK,
  OPENROUTER_MODELS_LATEST,
} from "./ai.server";

/** OpenRouter slug biçimi: `sağlayıcı/model` (ücretsiz varyantta `:free` olabilir). */
const SLUG = /^[a-z0-9-]+\/[a-z0-9.:-]+$/;

describe("OpenRouter model merdiveni", () => {
  it("kullanıcının sağladığı altı modelin hepsini içerir", () => {
    // Kullanıcı listesi (2026-10-03): deepseek-v4.1-flash, glm-5.3,
    // deepseek-v4-flash, mimo-v2.6-pro, qwen3.8-flash-next, gemma-4-31b.
    for (const fragment of [
      "deepseek-v4.1-flash",
      "glm-5.3",
      "deepseek-v4-flash",
      "mimo-v2.6-pro",
      "qwen3.8-flash",
      "gemma-4-31b",
    ]) {
      expect(OPENROUTER_MODELS_LATEST.some((m) => m.includes(fragment))).toBe(true);
    }
  });

  it("tüm slug'lar OpenRouter biçiminde ve tekrarsız", () => {
    for (const model of OPENROUTER_MODELS_LATEST) expect(model).toMatch(SLUG);
    expect(new Set(OPENROUTER_MODELS_LATEST).size).toBe(OPENROUTER_MODELS_LATEST.length);
  });

  it("ESKİ modelleri yedek olarak atmaz (hat asla boş dönmez)", () => {
    expect(OPENROUTER_MODELS_LATEST).toContain("google/gemini-2.0-flash-001");
    expect(OPENROUTER_MODELS_LATEST).toContain("meta-llama/llama-3.3-70b-instruct");
  });
});

describe("görev bazlı merdivenler", () => {
  it("sweep ve deep merdivenleri tam merdivenin alt kümesidir", () => {
    const all = new Set(OPENROUTER_MODELS_LATEST);
    for (const task of ["sweep", "deep"] as const) {
      for (const model of OPENROUTER_MODELS_BY_TASK[task]) {
        expect(all.has(model)).toBe(true);
      }
    }
  });

  it("hiçbir merdiven boş değil (boş merdiven o yolu sustukça kapatırdı)", () => {
    for (const task of ["sweep", "deep"] as const) {
      expect(OPENROUTER_MODELS_BY_TASK[task].length).toBeGreaterThan(0);
    }
  });

  it("her yeni modelin NEDEN seçildiği yazılı — temelsiz model eklenmez", () => {
    for (const model of OPENROUTER_MODELS_LATEST) {
      if (model.startsWith("google/gemini-") || model.startsWith("meta-llama/")) continue;
      expect(MODEL_ROUTING_NOTES[model]).toBeTruthy();
    }
  });

  it("sweep ucuz/hızlı, deep güçlü modelle başlar", () => {
    expect(OPENROUTER_MODELS_BY_TASK.sweep[0]).toBe("qwen/qwen3.8-flash");
    expect(OPENROUTER_MODELS_BY_TASK.deep[0]).toBe("z-ai/glm-5.3");
  });
});