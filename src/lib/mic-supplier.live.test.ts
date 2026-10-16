/**
 * MIC TEDARİK KAYNAĞI + LANSMAN KAPISI — CANLI AĞ TESTİ (mock YOK).
 *
 * Normal `npm test` koşusunda ATLANIR. Canlı koşu:
 *   MIC_LIVE=1 npx vitest run mic-supplier.live
 *   MIC_LIVE=1 MIC_LIVE_NICHES="air fryer,led desk lamp" npx vitest run mic-supplier.live
 *
 * Varlık sebebi: "yeni ücretsiz kaynak MOQ/FOB/tedarikçi ölçüyor ve bu ölçümle
 * lansman kararı üretiliyor" sözü KAĞIT ÜSTÜNDE KALMAMALI. Test üç şeyi ölçer:
 *
 *   1. Kaynak gerçekten ürün döndürüyor (HTTP 200 + ayrıştırılabilir kart) ve
 *      her istek DİLİM BÜTÇESİNE sığıyor (ölçüldü: 0,4-1,4 sn).
 *   2. ÖLÇÜM BOŞLUKLARI: kaç teklifin FOB'u, kaçının MOQ'su, kaçının tedarikçi
 *      adı ölçüldü — sayılar log'a yazılır, sözleşme yalnız "en az bir ölçüm
 *      var" der (dış kaynak boş dönerse test KIRILMAZ: o bir ağ durumudur,
 *      uydurma değil).
 *   3. Ölçülen teklifler lansman kapısından geçirilebiliyor ve karar
 *      `unknown`/`fail` ayrımını koruyor (ölçülmeyen alan `pass` olmaz).
 *
 * KAYNAK BOŞ DÖNERSE HATA DEĞİLDİR (sözleşme fail-soft); test yalnız şunu
 * zorunlu kılar: kaynak ya ÖLÇÜM üretir ya da SESSİZ kalmaz (log'da sayı çıkar).
 */
import { describe, expect, it } from "vitest";

import { assessLaunch } from "./launch-readiness";
import {
  extractMicOffers,
  fetchMicOffers,
  micSearchUrl,
  type MicOffer,
} from "./mic-supplier.server";
import { buildEconomics, type SupplierOfferLike } from "./supplier-economics";

/**
 * MIC teklifi → eşleştirme sözleşmesi (hattın yaptığı dönüşümün BİREBİR aynısı).
 *
 * MIC'in ölçmediği alanlar `null`'dur: satış adedi, puan ve indirim bu kaynakta
 * YOKTUR ve testte de uydurulmaz.
 */
const toContract = (offers: readonly MicOffer[]): SupplierOfferLike[] =>
  offers.map((o) => ({
    title: o.title,
    unitPriceUsd: o.unitPriceUsd,
    unitPriceHighUsd: o.unitPriceHighUsd,
    listPriceUsd: null,
    discountPct: null,
    sold: null,
    rating: null,
    store: o.store,
    shipFrom: o.shipFrom,
    url: o.url,
    moqUnits: o.moqUnits,
    moqUnit: o.moqUnit,
  }));

const LIVE = process.env.MIC_LIVE === "1";
const NICHES = (process.env.MIC_LIVE_NICHES ?? "air fryer,cat scratching board")
  .split(",")
  .map((n) => n.trim())
  .filter(Boolean);

describe.skipIf(!LIVE)("MIC toptan kaynağı (canlı ağ)", () => {
  for (const niche of NICHES) {
    it(`toptan teklifleri ölçer ve lansman kararı üretir: "${niche}"`, async () => {
      const startedAt = Date.now();
      const offers = await fetchMicOffers(niche);
      const elapsed = Date.now() - startedAt;

      const priced = offers.filter((o) => o.unitPriceUsd !== null);
      const ranged = offers.filter((o) => o.unitPriceHighUsd !== null);
      const moq = offers.filter((o) => o.moqUnits !== null);
      const store = offers.filter((o) => o.store !== "");
      const moqs = moq.map((o) => o.moqUnits as number).sort((a, b) => a - b);
      const prices = priced.map((o) => o.unitPriceUsd as number).sort((a, b) => a - b);

      /* eslint-disable no-console */
      console.log(
        `\n[MIC] "${niche}" → ${elapsed}ms · ${offers.length} teklif · ` +
          `FOB ${priced.length} (%${Math.round((priced.length / (offers.length || 1)) * 100)}) · ` +
          `aralık ${ranged.length} · MOQ ${moq.length} · tedarikçi ${store.length}` +
          (prices.length ? ` · medyan FOB $${prices[Math.floor(prices.length / 2)]}` : "") +
          (moqs.length ? ` · medyan MOQ ${moqs[Math.floor(moqs.length / 2)]}` : ""),
      );
      for (const o of priced.slice(0, 3)) {
        console.log(
          `   $${o.unitPriceUsd}${o.unitPriceHighUsd ? `-${o.unitPriceHighUsd}` : ""}` +
            `${o.moqUnits ? ` · MOQ ${o.moqUnits} ${o.moqUnit}` : ""} · ${o.store || "tedarikçi ölçülmedi"} · ${o.title.slice(0, 60)}`,
        );
      }
      /* eslint-enable no-console */

      // 1) Süre tavanı: kaynak 8 sn timeout ile çağrılır, ölçülen 0,4-1,4 sn.
      expect(elapsed).toBeLessThanOrEqual(15_000);

      // 2) Üretilen teklifler TUTARLI: fiyatı olan her teklifin başlığı ve URL'si
      //    vardır; aralık varsa üst uç alt uçtan KÜÇÜK OLAMAZ (sayfa hatası).
      for (const o of offers) {
        expect(o.title.length).toBeGreaterThan(3);
        expect(o.url).toContain("/product/");
        if (o.unitPriceUsd !== null && o.unitPriceHighUsd !== null) {
          expect(o.unitPriceHighUsd).toBeGreaterThanOrEqual(o.unitPriceUsd);
        }
        if (o.moqUnits !== null) expect(o.moqUnits).toBeGreaterThanOrEqual(1);
      }
      // Sözleşme: MOQ ya ölçülür ya `null`dur — asla 0 yazılmaz.
      expect(offers.every((o) => o.moqUnits === null || o.moqUnits > 0)).toBe(true);

      if (priced.length === 0) {
        /* eslint-disable-next-line no-console */
        console.log(
          `[MIC] "${niche}" için fiyatlı teklif gelmedi (ağ/şema durumu) — karar üretimi atlandı.`,
        );
        return;
      }

      // 3. ÖLÇÜLEN tekliflerle karar üretilebilir: perakende fiyatı tekliflerin
      //    medyanının 3 KATI varsayılırsa (gerçek perakende hattı burada yok),
      //    kapılar ölçümden konuşur; ölçülmeyen kapı `unknown` kalır.
      const medianFob = prices[Math.floor(prices.length / 2)];
      const cheapest = offers
        .filter((o) => o.unitPriceUsd !== null)
        .sort((a, b) => (a.unitPriceUsd as number) - (b.unitPriceUsd as number))[0];
      const retail = Math.round(medianFob * 3 * 100) / 100;
      const { supplier, margin } = buildEconomics(
        { name: cheapest.title.slice(0, 60), priceUsd: retail },
        toContract(offers),
      );
      const launch = assessLaunch({
        priceUsd: retail,
        grossMarginPct: margin.grossMarginPct,
        supplierPriceUsd: supplier.supplierPriceUsd,
        supplierPriceHighUsd: supplier.supplierPriceHighUsd ?? null,
        moqUnits: supplier.moqUnits ?? null,
        moqUnit: supplier.moqUnit ?? "",
        cohortCompetitors: null,
      });
      /* eslint-disable-next-line no-console */
      console.log(
        `[MIC] karar: ${launch.summary} · ilk sipariş ${launch.firstOrderUsd ?? "ölçülmedi"}`,
      );

      // Eşleşme kurulduysa MOQ kanıtı KORUNMUŞ olmalı (uçtan uca taşınma).
      if (supplier.moqUnits !== null) {
        expect(supplier.moqUnits).toBeGreaterThanOrEqual(1);
        expect(launch.firstOrderUsd).not.toBeNull();
      }
      // Ölçülmeyen rekabet kapısı ASLA `pass` olmaz (dürüstlük sözleşmesi).
      expect(launch.gates.find((g) => g.id === "competition")!.state).toBe("unknown");
      expect(launch.gates.some((g) => g.state === "pass")).toBe(true);
    });
  }

  it("boş niş ağa ÇIKMAZ (kota yakılmaz)", async () => {
    expect(micSearchUrl("")).toBe("");
    expect(await fetchMicOffers("")).toEqual([]);
    expect(extractMicOffers("")).toEqual([]);
  });
});
