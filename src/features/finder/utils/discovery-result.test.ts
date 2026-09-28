// ============================================================================
// KEŞİF HATTI HATA AÇIKLAMASI + HAT DEPOSU — BİRİM TESTLERİ.
//
// Kilitlenen davranış: arayüz hat kurulamayınca klasik motora düşüyor ve
// KULLANICIYA GERÇEK SEBEBİ söylemek zorunda. "Hata oldu" demek, kullanıcının
// ekranı düzeltememesi demektir; ham Supabase hatasını göstermek ise onu
// anlamaz. Bu testler ikisinin arasındaki çevirinin bozulmadığını sabitler.
// ============================================================================
import { describe, expect, it } from "vitest";

import { discoveryFallbackNotice, describeDiscoveryFailure } from "./discovery-result";
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

  it("tanımadığı hatayı SAKLAMAZ — kısaltıp sonuna ekler", () => {
    const text = describeDiscoveryFailure("bambaşka bir hata: xyz");
    expect(text).toContain("bambaşka bir hata: xyz");
  });

  it("boş sebepte de anlamlı bir cümle döner", () => {
    expect(describeDiscoveryFailure("").length).toBeGreaterThan(10);
  });
});

describe("discoveryFallbackNotice", () => {
  it("sebebi, geri düşüşü ve teşhis adresini birlikte söyler", () => {
    const notice = discoveryFallbackNotice('column "discovery_status" does not exist');
    expect(notice).toContain("migration");
    expect(notice).toContain("klasik motor");
    // Kullanıcı tek tıkla teşhise gidebilsin: teşhis ucu gizli kalmamalı.
    expect(notice).toContain("/api/product-discovery/preflight");
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
