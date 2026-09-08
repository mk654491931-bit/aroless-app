import { describe, expect, it } from "vitest";
import { buildPrompt, withOutputLanguage } from "@/lib/tools-prompts.server";

describe("tools prompt sanitization", () => {
  it("sanitizes interpolated user values before building prompts", () => {
    const prompt = buildPrompt("consensus", {
      product: "mug\u202E",
      country: "tr\u200B",
      price: "29\u0000",
      cost: "7\n9",
      uiLang: "tr",
    });
    expect(prompt).toContain("Ürün: mug");
    expect(prompt).toContain("Pazar: tr");
    expect(prompt).toContain("Maliyet: $7\n9");
    expect(prompt).not.toContain("\u202E");
    expect(prompt).not.toContain("\u200B");
    expect(prompt).not.toContain("\u0000");
  });

  it("sanitizes language selector", () => {
    const out = withOutputLanguage("x", "tr\u202E");
    expect(out).toContain("in Turkish");
  });
});
