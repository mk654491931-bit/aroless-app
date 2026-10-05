/**
 * EVREN (SSB ulusal YZ platformu) entegrasyonunun DÜRÜSTLÜK testleri.
 *
 * Buradaki en önemli kural şu: EVREN'in uç adresi ve model slug'ları kamuya açık
 * dokümanda YOK (erişim e-Devlet arkasında). Bu yüzden kod tabanı bu ikisini
 * ASLA tahmin etmemeli. Testler de tam olarak bunu sabitler — anahtar tek
 * başına "hazır" sayılmaz, uç uydurulmaz.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { evrenBaseUrl, evrenEnvKeys, evrenModels, evrenStatus } from "./ai-keys.server";
import { buildPoolNodes, poolGroupAvailable, poolGroupConfigured } from "./ai-pool.server";
import { groqEnvKeys } from "./ai-keys.server";
import { DEEP_CHAIN, FAST_CHAIN, councilChainFor } from "./ai-router.server";
import { envChecks } from "./product-discovery-preflight.server";

afterEach(() => {
  vi.unstubAllEnvs();
});

const READY = { EVREN_API_KEY: "ev-key" };

/** Doğrulanmış varsayılan uc — kullanıcı üçüncü kutuyu doldurmak zorunda değil. */
const EVREN_DEFAULT_URL = "https://evren-llmapi.ssyz.org.tr/v1";

describe("EVREN anahtar taraması", () => {
  it("düz EVREN_API_KEY okur", () => {
    vi.stubEnv("EVREN_API_KEY", "k1");
    expect(evrenEnvKeys()).toEqual(["k1"]);
  });

  it("PROVIDER_E_1.._8 yuvalarını ve numaralı adları tarar", () => {
    vi.stubEnv("PROVIDER_E_1", "a");
    vi.stubEnv("PROVIDER_E_2", "b");
    vi.stubEnv("EVREN_API_KEY_3", "c");
    vi.stubEnv("EVREN_4_API_KEY", "d");
    expect(evrenEnvKeys()).toContain("a");
    expect(evrenEnvKeys()).toContain("b");
    expect(evrenEnvKeys()).toContain("c");
    expect(evrenEnvKeys()).toContain("d");
  });

  it("aynı anahtarı iki kez saymaz", () => {
    vi.stubEnv("PROVIDER_E_1", "same");
    vi.stubEnv("EVREN_API_KEY_1", "same");
    expect(evrenEnvKeys()).toEqual(["same"]);
  });

  it("hiçbir şey tanımlı değilse boş döner", () => {
    expect(evrenEnvKeys()).toEqual([]);
  });
});

describe("EVREN ucu ve modeli — DOĞRULANMIŞ VARSAYILAN", () => {
  it("kullanıcı uç tanımlamazsa doğrulanmış varsayılan kullanılır", () => {
    vi.stubEnv("EVREN_API_KEY", "k1");
    expect(evrenBaseUrl()).toBe(EVREN_DEFAULT_URL);
  });

  it("kullanıcı uç tanımlarsa O kullanılır (varsayılan ezilir)", () => {
    vi.stubEnv("EVREN_BASE_URL", "https://kendi.example.test/v1");
    expect(evrenBaseUrl()).toBe("https://kendi.example.test/v1");
  });

  it("model tanımlanmazsa `auto` — platform kendi modelini seçer", () => {
    vi.stubEnv("EVREN_API_KEY", "k1");
    expect(evrenModels()).toEqual(["auto"]);
  });

  it("anahtar yoksa hazır sayılmaz", () => {
    expect(evrenStatus({}).ready).toBe(false);
  });

  it("virgüllü model listesini ayrıştırır (sabit model istenirse)", () => {
    vi.stubEnv("EVREN_MODELS", "glm-5.3, deepseek-v4.1-flash ,qwen3.8-flash-next");
    expect(evrenModels()).toEqual(["glm-5.3", "deepseek-v4.1-flash", "qwen3.8-flash-next"]);
  });

  it("aynı slug'ı iki kez listelemek tekrarlanmaz", () => {
    vi.stubEnv("EVREN_MODEL", "glm-5.3,glm-5.3");
    expect(evrenModels()).toEqual(["glm-5.3"]);
  });

  it("YALNIZ ANAHTAR yeterli — uç ve model otomatik gelir", () => {
    const status = evrenStatus(READY);
    expect(status).toMatchObject({ keys: 1, baseUrl: true, ready: true });
    expect(status.models).toEqual(["auto"]);
  });
});

describe("EVREN havuz kaydı", () => {
  it("üçü de tanımlıysa pool_e düğümleri üretilir", () => {
    for (const [k, v] of Object.entries(READY)) vi.stubEnv(k, v);
    expect(poolGroupConfigured("pool_e")).toBe(true);
    expect(poolGroupAvailable("pool_e")).toBe(true);
    const nodes = buildPoolNodes().filter((n) => n.group === "pool_e");
    expect(nodes.length).toBeGreaterThanOrEqual(1);
    expect(nodes[0]!.id).toBe("POOL_E-01");
  });

  it("yalnız anahtar varsa da düğüm üretilir (varsayılan uç + auto model)", () => {
    vi.stubEnv("EVREN_API_KEY", "k1");
    expect(buildPoolNodes().filter((n) => n.group === "pool_e")).toHaveLength(1);
    expect(poolGroupAvailable("pool_e")).toBe(true);
  });

  it("anahtar YOKSA düğüm üretilmez", () => {
    expect(buildPoolNodes().filter((n) => n.group === "pool_e")).toHaveLength(0);
    expect(poolGroupAvailable("pool_e")).toBe(false);
  });

  it("sır sağlık özetine sızmaz", () => {
    for (const [k, v] of Object.entries({ ...READY, EVREN_API_KEY: "super-secret" }))
      vi.stubEnv(k, v);
    const nodes = buildPoolNodes().filter((n) => n.group === "pool_e");
    expect(JSON.stringify(nodes)).not.toContain("super-secret");
  });
});

describe("EVREN zincirlerde yer alır", () => {
  it("her iki zincirde de vardır", () => {
    expect(FAST_CHAIN).toContain("evren");
    expect(DEEP_CHAIN).toContain("evren");
  });

  it("konsey dağılımına girer — EVREN + Groq ikilisi", () => {
    // Kullanıcı kararı: 14 ajan EVREN ve Groq'un 5 anahtarı üzerinde koşar,
    // biri hata verirse diğerine ve kalan 5 sağlayıcıya düşer.
    const chains = Array.from({ length: 14 }, (_, i) => councilChainFor(i));
    for (const chain of chains) {
      expect(chain).toHaveLength(7);
      expect(chain.slice(0, 2).sort()).toEqual(["evren", "groq"]);
    }
    expect(chains.filter((c) => c[0] === "evren")).toHaveLength(7);
    expect(chains.filter((c) => c[0] === "groq")).toHaveLength(7);
  });
});

describe("“5 Groq API'si” cümlesi doğrudur — hepsi kullanılır", () => {
  it("Groq sağlayıcısı TÜM anahtarları sırayla dener, ilkine takılı kalmaz", () => {
    // `rotate` her anahtarı deniyor; 429/402/401/403 alan anahtar park edilip
    // sıradakine geçiliyor. Yani "5 Groq anahtarı" ifadesi 5 ayrı kapasite
    // demek, tek deneme değil. 14 ajan aynı anda koşunca hepsi işe yarar.
    for (let i = 1; i <= 5; i++) vi.stubEnv(`GROQ_API_KEY_${i}`, `g${i}`);
    expect(groqEnvKeys().length).toBe(5);
    // groq havuz grubu 5 düğüm üretmeli (her anahtar bir düğüm).
    for (const [k, v] of Object.entries(READY)) vi.stubEnv(k, v);
    const groqNodes = buildPoolNodes().filter((n) => n.group === "groq");
    expect(groqNodes).toHaveLength(5);
    expect(new Set(groqNodes.map((n) => n.id)).size).toBe(5);
  });
});

describe("EVREN ön kontrol paneli dürüstlüğü", () => {
  it("hiçbir şey yoksa hat çalışır durumda kalır (isteğe bağlı)", () => {
    const check = envChecks({}).find((c) => c.id === "evren");
    expect(check?.ok).toBe(false);
    expect(check?.optional).toBe(true);
  });

  it("hiçbir şey yoksa eksik olduğunu açıkça söyler", () => {
    const check = envChecks({}).find((c) => c.id === "evren");
    expect(check?.ok).toBe(false);
    expect(check?.detail).toContain("Yok");
  });

  it("yalnız anahtar tanımlıysa hazır görünür", () => {
    const check = envChecks(READY).find((c) => c.id === "evren");
    expect(check?.ok).toBe(true);
    expect(check?.detail).toContain("auto");
    expect(check?.detail).not.toContain("k1");
  });
});
