// Sunucu girişi — 504'ü kapatan kesme noktasının GERÇEKTEN bağlı olduğunun kanıtı.
//
// Bu testler saf fonksiyonları değil, `src/server.ts` giriş noktasını çağırır:
// böylece "fonksiyon doğru hesaplıyor ama sunucuya bağlanmamış" hatası
// yakalanır. `/health` yolu kasıtlı seçildi; uygulama runtime'ını (TanStack
// server-entry) yüklemez, dolayısıyla test hızlı ve bağımsızdır.
import { afterEach, describe, expect, it, vi } from "vitest";
import serverEntry from "./server";

afterEach(() => {
  vi.unstubAllEnvs();
});

function healthRequest(): Request {
  return new Request("https://aroless.tech/health");
}

describe("sunucu girişi / /health", () => {
  it("kalıcı/dev süreçte global kesmenin KAPALI olduğunu bildirir", async () => {
    // Dev sunucusu ve Render kalıcıdır; orada 45 sn'lik global bir tavan uzun
    // analizleri haksız yere keserdi.
    vi.stubEnv("NITRO_PRESET", "node-server");
    vi.stubEnv("VERCEL", "");
    const res = await serverEntry.fetch(healthRequest(), {}, {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      requestDeadlineMs: number | null;
      serverless: boolean;
    };
    expect(body.serverless).toBe(false);
    expect(body.requestDeadlineMs).toBeNull();
  });

  it("Vercel'de 504'ü kapatan kesme noktasını bildirir", async () => {
    // Üç girdiyi de sabitliyoruz: ortam değişkenlerinden bağımsız, deterministik
    // bir doğrulama olsun (aksi halde çalışma alanındaki bir değişken testi
    // sessizce zayıflatabilirdi).
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_URL", "aroless.vercel.app");
    vi.stubEnv("NITRO_PRESET", "vercel");
    vi.stubEnv("VERCEL_FUNCTION_MAX_DURATION", "300");

    const res = await serverEntry.fetch(healthRequest(), {}, {});
    const body = (await res.json()) as {
      requestDeadlineMs: number | null;
      platformSeconds: number;
      serverless: boolean;
    };

    expect(body.serverless).toBe(true);
    expect(body.requestDeadlineMs).toBe(292_000);
    // Sözleşme: yanıt, platform işi öldürmeden ÖNCE çıkmalı.
    expect(body.requestDeadlineMs!).toBeLessThan(body.platformSeconds * 1000);
  });

  it("daraltılmış fonksiyon limitini de izler (eski 60 sn kurulumu)", async () => {
    // `VERCEL_FUNCTION_MAX_DURATION=60` kalmış bir projede kesme noktası 52 sn
    // olur. Yanlış olsa da tutarlıdır: hat 44 sn alır ve 504 üretilmez.
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("NITRO_PRESET", "vercel");
    vi.stubEnv("VERCEL_FUNCTION_MAX_DURATION", "60");
    const res = await serverEntry.fetch(healthRequest(), {}, {});
    const body = (await res.json()) as { requestDeadlineMs: number | null };
    expect(body.requestDeadlineMs).toBe(52_000);
  });

  it("sağlık yanıtı sır sızdırmaz ve önbellek durumunu raporlar", async () => {
    const res = await serverEntry.fetch(healthRequest(), {}, {});
    const text = JSON.stringify(await res.json());
    expect(text).toContain("caches");
    expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/); // JWT benzeri parça yok
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});
