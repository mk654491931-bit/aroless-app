// ============================================================================
// ABONELİK AKTİVASYON DOĞRULAMA — saf karar kuralları (ağ yok, React yok).
//
// Kilitlenen davranış, kullanıcının bildirdiği iki hatanın karşılığıdır:
//   1. "Ödedim ama abonelik başlamadı" — doğrulama YOKSA "başladı" yazılmaz.
//   2. "İndirimde tetiklenmiyor" — `checkout.completed` indirim durumundan
//      bağımsız olarak tanınır, çünkü Paddle indirimli alışverişte de aynı
//      olayı yayar.
// ============================================================================
import { describe, expect, it } from "vitest";

import {
  confirmationStep,
  isCheckoutCompleted,
  isPaidTier,
  shouldReconcile,
  type ConfirmationStatus,
} from "./subscription-confirmation";

const read = (p: string) => import("node:fs").then((fs) => fs.readFileSync(p, "utf8"));

describe("isPaidTier — 'başladı' iddiasının kapısı", () => {
  it("ücretli planları kabul eder", () => {
    for (const tier of ["Starter", "Pro", "Business"]) expect(isPaidTier(tier)).toBe(true);
  });

  it("'Free' ücretli DEĞİLDİR — webhook henüz yazmadı demektir", () => {
    expect(isPaidTier("Free")).toBe(false);
    expect(isPaidTier("free")).toBe(false);
    expect(isPaidTier(" FREE ")).toBe(false);
  });

  it("null/boş değer ücretli sayılmaz (yokluk, varoluşun kanıtı değildir)", () => {
    // Ölçülen hatanın kaynağıydı: profil henüz güncellenmemişken "başladı"
    // demek, olmayan bir şeyi iddia etmektir.
    expect(isPaidTier(null)).toBe(false);
    expect(isPaidTier(undefined)).toBe(false);
    expect(isPaidTier("")).toBe(false);
    expect(isPaidTier("   ")).toBe(false);
  });
});

describe("isCheckoutCompleted — indirim tetiği", () => {
  it("checkout.completed'ı tanır", () => {
    expect(isCheckoutCompleted({ name: "checkout.completed", data: { id: "txn_1" } })).toBe(true);
  });

  it("İNDİRİMLİ alışverişte de aynı olayı tanır (tutar 0 olsa bile)", () => {
    // Kullanıcı şikâyeti: indirim kodu uygulanınca frontend tetiklenmiyor.
    // Sebep: tutara (grandTotal=0) bakılarak elenmesiydi. Doğru olan
    // OLAYIN ADINA bakmaktır; Paddle indirimli alışverişte de aynı olayı yayar.
    const event = {
      name: "checkout.completed",
      data: { id: "txn_2", details: { totals: { grandTotal: "0" } } },
    };
    expect(isCheckoutCompleted(event)).toBe(true);
  });

  it("ilgisiz olayları reddeder", () => {
    for (const e of [null, undefined, {}, "checkout.completed", { name: "checkout.loaded" }, 42]) {
      expect(isCheckoutCompleted(e)).toBe(false);
    }
  });
});

describe("confirmationStep — bekleme ve zaman aşımı", () => {
  const base = { maxAttempts: 3, intervalMs: 1500 };

  it("plan ücretliyse HEMEN doğrular, beklemez", () => {
    // Yenileme ödemesi yapan ücretli kullanıcı gereksizce bekletilmemeli.
    const step = confirmationStep({ ...base, tier: "Pro", attempt: 0 });
    expect(step).toEqual({ status: "confirmed", delayMs: null, done: true });
  });

  it("plan Free ise tekrar dener", () => {
    const step = confirmationStep({ ...base, tier: "Free", attempt: 0 });
    expect(step).toEqual({ status: "pending", delayMs: 1500, done: false });
  });

  it("son denemede plan hâlâ Free ise ZAMAN AŞIMI — 'başladı' denmez", () => {
    // En kritik kural: webhook hiç gelmezse dürüstçe zaman aşımı.
    const step = confirmationStep({ ...base, tier: "Free", attempt: 3 });
    expect(step).toEqual({ status: "timeout", delayMs: null, done: true });
  });

  it("sayaç arttıkça beklemeyi bırakır", () => {
    expect(confirmationStep({ ...base, tier: null, attempt: 2 }).done).toBe(false);
    expect(confirmationStep({ ...base, tier: null, attempt: 3 }).done).toBe(true);
  });

  it("maxAttempts=0 ise hiç beklemeden zaman aşımı verir", () => {
    const step = confirmationStep({ maxAttempts: 0, intervalMs: 100, tier: "Free", attempt: 0 });
    expect(step.status).toBe("timeout");
  });

  it("durum 'confirmed' olanakadar 'idle' DEĞİL, çalışır durumdadır", () => {
    const step = confirmationStep({ ...base, tier: "Free", attempt: 1 });
    expect(step.status satisfies ConfirmationStatus).toBe("pending");
  });
});

describe("shouldReconcile — Paddle'dan tazeleme zamanı", () => {
  /** Webhook gelmediyse yetki Paddle'ın kendi kaydından yazdırılır. */
  const base = { reconcilesDone: 0, maxReconciles: 3, hasReconcile: true };

  it("webhook'a önce zaman tanınır: ilk iki yoklamada tazelenmez", () => {
    // Normal akışta webhook saniyeler içinde yazar; API boşa çağrılmaz.
    expect(shouldReconcile({ ...base, attempt: 0 })).toBe(false);
    expect(shouldReconcile({ ...base, attempt: 1 })).toBe(false);
  });

  it("üçüncü yoklamadan itibaren her ikinci denemede tazeler", () => {
    expect(shouldReconcile({ ...base, attempt: 2 })).toBe(true);
    expect(shouldReconcile({ ...base, attempt: 3 })).toBe(false);
    expect(shouldReconcile({ ...base, attempt: 4 })).toBe(true);
  });

  it("tazeleme sayısı sınırına uyar (Paddle API'si boşa yorulmaz)", () => {
    expect(shouldReconcile({ ...base, attempt: 2, reconcilesDone: 3 })).toBe(false);
    expect(shouldReconcile({ ...base, attempt: 4, reconcilesDone: 2 })).toBe(true);
  });

  it("tazeleme bağlanmamışsa hiç denenmez", () => {
    expect(shouldReconcile({ ...base, attempt: 6, hasReconcile: false })).toBe(false);
  });
});

// ============================================================================
// KABLOLAMA SÖZLEŞMESİ — asıl hatanın kendisi buradaydı.
// ============================================================================

describe("her checkout giriş noktası olay dinleyicisi verir", () => {
  // ÖLÇÜLEN HATA: `pricing-card.tsx`, `openPaddleOverlay`'a `onEvent` VERMİYORDU.
  // Paddle.js örnek önbelleklemesi sayesinde bu bazen maskeleniyor, ama ilk
  // açılış bu yolsa hiçbir olay gelmiyor ve “abonelik başlatıldı” görünmüyordu.
  // Bir giriş noktası sessizce dinleyicisiz kalırsa hata tekrar doğar.
  it("pricing-card her iki checkout yoluna da onEvent geçirir", async () => {
    const src = await read("src/components/pricing-card.tsx");
    expect(src).toContain("onEvent: onCheckoutEvent");
    // Sunucu oturumlu yol da, ham fiyat yedeği de dinleyicili olmalı.
    expect(src.match(/onEvent: onCheckoutEvent/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("pricing-modal hem sunucu hem yedek yolda onEvent geçirir", async () => {
    const src = await read("src/components/pricing-modal.tsx");
    expect(src.match(/onEvent: onCheckoutEvent/g)?.length).toBeGreaterThanOrEqual(2);
  });

  // Paddle.js `initializePaddle` örneğini ÖNBELLEKLEMEYE alır ve sonraki
  // çağrılarda verilen `eventCallback`'i yok sayar. Bu yüzden dinleyici
  // `paddle.Event.on` ile de kurulmalıdır; aksi hâlde ilk açılış sonrası
  // olaylar sessizce kaybolur (indirimli alışverişte bildirilen belirti).
  it("paddle-checkout, önbelleklenmiş örnek için Event.on ile yeniden bağlar", async () => {
    const src = await read("src/lib/paddle-checkout.ts");
    expect(src).toContain("Paddle.Event.on");
    expect(src).toContain("checkout.completed");
  });
});

describe("ödeme sonrası dönüş kullanıcıya geri bildirim verir", () => {
  // ÖLÇÜLEN HATA 2: `successUrl` `/settings?paid=1` üretiyor ama `settings.tsx`
  // bu parametreyi hiç okumuyordu. Kullanıcı öder, ayarlara döner ve hiçbir
  // geri bildirim görmez.
  it("settings.tsx `paid` parametresini okur ve doğrulamayı başlatır", async () => {
    const src = await read("src/routes/settings.tsx");
    expect(src).toContain("validateSearch");
    expect(src).toContain('search.paid === "1"');
    expect(src).toContain("useSubscriptionConfirmation");
  });

  it("successUrl hâlâ doğrulama için paid=1 üretir", async () => {
    const src = await read("src/lib/paddle-checkout.ts");
    expect(src).toContain("/settings?paid=1");
  });

  // ÖLÇÜLEN HATA 3: "Paddle abonelik başladı diyor ama uygulamada başlamıyor."
  // Aktivasyon yalnız webhook'a bağlıysa, bildirim adresi/imza yanlış olduğunda
  // kullanıcı ödeme yapmış olmasına rağmen "Free" kalır. Tazeleme yolu bu
  // yüzden HER iki doğrulama noktasına da bağlı olmalı — biri unutulursa hata
  // o girişte geri döner.
  it("pricing-modal webhook gecikirse Paddle'dan tazeler", async () => {
    const src = await read("src/components/pricing-modal.tsx");
    expect(src).toContain("reconcileMySubscription");
    expect(src).toMatch(/reconcile:\s*async/);
  });

  it("settings.tsx de (ödeme dönüşü) Paddle'dan tazeler", async () => {
    const src = await read("src/routes/settings.tsx");
    expect(src).toContain("reconcileMySubscription");
    expect(src).toMatch(/reconcile:\s*async/);
  });

  it("webhook ucu GET ile canlı olduğunu bildirir (adres/imza sessizce yanlış kalmasın)", async () => {
    const src = await read("src/routes/api/public/webhook/paddle.ts");
    expect(src).toContain("GET:");
    expect(src).toContain("configured");
  });
});
