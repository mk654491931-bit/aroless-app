// ============================================================================
// PREFLIGHT KONTROLÜ — BİRİM TESTLERİ.
//
// Bu testler saf fonksiyonları kilitler. Neden önemli: preflight'in tek işi
// "hat neden kurulmadı" sorusunu DÜRÜŞT cevaplamak. Yanlış yeşil gösteren bir
// kontrol, olmayan hatta "her şey hazır" der ve kullanıcı yine eski hatta
// düşer — yani teşhis aracının kendisi hatayı gizlerdi.
// ============================================================================
import { describe, expect, it } from "vitest";

import {
  buildPreflight,
  envChecks,
  schemaChecks,
  summarize,
  type PreflightEnv,
} from "./product-discovery-preflight.server";

/** Tam kurulum: zorunlu anahtarlar + isteğe bağlı tüm kaynak anahtarları tanımlı. */
const READY: PreflightEnv = {
  QSTASH_TOKEN: "t",
  QSTASH_CURRENT_SIGNING_KEY: "k",
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "r",
  GEMINI_API_KEY: "g",
  SERPAPI_KEY: "s",
  SCRAPERAPI_KEY: "sc",
  // Gelişmiş model havuzu (DeepSeek V4.1 Flash / GLM-5.3 / Qwen3.8 / MiMo /
  // Gemma 4 tek anahtarla açılır). SerpAPI/ScraperAPI gibi isteğe bağlıdır.
  OPENROUTER_API_KEY: "or",
  // EVREN (SSB ulusal YZ platformu): anahtar + uç + model. Üçü birden gerekir.
  EVREN_API_KEY: "ev",
  EVREN_BASE_URL: "https://evren.example.test/v1/chat/completions",
  EVREN_MODEL: "deepseek-v4.1-flash",
};

const byId = (checks: { id: string }[], id: string) =>
  checks.find((c) => c.id === id) as { ok: boolean; optional?: boolean; fix: string } | undefined;

describe("preflight env kontrolleri", () => {
  it("tam kurulumda tüm kontroller geçer", () => {
    const checks = envChecks(READY);
    expect(checks.every((c) => c.ok)).toBe(true);
  });

  it("gelişmiş model havuzu yoksa hat yine çalışır (isteğe bağlı)", () => {
    const checks = envChecks({
      ...READY,
      OPENROUTER_API_KEY: undefined,
      EVREN_API_KEY: undefined,
      EVREN_BASE_URL: undefined,
      EVREN_MODEL: undefined,
    });
    const check = byId(checks, "ai_models");
    expect(check?.ok).toBe(false);
    expect(check?.optional).toBe(true);
    // Yokluk hatı düşürmez; yalnız gelişmiş modeller kullanılmaz.
    expect(check?.fix).toContain("OpenRouter");
  });

  it("EVREN tek başına gelişmiş model havuzunu açar (OpenRouter gerekmez)", () => {
    const checks = envChecks({ ...READY, OPENROUTER_API_KEY: undefined });
    expect(byId(checks, "ai_models")?.ok).toBe(true);
    expect(byId(checks, "evren")?.ok).toBe(true);
  });

  it("doğrudan sağlayıcı anahtarı varsa model havuzu tanımlı sayılır", () => {
    const checks = envChecks({
      ...READY,
      OPENROUTER_API_KEY: undefined,
      PROVIDER_A_1: "ds",
      PROVIDER_A_BASE_URL: "https://api.deepseek.com/v1",
    });
    expect(byId(checks, "ai_models")?.ok).toBe(true);
  });

  it("QSTASH_TOKEN yoksa hat kuyruğa ALINAMAZ — bu zorunlu eksiktir", () => {
    const check = byId(envChecks({ ...READY, QSTASH_TOKEN: undefined }), "qstash_token");
    expect(check?.ok).toBe(false);
    expect(check?.optional).toBeFalsy();
    // Düzeltme yazılmadan "hazır" denemez: kullanıcı ne yapacağını bilmeli.
    expect(check?.fix).toContain("QSTASH_TOKEN");
  });

  it("imza anahtarı yoksa üretimde her adım 503 döner — zorunlu eksiktir", () => {
    const check = byId(
      envChecks({ ...READY, QSTASH_CURRENT_SIGNING_KEY: undefined }),
      "qstash_signing_key",
    );
    expect(check?.ok).toBe(false);
    expect(check?.optional).toBeFalsy();
  });

  it("servis rolü anahtarı yoksa kalıcı iş kaydı açılamaz — zorunlu eksiktir", () => {
    const check = byId(
      envChecks({ ...READY, SUPABASE_SERVICE_ROLE_KEY: undefined }),
      "supabase_service_role",
    );
    expect(check?.ok).toBe(false);
    expect(check?.optional).toBeFalsy();
  });

  it("Gemini anahtarı İSTEĞE BAĞLIDIR: yoksa hat yine de hazırdır", () => {
    const checks = envChecks({ ...READY, GEMINI_API_KEY: undefined });
    const check = byId(checks, "gemini");
    expect(check?.ok).toBe(false);
    expect(check?.optional).toBe(true);
    // Hat hazır sayılır: Gemini yoksa yalnız seçim deterministik olur.
    // SerpAPI/ScraperAPI/OpenRouter/EVREN tanımlı olduğu için tek eksik budur;
    // hepsi isteğe bağlıdır ve yoklukları hattı düşürmez.
    expect(summarize(checks)).toBe("Hat çalışmaya hazır (1 isteğe bağlı eksik).");
  });

  it("boş string 'tanımlı' sayılmaz", () => {
    const check = byId(envChecks({ ...READY, QSTASH_TOKEN: "   " }), "qstash_token");
    expect(check?.ok).toBe(false);
  });
});

describe("preflight şema kontrolleri", () => {
  it("migration uygulanmamışsa kolon kontrolü kırmızıdır ve SQL dosyasını söyler", () => {
    const checks = schemaChecks({
      columnsError: 'column "searches.discovery_status" does not exist',
      rpcError: null,
    });
    const check = byId(checks, "db_columns");
    expect(check?.ok).toBe(false);
    expect(check?.fix).toContain("20260927000000_product_discovery_pipeline.sql");
  });

  it("RPC yoksa ayrı bir kontrol kırmızıdır (kolonlar yeşil kalabilir)", () => {
    const checks = schemaChecks({
      columnsError: null,
      rpcError: "function public.advance_discovery_status does not exist",
    });
    expect(byId(checks, "db_columns")?.ok).toBe(true);
    expect(byId(checks, "db_rpc")?.ok).toBe(false);
  });

  it("DOĞRULANAMADI durumu yeşil GÖSTERİLMEZ (yoklanmamış ≠ geçti)", () => {
    // Servis rolü anahtarı yoksa veritabanına hiç gidilmez. Burada "bilmiyorum"
    // yerine "geçti" demek, kullanıcıya doğrulanmamış bir şeyi doğrulanmış
    // göstermek olurdu — bu kod tabanında sessiz yalanın en ince hâli.
    const checks = schemaChecks({ columnsError: undefined, rpcError: undefined });
    expect(byId(checks, "db_columns")?.ok).toBe(false);
    expect(byId(checks, "db_rpc")?.ok).toBe(false);
    expect(buildPreflight(READY, {}).ok).toBe(false);
  });

  it("temiz yoklama iki kontrolü de geçirir", () => {
    const checks = schemaChecks({ columnsError: null, rpcError: null });
    expect(checks.every((c) => c.ok)).toBe(true);
  });
});

describe("preflight özeti", () => {
  it("eksik anahtarları isimleriyle sayar", () => {
    const report = buildPreflight(
      { ...READY, QSTASH_TOKEN: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined },
      { columnsError: null, rpcError: null },
    );
    expect(report.ok).toBe(false);
    expect(report.summary).toContain("QStash yayın jetonu");
    expect(report.summary).toContain("Supabase servis rolü");
  });

  it("şema hatası özete de yansır", () => {
    const report = buildPreflight(READY, {
      columnsError: "column does not exist",
      rpcError: null,
    });
    expect(report.ok).toBe(false);
    expect(report.summary).toContain("searches keşif kolonları");
  });

  it("tam kurulum 'hazır' der", () => {
    const report = buildPreflight(READY, { columnsError: null, rpcError: null });
    expect(report.ok).toBe(true);
    expect(report.summary).toBe("Hat çalışmaya hazır.");
  });

  it("HİÇBİR kontrol sır değeri taşımaz", () => {
    // Sızıntı koruması: rapor JSON olarak kullanıcıya döner.
    const report = buildPreflight({ ...READY, QSTASH_TOKEN: "super-gizli-token" }, {});
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("super-gizli-token");
  });
});
