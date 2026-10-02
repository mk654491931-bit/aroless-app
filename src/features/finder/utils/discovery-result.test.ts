// ============================================================================
// KEŞİF HATTI HATA AÇIKLAMASI + HAT DEPOSU — BİRİM TESTLERİ.
//
// Kilitlenen davranış: arayüz hat kurulamayınca klasik motora düşüyor ve
// KULLANICIYA GERÇEK SEBEBİ söylemek zorunda. "Hata oldu" demek, kullanıcının
// ekranı düzeltememesi demektir; ham Supabase hatasını göstermek ise onu
// anlamaz. Bu testler ikisinin arasındaki çevirinin bozulmadığını sabitler.
// ============================================================================
import { describe, expect, it } from "vitest";

import {
  describeDiscoveryFailure,
  discoverySetupNotice,
  hintsForFailure,
  type SetupReport,
} from "./discovery-result";
import {
  isDiscoveryPipelineActive,
  setDiscoveryPipelineActive,
  subscribeDiscoveryPipeline,
} from "./discovery-progress-store";

describe("describeDiscoveryFailure", () => {
  it("migration uygulanmamışsa kolon hatasını tanır", () => {
    // Bu, canlıdaki GERÇEK hataydı: hat sessizce klasik hatta düşüyordu.
    const text = describeDiscoveryFailure(
      'column "discovery_status" of relation "searches" does not exist',
    );
    expect(text).toContain("migration");
    expect(text).toContain("discovery_status");
  });

  it("RPC eksikliğini kolon eksikliğinden AYIRIR", () => {
    // İkisi aynı migration'ın parçası ama farklı hata ve farklı düzeltme
    // yazısı; kullanıcı hangisini arayacağını bilsin.
    const text = describeDiscoveryFailure(
      "function public.advance_discovery_status does not exist",
    );
    expect(text).toContain("advance_discovery_status");
    expect(text).not.toContain("kolonu yok");
  });

  it("servis rolü anahtarı eksikliğini söyler", () => {
    const text = describeDiscoveryFailure(
      "Missing Supabase environment variable(s): SUPABASE_SERVICE_ROLE_KEY",
    );
    expect(text).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("QStash erişilemezliğini jeton/imza sorununa bağlar", () => {
    expect(describeDiscoveryFailure("fetch failed")).toContain("QStash");
    expect(describeDiscoveryFailure("NO_ORIGIN")).toContain("adres");
  });

  it("boş ürün sonucunu kurulum hatası DEĞİL diye ayırır", () => {
    expect(describeDiscoveryFailure("empty_result")).toContain("ürün");
  });

  // Canlı hata (2026-10-02): "gemini: Gemini error: 404 { "error": { "code":
  // 404, "message": "models/gemini-1.5-flash is not found for API version
  // v1beta…" } }". Google 1.5 ailesini emekliye ayırmıştı; ağ, veritabanı ve
  // kurulumun üçü de sağlıklıydı. Ham JSON duvarı ve "migration eksik"
  // ipucu kullanıcıyı yanlış yere götürüyordu.
  it("emekliye ayrılmış Gemini modelini kurulum hatası SANMAZ", () => {
    const raw =
      'gemini: Gemini error: 404 { "error": { "code": 404, "message": "models/gemini-1.5-flash is not found for API version v1beta, or is not supported for generateContent" } }';
    const text = describeDiscoveryFailure(raw);
    expect(text).toContain("Gemini");
    expect(text).not.toContain("migration");
    expect(text).not.toContain("SUPABASE");
    expect(text).not.toContain("404"); // ham JSON duvarı gösterilmez
  });

  it("sağlayıcı hatasında ipucu migration'a değil AI motoruna gösterir", () => {
    const raw = 'gemini: Gemini error: 404 models/gemini-1.5-flash is not found';
    const hint = hintsForFailure(raw);
    expect(hint).toContain("AI sağlayıcısı");
    expect(hint).toContain("DEĞİL");
    expect(hint).not.toContain("migration");
  });

  // Canlı hattan çıkan düzeltme (2026-10-01, "LED masa lambası"):
  // 13 kaynak koştu, 15 satır döndü, hepsi ilk aşama elemesinde düştü.
  // Bu hata "hiç kaynak ürün döndürmedi" diye okununca kurulum hatası
  // SANILIYOR — ama ağ/anahtar/migration'ların üçü de çalışıyordu.
  it("kaynakların döndürdüğü ama elemenin düşürdüğü boş listeyi kurulum hatası SANMAZ", () => {
    const text = describeDiscoveryFailure("Hiç kaynak doğrulanabilir ürün döndürmedi.");
    expect(text).toContain("eleme");
    expect(text).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  // İlk aşama hata mesajı artık SAYAÇ taşır (kaynak kaç tanesi çalıştı, kaç
  // ham satır geldi). İki durum ayrı okunmalı: satır HİÇ gelmediyse sorun
  // kaynak/ağ tarafındadır, satır geldiyse eleme kapılarındadır.
  it("kaynaklardan hiç satır gelmediyse kaynak/ağ tarafını işaret eder", () => {
    const text = describeDiscoveryFailure(
      "Hiç kaynak doğrulanabilir ürün döndürmedi (0/13 kaynak çalıştı, 0 ham satır; eleme: şema 0, stok 0, fiyat 0, puan 0, bütünlük 0, tekrar 0).",
    );
    expect(text).toContain("Kaynaklardan hiç ölçülmüş ürün satırı gelmedi");
    expect(text).not.toContain("elemesi hepsini eledi");
  });

  it("satır geldiyse eleme kapılarını işaret eder", () => {
    const text = describeDiscoveryFailure(
      "Hiç kaynak doğrulanabilir ürün döndürmedi (13/13 kaynak çalıştı, 15 ham satır; eleme: şema 0, stok 0, fiyat 0, puan 0, bütünlük 15, tekrar 0).",
    );
    expect(text).toContain("ilk aşama elemesi hepsini eledi");
  });

  it("ipucu yalnız GERÇEKTEN kurulum hatasıysa anahtar/migration önerir", () => {
    // Supabase hatası → kurulum ipucu gösterilir.
    expect(hintsForFailure("column discovery_status does not exist")).toContain(
      "Kurulum eksikliği",
    );
    expect(
      hintsForFailure("Missing Supabase environment variable(s): SUPABASE_SERVICE_ROLE_KEY"),
    ).toContain("Kurulum eksikliği");

    // Filtre/boş liste hatası → kurulum ipucu GÖSTERİLMEZ. Bu, canlı hatta
    // yanlış yere bakmaya yol açan asıl sebepti.
    expect(hintsForFailure("Hiç kaynak doğrulanabilir ürün döndürmedi.")).not.toContain(
      "servis rolü",
    );
    expect(hintsForFailure("Hiç kaynak doğrulanabilir ürün döndürmedi.")).toContain(
      "kurulum hatası DEĞİL",
    );
  });

  it("tanımadığı hatayı SAKLAMAZ — kısaltıp sonuna ekler", () => {
    const text = describeDiscoveryFailure("bambaşka bir hata: xyz");
    expect(text).toContain("bambaşka bir hata: xyz");
  });

  it("boş sebepte de anlamlı bir cümle döner", () => {
    expect(describeDiscoveryFailure("").length).toBeGreaterThan(10);
  });
});

describe("discoverySetupNotice", () => {
  const passing = (id: string, label: string) => ({ id, label, ok: true, fix: "" });

  it("rapor gelmezse sebebi gizlemez, yine de ne yapılacağını söyler", () => {
    const notice = discoverySetupNotice("queue_failed: fetch failed", null);
    expect(notice).toContain("QStash");
    expect(notice).toContain("klasik motor");
    expect(notice).toContain("Kurulum raporu alınamadı");
  });

  it("eksik olanı ve ÇÖZÜMÜNÜ birlikte yazar", () => {
    // Kullanıcının gerçek ihtiyacı bu: ne eksik ve ne yapmalı.
    const report: SetupReport = {
      ok: false,
      summary: "",
      checks: [
        passing("qstash_token", "QStash yayın jetonu"),
        {
          id: "db_columns",
          label: "searches keşif kolonları",
          ok: false,
          fix: "supabase/migrations/20260927000000_product_discovery_pipeline.sql",
        },
      ],
    };
    const notice = discoverySetupNotice("column discovery_status does not exist", report);
    expect(notice).toContain("searches keşif kolonları");
    expect(notice).toContain("20260927000000_product_discovery_pipeline.sql");
    expect(notice).toContain("klasik motor");
  });

  it("birden fazla eksikte ilk çözümü gösterir, kalanını sayar", () => {
    const report: SetupReport = {
      ok: false,
      summary: "",
      checks: [
        { id: "a", label: "A eksik", ok: false, fix: "A çözümü" },
        { id: "b", label: "B eksik", ok: false, fix: "B çözümü" },
        { id: "c", label: "C eksik", ok: false, fix: "C çözümü" },
      ],
    };
    const notice = discoverySetupNotice("x", report);
    expect(notice).toContain("A çözümü");
    expect(notice).toContain("+2 eksik daha");
    // Kullanıcı ekrana bakan biri: üçünü de birden dökmek gürültü olurdu.
    expect(notice).not.toContain("C çözümü");
  });

  it("İSTEĞE BAĞLI eksik (Gemini) kurulumu bozuk saymaz", () => {
    const report: SetupReport = {
      ok: true,
      summary: "",
      checks: [
        passing("qstash_token", "QStash yayın jetonu"),
        { id: "gemini", label: "Gemini seçici", ok: false, optional: true, fix: "—" },
      ],
    };
    expect(discoverySetupNotice("x", report)).toContain("Kurulum tamam görünüyor");
  });

  it("kurulum hazırsa sorunun başka yerde olduğunu söyler", () => {
    const report: SetupReport = { ok: true, summary: "", checks: [passing("a", "A")] };
    const notice = discoverySetupNotice("fetch failed", report);
    expect(notice).toContain("Kurulum tamam görünüyor");
    expect(notice).toContain("klasik motor");
  });

  it("rapor boş dönerse yine de sebebi gösterir", () => {
    const notice = discoverySetupNotice("timeout", { ok: true, summary: "", checks: [] });
    expect(notice).toContain("zaman aşımına");
  });
});

describe("keşif hattı deposu", () => {
  it("abone olmadan da okunabilir", () => {
    expect(isDiscoveryPipelineActive()).toBe(false);
  });

  it("değer değişince aboneleri uyarır, aynı değer için uyarılmaz", () => {
    let hits = 0;
    const unsubscribe = subscribeDiscoveryPipeline(() => {
      hits++;
    });
    setDiscoveryPipelineActive(true);
    expect(isDiscoveryPipelineActive()).toBe(true);
    expect(hits).toBe(1);
    // Aynı değeri yazmak gereksiz render üretmemeli.
    setDiscoveryPipelineActive(true);
    expect(hits).toBe(1);
    setDiscoveryPipelineActive(false);
    expect(hits).toBe(2);
    unsubscribe();
  });

  it("abonelik kaldırıldıktan sonra bildirim gitmez", () => {
    let hits = 0;
    const unsubscribe = subscribeDiscoveryPipeline(() => {
      hits++;
    });
    unsubscribe();
    setDiscoveryPipelineActive(true);
    setDiscoveryPipelineActive(false);
    expect(hits).toBe(0);
  });
});
