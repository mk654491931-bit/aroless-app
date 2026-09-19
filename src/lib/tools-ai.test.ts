// Unit tests for the sidebar AI tools' provider mesh (pure — no network).
//
// Sol menüdeki araç kartları tek bir sağlayıcıya bağlı kalmamalı: env'de 5
// Gemini + 5 Groq + 5 OpenRouter + 5 HuggingFace anahtarı, 1 Cerebras ve 1
// SambaNova var. Bu testler "hangisi müsaitse ondan alsın" kuralını sabitler:
//   • tercih edilen motor her zaman ilk sıradadır,
//   • müsait (anahtarı tanımlı ve devre dışı olmayan) sağlayıcılar müsait
//     olmayanların önüne geçer,
//   • motorlar 3 + 3 + 1 dalgasına bölünür (biri tek başına tüm kotayı yakmaz).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROVIDER_ORDER,
  SCHEMA_HINT,
  orderToolProviders,
  toolProviderWaves,
  type Provider,
} from "./tools-ai.server";
import { poolGroupAvailable } from "./ai-pool.server";

/** Sağlayıcı anahtarları — test ortamında sızıntı olmasın diye temizlenir. */
const PROVIDER_KEY_NAMES = [
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
  "HF_TOKEN",
  "CEREBRAS_API_KEY",
  "SAMBANOVA_API_KEY",
];

beforeEach(() => {
  vi.unstubAllEnvs();
  // Base ve _1.._8 slotlarını boşalt: her test kendi platformunu/durumunu kurar.
  for (const base of PROVIDER_KEY_NAMES) {
    vi.stubEnv(base, "");
    for (let slot = 1; slot <= 8; slot++) vi.stubEnv(`${base}_${slot}`, "");
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("orderToolProviders", () => {
  it("tercih edilen motoru her koşulda başa koyar", () => {
    const none = () => false;
    expect(orderToolProviders("groq", none)[0]).toBe("groq");
    expect(orderToolProviders("cerebras", none)[0]).toBe("cerebras");
    expect(orderToolProviders("lovable", none)[0]).toBe("lovable");
  });

  it("müsait sağlayıcıları müsait olmayanların önüne alır", () => {
    const available = new Set<Provider>(["sambanova", "cerebras"]);
    const order = orderToolProviders("gemini", (p) => available.has(p));
    expect(order).toEqual([
      "gemini",
      "cerebras",
      "sambanova",
      "groq",
      "openrouter",
      "hf",
      "lovable",
    ]);
  });

  it("hiçbiri müsait değilse sabit güvenilirlik sırasını korur", () => {
    expect(orderToolProviders("gemini", () => false)).toEqual(PROVIDER_ORDER);
  });

  it("tüm motorları bir kez içerir, tekrar üretmez", () => {
    const order = orderToolProviders("openrouter", () => true);
    expect(order).toHaveLength(PROVIDER_ORDER.length);
    expect(new Set(order).size).toBe(PROVIDER_ORDER.length);
    expect([...order].sort()).toEqual([...PROVIDER_ORDER].sort());
  });

  it("havuzlu altı sağlayıcı + ağ geçidi yolunu kapsar", () => {
    // 5 Gemini + 5 Groq + 5 OpenRouter + 5 HF + 1 Cerebras + 1 SambaNova anahtarı
    // ayrı motorlar olarak denenir; `lovable` ağ geçidi/tam havuz süpürmesidir.
    expect(PROVIDER_ORDER).toEqual([
      "gemini",
      "groq",
      "openrouter",
      "hf",
      "cerebras",
      "sambanova",
      "lovable",
    ]);
  });

  it("varsayılan müsaitlik ölçütü anahtarı olan sağlayıcıyı öne alır", () => {
    vi.stubEnv("CEREBRAS_API_KEY", "cerebras-test-key");
    const order = orderToolProviders("gemini");
    const isAvailable = (p: Provider) => p === "lovable" || poolGroupAvailable(p);
    expect(order[0]).toBe("gemini");

    const rest = order.filter((p) => p !== "gemini");
    const available = rest.filter(isAvailable);
    const unavailable = rest.filter((p) => !isAvailable(p));
    expect(available).toContain("cerebras");
    // Müsait motorların tamamı, müsait olmayanların tamamından önce gelir.
    if (available.length && unavailable.length) {
      expect(rest.indexOf(available[available.length - 1])).toBeLessThan(
        rest.indexOf(unavailable[0]),
      );
    }
  });
});

describe("SCHEMA_HINT (tüm araçların ortak çıktı sözleşmesi)", () => {
  it("her alanı ve daha yüksek detay barajını içerir", () => {
    for (const key of [
      "headline",
      "verdict",
      "score",
      "metrics",
      "bullets",
      "risks",
      "actions",
      "assumptions",
      "table",
      "document",
    ])
      expect(SCHEMA_HINT).toContain(`"${key}"`);
    // Detay barajı: 4-8 metrik, 5-10 madde, 3-5 risk, 4-6 aksiyon.
    expect(SCHEMA_HINT).toContain("4-8 items");
    expect(SCHEMA_HINT).toContain("5-10 concrete insights");
    expect(SCHEMA_HINT).toContain("3-5 specific failure modes");
    expect(SCHEMA_HINT).toContain("4-6 prioritised next steps");
    // Başlık sayı VE karar taşımalı; tablo 4-8 satır olmalı.
    expect(SCHEMA_HINT).toContain("MUST contain at least one number");
    expect(SCHEMA_HINT).toContain("4-8 rows");
    expect(SCHEMA_HINT).toContain("Quality bar");
  });

  it("JSON şeklini tarif eder, serbest metin istemez", () => {
    expect(SCHEMA_HINT).toContain("output ONLY minified JSON");
    expect(SCHEMA_HINT).not.toContain("```");
  });
});

describe("toolProviderWaves", () => {
  it("3 + 3 + 1 dalgasına böler", () => {
    const order = orderToolProviders("gemini", () => true);
    const waves = toolProviderWaves(order);
    expect(waves.map((w) => w.length)).toEqual([3, 3, 1]);
    expect(waves.flat()).toEqual(order);
  });

  it("motor sayısı azaldıkça dalga sayısı da azalır", () => {
    expect(toolProviderWaves(["gemini", "groq", "lovable"])).toEqual([
      ["gemini", "groq", "lovable"],
    ]);
    expect(toolProviderWaves([])).toEqual([]);
  });
});
