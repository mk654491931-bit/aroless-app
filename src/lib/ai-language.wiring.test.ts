// ============================================================================
// ÇIKTI DİLİ — TÜM AI YÜZEYLERİ (birim + bağlantı testleri, AĞ YOK).
//
// Kilitlenen söz: kullanıcı hangi dili seçerse SEÇSİN, AI'ın ürettiği okunur
// metin (ürün bulucu gerekçesi/kısa liste gerekçesi, 14 ajanın notu, sol bar
// araçlarının sonucu, doğrulama raporu) o dilde çıkar.
//
// NEDEN AYRI DOSYA: dil tek bir yerde unutulduğunda (ör. hattın bir adımına
// `lang` geçmezse) hata SESSİZDİR — arayüz çevrilir, sonuç Türkçe kalır ve
// kimse fark etmez. Bu yüzden hem saf fonksiyonlar hem de ÇAĞRI ZİNCİRİ
// (istemci → sunucu fonksiyonu → adım → istem) metin düzeyinde kilitlenir.
// ============================================================================
import { describe, expect, it } from "vitest";

import {
  AI_LANGUAGES,
  languageName,
  normalizeAiLanguage,
  outputLanguageDirective,
  withOutputLanguage,
} from "./ai-language";
import { buildAgentPrompt, runCouncilSlice } from "./product-discovery-council-ai.server";
import { buildShortlistPrompt, buildTopProducts } from "./product-discovery-pipeline.server";
import { reasonCopy } from "./product-discovery-reason";
import type { NormalizedProduct } from "./product-discovery.types";

const read = (p: string) => import("node:fs").then((fs) => fs.readFileSync(p, "utf8"));

const product = (over: Partial<NormalizedProduct> = {}): NormalizedProduct => ({
  name: "Ninja Air Fryer Pro 8QT",
  brand: "Ninja",
  brandMeasured: false,
  seller: "Walmart",
  category: "",
  priceUsd: 129.99,
  rating: 4.6,
  ratingCount: 1204,
  inStock: null,
  sources: ["bing-shopping"],
  url: "https://example.com",
  notes: "1K+ görüntülenme / 90g",
  viewed90d: 1000,
  id: "sku-8qt",
  imageUrl: "https://example.com/8qt.jpg",
  salesVolume: 2100,
  fingerprint: `fp-${Math.random().toString(36).slice(2, 8)}`,
  preScore: 70,
  signals: { demand: 80, competition: 60, margin: 70, rating: 85, availability: 50 },
  dataCompleteness: 4,
  missingFields: ["stock"],
  source: "scraped",
  ...over,
});

describe("ai-language — dil adı ve direktif", () => {
  it("iki harfli koda indirger, tanınmayanı İngilizce'ye düşürür", () => {
    expect(normalizeAiLanguage("tr-TR")).toBe("tr");
    expect(normalizeAiLanguage("DE")).toBe("de");
    expect(normalizeAiLanguage("xx")).toBe("en");
    expect(normalizeAiLanguage(undefined)).toBe("en");
    expect(normalizeAiLanguage(42)).toBe("en");
  });

  it("altı dilin tamamında modelin anlayacağı İngilizce adı verir", () => {
    const names = AI_LANGUAGES.map((l) => languageName(l));
    expect(names).toEqual(["Turkish", "English", "Spanish", "German", "French", "Arabic"]);
  });

  it("direktif okunacak alanları sayar ve URL/sayı korumasını söyler", () => {
    const es = outputLanguageDirective("es");
    expect(es).toContain("Spanish");
    expect(es).toContain("URLs");
    // Çağrıya özel alan listesi verilebilir (ürün bulucu gerekçesi).
    const custom = outputLanguageDirective("ar", "reasoning");
    expect(custom).toContain("Arabic");
    expect(custom).toContain("reasoning");
  });

  it("withOutputLanguage direktifi istemin SONUNA ekler", () => {
    const wrapped = withOutputLanguage("PROMPT", "fr");
    expect(wrapped.startsWith("PROMPT")).toBe(true);
    expect(wrapped).toContain("French");
  });
});

describe("kazanan gerekçesi — seçilen dilde kurulur", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    fingerprint: "fp-0",
    name: "Ürün 0 Model X100",
    priceUsd: 20,
    councilScore: 90,
    confidenceScore: 80,
    dataCompleteness: 4,
    sources: ["a", "b"],
    signals: { demand: 85, margin: 75, competition: 70 },
    ...over,
  });

  it("varsayılan metin Türkçe kalır (eski çağrı noktaları bozulmaz)", () => {
    const { top_products } = buildTopProducts([row()]);
    expect(top_products[0]!.selection_reason).toContain("Trend gücü 85/100");
    expect(top_products[0]!.selection_reason).toContain("Marj skoru 75/100");
    expect(top_products[0]!.selection_reason).toContain("Rekabet düşük (70/100)");
    expect(top_products[0]!.selection_reason).toContain("2 kaynak doğruladı");
  });

  it("İngilizce/İspanyolca/Arapça gerekçede ölçülen SAYILAR değişmeden görünür", () => {
    const en = buildTopProducts([row()], 5, "en").top_products[0]!.selection_reason;
    expect(en).toContain("Demand strength 85/100");
    expect(en).toContain("price $20");
    expect(en).not.toContain("Trend gücü");

    const es = buildTopProducts([row()], 5, "es").top_products[0]!.selection_reason;
    expect(es).toContain("Fuerza de demanda 85/100");
    expect(es).toContain("Confirmado por 2 fuentes");

    const ar = buildTopProducts([row()], 5, "ar").top_products[0]!.selection_reason;
    expect(ar).toContain("85/100");
    expect(ar).toContain("$20");
  });

  it("ölçülmemiş alan her dilde açıkça 'ölçülmedi' der (uydurma yok)", () => {
    const rows = [
      row({
        signals: { demand: null, margin: null, competition: null },
        dataCompleteness: null,
        sources: [],
        confidenceScore: undefined,
      }),
    ];
    const en = buildTopProducts(rows as never, 5, "en").top_products[0]!.selection_reason;
    expect(en).toContain("not measured");
    expect(en).toContain("No trend evidence");
    const tr = buildTopProducts(rows as never, 5, "tr").top_products[0]!.selection_reason;
    expect(tr).toContain("ölçülmedi");
  });

  it("altı dilin hepsi için başlık yer tutucusu ve şablonlar doludur", () => {
    for (const lang of AI_LANGUAGES) {
      const copy = reasonCopy(lang);
      const text = [
        copy.trendUnknown,
        copy.trend(80, 70),
        copy.priceUnknown,
        copy.margin(70, 20),
        copy.competitionUnknown,
        copy.competitionLow(70),
        copy.competitionHigh(30),
        copy.completeness(4),
        copy.sourcesConfirmed(3),
        copy.untitled,
      ].join(" ");
      expect(text).toContain("80/100");
      expect(text).not.toContain("undefined");
      expect(copy.untitled.length).toBeGreaterThan(1);
    }
  });
});

describe("istemler — dil direktifi modele gerçekten gidiyor", () => {
  it("kısa liste istemi seçilen dili yazar", () => {
    const es = buildShortlistPrompt([product()], "air fryer", "es");
    expect(es).toContain("Spanish");
    expect(es).toContain("reasoning");
    // Dil verilmezse güvenli varsayılan: İngilizce.
    expect(buildShortlistPrompt([product()], "air fryer")).toContain("English");
  });

  it("14 ajan istemi seçilen dili yazar (gerekçe alanı `note`)", () => {
    const de = buildAgentPrompt(
      { key: "cfo", name: "CFO Agent", task: "Unit economics" },
      [product()],
      "air fryer",
      "de",
    );
    expect(de).toContain("German");
    expect(de).toContain("note");
  });

  it("konsey dilimi `lang` seçeneğini modele taşır (sessiz düşme yok)", async () => {
    const prompts: string[] = [];
    const result = await runCouncilSlice([product()], "air fryer", {
      lang: "fr",
      concurrency: 1,
      sliceDeadlineAt: Date.now() + 5_000,
      call: async (prompt) => {
        prompts.push(prompt);
        return '{"scores":[{"i":1,"score":70,"note":"ok"}]}';
      },
    });
    expect(result.state.done.length).toBe(1);
    expect(prompts[0]).toContain("French");
  });
});

/**
 * ÇAĞRI ZİNCİRİ — dil kaybolursa test KIRILIR.
 *
 * Dil istemciden sunucuya kadar şu yolu izler:
 *   istemci (`getUiLang`) → başlatma şeması → adım girdisi → istem.
 * Bir halka eksikse sonuç metni eski dilde kalır ve bu SESSİZ bir hatadır.
 */
describe("dil zinciri — istemciden isteme", () => {
  it("ürün bulucu istemcisi seçili dili başlatma çağrısına koyar", async () => {
    const src = await read("src/features/finder/hooks/use-finder-search.ts");
    expect(src).toContain("lang: opts.lang.slice(0, 2) || \"en\"");
  });

  it("başlatma şeması ve adım girdisi `lang` alanını taşır", async () => {
    const types = await read("src/lib/product-discovery.types.ts");
    expect(types).toContain('lang: z.string().max(5).default("en")');
    const fn = await read("src/lib/product-discovery.functions.ts");
    expect(fn).toContain('lang: z.string().max(5).default("en")');
  });

  it("adımlar dili kısa liste, konsey ve kazanan gerekçesine geçirir", async () => {
    const src = await read("src/lib/product-discovery-steps.server.ts");
    expect(src).toContain("geminiShortlistSelector(\n          candidates,\n          input.niche,\n          sliceDeadline,\n          input.lang,");
    expect(src).toContain("lang: input.lang,");
    expect(src).toContain("input.lang,\n        );");
  });

  it("araç uçları ve doğrulama raporu dili gönderir", async () => {
    const tool = await read("src/components/tools/tool-card.tsx");
    expect(tool).toContain("uiLang: getUiLang()");
    const home = await read("src/routes/index.tsx");
    expect(home).toContain("lang: getUiLang()");
  });

  it("araç istemleri ortak `withOutputLanguage` sarmalayıcısını kullanır", async () => {
    const src = await read("src/lib/tools-prompts.server.ts");
    expect(src).toMatch(/export function buildPrompt[\s\S]*?withLang\(/);
  });

  it("araç çıktısı seçilen dile bağlanır; tedarikçi mesajı belgesi İSTİSNA kalır", async () => {
    const { buildPrompt } = await import("./tools-prompts.server");
    const es = buildPrompt("landed-cost" as never, { uiLang: "es" } as never);
    expect(es).toContain("Spanish");
    // Tedarikçi pazarlığı belgesi tasarımı gereği İngilizce + Çince'dir; genel
    // direktif belgeyi kapsamaz ama metrikgörseller/maddeler seçilen dilde olur.
    const neg = buildPrompt("supplier-negotiator" as never, { uiLang: "de" } as never);
    expect(neg).toContain("German");
    expect(neg).toContain('"document" field must stay in English + Simplified Chinese');
  });

  it("doğrulama ajanları dil direktifini isteme ekler", async () => {
    const src = await read("src/lib/agents.server.ts");
    // Üç ajan + piyasa taraması: dördünün de isteminde direktif olmalı.
    expect(src.match(/outputLanguageDirective\(/g)?.length).toBeGreaterThanOrEqual(4);
    // "Ürünümü Doğrula" uç noktası dili hem taramaya hem konseye geçirir.
    const fn = await read("src/lib/gemini.functions.ts");
    expect(fn).toContain("lang: data.lang");
    expect(fn).toContain("runConsensus({ context: ctx, lang: data.lang })");
  });
});
