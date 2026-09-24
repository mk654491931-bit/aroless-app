// JETON FİYAT SÖZLEŞMESİ.
//
// NEDEN VAR: fiyat tablosu üç yerde aynı sayıyı konuşmak zorundadır —
//   1. sunucu tahsilatı (`credit-charge.server.ts` → `featureCreditCost`),
//   2. araçlar hub'ındaki rozet (`ToolCard`),
//   3. konsey/radar sayfasındaki rozet ve veritabanındaki `deduct_*` çağrısı.
// Biri diğerinden koparsa kullanıcı ya bedava kullanır ya da beklediğinden çok
// jeton kaybeder. Bu test tabloyu kilitler: yeni bir araç eklenip fiyatı
// yazılmazsa derleme, fiyat 0/negatif olursa bu test kırılır.
import { describe, expect, it } from "vitest";
import { TOOL_PROVIDER, type ToolId } from "./tools-prompts.server";
import {
  AI_CREDIT_COSTS,
  DEFAULT_TOOL_CREDIT_COST,
  TOOL_CREDIT_COSTS,
  creditCostLabel,
  featureCreditCost,
  toolCreditCost,
} from "./credit-costs";

const ALL_TOOLS = Object.keys(TOOL_PROVIDER) as ToolId[];

describe("araç jeton fiyatları", () => {
  it("HER araç için pozitif, tam sayı bir fiyat tanımlıdır (bedava araç yok)", () => {
    for (const tool of ALL_TOOLS) {
      const cost = toolCreditCost(tool);
      expect(Number.isInteger(cost), tool).toBe(true);
      expect(cost, tool).toBeGreaterThan(0);
    }
    expect(Object.keys(TOOL_CREDIT_COSTS).sort()).toEqual([...ALL_TOOLS].sort());
  });

  it("bilinmeyen araç adı güvenli varsayılana düşer (0 dönmez)", () => {
    expect(toolCreditCost("bilinmeyen-arac")).toBe(DEFAULT_TOOL_CREDIT_COST);
    expect(toolCreditCost("")).toBe(DEFAULT_TOOL_CREDIT_COST);
  });

  it("dört motoru birlikte koşturan consensus daha pahalıdır", () => {
    const standard = ALL_TOOLS.filter((t) => t !== "consensus").map(toolCreditCost);
    expect(TOOL_CREDIT_COSTS.consensus).toBe(2);
    expect(Math.max(...standard)).toBeLessThan(TOOL_CREDIT_COSTS.consensus);
  });

  it("`tool:` ön ekli özellik araç fiyatına delege eder", () => {
    for (const tool of ALL_TOOLS) {
      expect(featureCreditCost(`tool:${tool}` as const), tool).toBe(toolCreditCost(tool));
    }
  });
});

describe("AI özellik fiyatları", () => {
  it("konsey tek jetonluk canlı düşme ile aynı fiyattadır", () => {
    // `council.functions.ts` `deduct_product_finder_credit`'i BİR kez çağırır ve
    // arayüz rozeti 1 kredi yazar; buradaki fiyat onlardan kopmamalıdır.
    expect(AI_CREDIT_COSTS.council).toBe(1);
    expect(featureCreditCost("council")).toBe(1);
  });

  it("tek blok ajan hattı, trend analizi ve radar taraması birer jetondur", () => {
    expect(featureCreditCost("agent-pipeline")).toBe(1);
    expect(featureCreditCost("trend-analysis")).toBe(1);
    expect(featureCreditCost("radar-scan")).toBe(1);
  });

  it("hiçbir AI işi 0 jeton değildir (sessiz bedava kullanım olmaz)", () => {
    const features = [
      "council",
      "agent-pipeline",
      "trend-analysis",
      "radar-scan",
      ...ALL_TOOLS.map((t) => `tool:${t}` as const),
    ] as const;
    for (const feature of features) {
      expect(featureCreditCost(feature), feature).toBeGreaterThan(0);
    }
  });
});

describe("creditCostLabel", () => {
  it("panelde okunur kısa etiket üretir", () => {
    expect(creditCostLabel(1)).toBe("1 kredi");
    expect(creditCostLabel(2)).toBe("2 kredi");
    expect(creditCostLabel(-5)).toBe("0 kredi");
  });
});
