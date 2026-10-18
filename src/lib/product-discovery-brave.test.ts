import { afterEach, describe, expect, it, vi } from "vitest";

import {
  braveHits,
  braveKey,
  braveLocale,
  braveSearchUrl,
  parseBraveHits,
  PRODUCT_SOURCES,
} from "./product-discovery-sources.server";

/**
 * BRAVE SEARCH — sözleşme testleri.
 *
 * NEDEN BUNLAR: Brave eklenirken üç iddia verildi ve üçü de burada kilitlenir:
 *   1. Anahtar yokken **0 ağ çağrısı** — hat hiçbir koşulda Brave yüzünden beklemez.
 *   2. Ülke/dil parametreleri **doğru** gider (TR → `country=TR&search_lang=tr`);
 *      desteklenmeyen kod gönderilmez (422 → o nişin satırları kaybolurdu).
 *   3. Aynı niş+ülke ikinci kez aranınca **kredi harcanmaz** (24 saat önbellek).
 *
 * Ayrıca Brave'in PARALEL bir kaynak olmadığı sabitlenir: `PRODUCT_SOURCES`
 * içinde `brave-search` diye ikinci bir satır YOKTUR — Brave, var olan
 * `web-reviews` kaynağının ilk motorudur (aynı satırlar için iki kez ödeme
 * yapılmaz).
 */

const h = vi.hoisted(() => ({ cache: new Map<string, unknown>() }));

vi.mock("./ai-cache.server", () => ({
  cacheKey: async (prefix: string, parts: unknown[]) => `${prefix}:${parts.join("|")}`,
  cacheGet: async (key: string) => h.cache.get(key) ?? null,
  cacheSet: async (key: string, _source: string, value: unknown) => {
    h.cache.set(key, value);
  },
}));

vi.mock("./scraper-quota.server", () => ({
  allowDealFeedRequest: async () => true,
  allowBraveCredit: async () => true,
}));

const ENV_KEYS = ["BRAVE_API_KEY", "BRAVE_SEARCH_API_KEY", "BRAVE_KEY"] as const;
const saved = ENV_KEYS.map((k) => [k, process.env[k]] as const);

function clearBraveEnv(): void {
  for (const k of ENV_KEYS) delete process.env[k];
}

afterEach(() => {
  clearBraveEnv();
  for (const [k, v] of saved) if (v !== undefined) process.env[k] = v;
  h.cache.clear();
  vi.unstubAllGlobals();
});

describe("Brave anahtarı ve yerelleştirme", () => {
  it("anahtar üç adla da tanınır; boş dize anahtar SAYILMAZ", () => {
    expect(braveKey({})).toBe("");
    expect(braveKey({ BRAVE_API_KEY: "   " })).toBe("");
    expect(braveKey({ BRAVE_API_KEY: "bsa-1" })).toBe("bsa-1");
    expect(braveKey({ BRAVE_SEARCH_API_KEY: "bsa-2" })).toBe("bsa-2");
    expect(braveKey({ BRAVE_KEY: "bsa-3" })).toBe("bsa-3");
  });

  it("TR → country=TR + search_lang=tr; desteklenmeyen kod GÖNDERİLMEZ", () => {
    expect(braveLocale("tr")).toEqual({ country: "TR", searchLang: "tr" });
    expect(braveLocale("DE")).toEqual({ country: "DE", searchLang: "de" });
    expect(braveLocale("US")).toEqual({ country: "US", searchLang: "en" });
    // Listede olmayan kod: country parametresi hiç eklenmez (422 yerine varsayılan).
    expect(braveLocale("ZZ")).toEqual({ country: "", searchLang: "en" });
    expect(braveLocale("")).toEqual({ country: "", searchLang: "en" });
  });

  it("sorgu adresi ülke/dil ve snippet parametrelerini taşır", () => {
    const url = new URL(braveSearchUrl("air fryer", "TR"));
    expect(url.origin + url.pathname).toBe("https://api.search.brave.com/res/v1/web/search");
    expect(url.searchParams.get("q")).toBe("air fryer review");
    expect(url.searchParams.get("country")).toBe("TR");
    expect(url.searchParams.get("search_lang")).toBe("tr");
    expect(url.searchParams.get("extra_snippets")).toBe("true");
    expect(url.searchParams.get("text_decorations")).toBe("false");
    expect(url.searchParams.get("count")).toBe("20");

    const unknown = new URL(braveSearchUrl("air fryer", "ZZ"));
    expect(unknown.searchParams.get("country")).toBeNull();
    expect(unknown.searchParams.get("search_lang")).toBe("en");
  });
});

describe("parseBraveHits", () => {
  const payload = {
    web: {
      results: [
        {
          title: "Ninja AF101 Air Fryer — $89.99 (4.7 / 5, 12.480 reviews)",
          url: "https://www.example-shop.com/ninja-af101",
          description: "Ninja AF101 4 qt air fryer in stock.",
          extra_snippets: ["Rated 4.7 out of 5 by 12480 buyers."],
        },
        { title: "Geçersiz adres", url: "javascript:alert(1)", description: "x" },
        { title: "Ok", url: "https://ok.example.com/p", description: "—" },
      ],
    },
  };

  it("başlık + açıklama + extra_snippets birleşir, host www'suz yazılır", () => {
    const hits = parseBraveHits(payload);
    expect(hits).toHaveLength(1);
    const hit = hits[0]!;
    expect(hit.host).toBe("example-shop.com");
    expect(hit.title).toContain("Ninja AF101");
    expect(hit.snippet).toContain("Rated 4.7 out of 5");
    expect(hit.snippet).toContain("in stock");
  });

  it("bozuk yanıtta satır UYDURMAZ", () => {
    expect(parseBraveHits(null)).toEqual([]);
    expect(parseBraveHits({})).toEqual([]);
    expect(parseBraveHits({ web: { results: "nope" } })).toEqual([]);
  });

  it("en fazla 20 sonuç döner (snippet bütçesi sınırlı)", () => {
    const many = {
      web: {
        results: Array.from({ length: 40 }, (_, i) => ({
          title: `Ürün ${i} fiyat $${10 + i}.00`,
          url: `https://shop${i}.example.com/p`,
          description: "açıklama",
        })),
      },
    };
    expect(parseBraveHits(many)).toHaveLength(20);
  });
});

describe("braveHits — anahtar yokken ağa çıkmaz, tekrar aramada kredi harcamaz", () => {
  it("anahtar yoksa [] döner ve fetch ÇAĞRILMAZ", async () => {
    clearBraveEnv();
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await expect(braveHits("air fryer", "TR")).resolves.toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("anahtarlı ilk çağrı 1 istek atar, aynı niş+ülke ikinci çağrıda önbellekten döner", async () => {
    process.env["BRAVE_API_KEY"] = "test-key";
    const spy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          web: {
            results: [
              { title: "Ürün A $25.00", url: "https://shop.example.com/a", description: "yorum" },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", spy);

    const first = await braveHits("air fryer", "TR");
    const second = await braveHits("air fryer", "TR");

    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
    expect(spy).toHaveBeenCalledTimes(1);

    const [calledUrl, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toContain("country=TR");
    expect(calledUrl).toContain("search_lang=tr");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-subscription-token"]).toBe("test-key");
  });
});

describe("Brave PARALEL kaynak değil, web-reviews motoru", () => {
  it("kaynak listesinde ikinci bir brave satırı yok (çift sayım/çift maliyet olmasın)", () => {
    const names = PRODUCT_SOURCES.map((s) => s.name);
    expect(names).toContain("web-reviews");
    expect(names.filter((n) => n.includes("brave"))).toEqual([]);
  });
});
