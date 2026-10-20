// Jeton bakiyesi testleri.
//
// REGRESYON: arayüz yalnızca `credits` gösteriyordu, ürün bulucu ise ÖNCE
// `finder_credits`'i harcıyor. Ücretsiz kullanıcıda (0 genel + 2 finder) rozet
// sürekli 0 kalıyor ve arama "kredin bitti" diye engelleniyordu.
import { describe, expect, it } from "vitest";
import {
  UNKNOWN_CREDIT_LABEL,
  chargePoolFor,
  creditBalances,
  creditBreakdownLabel,
  creditCountLabel,
  hasSpendableCredits,
  type CreditProfile,
} from "./credits";

describe("creditBalances", () => {
  it("ücretsiz kullanıcı: 2 hoş geldin jetonu görünür (eskiden 0 görünüyordu)", () => {
    const free: CreditProfile = { credits: 0, finder_credits: 2 };
    expect(creditBalances(free)).toEqual({ finder: 2, general: 0, total: 2, spent: 0 });
  });

  it("admin/yüklü kullanıcı: genel jetonlar sayılır", () => {
    const admin: CreditProfile = { credits: 250, finder_credits: 0, credits_spent: 12 };
    expect(creditBalances(admin)).toEqual({ finder: 0, general: 250, total: 250, spent: 12 });
  });

  it("iki havuz toplanır (kullanıcı tek sayı görür)", () => {
    expect(creditBalances({ credits: 5, finder_credits: 3 }).total).toBe(8);
  });

  it("harcama toplamı DÜŞÜRÜR: hangi havuzdan düşerse düşsün", () => {
    const before = creditBalances({ credits: 0, finder_credits: 2 });
    const afterFinder = creditBalances({ credits: 0, finder_credits: 1 });
    const afterGeneral = creditBalances({ credits: 9, finder_credits: 2 });
    expect(afterFinder.total).toBe(before.total - 1);
    expect(afterGeneral.total).toBe(before.total - 1 + 10);
  });

  it("eksik/bozuk değerlerde çökmez ve negatifi saymaz", () => {
    for (const raw of [null, undefined, {}, { credits: null, finder_credits: null }]) {
      expect(creditBalances(raw).total).toBe(0);
    }
    expect(creditBalances({ credits: -5, finder_credits: -1 }).total).toBe(0);
    expect(creditBalances({ credits: 2.7 }).total).toBe(2);
    expect(creditBalances({ credits: Number.NaN, finder_credits: 1 }).total).toBe(1);
  });
});

describe("hasSpendableCredits (arama kapısı)", () => {
  it("ürün bulucu jetonu olan kullanıcıyı ENGELLEMEZ (eski hata)", () => {
    // Eski kontrol `credits <= 0` idi → bu kullanıcı arama yapamıyordu.
    expect(hasSpendableCredits({ credits: 0, finder_credits: 2 })).toBe(true);
    expect(hasSpendableCredits({ credits: 0, finder_credits: 1 })).toBe(true);
  });

  it("her iki havuz da boşsa engeller", () => {
    expect(hasSpendableCredits({ credits: 0, finder_credits: 0 })).toBe(false);
    expect(hasSpendableCredits(null)).toBe(false);
  });
});

describe("chargePoolFor (DB düşme sırası)", () => {
  it("önce ücretsiz hoş geldin jetonu, o bitince genel havuz", () => {
    expect(chargePoolFor({ credits: 250, finder_credits: 2 })).toBe("finder_credits");
    expect(chargePoolFor({ credits: 250, finder_credits: 0 })).toBe("credits");
    expect(chargePoolFor({ credits: 0, finder_credits: 2 })).toBe("finder_credits");
    expect(chargePoolFor(null)).toBe("credits");
  });
});

// REGRESYON: rozet, oturum henüz çözülmemişken (veya oturum kapalıyken)
// "bilinmiyor" yazıyordu; kullanıcı bunu bakiyesinin bozuk olduğu şeklinde
// okuyordu. Artık geçici durum "…", okunamayan değer nötr "—" gösterilir.
describe("creditCountLabel — okunamayan bakiye '0' değil '—'", () => {
  it("bilinmeyen değer 0 yazmaz ve 'bilinmiyor' kelimesini kullanmaz", () => {
    expect(creditCountLabel(null)).toBe(UNKNOWN_CREDIT_LABEL);
    expect(creditCountLabel(undefined)).toBe(UNKNOWN_CREDIT_LABEL);
    expect(UNKNOWN_CREDIT_LABEL).toBe("—");
    expect(UNKNOWN_CREDIT_LABEL).not.toContain("bilinmiyor");
  });

  it("yüklenirken '…', bilinen değerde sayı", () => {
    expect(creditCountLabel(null, { loading: true })).toBe("…");
    expect(creditCountLabel(0)).toBe("0");
    expect(creditCountLabel(250)).toBe("250");
  });
});

describe("creditBreakdownLabel", () => {
  it("iki havuzu da okunur şekilde gösterir", () => {
    expect(creditBreakdownLabel(creditBalances({ credits: 250, finder_credits: 2 }))).toBe(
      "Ürün Bulucu 2 · Genel 250",
    );
  });
});
