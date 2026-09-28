/**
 * MOTOR SEÇİCİ — TEK SEÇENEK.
 *
 * Kilitlenen davranış: seçici yalnız "Default AI" sunar ve tarayıcıda kalmış
 * eski bir seçim kalıcı bir hata olmaz, kendiliğinden "default"a iner. Bu, HF
 * motorları kaldırıldıktan sonra kullanıcının ürün aramayı yanlış yola
 * düşmesini engelleyen şeydir.
 */
import { describe, expect, it } from "vitest";

import { ACTIVE_ENGINE_IDS, ENGINES, engineLabel, normalizeEngineId } from "./engines";

describe("motor seçici", () => {
  it("yalnız Default AI sunar", () => {
    expect(ENGINES).toHaveLength(1);
    expect(ENGINES[0]!.id).toBe("default");
    expect(ACTIVE_ENGINE_IDS).toEqual(["default"]);
  });

  it("Default AI'ın etiketi Gemini önceliğini söyler", () => {
    // Arayüzde "Gemini hybrid" yazması, gerçekte havuz yedeği de olduğu
    // anlamına gelirdi; metin gerçeği anlatmalı.
    expect(ENGINES[0]!.label).toBe("Default AI");
    expect(`${ENGINES[0]!.hint} ${ENGINES[0]!.model}`).toContain("Gemini");
  });

  it("eskimiş seçimler 'default'a normalleşir", () => {
    for (const legacy of ["qwen", "llama", "hybrid", "bilinmeyen", "", null, undefined]) {
      expect(normalizeEngineId(legacy)).toBe("default");
    }
  });

  it("bilinmeyen motor etiketi Default AI'a düşer (sabit ekranda çökmez)", () => {
    expect(engineLabel("qwen").id).toBe("default");
    expect(engineLabel("default").id).toBe("default");
  });
});
