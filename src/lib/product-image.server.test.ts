// Ürün fotoğrafı çözümleyici — ScrapAPI (ScraperAPI) entegrasyon testi.
//
// Anahtar tanımlıysa kazıma ScrapAPI/ScraperAPI proxy'si üzerinden yapılmalı;
// yoksa hat doğrudan kazımaya düşmeli. Fotoğraf bulunamazsa uydurma/stok görsel
// ASLA döndürülmez. Tüm ağ çağrıları taklit edilir (gerçek istek yok).
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveProductImage, scraperApiConfigured } from "./product-image.server";

const BING_HTML =
  '<a class="iusc" m="{"murl":"https://cdn.example.com/widget.jpg"}"></a>';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("resolveProductImage (ScrapAPI/ScraperAPI)", () => {
  it("anahtar tanımlıysa Bing Görseller ScrapAPI proxy'si üzerinden kazınır", async () => {
    vi.stubEnv("SCRAPERAPI_KEY", "secret-key");
    expect(scraperApiConfigured()).toBe(true);

    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("https://api.scraperapi.com/")) {
        return new Response(BING_HTML, { status: 200 });
      }
      return new Response("", { status: 500 });
    });

    const result = await resolveProductImage("mini ice maker");

    expect(result.url).toBe("https://cdn.example.com/widget.jpg");
    expect(result.source).toBe("scraperapi");
    // İlk istek ScrapAPI proxy'sine gitti ve hedef URL kodlanmış olarak taşındı.
    expect(calls[0]).toContain("api.scraperapi.com");
    expect(calls[0]).toContain(encodeURIComponent("bing.com/images/search"));
  });

  it("anahtar yoksa doğrudan kazıma yapılır (DuckDuckGo sonra Bing)", async () => {
    vi.stubEnv("SCRAPERAPI_KEY", "");
    vi.stubEnv("SCRAP_API_KEY", "");
    expect(scraperApiConfigured()).toBe(false);

    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://duckduckgo.com/?q")) {
        return new Response("<html>vqd=123-456</html>", { status: 200 });
      }
      if (url.startsWith("https://duckduckgo.com/i.js")) {
        return new Response(JSON.stringify({ results: [{ image: "https://img.example/ddg.jpg" }] }), {
          status: 200,
        });
      }
      return new Response("", { status: 500 });
    });

    const result = await resolveProductImage("mini ice maker");
    expect(result.url).toBe("https://img.example/ddg.jpg");
    expect(result.source).toBe("ddg");
  });

  it("hiçbir kaynak görsel vermezse uydurma placeholder yerine null döner", async () => {
    vi.stubEnv("SCRAPERAPI_KEY", "");
    vi.stubEnv("SCRAP_API_KEY", "");
    vi.stubGlobal("fetch", async () => new Response("", { status: 500 }));

    const result = await resolveProductImage("bulunamayan urun");
    expect(result.url).toBeNull();
    expect(result.source).toBe("none");
  });
});
