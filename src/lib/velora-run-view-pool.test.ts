// AI havuzu uyarısı: "anahtar yok" ile "anahtar var ama beklemede" AYRI
// söylenmeli. Ölçülen hata: panel `available === 0` gördüğünde koşulsuz
// "Vercel ortam değişkenlerini kontrol edin" yazıyordu; oysa 14 paralel ajan
// ücretsiz katmanda tüm anahtarları 60-90 sn park edebiliyor ve yapılandırma
// yerinde kalıyor.
import { describe, expect, it } from "vitest";
import { aiPoolNotice, type AiPoolHealth } from "./velora-run-view";

function pool(overrides: Partial<AiPoolHealth> = {}): AiPoolHealth {
  return {
    total: 22,
    available: 22,
    cooling: 0,
    unusable: 0,
    groups: [{ group: "gemini", configured: 5, available: 5, cooling: 0 }],
    ...overrides,
  };
}

describe("aiPoolNotice", () => {
  it("anahtarlar kullanılabilirse uyarı YOK", () => {
    expect(aiPoolNotice(pool())).toBeNull();
    expect(aiPoolNotice(null)).toBeNull();
  });

  it("hiç anahtar tanımlı değilse env değişkenlerini doğru şekilde işaret eder", () => {
    const notice = aiPoolNotice(pool({ total: 0, available: 0, groups: [] }));
    expect(notice?.tone).toBe("error");
    expect(notice?.text).toContain("Vercel");
    expect(notice?.text).toContain("GEMINI_API_KEY_1");
  });

  it("anahtarlar tanımlı ama hepsi beklemedeyse Vercel'i SUÇLAMAZ", () => {
    const notice = aiPoolNotice(pool({ total: 22, available: 0, cooling: 22, unusable: 0 }));
    expect(notice?.tone).toBe("warn");
    expect(notice?.text).toContain("22 anahtar tanımlı");
    expect(notice?.text).toContain("beklemede");
    expect(notice?.text).toContain("Ortam değişkenlerinde sorun yok");
    expect(notice?.text).not.toContain("kontrol edin");
  });

  it("anahtarlar var ama uç/model eksikse doğru eksikliği söyler", () => {
    const notice = aiPoolNotice(pool({ total: 5, available: 0, cooling: 0, unusable: 5 }));
    expect(notice?.tone).toBe("warn");
    expect(notice?.text).toContain("uç/model eksik");
    expect(notice?.text).toContain("BASE_URL");
  });

  it("eski payload (cooling alanı yok) çökmez", () => {
    const legacy = { total: 22, available: 0, groups: [] } as unknown as AiPoolHealth;
    const notice = aiPoolNotice(legacy);
    expect(notice?.tone).toBe("warn");
    expect(notice?.text).toContain("22 anahtar tanımlı");
  });
});
