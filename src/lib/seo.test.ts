/**
 * SEO başlık yardımcılarının testi.
 *
 * Kural: canonical YALNIZCA mutlak adres üretilebiliyorsa yazılır. Göreli
 * canonical yanlış sinyaldir; origin yoksa hiç yazılmaması gerekir.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SITE_NAME, canonicalUrl, publicPageHead, siteOrigin } from "./seo";

/** Test ortamını deterministik yap: ilgisiz env değişkenleri boşaltılır. */
function useEnv(vars: { app?: string; vite?: string; vercel?: string }) {
  vi.stubEnv("APP_URL", vars.app ?? "");
  vi.stubEnv("VITE_APP_URL", vars.vite ?? "");
  vi.stubEnv("VERCEL_URL", vars.vercel ?? "");
}

beforeEach(() => {
  useEnv({});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("siteOrigin", () => {
  it("APP_URL en yüksek önceliktir ve sonundaki / atılır", () => {
    useEnv({ app: "https://aroless.tech/", vite: "https://baska.test" });
    expect(siteOrigin()).toBe("https://aroless.tech");
  });

  it("şema yoksa https:// eklenir", () => {
    useEnv({ app: "aroless.tech" });
    expect(siteOrigin()).toBe("https://aroless.tech");
  });

  it("Vercel ortamında VERCEL_URL'den türetilir", () => {
    useEnv({ vercel: "aroless-abc.vercel.app" });
    expect(siteOrigin()).toBe("https://aroless-abc.vercel.app");
  });

  it("hiçbir kaynak yoksa null (uydurma domain yazılmaz)", () => {
    expect(siteOrigin()).toBeNull();
  });
});

describe("canonicalUrl", () => {
  it("yolu origin'e ekler", () => {
    useEnv({ app: "https://aroless.tech" });
    expect(canonicalUrl("/pricing")).toBe("https://aroless.tech/pricing");
    expect(canonicalUrl("pricing")).toBe("https://aroless.tech/pricing");
  });

  it("origin yoksa null döner (göreli canonical üretilmez)", () => {
    expect(canonicalUrl("/")).toBeNull();
  });
});

describe("publicPageHead", () => {
  it("sayfaya özgü başlık/açıklama ile ortak alanları döner", () => {
    useEnv({ app: "https://aroless.tech" });
    const head = publicPageHead({
      path: "/pricing",
      title: "Fiyatlandırma",
      description: "Paketler",
    });

    expect(head.meta).toContainEqual({ property: "og:title", content: "Fiyatlandırma" });
    expect(head.meta).toContainEqual({ property: "og:site_name", content: SITE_NAME });
    expect(head.meta).toContainEqual({
      property: "og:url",
      content: "https://aroless.tech/pricing",
    });
    expect(head.meta).toContainEqual({ name: "robots", content: "index,follow" });
    expect(head.links).toEqual([{ rel: "canonical", href: "https://aroless.tech/pricing" }]);
  });

  it("origin yoksa canonical ve og:url HİÇ yazılmaz", () => {
    const head = publicPageHead({ path: "/", title: "A", description: "B" });
    expect(head.meta.some((m) => "property" in m && m.property === "og:url")).toBe(false);
    expect(head.links).toEqual([]);
  });

  it("başlık/açıklama meta'sı canonical'dan bağımsız olarak her zaman vardır", () => {
    const head = publicPageHead({ path: "/", title: "A", description: "B" });
    expect(head.meta).toContainEqual({ property: "og:title", content: "A" });
    expect(head.meta).toContainEqual({ name: "twitter:description", content: "B" });
  });
});
