/**
 * STEAM KAYNAĞI — uydurma sayı üretmediğini kanıtlayan testler (ağ YOK).
 *
 * Kapsam ve neden:
 *   Bu kaynak "gerçek ürün + gerçek sayı" isteğini karşılamak için eklendi.
 *   Asıl risk, sayı YOKLUĞUNDA bir şey uydurmak (metascore Steam'de hiçbir
 *   uçta yayımlanmıyor; yoksa yüzde puan kolayca uydurulabilirdi) veya
 *   ölçülmüş sayıyı yanlış ölçekte yazmak (review_score 1-10, bizim şema 0-5).
 *
 * Sabitlenen kurallar:
 *   1. `review_score` 1-10 → 5'lik ölçeğe BÖLÜNÜR, uydurma puan yok.
 *   2. Değerlendirme yoksa `rating` VE `ratingCount` `null` kalır.
 *   3. Fiyat para birimi USD değilse `priceUsd` `null`; kur çevrimi yapılmaz.
 *   4. Nişle ilgisi olmayan oyun (Steam araması gevşektir) elenir.
 *   5. Ne fiyatı ne puanı olan oyun gürültü kapısından geçemez.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { steamSource } from "./product-discovery-sources.server";

type FetchCall = { url: string };

const calls: FetchCall[] = [];

/** Steam'in iki ucunu taklit eder; `storesearch` + `appreviews`. */
function stubSteam(opts: {
  items?: {
    name?: string;
    id?: number;
    price?: { currency?: string; final?: number };
    tiny_image?: string;
  }[];
  summaries?: Record<number, { review_score?: number; total_reviews?: number; total_positive?: number; total_negative?: number }>;
}) {
  calls.length = 0;
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = String(input);
    calls.push({ url });
    const respond = (body: unknown) =>
      ({ ok: true, status: 200, text: async () => JSON.stringify(body) }) as Response;

    const review = /appreviews\/(\d+)/.exec(url);
    if (review) {
      const id = Number(review[1]);
      return respond({ query_summary: opts.summaries?.[id] ?? {} });
    }
    if (url.includes("storesearch")) return respond({ total: opts.items?.length ?? 0, items: opts.items ?? [] });
    return respond({});
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("steamSource — gerçek sayı, uydurma yok", () => {
  it("Steam'in 1-10 puanını 5'lik ölçeğe böler ve değerlendirme sayısını korur", async () => {
    stubSteam({
      items: [{ name: "Great Strategy Game", id: 11, price: { currency: "USD", final: 1999 }, tiny_image: "i.png" }],
      summaries: { 11: { review_score: 8, total_reviews: 1540, total_positive: 1300, total_negative: 240 } },
    });

    const rows = await steamSource.scrape("strategy game");

    expect(rows).toHaveLength(1);
    expect(rows[0].priceUsd).toBe(19.99);
    // 8/10 → 4.0/5. Ham puan da notta korunur ki ölçek karışmasın.
    expect(rows[0].rating).toBe(4);
    expect(rows[0].ratingCount).toBe(1540);
    expect(rows[0].notes).toContain("oy 8/10");
    expect(rows[0].notes).toContain("1.540 değerlendirme");
    // Marka uydurulmaz: Steam mağaza adıdır, ürünün markası değil.
    expect(rows[0].brand).toBe("");
    expect(rows[0].seller).toBe("Steam Store");
  });

  it("kimse oy vermemişse puan ve sayı null kalır (uydurma yok)", async () => {
    stubSteam({
      items: [{ name: "Unrated Strategy Game", id: 22, price: { currency: "USD", final: 999 } }],
      summaries: { 22: { review_score: 0, total_reviews: 0 } },
    });

    const rows = await steamSource.scrape("strategy game");

    expect(rows).toHaveLength(1);
    expect(rows[0].rating).toBeNull();
    expect(rows[0].ratingCount).toBeNull();
  });

  it("fiyatı olmayan oyuna puan varsa satır yine de kanıttır", async () => {
    stubSteam({
      items: [{ name: "Free Strategy Game", id: 33 }],
      summaries: { 33: { review_score: 9, total_reviews: 90000 } },
    });

    const rows = await steamSource.scrape("strategy game");

    expect(rows).toHaveLength(1);
    expect(rows[0].priceUsd).toBeNull();
    expect(rows[0].rating).toBe(4.5);
  });

  it("USD olmayan fiyatı USD'ye ÇEVİRMEZ", async () => {
    stubSteam({
      items: [{ name: "Turkish Strategy Game", id: 44, price: { currency: "TRY", final: 15000 } }],
      summaries: { 44: { review_score: 7, total_reviews: 40 } },
    });

    const rows = await steamSource.scrape("strategy game");

    expect(rows[0].priceUsd).toBeNull();
    // Gerçek fiyat kaybolmaz; kendi para biriminde notta durur.
    expect(rows[0].notes).toContain("fiyat TRY 150.00");
  });

  it("nişle ilgisi olmayan oyunu eler (Steam araması gevşektir)", async () => {
    stubSteam({
      items: [
        { name: "Kitchen Cooking Simulator", id: 55, price: { currency: "USD", final: 2999 } },
        { name: "Strategy Game Deluxe", id: 66, price: { currency: "USD", final: 1999 } },
      ],
      summaries: {
        55: { review_score: 9, total_reviews: 50000 },
        66: { review_score: 8, total_reviews: 100 },
      },
    });

    const rows = await steamSource.scrape("strategy game");

    expect(rows.map((r) => r.title)).toEqual(["Strategy Game Deluxe"]);
  });

  it("ne fiyatı ne puanı olan oyunu gürültü kapısından geçirmez", async () => {
    stubSteam({
      items: [{ name: "Bare Strategy Game", id: 77 }],
      summaries: { 77: {} },
    });

    expect(await steamSource.scrape("strategy game")).toEqual([]);
  });

  it("oyun dışı nişte Steam satırı UYDURMAZ (boş döner)", async () => {
    stubSteam({
      items: [{ name: "Desk Lamp Deluxe", id: 88, price: { currency: "USD", final: 4999 } }],
      summaries: { 88: { review_score: 9, total_reviews: 12 } },
    });

    expect(await steamSource.scrape("LED masa lambası")).toEqual([]);
  });

  it("puan uçlarından biri düşerse o satır düşmez (fail-soft)", async () => {
    stubSteam({
      items: [{ name: "Strategy Game Alpha", id: 99, price: { currency: "USD", final: 1999 } }],
      summaries: {},
    });
    calls.length = 0;
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = String(input);
      if (url.includes("appreviews")) return { ok: false, status: 500, text: async () => "" } as Response;
      return original(input as string);
    });

    const rows = await steamSource.scrape("strategy game");

    // Puan gelmez ama GERÇEK fiyat vardır → satır kaybolmaz.
    expect(rows).toHaveLength(1);
    expect(rows[0].priceUsd).toBe(19.99);
    expect(rows[0].rating).toBeNull();
  });
});