/**
 * Viral ad metrik motoru (saf, AI'sız, ağsız).
 *
 * Viral Ad Library artık videoları yalnız "toplam izlenme" ile sıralamıyor:
 * gerçek dünya metriklerinden (izlenme, beğeni, yayın yaşı, süre) hesaplanan
 * bir `virality_score` üretiyor. Böylece 3 yıl önce patlamış 10M izlenmeli bir
 * video, dün çıkmış ve saatte 40K izlenen bir videonun önüne geçemiyor.
 *
 * Ağırlıklar (toplam 100):
 *   • hız (izlenme/saat)   %40 — asıl viral sinyal
 *   • etkileşim (beğeni/izlenme) %30
 *   • tazelik (yayın yaşı) %20 — kısa video viralitesi hızlı söner
 *   • süre uyumu           %10 — 15-45 sn short-form için ideal
 */

export type ViralMetricInput = {
  views: number;
  likes: number;
  duration_sec: number;
  created_at: string;
  title?: string;
};

export type ViralMetrics = {
  /** Beğeni / izlenme, yüzde olarak (0-100). */
  engagement_pct: number;
  /** Yayınlandığından beri saat başına izlenme (gerçek hız). */
  views_per_hour: number;
  /** Yayın yaşı, saat. */
  age_hours: number;
  /** 15-45 sn ideal bandına yakınlık (0-100). */
  duration_fit: number;
  /** 0-100 ağırlıklı viralite skoru. */
  virality_score: number;
  /** Gerçek başlık/açıklama metninden çıkarılan reklam formatı. */
  format: string;
  /** İnsan diline çevrilmiş sonuç. */
  verdict: "patlayan" | "yükselen" | "istikrarlı" | "durgun";
  /** Beğeni sayısı gizliyse etkileşim nötr kabul edildi mi? */
  engagement_estimated: boolean;
};

const clamp = (v: number, min = 0, max = 100) => Math.max(min, Math.min(max, v));

/** İzlenme hızını logaritmik ölçekler: 10/sa ≈ 25, 100/sa ≈ 50, 1K/sa ≈ 75. */
export function velocityScore(viewsPerHour: number): number {
  if (!Number.isFinite(viewsPerHour) || viewsPerHour <= 0) return 0;
  return clamp(Math.round(Math.log10(viewsPerHour) * 25));
}

/** Etkileşim oranını ölçekler: %2 ≈ 40, %5 ve üzeri ≈ 100. */
export function engagementScore(engagementPct: number): number {
  if (!Number.isFinite(engagementPct) || engagementPct <= 0) return 0;
  return clamp(Math.round(engagementPct * 20));
}

/** Tazelik: 14 günden eski içerik tabana (10) iner, yeni içerik 100'den başlar. */
export function freshnessScore(ageHours: number): number {
  if (!Number.isFinite(ageHours) || ageHours <= 0) return 100;
  const decay = (ageHours / (24 * 14)) * 100;
  return clamp(Math.round(100 - decay), 10, 100);
}

/** Süre uyumu: short-form reklamlar için 15-45 sn bandı ideal. */
export function durationFitScore(durationSec: number): number {
  if (!durationSec || durationSec <= 0) return 60; // bilinmiyorsa nötr
  if (durationSec >= 15 && durationSec <= 45) return 100;
  if (durationSec < 15) return 80;
  if (durationSec <= 60) return 80;
  if (durationSec <= 90) return 60;
  if (durationSec <= 180) return 45;
  return 30;
}

/**
 * Gerçek metin sinyallerinden reklam formatını çıkarır (AI'sız, deterministik).
 * Sıra önemlidir: daha özgül format önce gelir.
 */
export function formatOf(text: string): string {
  const t = (text || "").toLowerCase();
  const rules: Array<[string, RegExp]> = [
    ["Öncesi/Sonrası", /before (and )?after|öncesi sonrası|dönüşüm|transformation/],
    ["Problem → Çözüm", /problem|fix(es|ing)? |solves?|çözüm|işe yarad|works/],
    ["Kutu Açılış", /unbox|kutu aç|asmr unbox/],
    ["Yorum/İnceleme", /review|inceleme|test(ed|ing)?|deniedim|deneme/],
    ["POV / Hikâye", /\bpov\b|story|hikaye|day in (the )?life/],
    ["Karşılaştırma", /vs\.?|versus|compare|karşılaştır/],
    ["UGC / Tanık", /ugc|testimonial|honest|gerçek yorum|kullanıcı/],
    ["Demo / Nasıl Yapılır", /how to|nasıl|tutorial|demo|hack/],
    ["Komik / Skeç", /funny|komik|skit|meme|challenge/],
  ];
  for (const [label, re] of rules) if (re.test(t)) return label;
  return "Genel tanıtım";
}

function verdictOf(score: number): ViralMetrics["verdict"] {
  if (score >= 75) return "patlayan";
  if (score >= 58) return "yükselen";
  if (score >= 40) return "istikrarlı";
  return "durgun";
}

/**
 * Gerçek metriklerden viralite skorunu hesaplar.
 *
 * Beğeni sayısı platform tarafından gizlendiğinde (`likes <= 0`) etkileşim
 * bileşeni nötr kabul edilir (40) — sıfır sayılmaz, aksi halde likeleri kapalı
 * tüm videolar haksız şekilde dibe düşerdi.
 */
export function computeViralMetrics(input: ViralMetricInput, now = Date.now()): ViralMetrics {
  const views = Math.max(0, Number(input.views) || 0);
  const likes = Math.max(0, Number(input.likes) || 0);
  const published = Date.parse(input.created_at);
  const ageHours = Number.isFinite(published)
    ? Math.max(1, Math.round((now - published) / 3_600_000))
    : 24 * 7;
  const viewsPerHour = Math.round(views / ageHours);
  const engagementEstimated = likes <= 0;
  const engagementPct = views > 0 && likes > 0 ? Math.round((likes / views) * 1000) / 10 : 0;

  const vScore = velocityScore(viewsPerHour);
  const eScore = engagementEstimated ? 40 : engagementScore(engagementPct);
  const fScore = freshnessScore(ageHours);
  const dScore = durationFitScore(Number(input.duration_sec) || 0);
  const virality = Math.round(vScore * 0.4 + eScore * 0.3 + fScore * 0.2 + dScore * 0.1);

  return {
    engagement_pct: engagementPct,
    views_per_hour: viewsPerHour,
    age_hours: ageHours,
    duration_fit: dScore,
    virality_score: clamp(virality),
    format: formatOf(input.title ?? ""),
    verdict: verdictOf(clamp(virality)),
    engagement_estimated: engagementEstimated,
  };
}

/** Skoru insan diline çevirir (UI rozetleri için). */
export function viralityLabel(metrics: ViralMetrics): string {
  return `${metrics.virality_score}/100 · ${metrics.verdict}`;
}
