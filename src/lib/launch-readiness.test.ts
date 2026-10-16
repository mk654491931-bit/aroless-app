/**
 * LANSMAN KAPISI — "bu ürün GERÇEKTEN atılabilir mi?" sözleşme testleri.
 *
 * Bu dosya iki şeyi kilitler:
 *   1. ÖLÇÜLMEMİŞ bir kapı ASLA `pass` ya da `fail` OLAMAZ — "bilmiyoruz" ile
 *      "kötü" ayrı durumlardır (dürüstlük kuralı).
 *   2. Eşikler ÖLÇÜLEN kanıta uygulanır: MOQ × FOB = ilk sipariş sermayesi,
 *      brüt marj tabanı, fiyat tabanı, kohort rakibi tavanı.
 */
import { describe, expect, it } from "vitest";

import {
  assessLaunch,
  LAUNCH_MAX_COMPETITORS,
  LAUNCH_MAX_FIRST_ORDER_USD,
  LAUNCH_MIN_GROSS_MARGIN_PCT,
  LAUNCH_MIN_PRICE_USD,
  type LaunchInput,
} from "./launch-readiness";

/** Ölçülmüş, sağlıklı bir aday: $59.9 perakende, $22 FOB, 30 adet MOQ, %63 marj. */
const healthy: LaunchInput = {
  priceUsd: 59.9,
  grossMarginPct: 63.3,
  supplierPriceUsd: 22,
  supplierPriceHighUsd: null,
  moqUnits: 30,
  moqUnit: "pieces",
  cohortCompetitors: 2,
};

describe("assessLaunch — ölçülen kanıttan atılabilirlik kararı", () => {
  it("tüm kapılar ölçülmüş ve iyiyse 'atılabilir' der; sermaye MOQ × FOB'dur", () => {
    const r = assessLaunch(healthy);
    expect(r.launchable).toBe(true);
    expect(r.gates).toHaveLength(5);
    expect(r.passed).toBe(5);
    expect(r.unknown).toBe(0);
    expect(r.blockers).toEqual([]);
    expect(r.firstOrderUsd).toBe(660); // 30 × $22
    expect(r.summary).toContain("Atılabilir");
    expect(r.summary).toContain("660");
  });

  it("FOB ARALIĞINDA konservatif (ÜST) uç kullanılır — iyimser sermaye gösterilmez", () => {
    const r = assessLaunch({ ...healthy, supplierPriceUsd: 13, supplierPriceHighUsd: 15 });
    // 30 × $15 (üst uç), 30 × $13 (alt uç) DEĞİL.
    expect(r.firstOrderUsd).toBe(450);
    expect(r.gates.find((g) => g.id === "sourcing")!.value).toContain("–");
  });

  it("MOQ yüksekse ilk sipariş kapısı ENGELLER (marj iyi olsa bile)", () => {
    // Ölçülmüş örnek: 1.480 adetlik MOQ × $18 = $26.640 ilk sipariş.
    const r = assessLaunch({ ...healthy, moqUnits: 1480, supplierPriceUsd: 18 });
    expect(r.launchable).toBe(false);
    expect(r.failed).toBe(1);
    expect(r.firstOrderUsd).toBe(26640);
    expect(r.blockers.join(" ")).toContain("İlk sipariş");
    expect(r.summary).toContain("Atılamaz");
  });

  it("tam tavandaki sermaye GEÇER (sınır dışlamaz)", () => {
    const unit = 10;
    const moq = LAUNCH_MAX_FIRST_ORDER_USD / unit;
    const r = assessLaunch({
      ...healthy,
      supplierPriceUsd: unit,
      supplierPriceHighUsd: null,
      moqUnits: moq,
    });
    expect(r.firstOrderUsd).toBe(LAUNCH_MAX_FIRST_ORDER_USD);
    expect(r.gates.find((g) => g.id === "firstOrder")!.state).toBe("pass");
  });

  it("brüt marj tabanın altındaysa marj kapısı ENGELLER", () => {
    const r = assessLaunch({ ...healthy, grossMarginPct: LAUNCH_MIN_GROSS_MARGIN_PCT - 5 });
    expect(r.launchable).toBe(false);
    expect(r.gates.find((g) => g.id === "margin")!.state).toBe("fail");
    expect(r.blockers.join(" ")).toContain("Brüt marj");
  });

  it("satış fiyatı tabanın altındaysa fiyat kapısı ENGELLER", () => {
    const r = assessLaunch({ ...healthy, priceUsd: LAUNCH_MIN_PRICE_USD - 3, grossMarginPct: 70 });
    expect(r.launchable).toBe(false);
    expect(r.gates.find((g) => g.id === "price")!.state).toBe("fail");
  });

  it("kohort rakibi tavanı aşarsa rekabet kapısı ENGELLER", () => {
    const r = assessLaunch({ ...healthy, cohortCompetitors: LAUNCH_MAX_COMPETITORS + 4 });
    expect(r.launchable).toBe(false);
    expect(r.gates.find((g) => g.id === "competition")!.state).toBe("fail");
    expect(r.summary).toContain("Rakip yoğunluğu");
  });
});

describe("assessLaunch — ölçülmemiş alan UYDURULMAZ", () => {
  it("hiçbir ölçüm yoksa tüm kapılar 'unknown'; asla pass/fail olmaz", () => {
    const r = assessLaunch({
      priceUsd: null,
      grossMarginPct: null,
      supplierPriceUsd: null,
      moqUnits: null,
      cohortCompetitors: null,
    });
    expect(r.launchable).toBe(false);
    expect(r.passed).toBe(0);
    expect(r.failed).toBe(0);
    expect(r.unknown).toBe(5);
    expect(r.firstOrderUsd).toBeNull();
    for (const gate of r.gates) {
      expect(gate.state).toBe("unknown");
      expect(gate.value).toBe("—");
      expect(gate.detail).not.toContain("%0");
    }
    expect(r.summary).toContain("Kanıt eksik");
  });

  it("MOQ ölçülmediyse sermaye 'unknown' — 0 ya da tahmin yazılmaz", () => {
    const r = assessLaunch({ ...healthy, moqUnits: null });
    const gate = r.gates.find((g) => g.id === "firstOrder")!;
    expect(gate.state).toBe("unknown");
    expect(gate.value).toBe("—");
    expect(r.firstOrderUsd).toBeNull();
    // MOQ yokluğu diğer kapıları etkilemez: marj ve tedarik hâlâ geçer.
    expect(r.gates.find((g) => g.id === "margin")!.state).toBe("pass");
    expect(r.launchable).toBe(true);
  });

  it("MOQ ölçülü ama birim FOB yoksa sermaye yine hesaplanmaz", () => {
    const r = assessLaunch({ ...healthy, supplierPriceUsd: null, moqUnits: 500 });
    expect(r.gates.find((g) => g.id === "firstOrder")!.state).toBe("unknown");
    expect(r.firstOrderUsd).toBeNull();
  });

  it("tedarik fiyatı ölçülmediyse ATILABİLİR DENMEZ (alış maliyeti bilinmiyor)", () => {
    const r = assessLaunch({ ...healthy, supplierPriceUsd: null });
    expect(r.launchable).toBe(false);
    expect(r.summary).toContain("Kanıt eksik");
    expect(r.summary).toContain("tedarik");
  });

  it("marj ölçülmediyse ATILABİLİR DENMEZ", () => {
    const r = assessLaunch({ ...healthy, grossMarginPct: null });
    expect(r.launchable).toBe(false);
    expect(r.gates.find((g) => g.id === "margin")!.state).toBe("unknown");
  });

  it("rekabet ölçülmediyse tek başına kararı engellemez (bilinmeyen ≠ kötü)", () => {
    const r = assessLaunch({ ...healthy, cohortCompetitors: null });
    expect(r.gates.find((g) => g.id === "competition")!.state).toBe("unknown");
    expect(r.launchable).toBe(true);
    expect(r.summary).toContain("1 kapı ölçülmedi");
  });
});
