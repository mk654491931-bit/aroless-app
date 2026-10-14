/**
 * PUBLIC ARAÇ MERKEZİ (/tools) — içerik sözleşmesi.
 *
 * NEDEN TEST: bu sayfa bir tanıtım ve yönlendirme yüzeyi. İki şey sessizce
 * bozulabilir ve ikisi de doğrudan kayba yol açar:
 *   1. Modül kartının linki yanlış rotaya giderse ziyaretçi ölü uca düşer,
 *   2. katalogdan bir araç düşerse sayfa eksik tanıtım yapar.
 * Testler kartların hedefini, tüm araç etiketlerinin göründüğünü ve sayfanın
 * kullanıcıyı uygulamaya sokan CTA'ları taşıdığını sabitler.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ALL_TOOL_ENTRIES, TOOL_ENTRY_COUNT, TOOL_HUBS } from "@/lib/tools-catalog";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import { ToolsShowcasePage } from "./tools-showcase-page";

const html = () => renderToStaticMarkup(<ToolsShowcasePage />);

/**
 * React metni HTML'e yazarken `&` → `&amp;` yapar. Araç adlarının bir kısmı
 * "&" içeriyor ("Packaging & Desi Optimizer"), bu yüzden kaynak metni de
 * kaçışlanmış hâliyle karşılaştırıyoruz: aksi hâlde doğru render edilmiş bir
 * etiket testte "eksik" görünürdü.
 */
const escaped = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");

describe("ToolsShowcasePage", () => {
  it("her modülü başlığı, özeti ve gerçek rota linkiyle gösterir", () => {
    const out = html();
    for (const hub of TOOL_HUBS) {
      expect(out, hub.id).toContain(escaped(hub.title));
      expect(out, hub.id).toContain(escaped(hub.summary));
      expect(out, hub.id).toContain(`href="${hub.route}"`);
    }
  });

  it("katalogdaki 22 aracın tamamı sayfada görünür", () => {
    const out = html();
    const missing = ALL_TOOL_ENTRIES.filter((tool) => !out.includes(escaped(tool.label))).map(
      (t) => t.id,
    );
    expect(missing).toEqual([]);
    expect(TOOL_ENTRY_COUNT).toBe(22);
  });

  it("sayılar koddan gelir (araç sayısı ve modül sayısı)", () => {
    const out = html();
    expect(out).toContain(`>${TOOL_ENTRY_COUNT}<`);
    expect(out).toContain(`>${TOOL_HUBS.length}<`);
  });

  it("kullanıcıyı uygulamaya ve ortaklık programına sokan CTA'lar vardır", () => {
    const out = html();
    expect(out).toContain('href="/auth"');
    expect(out).toContain('href="/affiliate"');
    expect(out).toContain('href="/pricing"');
  });

  it("boş değer sızdırmaz (undefined/NaN/biçimlenmemiş şablon)", () => {
    const out = html();
    expect(out).not.toContain("undefined");
    expect(out).not.toContain("NaN");
    expect(out).not.toContain("[object Object]");
  });

  it("ücretsiz planda araçların açık olduğunu iddia etmez", () => {
    const out = html();
    // Araç modülleri paketle açılır; sayfa bunu açıkça yazmalı.
    expect(out).toContain("paket");
    expect(out).toContain("Ücretsiz plan");
  });
});
