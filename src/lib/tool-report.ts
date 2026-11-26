/**
 * ARAÇ ÇALIŞMA DEFTERİ — istemci tarafı kalıcı analiz kaydı ve rapor üretimi.
 *
 * NEDEN VAR: Araçlar AI'dan değerli bir çıktı üretiyordu ama sayfa yenilenince
 * ya da kullanıcı başka modüle geçince sonuç kayboluyordu. Aynı analizi ikinci
 * kez çalıştırmak hem 30-90 sn hem de jeton harcıyordu. Bu dosya son başarılı
 * çalışmayı tarayıcıda saklar; ToolCard açılışta geri yükler, Dashboard geçmişi
 * gösterir ve rapor/CSV dışa aktarımı için TEK biçim üretir.
 *
 * GİZLİLİK: Veri yalnız kullanıcının tarayıcısında (`localStorage`) durur,
 * sunucuya gönderilmez. Tedarikçi e-postası gibi girdiler de bu yüzden
 * sınırlandırılarak saklanır; kullanıcı tek tıkla silebilir.
 *
 * Bu modül React'ten bağımsızdır; böylece formatlama ve depolama davranışı
 * tarayıcı açmadan test edilebilir.
 */

export type ToolRunMetric = {
  label: string;
  value: string;
  tone?: "profit" | "warning" | "action" | "neutral";
};

export type ToolRunSource = { label: string; url?: string; fetchedAt?: string };

export type ToolRunResult = {
  headline: string;
  metrics: ToolRunMetric[];
  bullets: string[];
  table: { columns: string[]; rows: string[][] } | null;
  document: string | null;
  risks?: string[];
  actions?: string[];
  assumptions?: string[];
  verdict?: string;
  score?: number;
  provider: string;
  providers?: string[];
  confidence?: number;
  sources?: ToolRunSource[];
};

export type ToolRun = {
  id: string;
  toolId: string;
  title: string;
  /** ISO zaman damgası. */
  ranAt: string;
  /** Analizi üreten girdiler; raporun tekrar çalıştırılabilir olması için. */
  input: Record<string, string>;
  result: ToolRunResult;
};

const STORAGE_KEY = "aroless:tool-runs:v1";
const CHANGE_EVENT = "aroless:tool-runs-changed";
const MAX_RUNS = 40;
const MAX_DOCUMENT_CHARS = 6_000;
const MAX_INPUT_CHARS = 1_200;

/** Sunucu tarafında (ve ilk render'da) kullanılan sabit boş liste. */
const EMPTY_RUNS: readonly ToolRun[] = Object.freeze([]);
let memoryRuns: readonly ToolRun[] | null = null;

function storageAvailable(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

function asStringArray(value: unknown, limit = 12): string[] {
  return Array.isArray(value)
    ? value
        .slice(0, limit)
        .map((item) =>
          String(item ?? "")
            .trim()
            .slice(0, 500),
        )
        .filter(Boolean)
    : [];
}

function normalizeResult(raw: unknown): ToolRunResult | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const metrics = Array.isArray(value.metrics)
    ? value.metrics
        .slice(0, 10)
        .map((metric) => {
          if (!metric || typeof metric !== "object") return null;
          const item = metric as Record<string, unknown>;
          const label = String(item.label ?? "")
            .trim()
            .slice(0, 80);
          const metricValue = String(item.value ?? "")
            .trim()
            .slice(0, 120);
          if (!label || !metricValue) return null;
          const tone = ["profit", "warning", "action", "neutral"].includes(String(item.tone))
            ? (String(item.tone) as ToolRunMetric["tone"])
            : undefined;
          return { label, value: metricValue, ...(tone ? { tone } : {}) };
        })
        .filter((metric): metric is ToolRunMetric => metric !== null)
    : [];

  let table: ToolRunResult["table"] = null;
  if (value.table && typeof value.table === "object") {
    const rawTable = value.table as Record<string, unknown>;
    if (Array.isArray(rawTable.columns) && Array.isArray(rawTable.rows)) {
      const columns = rawTable.columns
        .slice(0, 10)
        .map((column) => String(column ?? "").slice(0, 80));
      const rows = rawTable.rows
        .slice(0, 30)
        .map((row) =>
          Array.isArray(row)
            ? row.slice(0, 10).map((cell) => String(cell ?? "").slice(0, 300))
            : [],
        )
        .filter((row) => row.length);
      if (columns.length && rows.length) table = { columns, rows };
    }
  }

  const headline = String(value.headline ?? "")
    .trim()
    .slice(0, 500);
  if (!headline && !metrics.length && !asStringArray(value.bullets).length && !table) return null;

  const sources = Array.isArray(value.sources)
    ? value.sources
        .slice(0, 10)
        .map((source) => {
          if (!source || typeof source !== "object") return null;
          const item = source as Record<string, unknown>;
          const label = String(item.label ?? "")
            .trim()
            .slice(0, 120);
          if (!label) return null;
          const url = typeof item.url === "string" ? item.url.slice(0, 500) : undefined;
          const fetchedAt =
            typeof item.fetchedAt === "string" ? item.fetchedAt.slice(0, 80) : undefined;
          return { label, ...(url ? { url } : {}), ...(fetchedAt ? { fetchedAt } : {}) };
        })
        .filter((source): source is ToolRunSource => source !== null)
    : [];

  const confidence = Number(value.confidence);
  const score = Number(value.score);
  return {
    headline,
    metrics,
    bullets: asStringArray(value.bullets),
    table,
    document:
      typeof value.document === "string" && value.document.trim()
        ? value.document.slice(0, MAX_DOCUMENT_CHARS)
        : null,
    risks: asStringArray(value.risks, 8),
    actions: asStringArray(value.actions, 8),
    assumptions: asStringArray(value.assumptions, 6),
    verdict: String(value.verdict ?? "")
      .trim()
      .slice(0, 160),
    score: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : undefined,
    provider: String(value.provider ?? "AI").slice(0, 160),
    providers: asStringArray(value.providers, 8),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(100, confidence)) : undefined,
    sources,
  };
}

/** Saklanan nesnenin şema dışı/eski alanlarla UI'yı kırmasını engeller. */
function normalizeRun(raw: unknown): ToolRun | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const id = String(value.id ?? "").slice(0, 240);
  const toolId = String(value.toolId ?? "").slice(0, 80);
  const title = String(value.title ?? "").slice(0, 120);
  const ranAt = String(value.ranAt ?? "");
  if (!id || !toolId || !title || !ranAt || Number.isNaN(new Date(ranAt).getTime())) return null;
  const result = normalizeResult(value.result);
  if (!result) return null;
  const input: Record<string, string> = {};
  if (value.input && typeof value.input === "object") {
    for (const [key, item] of Object.entries(value.input as Record<string, unknown>).slice(0, 20)) {
      input[String(key).slice(0, 40)] = String(item ?? "").slice(0, MAX_INPUT_CHARS);
    }
  }
  return { id, toolId, title, ranAt, input, result };
}

function readRuns(): readonly ToolRun[] {
  if (memoryRuns) return memoryRuns;
  if (!storageAvailable()) {
    memoryRuns = EMPTY_RUNS;
    return memoryRuns;
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    memoryRuns = Array.isArray(parsed)
      ? parsed
          .map(normalizeRun)
          .filter((run): run is ToolRun => run !== null)
          .sort((a, b) => (a.ranAt < b.ranAt ? 1 : -1))
          .slice(0, MAX_RUNS)
      : EMPTY_RUNS;
  } catch {
    memoryRuns = EMPTY_RUNS;
  }
  return memoryRuns;
}

function publish(runs: readonly ToolRun[]) {
  memoryRuns = runs;
  if (!storageAvailable()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(runs));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* Kota dolu / gizli mod: yalnız bellek içi çalışmaya devam et. */
  }
}

/** Bir çalışmayı kaydeder; aynı araçte önceki kayıtları korur (geçmiş için). */
export function saveToolRun(input: {
  toolId: string;
  title: string;
  input: Record<string, string>;
  result: ToolRunResult;
  ranAt?: string;
}): ToolRun | null {
  const result = normalizeResult(input.result);
  if (!result) return null;
  const ranAt = input.ranAt ?? new Date().toISOString();
  const cleanInput: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.input).slice(0, 20)) {
    cleanInput[String(key).slice(0, 40)] = String(value ?? "").slice(0, MAX_INPUT_CHARS);
  }
  const run: ToolRun = {
    id: `${input.toolId}:${ranAt}`,
    toolId: String(input.toolId).slice(0, 80),
    title: String(input.title).slice(0, 120),
    ranAt,
    input: cleanInput,
    result,
  };
  const next = [run, ...readRuns().filter((item) => item.id !== run.id)].slice(0, MAX_RUNS);
  publish(next);
  return run;
}

export function listToolRuns(): readonly ToolRun[] {
  return readRuns();
}

export function latestToolRun(toolId: string): ToolRun | null {
  return readRuns().find((run) => run.toolId === toolId) ?? null;
}

export function removeToolRun(id: string): void {
  publish(readRuns().filter((run) => run.id !== id));
}

export function clearToolRuns(): void {
  publish(EMPTY_RUNS);
}

/** Dashboard'ın `useSyncExternalStore` aboneliği; sekmeler arası değişimi de yakalar. */
export function subscribeToolRuns(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    memoryRuns = null;
    listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function getToolRunsSnapshot(): readonly ToolRun[] {
  return readRuns();
}

export function getToolRunsServerSnapshot(): readonly ToolRun[] {
  return EMPTY_RUNS;
}

export function formatToolRunTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const diff = Math.max(0, now.getTime() - date.getTime());
  const minute = 60_000;
  if (diff < minute) return "az önce";
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} dk önce`;
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} sa önce`;
  return date.toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function mdCell(value: string): string {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

export function tableToTsv(table: { columns: string[]; rows: string[][] }): string {
  const clean = (value: string) =>
    String(value ?? "")
      .replace(/\t/g, " ")
      .replace(/\r?\n/g, " ");
  return [table.columns, ...table.rows].map((row) => row.map(clean).join("\t")).join("\n");
}

/** Panoya/rapora giden tam metin; belge varsa aynen korunur. */
export function buildToolReport(run: ToolRun): string {
  const { result } = run;
  const lines: string[] = [
    `# ${run.title}`,
    "",
    `- **Araç:** \`${run.toolId}\``,
    `- **Çalışma:** ${new Date(run.ranAt).toLocaleString("tr-TR")}`,
    `- **Motor:** ${result.provider}`,
  ];
  if (typeof result.confidence === "number" && result.confidence > 0) {
    lines.push(`- **Güven:** %${result.confidence}`);
  }
  if (typeof result.score === "number" && result.score > 0) {
    lines.push(`- **Skor:** ${result.score}/100`);
  }
  lines.push("");
  if (result.verdict) lines.push(`**Karar:** ${result.verdict}`, "");
  if (result.headline) lines.push(result.headline, "");

  if (result.metrics.length) {
    lines.push("## Metrikler", "", "| Metrik | Değer |", "| --- | --- |");
    for (const metric of result.metrics) {
      lines.push(`| ${mdCell(metric.label)} | ${mdCell(metric.value)} |`);
    }
    lines.push("");
  }

  const listSection = (title: string, items: string[] | undefined) => {
    if (!items?.length) return;
    lines.push(`## ${title}`, "");
    for (const item of items) lines.push(`- ${item}`);
    lines.push("");
  };
  listSection("Bulgular", result.bullets);
  listSection("Riskler", result.risks);
  listSection("Aksiyon planı", result.actions);
  listSection("Varsayımlar", result.assumptions);

  if (result.table) {
    lines.push("## Karşılaştırma tablosu", "");
    lines.push(
      `| ${result.table.columns.map(mdCell).join(" | ")} |`,
      `| ${result.table.columns.map(() => "---").join(" | ")} |`,
    );
    for (const row of result.table.rows) {
      lines.push(`| ${row.map(mdCell).join(" | ")} |`);
    }
    lines.push("");
  }

  if (result.document) {
    lines.push("## Belge", "", "```text", result.document, "```", "");
  }

  const inputEntries = Object.entries(run.input).filter(([, value]) => value.trim());
  if (inputEntries.length) {
    lines.push("## Girdiler", "");
    for (const [key, value] of inputEntries) {
      lines.push(`- **${key}:** ${value.length > 600 ? `${value.slice(0, 600)}…` : value}`);
    }
    lines.push("");
  }

  if (result.sources?.length) {
    lines.push("## Canlı kaynaklar", "");
    for (const source of result.sources) {
      lines.push(
        `- ${source.label}${source.url ? ` — ${source.url}` : ""}${
          source.fetchedAt ? ` (${source.fetchedAt})` : ""
        }`,
      );
    }
    lines.push("");
  }

  lines.push("---", "Aroless AI çıktısı — karar öncesi sayıları ve resmi kaynağı doğrulayın.");
  return lines.join("\n");
}

function csvCell(value: unknown): string {
  const text = String(value ?? "").replace(/\r?\n/g, " ");
  return /[",;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Dashboard dışa aktarımı: her satır bir araç çalışması. */
export function buildToolHistoryCsv(runs: readonly ToolRun[]): string {
  const header = [
    "calisma",
    "arac",
    "baslik",
    "karar",
    "skor",
    "motor",
    "guven",
    "kaynak_sayisi",
    "ozet",
  ];
  const rows = runs.map((run) => [
    run.ranAt,
    run.toolId,
    run.title,
    run.result.verdict ?? "",
    run.result.score ?? "",
    run.result.provider,
    run.result.confidence ?? "",
    run.result.sources?.length ?? 0,
    run.result.headline,
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}
