// AYLIK KULLANIM TABLOSU — görünürlük sözleşmesi.
//
// NEDEN VAR (kullanıcı bildirimi: "tablo gözükmüyor"): aylık paket hakları
// (bulucu / araç / konsey / radar) hiçbir yerde tablo olarak yoktu; kullanıcı
// ödediği paketin hakkını ve kalanını okuyamıyordu. Bu test tablonun gerçekten
// çizildiğini, dört hakkı, aylık tavanı, kalanı ve jeton bakiyesini yazdığını
// sabitler. Sayaç okunamadığında "0" yazmak yanlış beyan olurdu — "?" beklenir.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { planUsageRows } from "@/lib/plan-usage";

const state = vi.hoisted(() => ({
  measured: true as boolean,
  snapshot: null as unknown,
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "u1" } }),
}));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  useServerFn: () => async () => state.snapshot,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ isLoading: false, isError: false, data: state.snapshot, refetch: vi.fn() }),
}));

import { PlanUsageTable } from "./plan-usage-table";

const USED = { credits: 3, toolRuns: 12, councilRuns: 1, radarScans: 0 };

function snapshot(measured = true) {
  return {
    tier: "Pro",
    level: 2,
    isAdmin: false,
    period: "2026-10",
    since: "2026-10-01T00:00:00.000Z",
    measured,
    rows: planUsageRows(2, USED),
  };
}

const html = () =>
  renderToStaticMarkup(<PlanUsageTable tier="Pro" credits={17} finderCredits={2} />);

describe("PlanUsageTable", () => {
  it("dört aylık hakkı, kullanımı, tavanı ve kalanı tablo olarak yazar", () => {
    state.snapshot = snapshot();
    const out = html();
    expect(out).toContain("Bu ayın kullanımı");
    expect(out).toContain("Aylık hak");
    expect(out).toContain("Kalan");
    expect(out).toContain("Bulucu + derin analiz");
    expect(out).toContain("AI araç");
    expect(out).toContain("AI Konsey");
    expect(out).toContain("Trend radar");
    // Pro tavanları fiyat tablosuyla aynı olmalı (tek kaynak: plans.ts).
    expect(out).toContain("90");
    expect(out).toContain("20");
    // Kullanılan / kalan gerçek sayaçtan gelir.
    expect(out).toContain("12"); // 12 araç kullanıldı
    expect(out).toContain("78"); // 90 - 12 kaldı
  });

  it("jeton bakiyesini iki havuzun toplamı olarak yazar", () => {
    state.snapshot = snapshot();
    const out = html();
    expect(out).toContain("Jeton bakiyesi");
    expect(out).toContain("19"); // 17 genel + 2 bulucu
    expect(out).toContain("Ürün Bulucu 2");
    expect(out).toContain("Genel 17");
  });

  it("sayaç okunamadığında 0 YAZMAZ: kullanılan tarafı ? olur", () => {
    state.snapshot = snapshot(false);
    const out = html();
    expect(out).toContain("?");
    expect(out).toContain("Sayaç okunamadı");
  });

  it("veri gelmeden çökmez ve yükleme durumunu gösterir", () => {
    state.snapshot = null;
    const out = html();
    expect(out).toContain("Bu ayın kullanımı");
  });
});
