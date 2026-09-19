// Viral ad metrik motoru — gerçek dünya metriklerine dayalı sıralama garantileri.
//
// Kullanıcı şikâyeti: "viral ad kısmı gerçek dünya metriklerine göre çalışsın".
// Bu testler listenin toplam izlenmeye değil, ölçülmüş hıza + etkileşime + tazeliğe
// göre sıralandığını ve beğenisi gizli videoların haksız şekilde dibe düşmediğini
// kilitler. Ağ yok, AI yok — saf fonksiyonlar.
import { describe, expect, it } from "vitest";
import {
  computeViralMetrics,
  durationFitScore,
  engagementScore,
  formatOf,
  freshnessScore,
  velocityScore,
  viralityLabel,
} from "./viral-metrics";

const HOUR = 3_600_000;
const now = Date.UTC(2026, 8, 19, 12, 0, 0);
const ago = (hours: number) => new Date(now - hours * HOUR).toISOString();

describe("velocityScore (izlenme/saat)", () => {
  it("logaritmik ölçekte artar", () => {
    expect(velocityScore(0)).toBe(0);
    expect(velocityScore(10)).toBe(25);
    expect(velocityScore(100)).toBe(50);
    expect(velocityScore(1000)).toBe(75);
    expect(velocityScore(10_000)).toBe(100);
  });

  it("100'ü aşmaz ve geçersiz girdide 0 döner", () => {
    expect(velocityScore(10_000_000)).toBe(100);
    expect(velocityScore(-5)).toBe(0);
    expect(velocityScore(Number.NaN)).toBe(0);
  });
});

describe("engagementScore (beğeni/izlenme)", () => {
  it("yüzdeyi ölçekler: %2 ≈ 40, %5 ve üzeri ≈ 100", () => {
    expect(engagementScore(2)).toBe(40);
    expect(engagementScore(5)).toBe(100);
    expect(engagementScore(9)).toBe(100);
    expect(engagementScore(0.5)).toBe(10);
  });
});

describe("freshnessScore (yayın yaşı)", () => {
  it("yeni içerik 100, 7 günlük ≈ 50, 14 günden eskisi tabana iner", () => {
    expect(freshnessScore(0)).toBe(100);
    expect(freshnessScore(24 * 7)).toBe(50);
    expect(freshnessScore(24 * 14)).toBe(10);
    expect(freshnessScore(24 * 60)).toBe(10);
  });
});

describe("durationFitScore (short-form süre uyumu)", () => {
  it("15-45 sn bandına tam puan, uzun videolara düşük puan verir", () => {
    expect(durationFitScore(30)).toBe(100);
    expect(durationFitScore(15)).toBe(100);
    expect(durationFitScore(45)).toBe(100);
    expect(durationFitScore(10)).toBe(80);
    expect(durationFitScore(60)).toBe(80);
    expect(durationFitScore(120)).toBe(45);
    expect(durationFitScore(600)).toBe(30);
    expect(durationFitScore(0)).toBe(60); // bilinmiyorsa nötr
  });
});

describe("formatOf (gerçek metinden format tespiti)", () => {
  it("İngilizce ve Türkçe sinyalleri tanır", () => {
    expect(formatOf("Unboxing the new gadget")).toBe("Kutu Açılış");
    expect(formatOf("Honest review after 30 days")).toBe("Yorum/İnceleme");
    expect(formatOf("POV: your kitchen at 7am")).toBe("POV / Hikâye");
    expect(formatOf("Before and after transformation")).toBe("Öncesi/Sonrası");
    expect(formatOf("Bu ürün problemi çözüyor")).toBe("Problem → Çözüm");
    expect(formatOf("random clip")).toBe("Genel tanıtım");
  });

  it("özgül format, genel kuralın önüne geçer", () => {
    expect(formatOf("before and after review")).toBe("Öncesi/Sonrası");
  });
});

describe("computeViralMetrics", () => {
  it("hızlı ve taze videoyu eski dev videonun önüne koyar", () => {
    // 3 yıl önce patlamış 10M izlenme: hızı ~380/saat, tazelik taban.
    const oldViral = computeViralMetrics(
      {
        views: 10_000_000,
        likes: 200_000,
        duration_sec: 300,
        created_at: ago(24 * 365 * 3),
        title: "eski",
      },
      now,
    );
    // Dün çıkmış 400K izlenme: ~16.6K/saat, tam tazelik, ideal süre.
    const freshViral = computeViralMetrics(
      { views: 400_000, likes: 20_000, duration_sec: 28, created_at: ago(24), title: "yeni" },
      now,
    );
    expect(freshViral.virality_score).toBeGreaterThan(oldViral.virality_score);
    expect(freshViral.verdict).toBe("patlayan");
  });

  it("beğenisi gizli videoyu sıfır etkileşimle cezalandırmaz", () => {
    const hidden = computeViralMetrics(
      { views: 100_000, likes: 0, duration_sec: 25, created_at: ago(24), title: "x" },
      now,
    );
    expect(hidden.engagement_estimated).toBe(true);
    expect(hidden.engagement_pct).toBe(0);
    // Nötr etkileşim (40) bileşeni sayesinde skor yine anlamlı kalır.
    expect(hidden.virality_score).toBeGreaterThan(40);
  });

  it("skoru 0-100 aralığında tutar", () => {
    const extreme = computeViralMetrics(
      {
        views: 1_000_000_000,
        likes: 99_000_000,
        duration_sec: 30,
        created_at: ago(1),
        title: "unboxing",
      },
      now,
    );
    expect(extreme.virality_score).toBeGreaterThanOrEqual(0);
    expect(extreme.virality_score).toBeLessThanOrEqual(100);
    expect(extreme.views_per_hour).toBe(1_000_000_000);
  });

  it("bozuk tarihte 7 günlük yaş varsayar, çökmez", () => {
    const broken = computeViralMetrics(
      { views: 50_000, likes: 1_000, duration_sec: 30, created_at: "not-a-date", title: "x" },
      now,
    );
    expect(broken.age_hours).toBe(24 * 7);
    expect(Number.isFinite(broken.virality_score)).toBe(true);
  });

  it("etkileşim oranını tek ondalıkla raporlar", () => {
    const m = computeViralMetrics(
      { views: 1_000, likes: 43, duration_sec: 30, created_at: ago(5), title: "review" },
      now,
    );
    expect(m.engagement_pct).toBe(4.3);
    expect(m.format).toBe("Yorum/İnceleme");
    expect(viralityLabel(m)).toBe(`${m.virality_score}/100 · ${m.verdict}`);
  });
});
