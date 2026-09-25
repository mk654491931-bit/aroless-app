/**
 * Velora orkestre koşusunun İSTEMCİ tarafı sözleşmesi (saf, test edilebilir).
 *
 * Neden ayrı modül: panelin davranışı (ne zaman yoklanır, kullanıcıya ne
 * yazılır, eksik veri nasıl etiketlenir) render'dan bağımsız olarak sabitlenmeli.
 * Böylece "karne gelene kadar yokla, sonra dur" kuralı ve dürüst uyarı metinleri
 * arayüz testine ihtiyaç duymadan doğrulanabilir.
 */

/** `POST /api/public/agent` yanıtı: yalnızca İLK ADIMIN sonucu (nihai karne değil). */
export type OrchestratedDispatch = {
  runId: string;
  status: "completed" | "dispatched" | "failed";
  completedPhases: number;
  nextPhase?: number;
  dispatch?: { ok: boolean; mode: string; messageId?: string; error?: string };
  deduped?: boolean;
  /** Karne 24 saatlik sorgu önbelleğinden geldi: yeni koşu yapılmadı, JETON HARCANMADI. */
  cached?: boolean;
  cachedAt?: string;
  error?: string;
};

/** Kesişimden çıkan ortak ürün — iki hattın ölçülebilir kararı. */
export type DossierProduct = {
  rank: number;
  name: string;
  winnerScore: number;
  source: string;
  analysisScore?: number;
  councilScore: number;
  councilVotes?: number;
  councilCoverage?: number;
  /** Ajan oylarının yayılımı (standart sapma): konsey ne kadar hemfikir? */
  councilSpread?: number;
  councilMin?: number;
  councilMax?: number;
  councilAlignment?: "unanimous" | "strong" | "split" | "contested" | "none";
  /** Kanal bazında pazar erişimi (kural tabanlı; vergi hesabı değildir). */
  marketReach?: {
    country: string;
    openMarkets: number;
    entries: { country: string; fit: string; barrier: string | null; verdict: string }[];
  };
  /** Geçmiş performans: önceki koşularda kaç kez çıktı (satış verisi DEĞİLDİR). */
  trackRecord?: {
    appearances: number;
    avgScore: number;
    bestRank: number;
    lastSeenDay: string;
    daysSinceSeen: number;
  };
  agentEvidence?: string[];
  verification?: "verified" | "unverified" | "unknown";
  whyNow?: string;
  risks?: string[];
};

/** Kazanan karne (shared best-3). */
export type Dossier = {
  joint_score: number;
  council_average: number;
  analysis_score: number;
  listed: boolean;
  products: DossierProduct[];
  requested_top: number;
  intersection_count: number;
  rank_source: "weighted" | "intersection" | "analysis-only";
  finalists: number;
  evaluated: number;
  notes: string[];
  evidence: { live: boolean; scraped_trends: number };
  phases: { id: number; key: string; ms: number; within_ceiling: boolean; agents: number }[];
};

/** `GET /api/public/agent?runId=…` yanıtı — panel koşuyu bununla yoklar. */
export type RunStatusPayload = {
  runId: string;
  status: "unknown" | "running" | "completed" | "failed";
  completedPhases: number;
  totalPhases: number;
  activePhase: number | null;
  nextPhase: number | null;
  stale: boolean;
  pollIntervalMs: number;
  dossier: Dossier | null;
  push: { ok: boolean; ids: string[]; error?: string } | null;
  selfTest: {
    verdict: "PASS" | "FAIL";
    status: string;
    agentsLogged: number;
    expectedAgents: number;
    dbFetchVerified: boolean;
    payloadIntegrity: boolean;
    notes: string[];
  } | null;
  phases: {
    id: number;
    key: string;
    ms: number;
    withinCeiling: boolean;
    agents: number;
    timedOut: number;
  }[];
  recovered: boolean;
  notes: string[];
};

/** Karne hazır mı (yoklama durmalı mı)? */
export function veloraRunSettled(data: RunStatusPayload | undefined): boolean {
  if (!data) return false;
  return (
    data.status === "completed" ||
    data.status === "failed" ||
    data.status === "unknown" ||
    data.stale === true
  );
}

/**
 * YOKLAMA ARALIĞI: karne gelene kadar `data.pollIntervalMs` (en az 1 sn), karne
 * hazır/bayat olduğunda `false` → panel sonsuz yoklamaz ve sunucuyu yormaz.
 */
export function veloraPollInterval(
  data: RunStatusPayload | undefined,
  fallbackMs = 2_000,
): number | false {
  if (!data) return fallbackMs;
  if (veloraRunSettled(data)) return false;
  return Math.max(1_000, data.pollIntervalMs || fallbackMs);
}

/** Durum şeridinin dürüst etiketi. */
export function veloraStatusLabel(data: RunStatusPayload | undefined, pending = false): string {
  if (!data) return pending ? "kuyruğa alınıyor" : "başlatıldı";
  if (data.status === "completed") return "tamamlandı";
  if (data.status === "failed") return "başarısız";
  if (data.status === "unknown") return "durum bulunamadı";
  if (data.stale) return "ilerleme durdu";
  if (data.activePhase) return `faz ${data.activePhase} koşuyor`;
  if (data.nextPhase) return `faz ${data.nextPhase} kuyrukta`;
  return "koşuyor";
}

const NOTE_LABELS: Record<string, string> = {
  AGENT_CONSENSUS_UNAVAILABLE:
    "Ajanlar ürün başına puan döndürmedi: sonuç yalnızca analiz hattına dayanıyor, ortak kesişim iddia edilmiyor.",
  NO_PRODUCT_INTERSECTION:
    "İki bağımsız hattın ilk 5 listesi hiç örtüşmedi: sonuç yine de ağırlıklı birleşimden üretildi.",
  LIVE_EVIDENCE_UNAVAILABLE: "Canlı piyasa kanıtı gelmedi: doğrulama sınırlı.",
  SHARED_EVIDENCE_EMPTY: "Ortak kazıma kanıtı boş: puanlar nötr/varsayılan girdilere dayanıyor.",
  RECOVERED_FROM_WINNER_LEDGER: "Karne kalıcı kazanan kaydından geri kuruldu.",
  AGENT_EVIDENCE_NOT_RECOVERABLE: "Kalıcı kayıtta ajan gerekçeleri saklanmaz.",
  STATE_EXPIRED_USING_WINNER_LEDGER: "Geçici koşu durumu düşmüş; kalıcı kazanan kaydı kullanıldı.",
  RUN_STATE_NOT_FOUND: "Bu runId için kayıtlı bir koşu bulunamadı.",
};

/** Sunucu notunu kullanıcıya anlaşılır tek cümleyle çevirir (ham kod göstermez). */
export function noteLabel(note: string): string {
  const known = NOTE_LABELS[note];
  if (known) return known;
  if (note.startsWith("INTERSECTION_BELOW_TARGET:")) {
    return `Ortak kesişim hedefin altında (${note.split(":")[1] ?? "?"}): eksik sıra doldurulmadı.`;
  }
  if (note.startsWith("QUALITY_GATE_DROPPED:")) {
    return `Kalite kapısı ${note.split(":")[1] ?? "?"} zayıf/dolgu adayı eledi: listeye yalnızca gerçek ürünler girdi.`;
  }
  return note;
}

// ---------------------------------------------------------------------------
// C) Ajan katılımı rozeti
// ---------------------------------------------------------------------------

/**
 * Ortalama puan TEK BAŞINA yeterlidir: 14 ajanın hepsinin 71 vermesi ile
 * 7'sinin 90, 7'sinin 52 vermesi aynı ortalamayı üretir. Rozet, yayılımdan
 * türeyen katılımı gösterir ve hangisinin ne anlama geldiğini bir ipucuyla
 * söyler — panelde tek başına bir renk kodu olarak bırakılmaz.
 */
export function alignmentChip(product: DossierProduct): {
  label: string;
  cls: string;
  hint: string;
} | null {
  if (!product.councilAlignment || product.councilAlignment === "none") return null;
  const detail =
    product.councilSpread !== undefined ? ` (${Math.round(product.councilSpread)} yayılım)` : "";
  const base: Record<string, { label: string; cls: string; hint: string }> = {
    unanimous: {
      label: "oy birliği",
      cls: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
      hint: "Ajanlar bu üründe neredeyse aynı puanı verdi.",
    },
    strong: {
      label: "geniş mutabakat",
      cls: "border-sky-400/30 bg-sky-500/10 text-sky-200",
      hint: "Ajanlar çoğunlukla aynı yönde, küçük sapmalarla.",
    },
    split: {
      label: "bölünmüş",
      cls: "border-amber-400/30 bg-amber-500/10 text-amber-200",
      hint: "Ajanlar belirgin farklı puanlar verdi; karar tartışmalı.",
    },
    contested: {
      label: "çok tartışmalı",
      cls: "border-rose-400/30 bg-rose-500/10 text-rose-200",
      hint: "Ajanlar birbirinden çok uzak puanlar verdi; ortalama yanıltıcıdır.",
    },
  };
  const chip = base[product.councilAlignment];
  if (!chip) return null;
  return { ...chip, label: `${chip.label}${detail}` };
}

/** Geçmiş performansın tek cümlelik, SATIŞ iddiası içermeyen özeti. */
export function trackRecordLabel(product: DossierProduct): string | null {
  const t = product.trackRecord;
  if (!t || t.appearances < 1) return null;
  const when = t.daysSinceSeen === 0 ? "bugün" : `${t.daysSinceSeen} gün önce`;
  return `Bu ürün ${t.appearances} önceki koşuda da çıktı · ort. puan ${t.avgScore} · en iyi sıra ${t.bestRank} · son görülme ${when} (satış verisi değil, bağımsız koşu teyidi)`;
}

/** Pazar erişimi satırlarının okunur özeti. */
export function marketReachLabel(product: DossierProduct): string | null {
  const reach = product.marketReach;
  if (!reach || reach.entries.length === 0) return null;
  const parts = reach.entries.map((e) => {
    if (e.verdict === "barrier") return `${e.country} bariyer`;
    if (e.verdict === "unavailable") return `${e.country} kanal yok`;
    if (e.verdict === "cross-border") return `${e.country} sınır ötesi`;
    return `${e.country} yerel`;
  });
  return `${parts.join(" · ")} — vergi/gümrük hesabı yapılmaz`;
}

/** Doğrulama durumunun rozet metni ve rengi — "verified" ASLA abartılmaz. */ export function verificationChip(
  value: DossierProduct["verification"],
): {
  label: string;
  cls: string;
} {
  if (value === "verified")
    return {
      label: "canlı doğrulandı",
      cls: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
    };
  if (value === "unverified")
    return { label: "canlı kanıt yok", cls: "border-sky-400/30 bg-sky-500/10 text-sky-200" };
  return { label: "ajan oyu yetersiz", cls: "border-amber-400/30 bg-amber-500/10 text-amber-200" };
}
