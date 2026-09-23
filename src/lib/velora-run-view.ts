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
  rank_source: "intersection" | "analysis-only";
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
    "İki sıralamanın ilk ürünleri kesişmedi: ortak karar üretilemedi, liste yalnız analiz hattıdır.",
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
  return note;
}

/** Doğrulama durumunun rozet metni ve rengi — "verified" ASLA abartılmaz. */
export function verificationChip(value: DossierProduct["verification"]): {
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
