/**
 * OKUMA GÜVENİLİRLİĞİ TESTLERİ — anahtar havuzu, yedekleme, devre kesici,
 * motor yükseltmesi, sayfa bütçesi ve token telemetrisi.
 *
 * NEDEN: kullanıcı Jina'ya 2 anahtar ekledi (her biri 10M token) ve bir arama
 * ~75-100K token harcıyor. Havuz yanlış işlerse ya kota boşa gider ya da
 * anahtarlardan biri yanlış yazıldığında TÜM okumalar durur. Bu testler ağa
 * çıkmaz: `fetch` taklit edilir.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { jinaEnvKeys } from "./ai-keys.server";
import {
  CHARS_PER_TOKEN,
  DEFAULT_KEY_TOKEN_BUDGET,
  DEFAULT_TR_PAGES,
  KEY_COOLDOWN_MS,
  circuitAllow,
  circuitRecord,
  jinaKeyOrder,
  looksBlocked,
  noteSourceDrop,
  noteSourcePage,
  readPage,
  readPageWithEscalation,
  readerHealth,
  readerPageBudget,
  resetReaderHealth,
} from "./product-discovery-reader.server";

const ENV_NAMES = [
  "JINA_API_KEY",
  "JINA_READER_API_KEY",
  "JINA_KEY",
  "JINA_API_KEY_1",
  "JINA_API_KEY_2",
  "JINA_1_API_KEY",
  "JINA_API_KEY1",
  "JINA_READER_API_KEY_1",
  "JINA_KEY_TOKEN_BUDGET",
  "DISCOVERY_READER_PAGES",
];

function clearJinaEnv() {
  for (const n of ENV_NAMES) delete process.env[n];
}

afterEach(() => {
  clearJinaEnv();
  resetReaderHealth();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("jinaEnvKeys — anahtar adlandırmaları", () => {
  beforeEach(clearJinaEnv);

  it("iki numaralı anahtarı SIRAYLA okur (kullanıcının eklediği biçim)", () => {
    process.env.JINA_API_KEY_1 = "first";
    process.env.JINA_API_KEY_2 = "second";
    expect(jinaEnvKeys()).toEqual(["first", "second"]);
  });

  it("düz adı da kabul eder ve aynı anahtarı iki kez saymaz", () => {
    process.env.JINA_API_KEY = "plain";
    process.env.JINA_API_KEY_1 = "plain";
    process.env.JINA_1_API_KEY = "slot";
    expect(jinaEnvKeys()).toEqual(["plain", "slot"]);
  });

  it("boşluk/boş değerleri atlar", () => {
    process.env.JINA_API_KEY_1 = "   ";
    process.env.JINA_API_KEY_2 = " real ";
    expect(jinaEnvKeys()).toEqual(["real"]);
  });
});

describe("jinaKeyOrder — yük paylaşımı", () => {
  it("imleçten başlar ve havuzun tamamını döner (kullanım eşitken)", () => {
    expect(jinaKeyOrder(["a", "b"], 0).map((x) => x.key)).toEqual(["a", "b"]);
    expect(jinaKeyOrder(["a", "b"], 1).map((x) => x.key)).toEqual(["b", "a"]);
    expect(jinaKeyOrder(["a", "b", "c"], 2).map((x) => x.key)).toEqual(["c", "a", "b"]);
  });

  it("anahtar YOKSA tek anahtarsız deneme döner", () => {
    expect(jinaKeyOrder([], 0)).toEqual([{ key: "", index: -1 }]);
  });
});

describe("devre kesici", () => {
  it("art arda 3 hatadan sonra host atlanır, soğuma sonrası tekrar denenir", () => {
    const t0 = 1_000_000;
    circuitRecord("https://r.jina.ai/x", false, t0);
    circuitRecord("https://r.jina.ai/x", false, t0);
    expect(circuitAllow("https://r.jina.ai/x", t0)).toBe(true);
    circuitRecord("https://r.jina.ai/x", false, t0);
    expect(circuitAllow("https://r.jina.ai/x", t0)).toBe(false);
    // Soğuma (5 dk) sonrası yarı-açık: tek deneme hakkı geri gelir.
    expect(circuitAllow("https://r.jina.ai/x", t0 + 5 * 60_000)).toBe(true);
  });

  it("başarılı okuma sayacı sıfırlar (host gereksiz yere kapanmaz)", () => {
    circuitRecord("https://r.jina.ai/y", false, 0);
    circuitRecord("https://r.jina.ai/y", false, 0);
    circuitRecord("https://r.jina.ai/y", true, 0);
    circuitRecord("https://r.jina.ai/y", false, 0);
    circuitRecord("https://r.jina.ai/y", false, 0);
    expect(circuitAllow("https://r.jina.ai/y", 0)).toBe(true);
  });
});

describe("looksBlocked — engellenmiş gövde tespiti", () => {
  it("ölçülen Cloudflare gövdesini engelli sayar (200 ile gelse bile)", () => {
    // ÖLÇÜM (2026-10-12): n11 taze aramada direct motor 200 + 1.041 karakter
    // ve şu gövdeyi döndürdü; durum kodu 200 olduğu için eskiden BAŞARILI
    // sayılıyordu ve havuz sessizce boşalıyordu.
    const blocked = "Attention Required! | Cloudflare Please enable cookies. Ray ID: 8a1f";
    expect(looksBlocked(blocked)).toBe(true);
    expect(looksBlocked("Just a moment...")).toBe(true);
  });

  it("anormal kısa gövdeyi engelli sayar, ürün listesi taşıyan gövdeyi saymaz", () => {
    expect(looksBlocked("# Loading")).toBe(true);
    const real = "kart satırı".repeat(400);
    expect(looksBlocked(real)).toBe(false);
  });
});

describe("readPage anahtar yedeği (fetch taklidi ile)", () => {
  /** Gerçek Jina gövdesi ürün listesi taşır (≥2 KB); kısa gövde \"engelli\" sayılır. */
  const pad = (body: string) => body + "\n" + "- gerçek satır ".repeat(400);
  const ok = (body: string) =>
    ({ ok: true, status: 200, text: async () => pad(body) }) as unknown as Response;
  const fail = (status: number) =>
    ({ ok: false, status, text: async () => "" }) as unknown as Response;

  /** fetch taklidi: hangi anahtar hangi yanıtı alacak. */
  const stub = (answers: Record<string, Response>, seen: string[]) => {
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const auth = String((init.headers as Record<string, string>).Authorization ?? "");
      seen.push(auth);
      return answers[auth] ?? ok("# varsayılan");
    });
  };

  it("ilk anahtar kotayı doldurduysa (429) İKİNCİ anahtarla okur", async () => {
    process.env.JINA_API_KEY_1 = "k1";
    process.env.JINA_API_KEY_2 = "k2";
    const seen: string[] = [];
    stub({ "Bearer k1": fail(429) }, seen); // k2 → varsayılan başarılı yanıt

    const text = await readPage("https://www.hepsiburada.com/ara?q=test", 5_000);
    expect(text).toContain("# varsayılan");
    expect(seen).toEqual(["Bearer k1", "Bearer k2"]);
  });

  it("ilk anahtar geçersizse (401) yine ikinci anahtarla okur", async () => {
    process.env.JINA_API_KEY_1 = "bad";
    process.env.JINA_API_KEY_2 = "good";
    const seen: string[] = [];
    stub({ "Bearer bad": fail(401) }, seen);

    await readPage("https://www.newegg.com/p/pl?d=test", 5_000);
    expect(seen).toEqual(["Bearer bad", "Bearer good"]);
  });

  it("404'te diğer anahtar DENENMEZ (anahtar sorunu değil, bütçe boşa gitmez)", async () => {
    process.env.JINA_API_KEY_1 = "k1";
    process.env.JINA_API_KEY_2 = "k2";
    const seen: string[] = [];
    stub({}, seen);
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      seen.push(String((init.headers as Record<string, string>).Authorization ?? ""));
      return fail(404);
    });

    await expect(readPage("https://www.n11.com/arama?q=test", 5_000)).rejects.toThrow("reader 404");
    expect(seen).toEqual(["Bearer k1"]);
  });

  it("tüm anahtarlar düşerse anahtarsız son deneme yapılır", async () => {
    process.env.JINA_API_KEY_1 = "k1";
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const auth = String((init.headers as Record<string, string>).Authorization ?? "");
      seen.push(auth);
      return auth ? fail(403) : ok("# anahtarsız okundu");
    });

    const text = await readPage("https://www.aliexpress.com/w/wholesale-test.html", 5_000);
    expect(text).toContain("# anahtarsız okundu");
    expect(seen).toEqual(["Bearer k1", ""]);
  });

  it("anahtar yokken (ücretsiz katman) doğrudan anahtarsız okur", async () => {
    clearJinaEnv();
    const seen: string[] = [];
    stub({}, seen);

    const text = await readPage("https://www.hepsiburada.com/ara?q=test", 5_000);
    expect(text).toContain("# varsayılan");
    expect(seen).toEqual([""]);
    expect(readerHealth().keys).toBe(0);
  });

  it("engellenmiş gövde (200 + Cloudflare) BAŞARILI sayılmaz, sıradaki anahtara geçer", async () => {
    process.env.JINA_API_KEY_1 = "k1";
    process.env.JINA_API_KEY_2 = "k2";
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const auth = String((init.headers as Record<string, string>).Authorization ?? "");
      seen.push(auth);
      if (auth === "Bearer k1") {
        return {
          ok: true,
          status: 200,
          text: async () => "Attention Required! | Cloudflare",
        } as unknown as Response;
      }
      return ok("# temiz gövde");
    });

    const text = await readPage("https://www.n11.com/arama?q=test", 5_000);
    expect(text).toContain("# temiz gövde");
    expect(seen).toEqual(["Bearer k1", "Bearer k2"]);
  });

  it("devre kesici açıkken istek ATILMAZ (ölü host bütçe yemez)", async () => {
    const seen: string[] = [];
    stub({}, seen);
    const now = Date.now();
    circuitRecord("https://www.n11.com/arama?q=x", false, now);
    circuitRecord("https://www.n11.com/arama?q=x", false, now);
    circuitRecord("https://www.n11.com/arama?q=x", false, now);

    await expect(readPage("https://www.n11.com/arama?q=x", 5_000, "browser")).rejects.toThrow(
      "circuit open",
    );
    expect(seen).toEqual([]);
  });
});

describe("readPageWithEscalation — motor yükseltmesi", () => {
  it("direct engellenirse BROWSER motoruyla okur ve motoru bildirir", async () => {
    const engines: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const engine = String((init.headers as Record<string, string>)["X-Engine"] ?? "");
      engines.push(engine);
      if (engine === "direct") {
        return {
          ok: true,
          status: 200,
          text: async () => "Attention Required! | Cloudflare",
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        text: async () => "- ürün kartı ".repeat(400),
      } as unknown as Response;
    });

    const { text, engine } = await readPageWithEscalation("https://www.n11.com/arama?q=x", 5_000);
    expect(engine).toBe("browser");
    expect(text).toContain("ürün kartı");
    expect(engines).toEqual(["direct", "browser"]);
  });

  it("direct çalışıyorsa TARAYICI motoruna hiç çıkmaz (pahalı motor boşa koşmaz)", async () => {
    const engines: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      engines.push(String((init.headers as Record<string, string>)["X-Engine"] ?? ""));
      return {
        ok: true,
        status: 200,
        text: async () => "- ürün kartı ".repeat(400),
      } as unknown as Response;
    });

    const { engine } = await readPageWithEscalation("https://www.n11.com/arama?q=x", 5_000);
    expect(engine).toBe("direct");
    expect(engines).toEqual(["direct"]);
  });
});

describe("readerPageBudget — arama başına sayfa bütçesi", () => {
  it("varsayılan 2 sayfa (4 sayfa ölçülen token maliyetinin yarısı)", () => {
    delete process.env.DISCOVERY_READER_PAGES;
    expect(DEFAULT_TR_PAGES).toBe(2);
    expect(readerPageBudget()).toBe(2);
  });

  it("env ile 1..6 arası ayarlanabilir, aralık dışı kırpılır", () => {
    expect(readerPageBudget({ DISCOVERY_READER_PAGES: "3" })).toBe(3);
    expect(readerPageBudget({ DISCOVERY_READER_PAGES: "0" })).toBe(1);
    expect(readerPageBudget({ DISCOVERY_READER_PAGES: "99" })).toBe(6);
    expect(readerPageBudget({ DISCOVERY_READER_PAGES: "abc" })).toBe(DEFAULT_TR_PAGES);
  });
});

describe("readerHealth — kota ve kaynak kanıtı (SIR YOK)", () => {
  const longBody = "- ürün kartı satırı ".repeat(500);
  const okResponse = () =>
    ({ ok: true, status: 200, text: async () => longBody }) as unknown as Response;

  it("okunan karakteri anahtar başına TOKEN olarak raporlar", async () => {
    process.env.JINA_API_KEY_1 = "k1";
    process.env.JINA_API_KEY_2 = "k2";
    vi.stubGlobal("fetch", async () => okResponse());

    await readPage("https://www.hepsiburada.com/ara?q=bardak", 5_000);
    const h = readerHealth();
    expect(h.keys).toBe(2);
    expect(h.tokensEstimated).toBe(Math.round(longBody.length / CHARS_PER_TOKEN));
    expect(h.perKey[0]?.tokensEstimated).toBeGreaterThan(0);
    expect(h.budgetPerKeyTokens).toBe(DEFAULT_KEY_TOKEN_BUDGET);
    expect(h.budgetUsedPct).toBeGreaterThan(0);
    expect(JSON.stringify(h)).not.toContain("k1");
    expect(JSON.stringify(h)).not.toContain("k2");
  });

  it("kalan arama tahminini bütçeden hesaplar (ölçülen ~57K token/arama)", () => {
    delete process.env.JINA_KEY_TOKEN_BUDGET;
    process.env.JINA_API_KEY_1 = "k1";
    // Hiç okuma yapılmadıysa: 10M / 57K ≈ 175 arama.
    const fresh = readerHealth();
    expect(fresh.searchesLeftEstimated).toBe(Math.floor(10_000_000 / 57_000));
  });

  it("bütçe `JINA_KEY_TOKEN_BUDGET` ile değiştirilebilir (10M varsayılan)", () => {
    process.env.JINA_KEY_TOKEN_BUDGET = "20000000";
    expect(readerHealth().budgetPerKeyTokens).toBe(20_000_000);
    delete process.env.JINA_KEY_TOKEN_BUDGET;
    expect(readerHealth().budgetPerKeyTokens).toBe(DEFAULT_KEY_TOKEN_BUDGET);
  });

  it("anahtarsız okumalar AYRI sayılır (yanlış adla eklenen anahtar görünür olur)", async () => {
    clearJinaEnv();
    vi.stubGlobal("fetch", async () => okResponse());

    await readPage("https://www.hepsiburada.com/ara?q=x", 5_000);
    const h = readerHealth();
    expect(h.keys).toBe(0);
    expect(h.tokensEstimated).toBe(0);
    expect(h.anonymous.reads).toBe(1);
    expect(h.anonymous.tokensEstimated).toBe(Math.round(longBody.length / CHARS_PER_TOKEN));
  });

  it("429 alan anahtar SOĞUMAYA girer ve sırada geriye düşer", async () => {
    process.env.JINA_API_KEY_1 = "k1";
    process.env.JINA_API_KEY_2 = "k2";
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const auth = String((init.headers as Record<string, string>).Authorization ?? "");
      seen.push(auth);
      if (auth === "Bearer k1") {
        return { ok: false, status: 429, text: async () => "" } as unknown as Response;
      }
      return okResponse();
    });

    await readPage("https://www.hepsiburada.com/ara?q=a", 5_000);
    expect(readerHealth().perKey[0]?.cooling).toBe(true);
    expect(KEY_COOLDOWN_MS).toBeGreaterThan(0);

    // İkinci okuma: soğumadaki k1 tekrar DENENMEZ, dengeli havuz k2'yi seçer.
    seen.length = 0;
    await readPage("https://www.hepsiburada.com/ara?q=b", 5_000);
    expect(seen[0]).toBe("Bearer k2");
  });

  it("kaynak sayaçları satır kaybını sebebiyle birlikte bildirir", () => {
    noteSourcePage("Hepsiburada", 37);
    noteSourcePage("Hepsiburada", 0);
    noteSourceDrop("Hepsiburada", "no_image", 25);
    noteSourceDrop("Hepsiburada", "no_price", 2);
    const s = readerHealth().sources["Hepsiburada"];
    expect(s).toEqual({
      pages: 2,
      rows: 37,
      kept: 0,
      droppedNoImage: 25,
      droppedNoPrice: 2,
      emptyPages: 1,
    });
  });
});
