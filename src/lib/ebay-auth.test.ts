// ============================================================================
// eBay + CJ JETON AKIŞI — BİRİM TESTLERİ (ağ yok, sahte `fetch`).
//
// NEDEN: bu iki kaynak daha önce panel anahtarını doğrudan jeton başlığına
// koyuyordu. Sonuç ölçülmüş bir yalandı: ön kontrol "tanımlı" diyor, kaynak
// 401 alıp 0 satır dönüyor, kullanıcı "anahtar var ama veri yok" görüyordu.
// Bu testler jetonun GERÇEKTEN değiştirildiğini ve yeniden kullanıldığını
// kilitler — ağ olmadan, saf sahte yanıtlarla.
// ============================================================================
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ebayAppToken,
  ebayClientId,
  ebayClientSecret,
  ebayCredentialsConfigured,
  ebayStaticToken,
  ebayTokenUrl,
  resetEbayTokenCache,
} from "./ebay-auth.server";
import {
  cjApiKey,
  cjConfigured,
  cjStaticAccessToken,
  resetCjTokenCache,
  resolveCjAccessToken,
} from "./mic-supplier.server";

/** Sahte yanıt üreticisi. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  resetEbayTokenCache();
  resetCjTokenCache();
});

describe("eBay kimlik bilgileri", () => {
  it("Client ID/Secret eşanlamlılarını okur, boşlukları kırpar", () => {
    expect(ebayClientId({ EBAY_CLIENT_ID: " id " })).toBe("id");
    expect(ebayClientId({ EBAY_APP_ID: "app" })).toBe("app");
    expect(ebayClientSecret({ EBAY_CLIENT_SECRET: " s " })).toBe("s");
    expect(ebayClientSecret({ EBAY_CERT_ID: "cert" })).toBe("cert");
    expect(ebayClientId({})).toBe("");
  });

  it("elle verilen jetonu okur (EBAY_TOKEN / EBAY_OAUTH_TOKEN)", () => {
    expect(ebayStaticToken({ EBAY_OAUTH_TOKEN: "t1" })).toBe("t1");
    expect(ebayStaticToken({ EBAY_BEARER_TOKEN: "t2" })).toBe("t2");
    expect(ebayStaticToken({})).toBe("");
  });

  it("kimlik ÇİFTİ tamamsa ya da elle jeton varsa yapılandırılmış sayar", () => {
    expect(ebayCredentialsConfigured({ EBAY_CLIENT_ID: "id" })).toBe(false);
    expect(ebayCredentialsConfigured({ EBAY_CLIENT_SECRET: "sec" })).toBe(false);
    expect(ebayCredentialsConfigured({ EBAY_CLIENT_ID: "id", EBAY_CLIENT_SECRET: "sec" })).toBe(true);
    // Elle alınan jeton tek başına yeterlidir (kısa yol).
    expect(ebayCredentialsConfigured({ EBAY_OAUTH_TOKEN: "t" })).toBe(true);
  });

  it("jeton ucu sandbox tabanıyla ezilebilir", () => {
    expect(ebayTokenUrl({})).toBe("https://api.ebay.com/identity/v1/oauth2/token");
    expect(ebayTokenUrl({ EBAY_API_BASE: "https://api.sandbox.ebay.com/" })).toBe(
      "https://api.sandbox.ebay.com/identity/v1/oauth2/token",
    );
  });
});

describe("eBay uygulama jetonu (client_credentials)", () => {
  it("kimlik yoksa AĞ ÇAĞRISI yapmaz", async () => {
    const fetchImpl = vi.fn();
    expect(await ebayAppToken({}, fetchImpl as unknown as typeof fetch)).toBe("");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("elle jeton varsa akışı hiç çalıştırmaz", async () => {
    const fetchImpl = vi.fn();
    const token = await ebayAppToken(
      { EBAY_OAUTH_TOKEN: "manual" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(token).toBe("manual");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("Basic auth + client_credentials gönderir ve jetonu döner", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ access_token: "app-token", expires_in: 7200 }));
    const token = await ebayAppToken(
      { EBAY_CLIENT_ID: "id", EBAY_CLIENT_SECRET: "sec" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(token).toBe("app-token");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.ebay.com/identity/v1/oauth2/token");
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("grant_type=client_credentials");
    expect(String((init.headers as Record<string, string>).authorization)).toBe(
      `Basic ${btoa("id:sec")}`,
    );
  });

  it("jetonu önbellekten yeniden kullanır (her aramada değil)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ access_token: "cached", expires_in: 7200 }));
    const env = { EBAY_CLIENT_ID: "id", EBAY_CLIENT_SECRET: "sec" };
    expect(await ebayAppToken(env, fetchImpl as unknown as typeof fetch)).toBe("cached");
    expect(await ebayAppToken(env, fetchImpl as unknown as typeof fetch)).toBe("cached");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("süresi dolmuş önbelleği yeniler", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ access_token: "fresh", expires_in: 7200 }));
    const env = { EBAY_CLIENT_ID: "id", EBAY_CLIENT_SECRET: "sec" };
    await ebayAppToken(env, fetchImpl as unknown as typeof fetch, 1_000);
    // 3 saat sonra: 2 saatlik jeton + 60 sn pay çoktan geçti.
    expect(await ebayAppToken(env, fetchImpl as unknown as typeof fetch, 1_000 + 3 * 3_600_000)).toBe(
      "fresh",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("HTTP hatasında \"\" döner ve sır sızdırmaz", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "invalid_client" }, 401));
    const token = await ebayAppToken(
      { EBAY_CLIENT_ID: "id", EBAY_CLIENT_SECRET: "topsecret" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(token).toBe("");
  });

  it("ağ hatasında \"\" döner (hat düşmez)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    expect(
      await ebayAppToken(
        { EBAY_CLIENT_ID: "id", EBAY_CLIENT_SECRET: "sec" },
        fetchImpl as unknown as typeof fetch,
      ),
    ).toBe("");
  });
});

describe("CJ API Key → Access Token", () => {
  it("API Key ile access token'ı KARIŞTIRMAZ", () => {
    // Eskiden `cjApiKey` CJ_ACCESS_TOKEN'ı da döndürüyordu; o jeton
    // `getAccessToken` ucuna gönderilince 401 geliyordu.
    expect(cjApiKey({ CJ_ACCESS_TOKEN: "tok" })).toBe("");
    expect(cjApiKey({ CJ_API_KEY: "key" })).toBe("key");
    expect(cjStaticAccessToken({ CJ_ACCESS_TOKEN: "tok" })).toBe("tok");
  });

  it("kaynak ya hazır jetonla ya API Key ile yapılandırılmış sayılır", () => {
    expect(cjConfigured({})).toBe(false);
    expect(cjConfigured({ CJ_API_KEY: "key" })).toBe(true);
    expect(cjConfigured({ CJ_ACCESS_TOKEN: "tok" })).toBe(true);
  });

  it("hazır jeton varsa değişim çağrısı yapılmaz", async () => {
    const fetchImpl = vi.fn();
    expect(
      await resolveCjAccessToken({ CJ_ACCESS_TOKEN: "ready" }, fetchImpl as unknown as typeof fetch),
    ).toBe("ready");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("API Key'i getAccessToken ucuna gönderir ve dönen jetonu kullanır", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ result: true, data: { accessToken: "cj-token" } }),
    );
    const token = await resolveCjAccessToken({ CJ_API_KEY: "key" }, fetchImpl as unknown as typeof fetch);
    expect(token).toBe("cj-token");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://developers.cjdropshipping.com/api2.0/v1/authentication/getAccessToken");
    expect(JSON.parse(String(init.body))).toEqual({ apiKey: "key" });
  });

  it("dönen jetonu önbelleğe alır (her aramada yeniden almaz)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: { accessToken: "cj-token" } }));
    const env = { CJ_API_KEY: "key" };
    await resolveCjAccessToken(env, fetchImpl as unknown as typeof fetch);
    expect(await resolveCjAccessToken(env, fetchImpl as unknown as typeof fetch)).toBe("cj-token");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("jeton dönmezse \"\" döner", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ result: false, data: {} }));
    expect(await resolveCjAccessToken({ CJ_API_KEY: "key" }, fetchImpl as unknown as typeof fetch)).toBe(
      "",
    );
  });

  it("anahtar yoksa ağ çağrısı yapmaz", async () => {
    const fetchImpl = vi.fn();
    expect(await resolveCjAccessToken({}, fetchImpl as unknown as typeof fetch)).toBe("");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
