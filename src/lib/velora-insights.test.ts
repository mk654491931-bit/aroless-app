import { describe, expect, it } from "vitest";
import {
  councilAlignment,
  marketReach,
  marketReachLine,
  veloraQueryCacheKey,
  voteSpread,
  MARKET_REACH_COUNTRIES,
} from "./velora-insights";
import { countryBarrierFor } from "./market-barriers";
import { daysBetween, lookbackStart, summarizeTrackRecords } from "./velora-track-record.server";

describe("voteSpread", () => {
  it("tek oy sıfır yayılım verir", () => {
    expect(voteSpread([80])).toBe(0);
  });

  it("oy yoksa sıfır verir (uydurma yayılım üretmez)", () => {
    expect(voteSpread([])).toBe(0);
  });

  it("hepsi aynı puan → 0", () => {
    expect(voteSpread([71, 71, 71, 71])).toBe(0);
  });

  it("iki uç → ortalamaya göre gerçek yayılım", () => {
    // [90,90,90,90,50,50,50,50] → mean 70, stddev 20
    expect(voteSpread([90, 90, 90, 90, 50, 50, 50, 50])).toBe(20);
  });

  it("ortalama AYNI ama yayılım FARKLI olan iki dağılımı ayırır", () => {
    const unanimous = [71, 71, 71, 71, 71, 71, 71, 71, 71, 71, 71, 71];
    const split = [90, 90, 90, 90, 90, 90, 50, 50, 50, 50, 50, 50];
    expect(voteSpread(split)).toBeGreaterThan(voteSpread(unanimous));
  });
});

describe("councilAlignment", () => {
  it("oy yoksa 'none'", () => {
    expect(councilAlignment(0, 0)).toBe("none");
  });

  it("çok az oy 'none' — iki ajanın uyuşması fikir birliği sayılmaz", () => {
    expect(councilAlignment(2, 1)).toBe("none");
  });

  it("dar yayılım + yeterli oy → oy birliği", () => {
    expect(councilAlignment(14, 3)).toBe("unanimous");
  });

  it("geniş yayılım → çok tartışmalı", () => {
    expect(councilAlignment(14, 35)).toBe("contested");
  });

  it("sıralı: dar → geniş yayılım daha zayıf etiket verir", () => {
    const order = ["unanimous", "strong", "split", "contested"] as const;
    const spread = [5, 12, 20, 30];
    const labels = spread.map((s) => councilAlignment(14, s));
    expect(labels).toEqual(order);
  });
});

describe("marketReach", () => {
  it("BİLİNMEYEN kanalda pazar uygunluğu UYDURMAZ — hepsi kapalı işaretlenir", () => {
    const reach = marketReach({ platform: "BilinmeyenKanal", productText: "silikon kase" });
    expect(reach.entries.length).toBe(MARKET_REACH_COUNTRIES.length);
    expect(reach.entries.every((e) => e.verdict === "unavailable")).toBe(true);
  });

  it("bilinen kanalda Amazon için bazı pazarlar yerel olur", () => {
    const reach = marketReach({ platform: "Amazon", productText: "telefon kılıfı" });
    expect(reach.entries.some((e) => e.verdict === "open")).toBe(true);
  });

  it("bilinen bir ülke bariyerini yakalar ve NEDENİNİ yazar", () => {
    const reach = marketReach({
      platform: "Amazon",
      productText: "lityum pil şarj cihazı",
    });
    const de = reach.entries.find((e) => e.country === "DE");
    expect(de?.verdict).toBe("barrier");
    expect(de?.barrier).toBeTruthy();
  });

  it("bariyer eşleşmezse barrier NULL olur (izin var DEMEK DEĞİLDİR)", () => {
    expect(countryBarrierFor("DE", "silikon mutfak taşıyıcı")).toBeNull();
  });

  it("verilmemiş bariyer tablosunda 'bariyer yok' der, uydurma kural üretmez", () => {
    expect(countryBarrierFor("PT", "lityum pil")).toBeNull();
  });

  it("entries en uygun pazardan başlayarak sıralanır", () => {
    const reach = marketReach({ platform: "Amazon", productText: "telefon kılıfı" });
    const verdicts = reach.entries.map((e) => e.verdict);
    const rank = { open: 0, "cross-border": 1, unavailable: 2, barrier: 3 } as const;
    for (let i = 1; i < verdicts.length; i += 1) {
      expect(rank[verdicts[i]!]).toBeGreaterThanOrEqual(rank[verdicts[i - 1]!]);
    }
  });

  it("özet satırı ülke kodlarını içerir", () => {
    const line = marketReachLine(
      marketReach({ platform: "Amazon", productText: "telefon kılıfı" }),
    );
    expect(line).toMatch(/DE/);
  });
});

describe("veloraQueryCacheKey", () => {
  const base = { userId: "u1", query: "mini ice maker", country: "us", platform: "amazon" };

  it("aynı girdi aynı anahtarı üretir", () => {
    expect(veloraQueryCacheKey(base)).toBe(veloraQueryCacheKey({ ...base }));
  });

  it("bosluk/büyük-küçük farkı anahtarı DEĞİŞTİRMEZ (yoksa önbellek tutmaz)", () => {
    expect(veloraQueryCacheKey({ ...base, query: "  Mini   Ice  Maker " })).toBe(
      veloraQueryCacheKey(base),
    );
  });

  it("TÜRKÇE büyük I sorunu anahtarı bozmaz ('ICE' ve 'ice' aynı)", () => {
    // toLocaleLowerCase('tr-TR') kullanılsaydı "ICE" → "ıce" olurdu ve aynı sorgu
    // iki farklı anahtara düşer, önbellek sessizce boşa çalışardı.
    expect(veloraQueryCacheKey({ ...base, query: "ICE MAKER" })).toBe(
      veloraQueryCacheKey({ ...base, query: "ice maker" }),
    );
  });

  it("farklı kullanıcı → farklı anahtar (önbellek kişiye özel)", () => {
    expect(veloraQueryCacheKey({ ...base, userId: "u2" })).not.toBe(veloraQueryCacheKey(base));
  });

  it("farklı ülke veya kanal → farklı anahtar", () => {
    expect(veloraQueryCacheKey({ ...base, country: "DE" })).not.toBe(veloraQueryCacheKey(base));
    expect(veloraQueryCacheKey({ ...base, platform: "TikTok" })).not.toBe(
      veloraQueryCacheKey(base),
    );
  });
});

describe("track record", () => {
  const now = Date.parse("2026-09-25T00:00:00.000Z");

  it("anahtar HAM AD DEĞİL, normalize parmak izidir", () => {
    const out = summarizeTrackRecords(
      [{ title: "Mini Ice Maker XR-500", day: "2026-09-20", winner_score: 70 }],
      now,
    );
    expect(out["mini ice maker xr 500"]).toBeDefined();
    expect(out["Mini Ice Maker XR-500"]).toBeUndefined();
  });

  it("FARKLI YAZILMIŞ aynı ürün tek geçmişte birleşir", () => {
    const out = summarizeTrackRecords(
      [
        {
          title: "Mini Ice Maker XR-500",
          day: "2026-09-20",
          winner_score: 70,
          payload: { rank: 2 },
        },
        {
          title: "MINI  ICE MAKER  xr 500",
          day: "2026-09-22",
          winner_score: 90,
          payload: { rank: 1 },
        },
      ],
      now,
    );
    const key = "mini ice maker xr 500";
    expect(Object.keys(out)).toHaveLength(1);
    expect(out[key]).toMatchObject({ appearances: 2, avgScore: 80, bestRank: 1 });
  });

  it("hacim/model farkı AYRI ürün sayılır — temkinli kalmak yanlış eşleşmeden iyidir", () => {
    const out = summarizeTrackRecords(
      [
        { title: "Mini Ice Maker XR-500", day: "2026-09-20", winner_score: 70 },
        { title: "Mini Ice Maker XR-500 2.5L", day: "2026-09-22", winner_score: 80 },
      ],
      now,
    );
    expect(Object.keys(out)).toHaveLength(2);
  });

  it("ilk görülen ad etiket olarak korunur", () => {
    const out = summarizeTrackRecords(
      [{ title: "Mini Ice Maker XR-500", day: "2026-09-20", winner_score: 70 }],
      now,
    );
    expect(out["mini ice maker xr 500"]?.title).toBe("Mini Ice Maker XR-500");
  });

  it("aynı gündeki TEKRAR satırlar tek görünüş sayılır", () => {
    const out = summarizeTrackRecords(
      [
        { title: "A", day: "2026-09-20", winner_score: 70, payload: { rank: 1 } },
        { title: "A", day: "2026-09-20", winner_score: 80, payload: { rank: 2 } },
      ],
      now,
    );
    expect(out["a"]?.appearances).toBe(1);
  });

  it("farklı günler ayrı görünüş sayılır ve ortalama hesaplanır", () => {
    const out = summarizeTrackRecords(
      [
        { title: "A", day: "2026-09-20", winner_score: 60, payload: { rank: 3 } },
        { title: "A", day: "2026-09-22", winner_score: 80, payload: { rank: 1 } },
      ],
      now,
    );
    expect(out["a"]).toMatchObject({ appearances: 2, avgScore: 70, bestRank: 1 });
  });

  it("en son görülme günü ve gün farkı hesaplanır", () => {
    const out = summarizeTrackRecords([{ title: "A", day: "2026-09-20", winner_score: 70 }], now);
    expect(out["a"]?.lastSeenDay).toBe("2026-09-20");
    expect(out["a"]?.daysSinceSeen).toBe(5);
  });

  it("sıra bilinmiyorsa 99 (uydurma sıra üretmez)", () => {
    const out = summarizeTrackRecords([{ title: "A", day: "2026-09-20", winner_score: 70 }], now);
    expect(out["a"]?.bestRank).toBe(99);
  });

  it("başlıksız/geçersiz satırlar yutulur", () => {
    const out = summarizeTrackRecords(
      [
        { title: "  ", day: "2026-09-20", winner_score: 70 },
        { title: "A", day: "", winner_score: 70 },
      ],
      now,
    );
    expect(out).toEqual({});
  });

  it("gün farkı negatif günü 0'a kıstırır", () => {
    expect(daysBetween("2026-09-25", "2026-09-20")).toBe(0);
  });

  it("geriye dönük bakış tam sayı gün verir", () => {
    expect(lookbackStart(30, now)).toBe("2026-08-26");
  });
});
