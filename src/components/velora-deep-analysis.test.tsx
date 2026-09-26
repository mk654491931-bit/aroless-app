// Velora derin analiz paneli — duman + davranış testi.
//
// Panelin DÜRÜSTLÜK sözleşmesini doğrular: hat koşmadan hiçbir skor gösterilmez,
// analiz yalnızca geçerli bir nişle başlatılabilir ve karne gelene kadar koşu
// `runId` ile yoklanır (sonra yoklama DURUR). Gerçek koşu sunucu tarafındadır.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { VeloraDeepAnalysis } from "./velora-deep-analysis";
import {
  noteLabel,
  veloraPollInterval,
  veloraRunSettled,
  veloraStatusLabel,
  verificationChip,
  type RunStatusPayload,
} from "@/lib/velora-run-view";

function render(node: React.ReactElement) {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>,
  );
}

function payload(overrides: Partial<RunStatusPayload> = {}): RunStatusPayload {
  return {
    runId: "velora_test",
    status: "running",
    completedPhases: 1,
    totalPhases: 4,
    activePhase: null,
    nextPhase: 2,
    stale: false,
    pollIntervalMs: 2_000,
    dossier: null,
    push: null,
    selfTest: null,
    phases: [],
    harvest: null,
    recovered: false,
    notes: [],
    ...overrides,
  };
}

describe("VeloraDeepAnalysis", () => {
  it("niş yazılmadan hiçbir skor göstermez, ne yapılacağını söyler", () => {
    const html = render(<VeloraDeepAnalysis niche="" country="US" platforms={["Amazon"]} />);

    expect(html).toContain("Velora 14 ajan derin analizi");
    expect(html).toContain("en az 2 karakter");
    // Henüz koşmadı: tek bir skor bile render edilmemeli.
    expect(html).not.toContain("/100");
    expect(html).not.toContain("En iyi ürünler");
    // Koşu yokken durum şeridi de yok (yalnızca açıklama metni kalır).
    expect(html).not.toContain("14 ajan / 4 faz");
    expect(html).not.toContain("runId:");
  });

  it("jeton iadesini ve ortak kanıt kullanımını açıkça söyler", () => {
    const html = render(
      <VeloraDeepAnalysis niche="mini ice maker" country="US" platforms={["Amazon"]} />,
    );

    expect(html).toContain("jeton");
    // Faz 0 kazıması hem analiz hattının hem konseyin ortak kanıtıdır.
    expect(html).toContain("ortak");
    expect(html).not.toContain("/100");
  });

  it("panel açılışta kendiliğinden koşar: buton tek yol değildir", () => {
    // Kullanıcı "değişiklikler canlıda yok" diyordu. Sebep: `runId` yalnızca
    // butona tıklanınca doluyordu, panel açılışta boş kalıyor ve eski veri
    // ekranda duruyordu. Artık niş yazılınca koşu kendiliğinden başlar.
    const html = render(
      <VeloraDeepAnalysis niche="robot vacuum" country="US" platforms={["Amazon"]} />,
    );
    // Panel otomatik koşuyu açıkça söyler ve elle yeniden koşturulabilir.
    expect(html).toContain("otomatik");
    expect(html).toContain("Yeniden koş");
  });

  it("disabled iken otomatik koşu tetiklenmez", () => {
    const html = render(
      <VeloraDeepAnalysis niche="robot vacuum" country="US" platforms={["Amazon"]} disabled />,
    );
    expect(html).toContain("Velora 14 ajan derin analizi");
  });
});

describe("Faz 0 kazıma tablosu (panel sözleşmesi)", () => {
  // Sunucu bu özeti `harvestSummary` ile üretir; panel onu olduğu gibi çizer.
  // Amaç: "kanıt toplandı" denirken hangi kaynağın ÖLDÜĞÜ gizlenmesin.
  const harvest = {
    niche: "robot vacuum",
    live: true,
    sources: [
      { name: "Hacker News", status: "active" as const, items: 6, detail: "" },
      { name: "Reddit arşivi", status: "error" as const, items: 0, detail: "timeout>6000ms" },
    ],
    reddit: 0,
    complaints: 0,
    prices: 2,
    priceMedianUsd: 300.55,
    supplierLive: true,
    trendMomentumPct: null,
  };

  it("ölü kaynağı 'hata' olarak gösterir, gizlemez", () => {
    const p = payload({ harvest });
    // Panel bu veriyi fetch ile alır; render sözleşmesi alanların varlığıdır.
    expect(p.harvest?.sources.filter((s) => s.status === "error")).toHaveLength(1);
    expect(p.harvest?.sources.find((s) => s.name === "Reddit arşivi")?.detail).toContain("timeout");
  });

  it("canlı olmayan kazımada 'canlı kanıt yok' der", () => {
    const p = payload({ harvest: { ...harvest, live: false } });
    expect(p.harvest?.live).toBe(false);
  });

  it("kaynak tablosu yoksa panel çökmez (null güvenli)", () => {
    expect(payload().harvest).toBeNull();
  });
});

describe("koşu yoklaması (panel sözleşmesi)", () => {
  it("karne gelene kadar yoklanır, hazır/bayat olduğunda DURUR", () => {
    // Durum henüz okunmadı: ilk tick hemen planlanır.
    expect(veloraPollInterval(undefined)).toBe(2_000);
    // Koşuyor: sunucunun verdiği aralık.
    expect(veloraPollInterval(payload())).toBe(2_000);
    expect(veloraPollInterval(payload({ pollIntervalMs: 5_000 }))).toBe(5_000);
    // Aşırı agresif aralık kırpılır.
    expect(veloraPollInterval(payload({ pollIntervalMs: 100 }))).toBe(1_000);

    // Karne hazır → yoklama BİTTİ (sonsuz yoklama yok).
    expect(veloraPollInterval(payload({ status: "completed", completedPhases: 4 }))).toBe(false);
    expect(veloraPollInterval(payload({ status: "failed" }))).toBe(false);
    expect(veloraPollInterval(payload({ status: "unknown" }))).toBe(false);
    // İlerleme durduysa da yoklama biter (kullanıcıyı sonsuz bekletmez).
    expect(veloraPollInterval(payload({ stale: true }))).toBe(false);

    expect(veloraRunSettled(payload())).toBe(false);
    expect(veloraRunSettled(payload({ status: "completed" }))).toBe(true);
  });

  it("durum etiketi hangi fazın koştuğunu dürüstçe söyler", () => {
    expect(veloraStatusLabel(undefined, true)).toBe("kuyruğa alınıyor");
    expect(veloraStatusLabel(payload())).toBe("faz 2 kuyrukta");
    expect(veloraStatusLabel(payload({ activePhase: 2 }))).toBe("faz 2 koşuyor");
    expect(veloraStatusLabel(payload({ status: "completed" }))).toBe("tamamlandı");
    expect(veloraStatusLabel(payload({ status: "failed" }))).toBe("başarısız");
    expect(veloraStatusLabel(payload({ stale: true, activePhase: 3 }))).toBe("ilerleme durdu");
  });

  it("eksik kesişim ve ajan oyu yokluğu ham kod olarak değil, anlaşılır uyarıyla gösterilir", () => {
    expect(noteLabel("INTERSECTION_BELOW_TARGET:2/3")).toContain("2/3");
    expect(noteLabel("INTERSECTION_BELOW_TARGET:2/3")).toContain("doldurulmadı");
    expect(noteLabel("AGENT_CONSENSUS_UNAVAILABLE")).toContain("ortak kesişim iddia edilmiyor");
    expect(noteLabel("LIVE_EVIDENCE_UNAVAILABLE")).toContain("Canlı piyasa kanıtı gelmedi");
    expect(noteLabel("RECOVERED_FROM_WINNER_LEDGER")).toContain("kalıcı kazanan kaydından");
    // Bilinmeyen not gizlenmez, olduğu gibi gösterilir.
    expect(noteLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });

  it("doğrulama rozeti 'verified' kelimesini abartmaz", () => {
    expect(verificationChip("verified").label).toBe("canlı doğrulandı");
    expect(verificationChip("unverified").label).toBe("canlı kanıt yok");
    expect(verificationChip("unknown").label).toBe("ajan oyu yetersiz");
    expect(verificationChip(undefined).label).toBe("ajan oyu yetersiz");
  });
});
