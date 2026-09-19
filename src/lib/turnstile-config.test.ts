import { describe, it, expect, vi } from "vitest";
import { TURNSTILE_SCRIPT_SRC, turnstileWidgetOptions } from "./turnstile-config";

describe("turnstileWidgetOptions", () => {
  it("mobil için kapsayıcıya uyan boyutu kullanır", () => {
    const opts = turnstileWidgetOptions("site-key", () => {});
    expect(opts.size).toBe("flexible");
    expect(opts.sitekey).toBe("site-key");
    expect(opts.appearance).toBe("interaction-only");
  });

  it("agresif retry aralığı ayarlamaz (varsayılan 8 sn geçerli)", () => {
    const opts = turnstileWidgetOptions("site-key", () => {});
    expect(opts).not.toHaveProperty("retry-interval");
    expect(opts.retry).toBe("auto");
  });

  it("hatasız akışta token'ı iletir", () => {
    const onToken = vi.fn();
    turnstileWidgetOptions("site-key", onToken).callback("token-123");
    expect(onToken).toHaveBeenCalledWith("token-123");
  });

  it("hata/expired/timeout durumlarında boş token ile devam eder ve uyarır", () => {
    const onToken = vi.fn();
    const warn = vi.fn();
    const opts = turnstileWidgetOptions("site-key", onToken, warn);

    opts["error-callback"]();
    opts["expired-callback"]();
    opts["timeout-callback"]();

    expect(onToken).toHaveBeenCalledTimes(3);
    expect(onToken).toHaveBeenCalledWith("");
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("betik adresi explicit render ile yüklenir", () => {
    expect(TURNSTILE_SCRIPT_SRC).toContain("challenges.cloudflare.com");
    expect(TURNSTILE_SCRIPT_SRC).toContain("render=explicit");
  });
});
