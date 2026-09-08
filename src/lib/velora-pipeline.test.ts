import { describe, expect, it } from "vitest";
import { sanitizePipelineInput } from "@/lib/velora-pipeline.server";

describe("sanitizePipelineInput", () => {
  it("strips hidden control and bidi characters before prompt construction", () => {
    const out = sanitizePipelineInput({
      userQuery: "ürün\u202E araştır",
      country: "tr\u200B",
      platform: "tik\n tok",
      language: "tr\u0000",
    }) as Record<string, unknown>;

    expect(out["userQuery"]).toBe("ürün araştır");
    expect(out["country"]).toBe("tr");
    expect(out["platform"]).toBe("tik tok");
    expect(out["language"]).toBe("tr");
  });
});
