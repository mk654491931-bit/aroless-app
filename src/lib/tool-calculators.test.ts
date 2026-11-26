import { describe, expect, it } from "vitest";
import {
  addDays,
  capitalPlan,
  channelMarginPlan,
  channelProfile,
  desiPlan,
  fbaSizeTier,
  landedCostPlan,
  leadTimePlan,
  milestonePlan,
  parsePriceList,
  priceStrategyPlan,
  reverseCostPlan,
} from "./tool-calculators";

describe("channelProfile", () => {
  it("serbest metin kanal adlarını doğru profile eşler", () => {
    expect(channelProfile("Amazon US").id).toBe("amazon");
    expect(channelProfile("Amazon.de").id).toBe("amazon-eu");
    expect(channelProfile("TikTok Shop US").id).toBe("tiktok");
    expect(channelProfile("Trendyol").id).toBe("trendyol");
    expect(channelProfile("Hepsiburada").id).toBe("trendyol");
    expect(channelProfile("bilinmeyen kanal").id).toBe("shopify");
  });
});

describe("reverseCostPlan", () => {
  it("Amazon US'te hedef marjı ve kanal kesintilerini düşer", () => {
    const plan = reverseCostPlan({ retail: 39.99, marginPct: 30, channel: "Amazon US" });
    // Komisyon 5.9985 + FBA 4.75 + iade 1.9995 + reklam 4.7988 + misc 0.45
    expect(plan.fees).toBeCloseTo(17.9968, 2);
    expect(plan.targetProfit).toBeCloseTo(11.997, 2);
    expect(plan.maxCogs).toBeCloseTo(9.9962, 1);
    expect(plan.feasible).toBe(true);
    expect(plan.breakdown).toHaveLength(7);
  });

  it("maliyet hedefin üstündeyse ulaşılamaz der, sıfıra gizlemez", () => {
    const plan = reverseCostPlan({ retail: 10, marginPct: 80, channel: "Shopify" });
    expect(plan.feasible).toBe(false);
    expect(plan.maxCogs).toBeLessThan(0);
  });

  it("boş girdide sıfır döndürür, NaN sızdırmaz", () => {
    const plan = reverseCostPlan({ retail: "", marginPct: "", channel: "" });
    expect(plan.retail).toBe(0);
    expect(plan.maxCogs).toBeLessThanOrEqual(0);
  });
});

describe("landedCostPlan", () => {
  it("gümrük ve navlunu toplam ve birim maliyete yazar", () => {
    const plan = landedCostPlan({
      unit: 3.2,
      qty: 1000,
      freight: 850,
      dutyPct: 12,
      extra: 150,
    });
    expect(plan.goods).toBe(3200);
    expect(plan.duty).toBe(384);
    expect(plan.total).toBe(4584);
    expect(plan.perUnit).toBe(4.58);
    expect(plan.effectiveLandedMultiple).toBe(1.43);
  });

  it("adet sıfırsa birim maliyeti sıfır tutar", () => {
    const plan = landedCostPlan({ unit: 3, qty: 0, freight: 10, dutyPct: 10, extra: 0 });
    expect(plan.total).toBe(10);
    expect(plan.perUnit).toBe(0);
  });
});

describe("capitalPlan", () => {
  it("stok, navlun ve tedarik süresi reklamını toplar", () => {
    const plan = capitalPlan({
      units: 1000,
      unit: 3.2,
      freight: 850,
      adsPerDay: 40,
      velocity: 12,
      leadTime: 35,
      today: "2026-11-09",
    });
    expect(plan.total).toBe(5450);
    expect(plan.stockoutDays).toBe(83.3);
    expect(plan.reorderInDays).toBe(48.3);
    expect(plan.reorderDate).toBe("2026-12-27");
    expect(plan.safetyStock).toBe(84);
  });

  it("satış hızı sıfırsa tarih üretmeye çalışmaz", () => {
    const plan = capitalPlan({
      units: 100,
      unit: 2,
      freight: 20,
      adsPerDay: 5,
      velocity: 0,
      leadTime: 20,
      today: "2026-11-09",
    });
    expect(plan.stockoutDays).toBe(0);
    expect(plan.safetyStock).toBe(0);
    expect(plan.reorderDate).toBe("2026-11-09");
  });
});

describe("desiPlan", () => {
  it("hacimsel ağırlığı gerçek ağırlıkla kıyaslar", () => {
    const plan = desiPlan({ l: 30, w: 22, h: 14, weight: 0.9 });
    expect(plan.volumetricKg).toBe(1.85);
    expect(plan.billableKg).toBe(1.85);
    expect(plan.isVolumetric).toBe(true);
  });
});

describe("fbaSizeTier", () => {
  it("küçük standart ve büyük standart kademelerini ayırır", () => {
    const small = fbaSizeTier({ l: 20, w: 15, h: 1.5, weight: 0.3 });
    expect(small.tier).toBe("small-standard");
    expect(small.label).toBe("Small standard");

    const large = fbaSizeTier({ l: 30, w: 22, h: 14, weight: 0.9 });
    expect(large.tier).toBe("large-standard");
    expect(large.blocker).toBeNull();
  });

  it("ağırlık sınırını aşınca ekstra büyük sınıf ve nedeni döner", () => {
    const oversized = fbaSizeTier({ l: 30, w: 22, h: 14, weight: 30 });
    expect(oversized.tier).toBe("extra-large");
    expect(oversized.blocker).toContain("Ağırlık");
  });
});

describe("channelMarginPlan", () => {
  it("dört kanalı karşılaştırır ve en kârlıyı seçer", () => {
    const plan = channelMarginPlan({ price: 39.99, cost: 8.5 });
    expect(plan.rows).toHaveLength(4);
    expect(plan.best).not.toBeNull();
    expect(plan.worst).not.toBeNull();
    expect(plan.best!.netProfit).toBeGreaterThanOrEqual(plan.worst!.netProfit);
    expect(plan.rows.find((row) => row.id === "amazon-eu")?.vatPct).toBe(20);
    expect(plan.spread).toBeGreaterThan(0);
  });

  it("maliyet fiyatı aşınca tüm kanalları zararda işaretler", () => {
    const plan = channelMarginPlan({ price: 10, cost: 25 });
    expect(plan.rows.every((row) => !row.feasible)).toBe(true);
  });
});

describe("fiyat stratejisi", () => {
  it("farklı fiyat yazımlarını ayrıştırır", () => {
    expect(parsePriceList("$24.99, 27,50, 1,299.00, 19,99")).toEqual([24.99, 27.5, 1299, 19.99]);
  });

  it("başabaş, taban ve önerilen fiyatı hesaplar", () => {
    const plan = priceStrategyPlan({
      cost: 8,
      competitors: "24.99, 27.50, 19.99",
      channel: "Amazon US",
      targetMarginPct: 20,
    });
    expect(plan.competitor?.median).toBe(24.99);
    expect(plan.suggestedPrice).toBeGreaterThanOrEqual(plan.floorPrice);
    expect(plan.breakEvenPrice).toBeLessThan(plan.floorPrice);
    expect(plan.feasible).toBe(true);
    expect(plan.marginAtSuggested).toBeGreaterThan(15);
  });

  it("rakip fiyatı yoksa taban fiyatla ve 'veri yok' konumuyla döner", () => {
    const plan = priceStrategyPlan({ cost: 8, competitors: "", channel: "Shopify" });
    expect(plan.competitor).toBeNull();
    expect(plan.suggestedPrice).toBe(plan.floorPrice);
    expect(plan.positioning).toBe("veri yok");
  });
});

describe("milestonePlan", () => {
  it("yüzde 30 depozito ve yüzde 70 bakiyeyi hesaplar", () => {
    const plan = milestonePlan({ amount: 4200, leadTime: 35 });
    expect(plan.deposit).toBe(1260);
    expect(plan.balance).toBe(2940);
    expect(plan.qcDay).toBe(25);
    expect(plan.balanceDay).toBe(35);
  });
});

describe("leadTimePlan", () => {
  it("yeniden sipariş ve stok tükenme tarihini takvim günü verir", () => {
    const plan = leadTimePlan({
      today: "2026-11-09",
      production: 25,
      transit: 32,
      checkin: 5,
      stock: 600,
      velocity: 14,
    });
    expect(plan.totalDays).toBe(62);
    expect(plan.stockoutDays).toBe(42.9);
    expect(plan.reorderInDays).toBe(-19.1);
    expect(plan.overdueDays).toBe(20);
    expect(plan.reorderDate).toBe("2026-11-09");
    expect(plan.stockoutDate).toBe("2026-12-22");
    expect(plan.safetyStock).toBe(174);
  });

  it("stok yeterliyse ileri tarih verir", () => {
    const plan = leadTimePlan({
      today: "2026-11-09",
      production: 10,
      transit: 10,
      checkin: 2,
      stock: 600,
      velocity: 5,
    });
    expect(plan.reorderInDays).toBe(98);
    expect(plan.reorderDate).toBe("2027-02-15");
    expect(plan.overdueDays).toBe(0);
  });
});

describe("addDays", () => {
  it("ay ve yıl sınırını UTC'de geçer", () => {
    expect(addDays("2026-12-30", 5)).toBe("2027-01-04");
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
  });
});
