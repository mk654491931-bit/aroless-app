// Reklam Kreatif Stüdyosu — normalizasyon / birleştirme / kapsam testleri.
//
// Bu testler "stüdyo boş dönüyor" hatasının bir daha oluşmamasını kilitler:
// modeller büyük JSON'u sık sık kesiyor ve eskiden kesilen cevap `undefined`
// alanlarla arayüze gidiyordu — yani başarılı görünen ama TAMAMEN BOŞ bir paket.
import { describe, expect, it } from "vitest";
import {
  STUDIO_MAX_BUDGET_MS,
  creativeKitCoverage,
  creativeKitHasContent,
  creativeKitPrompt,
  creativeRepairPrompt,
  dedupeBy,
  emptyCreativeKit,
  mergeCreativeKits,
  normalizeCreativeKit,
  studioBudgetMs,
  type CreativeKit,
} from "./creative-studio.server";

const input = {
  product: "Taşınabilir Boyun Fanı",
  platform: "TikTok",
  audience: "Sıcakta çalışan kadınlar",
  price: "$24.90",
  tone: "energetic",
  lang: "tr",
};

/** Tam ve geçerli bir paket — karşılaştırma tabanı. */
function fullKit(): CreativeKit {
  return normalizeCreativeKit({
    positioning: "Sessiz, tek elle kullanılan boyun fanı",
    audience: "30-45 yaş, sıcakta çalışan kadınlar",
    hooks: [
      { angle: "problem-agitate", hook: "Ter mi döküyorsun?", why: "İzleyici kendini görür" },
      { angle: "demonstration", hook: "3 saniyede takılıyor", why: "Kullanım kolaylığı" },
      { angle: "social proof", hook: "12.000 kişi aldı", why: "Kalabalık etkisi" },
    ],
    ugc_script: {
      title: "Sıcakta serin kal",
      duration_seconds: 32,
      scenes: [
        {
          second: "0-3",
          visual: "Terleyen kadın",
          voiceover: "Ter mi döküyorsun?",
          text_overlay: "Sessiz fan",
        },
        {
          second: "3-8",
          visual: "Boyna takma",
          voiceover: "Tek elle tak",
          text_overlay: "3 saniye",
        },
        {
          second: "8-15",
          visual: "Serinleme",
          voiceover: "Sessiz çalışır",
          text_overlay: "Sessiz",
        },
      ],
      cta: "Sepete ekle",
    },
    ad_copies: [
      {
        platform: "TikTok",
        primary: "Terlemek zorunda değilsin",
        headline: "Sessiz boyun fanı",
        description: "8 saat serinlik",
        cta: "Satın al",
      },
      {
        platform: "Meta",
        primary: "Sıcak günler için",
        headline: "Tek elle tak",
        description: "Kablosuz",
        cta: "Keşfet",
      },
    ],
    image_prompts: [
      { label: "Hero", prompt: "studio shot of a portable neck fan, white background" },
      { label: "Lifestyle", prompt: "woman walking outdoors wearing a neck fan" },
    ],
    hashtags: ["boyunfanı", "#serinlik", "tiktokmademebuyit", "yaz2026", "kablosuz", "teknoloji"],
    ab_tests: [
      {
        hypothesis: "Acı noktası hook'u daha iyi çalışır",
        variant_a: "Ter mi döküyorsun?",
        variant_b: "3 saniyede tak",
        metric: "hook rate",
      },
      {
        hypothesis: "Fiyat vurgusu CTR'ı artırır",
        variant_a: "$24.90",
        variant_b: "İndirimde",
        metric: "CTR",
      },
    ],
    email_sms: {
      subject: "Sıcakta serin kal",
      body: "Merhaba, ...",
      sms: "Boyun fanı %20 indirimde.",
    },
  });
}

describe("normalizeCreativeKit", () => {
  it("kesilen (kısmi) cevabı eksiksiz bir pakete çevirir, undefined alan bırakmaz", () => {
    // Model tam ortada kesildi: yalnızca 1 hook ve e-posta geldi.
    const kit = normalizeCreativeKit({ hooks: [{ hook: "Ter mi döküyorsun?" }] });

    expect(kit.hooks).toHaveLength(1);
    expect(kit.ad_copies).toEqual([]);
    expect(kit.ugc_script.scenes).toEqual([]);
    expect(kit.ugc_script.duration_seconds).toBe(30);
    expect(kit.email_sms).toEqual({ subject: "", body: "", sms: "" });
    expect(kit.image_prompts).toEqual([]);
    // Hiçbir alan undefined DEĞİL: arayüz patlamaz, boş sekme dürüstçe etiketlenir.
    for (const value of Object.values(kit)) expect(value).not.toBeUndefined();
  });

  it("tamamen bozuk girdide bile çökmez", () => {
    for (const raw of [null, undefined, "metin", 42, [], { hooks: "dizi değil" }]) {
      const kit = normalizeCreativeKit(raw);
      expect(creativeKitHasContent(kit)).toBe(false);
      expect(kit.hooks).toEqual([]);
    }
  });

  it("aynı hook'u iki kez göstermez ve dizileri sınırlar", () => {
    const kit = normalizeCreativeKit({
      hooks: [
        { hook: "Ter mi döküyorsun?" },
        { hook: "Ter mi döküyorsun?" },
        { hook: "ter mi döküyorsun?" },
        { hook: "Farklı bir hook" },
      ],
      hashtags: ["serinlik", "#serinlik", "serinlik"],
    });
    expect(kit.hooks.map((h) => h.hook)).toEqual(["Ter mi döküyorsun?", "Farklı bir hook"]);
    expect(kit.hashtags).toEqual(["#serinlik"]);
  });

  it("hashtag'leri # ile normalize eder, olmayan dizide boş liste döner", () => {
    expect(normalizeCreativeKit({ hashtags: ["serinlik"] }).hashtags).toEqual(["#serinlik"]);
    expect(normalizeCreativeKit({}).hashtags).toEqual([]);
  });

  it("sahne süresini makul aralığa kırar", () => {
    expect(
      normalizeCreativeKit({ ugc_script: { duration_seconds: 900 } }).ugc_script.duration_seconds,
    ).toBe(90);
    expect(
      normalizeCreativeKit({ ugc_script: { duration_seconds: 1 } }).ugc_script.duration_seconds,
    ).toBe(10);
  });
});

describe("mergeCreativeKits", () => {
  it("iki motorun paketini birleştirir: uzun metin + birleşik diziler", () => {
    const a = normalizeCreativeKit({ positioning: "Kısa", hooks: [{ hook: "Hook A" }] });
    const b = normalizeCreativeKit({
      positioning: "Çok daha uzun ve açıklayıcı konumlandırma",
      hooks: [{ hook: "Hook B" }],
    });

    const merged = mergeCreativeKits(a, b);
    expect(merged.positioning).toBe("Çok daha uzun ve açıklayıcı konumlandırma");
    expect(merged.hooks.map((h) => h.hook)).toEqual(["Hook A", "Hook B"]);
  });

  it("aynı hook'u iki kez eklemez (çift üretim kaydı oluşmaz)", () => {
    const a = normalizeCreativeKit({ hooks: [{ hook: "Aynı hook" }] });
    const b = normalizeCreativeKit({ hooks: [{ hook: "Aynı hook" }] });
    expect(mergeCreativeKits(a, b).hooks).toHaveLength(1);
  });

  it("daha zengin UGC senaryosunu (daha çok sahne) korur ama sahneleri birleştirir", () => {
    const a = normalizeCreativeKit({
      ugc_script: { title: "A", duration_seconds: 30, scenes: [{ second: "0-3", visual: "x" }] },
    });
    const b = normalizeCreativeKit({
      ugc_script: {
        title: "B",
        duration_seconds: 40,
        scenes: [
          { second: "0-3", visual: "x" },
          { second: "3-9", visual: "y" },
        ],
      },
    });
    const merged = mergeCreativeKits(a, b);
    expect(merged.ugc_script.title).toBe("B");
    expect(merged.ugc_script.scenes).toHaveLength(2);
  });
});

describe("creativeKitCoverage", () => {
  it("tam pakette %100 ve eksik yok", () => {
    const cov = creativeKitCoverage(fullKit());
    expect(cov.complete).toBe(true);
    expect(cov.percent).toBe(100);
    expect(cov.missing).toEqual([]);
  });

  it("eksik bölümleri ADIYLA söyler (arayüz kullanıcıya bunu gösterir)", () => {
    const kit = normalizeCreativeKit({ positioning: "Var", hooks: [{ hook: "Tek hook" }] });
    const cov = creativeKitCoverage(kit);
    expect(cov.complete).toBe(false);
    expect(cov.missing).toContain("UGC senaryo");
    expect(cov.missing).toContain("Reklam metinleri");
    expect(cov.missing).not.toContain("Konumlandırma");
    expect(cov.percent).toBeLessThan(100);
  });

  it("boş paket hiçbir bölümü dolu saymaz", () => {
    expect(creativeKitCoverage(emptyCreativeKit()).filled).toBe(0);
  });
});

describe("creativeKitHasContent", () => {
  it("tek bir hook bile varsa içerik sayılır (kayıt edilir), tamamen boş paket sayılmaz", () => {
    expect(creativeKitHasContent(normalizeCreativeKit({ hooks: [{ hook: "x" }] }))).toBe(true);
    expect(creativeKitHasContent(emptyCreativeKit())).toBe(false);
  });
});

describe("prompt'lar", () => {
  it("ana prompt ürün/platform/dil ve JSON şemasını taşır", () => {
    const p = creativeKitPrompt(input);
    expect(p).toContain("Taşınabilir Boyun Fanı");
    expect(p).toContain("TikTok");
    expect(p).toContain('"tr"');
    expect(p).toContain('"hooks"');
    expect(p).toContain('"ab_tests"');
  });

  it("onarım prompt'u mevcut paketi ve EKSİK bölümleri taşır", () => {
    const kit = fullKit();
    const p = creativeRepairPrompt(input, kit, ["Görsel promptları", "A/B testleri"]);
    expect(p).toContain("Görsel promptları");
    expect(p).toContain("A/B testleri");
    expect(p).toContain(kit.hooks[0].hook);
  });
});

describe("studioBudgetMs", () => {
  it("platform limitinden türer ve 150 sn'de kırpılır", () => {
    expect(studioBudgetMs(300)).toBe(STUDIO_MAX_BUDGET_MS); // Vercel 300 sn
    expect(studioBudgetMs(900)).toBe(STUDIO_MAX_BUDGET_MS); // Render
    expect(studioBudgetMs(60)).toBe(40_000); // eski 60 sn'lik kısıt
  });

  it("asla 25 sn'nin altına düşmez (kısa limitlerde bile tur başlatılabilir)", () => {
    expect(studioBudgetMs(10)).toBe(25_000);
    expect(studioBudgetMs(0)).toBe(25_000);
  });
});

describe("dedupeBy", () => {
  it("büyük/küçük harf ve noktalama farkını aynı kabul eder", () => {
    expect(dedupeBy(["A/B testi", "ab testi", "C"], (x) => x)).toEqual(["A/B testi", "C"]);
  });
});
