/**
 * ARAÇ KATALOĞU SÖZLEŞMESİ.
 *
 * NEDEN TEST: public /tools sayfası 22 aracın tamamını tanıtıyor. Bu liste elle
 * tutulsa, sunucuya yeni bir `ToolId` eklendiğinde (ya da biri kaldırıldığında)
 * sayfa sessizce eksik/yanlış tanıtım yapardı — pazarlama sayfasında "22 araç"
 * yazarken 23 aracın olması gibi. Test, katalog ile `TOOL_PROVIDER` arasındaki
 * kümeyi iki yönlü karşılaştırır.
 *
 * İkinci sözleşme: her aracın hedef rotası gerçek bir rotaya işaret etmeli.
 * Ölü link, sayfanın tüm amacını (araçları göstermek) bozar.
 */
import { describe, expect, it } from "vitest";
import { TOOL_PROVIDER, type ToolId } from "./tools-prompts.server";
import { ALL_TOOL_ENTRIES, TOOL_ENTRY_COUNT, TOOL_HUBS } from "./tools-catalog";

/** Public sayfanın verdiği linkler: gerçekten var olan rotalar. */
const ROUTES = new Set([
  "/tools/sourcing",
  "/tools/finance",
  "/tools/growth",
  "/tools/listing",
  "/news",
]);

describe("tools-catalog", () => {
  it("katalogdaki araçlar TOOL_PROVIDER ile birebir aynı", () => {
    const catalogIds = ALL_TOOL_ENTRIES.map((t) => t.id);
    const providerIds = Object.keys(TOOL_PROVIDER) as ToolId[];

    const missing = providerIds.filter((id) => !catalogIds.includes(id));
    const unknown = catalogIds.filter((id) => !providerIds.includes(id));

    // Eksik: sunucuda olan ama tanıtım sayfasında görünmeyen araç.
    expect(missing).toEqual([]);
    // Fazla: kaldırılmış bir araca verilen ölü link.
    expect(unknown).toEqual([]);
  });

  it("aynı araç iki modülde birden görünmez", () => {
    const ids = ALL_TOOL_ENTRIES.map((t) => t.id);
    expect(ids).toHaveLength(new Set(ids).size);
  });

  it("her modülün gerçek bir araç ekranı ve inci tanesi bilgisi vardır", () => {
    for (const hub of TOOL_HUBS) {
      expect(ROUTES.has(hub.route), `${hub.id} → ${hub.route}`).toBe(true);
      expect(hub.title.trim().length).toBeGreaterThan(0);
      expect(hub.summary.trim().length).toBeGreaterThan(0);
      expect(hub.tools.length).toBeGreaterThan(0);
      expect(hub.emoji.trim().length).toBeGreaterThan(0);
    }
  });

  it("her araç etiketi dolu ve sayı sabitleri tutarlı", () => {
    for (const tool of ALL_TOOL_ENTRIES) {
      expect(tool.label.trim().length, tool.id).toBeGreaterThan(2);
    }
    expect(TOOL_ENTRY_COUNT).toBe(ALL_TOOL_ENTRIES.length);
  });
});
