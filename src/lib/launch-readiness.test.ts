/**
 * LANSMAN KAPISI — "bu ürün GERÇEKTEN atılabilir mi?" sözleşme testleri.
 *
 * Bu dosya üç şeyi kilitler:
 *   1. ÖLÇÜLMEMİŞ bir kapı ASLA `pass` ya da `fail` OLAMAZ — "bilmiyoruz" ile
 *      "kötü" ayrı durumlardır (dürüstlük kuralı).
 *   2. Eşikler ARAŞTIRMAYLA seçilmiş ve ölçülen kanıta uygulanır: MOQ × FOB =
 *      ilk sipariş sermayesi, %60 brüt marj tabanı (2,5-3× iniş maliyeti),
 *      sipariş başına katkı ≥ $35 (Meta medyan CPA ≈ $38,99), fiyat tabanı,
 *      kohort rakibi tavanı.
 *   3. Mevzuat/IP kapısı VETO yönünde çalışır: kelime bulunursa ürün lansmana
 *      uygun sayılmaz; kelime bulunmaması hukuki temizlik DEMEK DEĞİLDİR.
 */
import { describe, expect, it } from "vitest";

import {
  assessLaunch,
  LAUNCH_MAX_COMPETITORS,
  LAUNCH_MAX_FIRST_ORDER_USD,
  LAUNCH_MIN_AD_BUDGET_USD,
  LAUNCH_MIN_GROSS_MARGIN_PCT,
  LAUNCH_MIN_PRICE_USD,
  type LaunchInput,
} from "./launch-readiness";

/**
 * Ölçülmüş, sağlıklı bir aday: $59,9 perakende, $22 FOB, 30 adet MOQ, %63 marj
 * → katkı $37,9 (reklam tabanının üstünde).
 */
const healthy: LaunchInput = {
  name: "Ninja Air Fryer Pro 6 Qt",
  priceUsd: 59.9,
  grossMarginPct: 63.3,
  supplierPriceUsd: 22,
  supplierPriceHighUsd: null,
  moqUnits: 30,
  moqUnit: "pieces",
  cohortCompetitors: 2,
};

const gate = (r: ReturnType<typeof assessLaunch>, id: string) => r.gates.find((g) => g.id === id)!;

describe("assessLaunch — ölçülen kanıttan atılabilirlik kararı", () => {
  it("tüm kapılar ölçülmüş ve iyiyse 'atılabilir' der; sermaye MOQ × FOB'dur", () => {
    const r = assessLaunch(healthy);
    expect(r.launchable).toBe(true);
    expect(r.gates).toHaveLength(7);
    expect(r.passed).toBe(7);
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
    expect(gate(r, "sourcing").value).toContain("–");
  });

  it("MOQ yüksekse ilk sipariş kapısı ENGELLER (marj iyi olsa bile)", () => {
    // Ölçülmüş örnek: 1.480 adetlik MOQ × $18 = $26.640 ilk sipariş.
    const r = assessLaunch({ ...healthy, moqUnits: 1480, supplierPriceUsd: 18 });
    expect(r.launchable).toBe(false);
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
    expect(gate(r, "firstOrder").state).toBe("pass");
  });

  it("brüt marj %60 tabanının altındaysa marj kapısı ENGELLER", () => {
    // %55: eski %40 tabanını GEÇERDİ ama 2,5-3× iniş maliyeti kuralının altında.
    const r = assessLaunch({ ...healthy, grossMarginPct: 55 });
    expect(r.launchable).toBe(false);
    expect(gate(r, "margin").state).toBe("fail");
    expect(r.blockers.join(" ")).toContain("Brüt marj");
    expect(LAUNCH_MIN_GROSS_MARGIN_PCT).toBe(60);
  });

  it("sipariş başına katkı reklam tabanının altındaysa REKLAM BÜTÇESİ kapısı engeller", () => {
    // $24,99 perakende − $13 toptan = $11,99 katkı: %48 marj olsa da ücretli
    // trafikte $39'luk medyan CPA'yı karşılamaz.
    const r = assessLaunch({
      ...healthy,
      name: "LED Desk Lamp Clip On",
      priceUsd: 24.99,
      supplierPriceUsd: 13,
      grossMarginPct: 48,
    });
    expect(gate(r, "adBudget").state).toBe("fail");
    expect(r.launchable).toBe(false);
    expect(r.summary).toContain("Reklam bütçesi");
    expect(LAUNCH_MIN_AD_BUDGET_USD).toBe(35);
  });

  it("katkı tam tabandaysa reklam kapısı GEÇER", () => {
    const r = assessLaunch({
      ...healthy,
      priceUsd: 60,
      supplierPriceUsd: 25, // katkı tam $35
      grossMarginPct: 58.3,
    });
    expect(gate(r, "adBudget").state).toBe("pass");
  });

  it("satış fiyatı tabanın altındaysa fiyat kapısı ENGELLER", () => {
    const r = assessLaunch({ ...healthy, priceUsd: LAUNCH_MIN_PRICE_USD - 3, grossMarginPct: 70 });
    expect(r.launchable).toBe(false);
    expect(gate(r, "price").state).toBe("fail");
  });

  it("kohort rakibi tavanı aşarsa rekabet kapısı ENGELLER", () => {
    const r = assessLaunch({ ...healthy, cohortCompetitors: LAUNCH_MAX_COMPETITORS + 4 });
    expect(r.launchable).toBe(false);
    expect(gate(r, "competition").state).toBe("fail");
    expect(r.summary).toContain("Rakip yoğunluğu");
  });
});

describe("assessLaunch — NİŞ BANDI (proxy) tedarik 'atılabilir' SAYILMAZ", () => {
  /**
   * ÖLÇÜLEN DURUM (canlı koşu, 2026-10-16): 30 adayın 13'ü BİREBİR ürün
   * teklifi bulamadı ve AYNI NİŞTEN ölçülen fiyat bandıyla fiyatlandı; eski
   * kod bu adayları da "atılabilir" sayıyordu. Kaynak araştırması bunu açıkça
   * yanlış buluyor: kategori medyanı ürünün maliyeti yerine konmaz, go/no-go
   * kararı ürünün KENDİ teklifini ister.
   */
  it("niş bandı → tedarik kapısı `unknown` (ölçüm var ama ÜRÜNE ait değil)", () => {
    const r = assessLaunch({ ...healthy, supplierMatchKind: "niche" });
    expect(gate(r, "sourcing").state).toBe("unknown");
    expect(gate(r, "sourcing").value).toContain("niş bandı");
    expect(gate(r, "sourcing").detail).toContain("proxy");
    // Ölçüm var diye `pass` sayılsaydı bu satır kırmızıya dönerdi.
    expect(r.launchable).toBe(false);
    expect(r.failed).toBe(0);
    expect(r.summary).toContain("Kanıt eksik");
    expect(r.summary).toContain("NİŞ BANDIYLA");
  });

  it("proxy'de MOQ'nun bu ürüne ait olmadığı İLK SİPARİŞ kapısında yazılır", () => {
    const r = assessLaunch({ ...healthy, supplierMatchKind: "niche" });
    expect(gate(r, "firstOrder").detail).toContain("aynı nişteki");
    // Birebir eşleşmede bu uyarı BULUNMAZ (yanlış alarm üretmez).
    expect(gate(assessLaunch(healthy), "firstOrder").detail).not.toContain("aynı nişteki");
  });

  it("birebir ürün teklifi (product) eskisi gibi geçer", () => {
    const r = assessLaunch({ ...healthy, supplierMatchKind: "product" });
    expect(gate(r, "sourcing").state).toBe("pass");
    expect(r.launchable).toBe(true);
  });

  it("tür alanı taşımayan (alan eklenmeden ÖNCE yazılmış) kayıt `product` sayılır", () => {
    // Eski kayıtlarda kanıt yalnız birebir eşleşmeyle üretilebiliyordu; alanı
    // zorunlu kılmak eski kayıtların kararını bozardı.
    expect(assessLaunch({ ...healthy, supplierMatchKind: undefined }).launchable).toBe(true);
    expect(assessLaunch({ ...healthy, supplierMatchKind: null }).launchable).toBe(true);
  });

  it("proxy ÖLÇÜLMEMİŞ tedarikten ayrı tutulur: bant yoksa 'ölçülmedi' denir", () => {
    const r = assessLaunch({ ...healthy, supplierMatchKind: "niche", supplierPriceUsd: null });
    expect(gate(r, "sourcing").value).toBe("—");
    expect(gate(r, "sourcing").detail).toContain("bulunamadı");
  });

  it("proxy olsa bile GERÇEK engeller yazılmaya devam eder", () => {
    const r = assessLaunch({ ...healthy, supplierMatchKind: "niche", grossMarginPct: 41 });
    expect(r.blockers.join(" ")).toContain("Brüt marj");
    expect(r.summary).toContain("Atılamaz");
  });
});

describe("assessLaunch — mevzuat/IP VETOSU", () => {
  it("riskli kategorideki başlık lansmana uygun SAYILMAZ (marj/kâr ne olursa olsun)", () => {
    for (const name of [
      "Rechargeable Lithium Battery Pack 20000mAh",
      "Vitamin C Serum Face Cream",
      "Mini Laser Engraver",
      "Kids Toy RC Car",
      "Rolex replica watch 1:1",
      "Tactical Folding Knife",
    ]) {
      const r = assessLaunch({ ...healthy, name });
      expect(gate(r, "risk").state).toBe("fail");
      expect(r.launchable).toBe(false);
      expect(r.blockers.join(" ")).toContain("Mevzuat/IP");
    }
  });

  it("temiz başlıkta risk kapısı geçer ama hukuki GARANTİ olmadığını söyler", () => {
    const r = assessLaunch(healthy);
    expect(gate(r, "risk").state).toBe("pass");
    expect(gate(r, "risk").detail).toContain("SÖZCÜK TARAMASIDIR");
  });

  it("ürün adı verilmezse risk kapısı 'unknown' kalır (uydurma yok)", () => {
    const { name: _name, ...noName } = healthy;
    const r = assessLaunch(noName);
    expect(gate(r, "risk").state).toBe("unknown");
    expect(gate(r, "risk").value).toBe("—");
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
    expect(r.unknown).toBe(7);
    expect(r.firstOrderUsd).toBeNull();
    for (const g of r.gates) {
      expect(g.state).toBe("unknown");
      expect(g.value).toBe("—");
      expect(g.detail).not.toContain("%0");
    }
    expect(r.summary).toContain("Kanıt eksik");
  });

  it("MOQ ölçülmediyse sermaye 'unknown' — 0 ya da tahmin yazılmaz", () => {
    const r = assessLaunch({ ...healthy, moqUnits: null });
    expect(gate(r, "firstOrder").state).toBe("unknown");
    expect(gate(r, "firstOrder").value).toBe("—");
    expect(r.firstOrderUsd).toBeNull();
    // MOQ yokluğu kararın tamamını düşürmez: diğer dört çekirdek kapı geçiyor.
    expect(gate(r, "margin").state).toBe("pass");
    expect(r.launchable).toBe(true);
  });

  it("MOQ ölçülü ama birim FOB yoksa sermaye yine hesaplanmaz", () => {
    const r = assessLaunch({ ...healthy, supplierPriceUsd: null, moqUnits: 500 });
    expect(gate(r, "firstOrder").state).toBe("unknown");
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
    expect(gate(r, "margin").state).toBe("unknown");
  });

  it("rekabet ölçülmediyse tek başına kararı engellemez (bilinmeyen ≠ kötü)", () => {
    const r = assessLaunch({ ...healthy, cohortCompetitors: null });
    expect(gate(r, "competition").state).toBe("unknown");
    expect(r.launchable).toBe(true);
    expect(r.summary).toContain("1 kapı ölçülmedi");
  });

  it("çekirdek kapılardan biri ölçülmediyse karar geçmez ama 'engel' de yazılmaz", () => {
    // Fiyat ölçülmedi → reklam bütçesi de hesaplanamaz; ikisi `unknown` olur.
    const r = assessLaunch({ ...healthy, priceUsd: null });
    expect(r.launchable).toBe(false);
    expect(r.failed).toBe(0);
    expect(r.blockers).toEqual([]);
    expect(r.summary).toContain("Kanıt eksik");
  });
});
