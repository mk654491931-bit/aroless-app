/**
 * Pins the f/p + reliability priority of the shared provider chains so nobody
 * accidentally moves single-key providers ahead of the 5-key pools again.
 */
import { describe, expect, it } from "vitest";
import { DEEP_CHAIN, FAST_CHAIN, councilChainFor, type ProviderId } from "./ai-router.server";

describe("provider chain f/p ordering", () => {
  it("FAST_CHAIN leads with Groq and keeps the most rate-limited last", () => {
    expect(FAST_CHAIN[0]).toBe("groq");
    const idx = (p: ProviderId) => FAST_CHAIN.indexOf(p);
    for (const a of ["groq", "cerebras", "gemini"] as ProviderId[]) {
      for (const b of ["openrouter", "huggingface"] as ProviderId[]) {
        expect(idx(a)).toBeGreaterThanOrEqual(0);
        expect(idx(b)).toBeGreaterThanOrEqual(0);
        expect(idx(a)).toBeLessThan(idx(b));
      }
    }
    // EVREN en sonda: tek anahtarlı, uç/model adresi hesaba özel ve henüz
    // canlı doğrulanmamış bir havuz. Ölçülmemiş bir düğümü ölçülmüş olanların
    // ÖNÜNE koymak, kanıtlanmamış bir tercih olurdu.
    expect(FAST_CHAIN[FAST_CHAIN.length - 1]).toBe("evren");
    expect(idx("huggingface")).toBeLessThan(idx("evren"));
  });

  it("DEEP_CHAIN leads with quality engines and trails Hugging Face then paid Bedrock", () => {
    expect(DEEP_CHAIN[0]).toBe("gemini");
    expect(DEEP_CHAIN.indexOf("groq")).toBeLessThan(DEEP_CHAIN.indexOf("huggingface"));
    expect(DEEP_CHAIN.indexOf("huggingface")).toBeLessThan(DEEP_CHAIN.indexOf("bedrock"));
    expect(DEEP_CHAIN[DEEP_CHAIN.length - 1]).toBe("bedrock");
    // EVREN derin zincirde ücretsiz katmanlardan SONRA, ücretli Bedrock'tan ÖNCE:
    // GLM-5.3 / DeepSeek-V4.1 gibi güçlü aileler barındırıyor ama kullanım süresi
    // 1 Kasım'da biteceği için kalıcı çözüm değil, geçici yüksek kapasite.
    expect(DEEP_CHAIN.indexOf("evren")).toBeLessThan(DEEP_CHAIN.indexOf("bedrock"));
    expect(DEEP_CHAIN.indexOf("huggingface")).toBeLessThan(DEEP_CHAIN.indexOf("evren"));
  });

  it("both chains cover the full configured pool", () => {
    for (const chain of [FAST_CHAIN, DEEP_CHAIN]) {
      for (const p of ["groq", "gemini", "openrouter", "huggingface", "evren"] as ProviderId[])
        expect(chain).toContain(p);
    }
  });

  it("no provider appears twice in a chain", () => {
    for (const chain of [FAST_CHAIN, DEEP_CHAIN]) expect(new Set(chain).size).toBe(chain.length);
  });
});

describe("konsey sağlayıcı dağıtımı (22 ücretsiz anahtarı verimli kullan)", () => {
  it("14 ajanın hepsini TEK sağlayıcıya yığmaz", () => {
    // Eski davranış: 14 ajan da DEEP_CHAIN ile koşuyordu ve DEEP_CHAIN[0]
    // = "gemini". Ücretsiz katmanda Gemini 15 RPM sınırı olduğu için 14
    // paralel istek anında 429 üretiyor, 90 sn park ediliyordu.
    //
    // Yeni kural (kullanıcı kararı): ajanlar EVREN + Groq üzerinde koşar,
    // 14 ajan İKİ ana motor arasında bölünür — tek noktaya yığılma yok.
    const primaries = Array.from({ length: 14 }, (_, i) => councilChainFor(i)[0]!);
    expect(new Set(primaries).size).toBe(2);
    expect(new Set(primaries)).toEqual(new Set(["evren", "groq"]));
  });

  it("14 ajan iki ana motor arasında YARI YARI bölünür", () => {
    const chains = Array.from({ length: 14 }, (_, i) => councilChainFor(i));
    const evrenFirst = chains.filter((c) => c[0] === "evren").length;
    const groqFirst = chains.filter((c) => c[0] === "groq").length;
    expect(evrenFirst).toBe(7);
    expect(groqFirst).toBe(7);
  });

  it("ana motor çökerse DİĞER ana motor İLK yedekte", () => {
    // Kullanıcının şartı: “herhangi biri hata verirse diğer API'lere düşsün”.
    // Diğer ana motor 5 yedekten ÖNCE gelmeli, yoksa yavaşlatıcı olur.
    for (const i of [0, 1, 2, 3, 100]) {
      const chain = councilChainFor(i);
      if (chain[0] === "evren") expect(chain[1]).toBe("groq");
      else expect(chain[1]).toBe("evren");
    }
  });

  it("iki ana motor da düşünce 5 yedek sırayla devreye girer", () => {
    for (const i of [0, 1]) {
      const chain = councilChainFor(i);
      expect(chain.slice(2)).toEqual([
        "gemini",
        "cerebras",
        "sambanova",
        "openrouter",
        "huggingface",
      ]);
    }
  });

  it("tüm yedekler HER ajanın zincirinde vardır (bir sağlayıcı çökerse 14 ajan düşer)", () => {
    for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) {
      const chain = councilChainFor(i);
      for (const p of [
        "evren",
        "groq",
        "gemini",
        "cerebras",
        "sambanova",
        "openrouter",
        "huggingface",
      ] as ProviderId[]) {
        expect(chain).toContain(p);
      }
    }
  });

  it("dağılım DETERMİNİSTİK: aynı ajan sırası → aynı sağlayıcı", () => {
    for (let i = 0; i < 14; i++) {
      expect(councilChainFor(i)).toEqual(councilChainFor(i));
    }
  });

  it("her ajan tam yedekli: 7 sağlayıcının tamamı zincirde", () => {
    for (let i = 0; i < 14; i++) {
      const chain = councilChainFor(i);
      expect(chain).toHaveLength(7);
      expect(new Set(chain).size).toBe(7);
      for (const p of [
        "groq",
        "gemini",
        "cerebras",
        "sambanova",
        "openrouter",
        "huggingface",
        "evren",
      ] as ProviderId[]) {
        expect(chain).toContain(p);
      }
      // Birincil sağlayıcı zincirin başında olmalı (429'da sıradakine geçsin).
      expect(chain[0]).toBe(councilChainFor(i)[0]);
    }
  });

  it("ücretsiz havuzun TAMAMI yedekte hazır: 5+5+5+5+1+1 = 22 anahtar", () => {
    // Kullanıcı kararı: yük EVREN + Groq'a bindi, ama 22 anahtarın TAMAMI
    // yedek zincirde duruyor. Yani iki ana motor tükenirse de ücretsiz
    // kapasite kaybı yaşanmaz — hepsi devreye girer.
    for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) {
      const chain = councilChainFor(i);
      for (const p of [
        "groq",
        "gemini",
        "cerebras",
        "sambanova",
        "openrouter",
        "huggingface",
      ] as ProviderId[]) {
        expect(chain).toContain(p);
      }
    }
  });

  it("dizge indeksleri güvenli: negatif veya devasa değer zinciri bozmaz", () => {
    for (const i of [-1, -14, 0, 13, 100, 1000]) {
      const chain = councilChainFor(i);
      expect(chain).toHaveLength(7);
      expect(new Set(chain).size).toBe(7);
    }
  });
});
