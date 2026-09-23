// ARAÇ PROMPT SÖZLEŞMESİ.
//
// NEDEN VAR: araç listesine yeni bir `ToolId` eklenip `buildToolPrompt`
// switch'ine case yazılmazsa üretimde AI'ya `undefined` prompt gider (kullanıcı
// boş/çöp sonuç alır, üstelik kotayı yakar). Bu test tüm listeyi dolaşıp her
// aracın GERÇEK ve dolu bir prompt ürettiğini doğrular; ayrıca vazgeçilmez
// olarak eklenen üç yeni aracın (HS kodu/gümrük, pazaryeri uyumu, rakip ilan
// istihbaratı) girdilerini prompt'a taşıdığını sabitler.
import { describe, expect, it } from "vitest";
import { TOOL_PROVIDER, buildPrompt, type ToolId } from "./tools-prompts.server";
import { TOOL_CACHE_TTL_MS } from "./tools-cache.server";

const INPUTS: Record<string, string> = {
  product: "vakumlu termos",
  material: "304 çelik + PP",
  destination: "US",
  country: "US",
  price: "29.99",
  cost: "7.40",
  channel: "Amazon US",
  competitor: "2L cam saklama seti",
  evidence: "$24.99, BSR 4200, kapak sızdırıyor",
  category: "Kitchen",
  url: "https://example.com/listing",
  offer: "EXW 3.10 USD",
  reviews: "motor yandı",
  adCopy: "only 200 left",
  keywords: "cam saklama",
  unit: "3.2",
  qty: "1000",
  freight: "850",
  duty: "12",
  amount: "4200",
  leadTime: "35",
  today: "2026-01-01",
  hour: "09",
  mode: "live",
};

describe("araç prompt kayıt defteri", () => {
  it("HER araç için dolu bir prompt üretir (eksik switch case'i yok)", () => {
    const tools = Object.keys(TOOL_PROVIDER) as ToolId[];
    expect(tools).toHaveLength(22);
    expect(Object.keys(TOOL_CACHE_TTL_MS).sort()).toEqual([...tools].sort());

    for (const tool of tools) {
      const prompt = buildPrompt(tool, INPUTS);
      expect(typeof prompt, tool).toBe("string");
      // BASE talimatı + dil direktifi her prompt'ta olmalı: aksi halde araç
      // "sayısal, gerekçeli" çıktı sözleşmesinden kopar.
      expect(prompt.length, tool).toBeGreaterThan(500);
      expect(prompt, tool).toContain("OUTPUT LANGUAGE");
    }
  });

  it("yeni vazgeçilmez araçlar girdiyi prompt'a taşır ve doğru motora bağlıdır", () => {
    const hs = buildPrompt("hs-classifier", {
      product: "paslanmaz termos",
      material: "304 çelik",
      destination: "US",
      price: "29.99",
    });
    expect(hs).toContain("paslanmaz termos");
    expect(hs).toContain("304 çelik");
    expect(hs).toContain("HS kodu");

    const compliance = buildPrompt("compliance-check", {
      product: "LED çocuk oyuncak",
      channel: "Amazon US",
      country: "US",
      material: "ABS + Li-ion pil",
    });
    expect(compliance).toContain("LED çocuk oyuncak");
    expect(compliance).toContain("ABS + Li-ion pil");
    expect(compliance).toContain("gating");

    const intel = buildPrompt("competitor-intel", {
      competitor: "2L cam saklama seti",
      evidence: "en çok şikâyet: kapak contası",
      cost: "6.10",
    });
    expect(intel).toContain("2L cam saklama seti");
    expect(intel).toContain("kapak contası");

    expect(TOOL_PROVIDER["hs-classifier"]).toBe("gemini");
    expect(TOOL_PROVIDER["compliance-check"]).toBe("gemini");
    expect(TOOL_PROVIDER["competitor-intel"]).toBe("openrouter");
  });

  it("boş girdide çökmez, '-' varsayılanını kullanır", () => {
    const prompt = buildPrompt("competitor-intel", {});
    expect(prompt).toContain("-");
    expect(prompt).toContain("OUTPUT LANGUAGE");
  });
});
