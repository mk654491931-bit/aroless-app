/**
 * MODÜL DIŞA AKTARIMI — rapor ve tabloları güvenli biçimde indirilebilir yapar.
 *
 * Neden ortak: Konsey, Trend Radar, Viral Ads, Rakip Analizi, Stüdyo ve
 * Hidrojen10 aynı CSV/Markdown kurallarını tekrar yazıyordu. Burada tek yerde
 * tutulur; virgül/tırnak/yeni satır içeren ürün adları tabloyu bozmaz.
 */

/** CSV hücresi: tırnak, virgül, noktalı virgül veya yeni satır içeriyorsa kaçırır. */
export function csvCell(value: unknown): string {
  const text = String(value ?? "")
    .replace(/\r?\n/g, " ")
    .trim();
  return /[",;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Başlık + satırlardan RFC 4180 uyumlu CSV üretir. */
export function rowsToCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

/** Markdown tablo hücresi: boru karakteri ve satır sonu tabloyu bozmasın. */
export function markdownCell(value: unknown): string {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

/** Başlıklı, hizalama satırı olan Markdown tablosu. */
export function markdownTable(
  columns: readonly string[],
  rows: readonly (readonly unknown[])[],
): string {
  if (!columns.length) return "";
  const header = `| ${columns.map(markdownCell).join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map(markdownCell).join(" | ")} |`);
  return [header, divider, ...body].join("\n");
}

/** Dosya adında güvenli ASCII karakterler bırakır; Türkçe harfleri eşler. */
export function safeFilename(value: string, fallback = "aroless"): string {
  const mapped = String(value ?? "")
    .toLowerCase()
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
  return mapped || fallback;
}

/** Tarayıcıda metin dosyası indirir; SSR'de sessizce false döner. */
export function downloadTextFile(
  filename: string,
  content: string,
  type = "text/plain;charset=utf-8",
): boolean {
  if (typeof document === "undefined" || typeof URL === "undefined") return false;
  try {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = safeFilename(filename);
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Bazı tarayıcılar indirmeyi başlatmadan blob'u serbest bırakırsa dosya boş kalır.
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
    return true;
  } catch {
    return false;
  }
}

/** İndirme adlarında tekrar eden tarih damgası. */
export function exportDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}
