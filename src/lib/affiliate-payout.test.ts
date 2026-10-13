// Affiliate ödeme kuralları (hold / IBAN / CSV) — DB'siz birim testleri.
import { describe, expect, it } from "vitest";
import {
  buildPayoutRunCsv,
  centsToDecimal,
  csvCell,
  isValidIban,
  maskIban,
  nextPayoutUnlockAt,
  normalizeIban,
  PAYOUT_CSV_HEADER,
  PAYOUT_HOLD_DAYS,
  PAYOUT_HOLD_MS,
  payoutProfileState,
  payoutReference,
  payoutRunSummary,
  shouldNotifyCommission,
  splitCommissionsByHold,
  type CommissionRow,
} from "./affiliate-payout";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-13T12:00:00.000Z").getTime();
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

const row = (over: Partial<CommissionRow> = {}): CommissionRow => ({
  commission_cents: 870,
  status: "pending",
  created_at: ago(45),
  ...over,
});

describe("splitCommissionsByHold — bekleme süresi (hold)", () => {
  it("30 günü dolmuş komisyonu ödenebilir sayar", () => {
    const split = splitCommissionsByHold([row({ created_at: ago(PAYOUT_HOLD_DAYS) })], {
      now: NOW,
    });
    expect(split.payableCents).toBe(870);
    expect(split.heldCents).toBe(0);
    expect(split.payableCount).toBe(1);
    expect(split.oldestPayableAt).toBe(ago(PAYOUT_HOLD_DAYS));
  });

  it("29 günlük komisyonu BEKLETİR (iade riski ödemeden önce kapanır)", () => {
    const split = splitCommissionsByHold([row({ created_at: ago(29) })], { now: NOW });
    expect(split.payableCents).toBe(0);
    expect(split.heldCents).toBe(870);
    expect(split.heldCount).toBe(1);
    expect(split.oldestHeldAt).toBe(ago(29));
  });

  it("ödenmiş ve mahsup edilmiş satırları ayırır", () => {
    const split = splitCommissionsByHold(
      [
        row({ status: "paid", commission_cents: 500 }),
        row({ status: "reversed", commission_cents: 900 }),
        row({ commission_cents: 300, created_at: ago(3) }),
        row({ commission_cents: 1000, created_at: ago(60) }),
      ],
      { now: NOW },
    );
    expect(split.paidCents).toBe(500);
    expect(split.paidCount).toBe(1);
    expect(split.payableCents).toBe(1000);
    expect(split.heldCents).toBe(300);
    // reversed hiçbir toplama girmez.
    expect(split.paidCents + split.payableCents + split.heldCents).toBe(1800);
  });

  it("tarihi okunamayan satırı ÖDENEBİLİR SAYMAZ (güvenli taraf)", () => {
    const split = splitCommissionsByHold(
      [row({ created_at: null }), row({ created_at: "bozuk-tarih", commission_cents: 200 })],
      { now: NOW },
    );
    expect(split.payableCents).toBe(0);
    expect(split.heldCents).toBe(1070);
  });

  it("en eski ödenebilir/beklemedeki tarihi bulur", () => {
    const split = splitCommissionsByHold(
      [row({ created_at: ago(40) }), row({ created_at: ago(90) }), row({ created_at: ago(5) })],
      { now: NOW },
    );
    expect(split.oldestPayableAt).toBe(ago(90));
    expect(split.oldestHeldAt).toBe(ago(5));
  });

  it("boş listede sıfır döner", () => {
    const split = splitCommissionsByHold([], { now: NOW });
    expect(split).toMatchObject({ payableCents: 0, heldCents: 0, paidCents: 0 });
    expect(split.oldestPayableAt).toBeNull();
  });
});

describe("nextPayoutUnlockAt", () => {
  it("beklemedeki en eski komisyonun açılma tarihini döner", () => {
    const split = splitCommissionsByHold([row({ created_at: ago(10) })], { now: NOW });
    const unlock = nextPayoutUnlockAt(split);
    expect(unlock).toBe(new Date(NOW - 10 * DAY + PAYOUT_HOLD_MS).toISOString());
  });

  it("beklemede satır yoksa null döner", () => {
    expect(nextPayoutUnlockAt(splitCommissionsByHold([]))).toBeNull();
    expect(nextPayoutUnlockAt(splitCommissionsByHold([row({ created_at: ago(90) })]))).toBeNull();
  });
});

describe("IBAN doğrulaması (mod-97)", () => {
  it("gerçek formatlı IBAN'ları kabul eder (TR/DE/GB)", () => {
    expect(isValidIban("TR330006100519786457841326")).toBe(true);
    expect(isValidIban("DE89370400440532013000")).toBe(true);
    expect(isValidIban("GB82WEST12345698765432")).toBe(true);
  });

  it("boşluklu/küçük harfli yazımı normalize ederek kabul eder", () => {
    expect(normalizeIban("tr33 0006 1005 1978 6457 8413 26")).toBe("TR330006100519786457841326");
    expect(isValidIban("tr33 0006 1005 1978 6457 8413 26")).toBe(true);
  });

  it("tek karakter hatalı IBAN'ı reddeder (yanlış kişiye ödeme önlenir)", () => {
    expect(isValidIban("TR330006100519786457841327")).toBe(false);
    expect(isValidIban("DE89370400440532013001")).toBe(false);
  });

  it("kısa/uzun ve harf-dışı karakterli girdileri reddeder", () => {
    expect(isValidIban("TR1234")).toBe(false);
    expect(isValidIban("TR33000610051978645784132$")).toBe(false);
    expect(isValidIban("")).toBe(false);
    expect(isValidIban(null)).toBe(false);
    expect(isValidIban("A".repeat(40))).toBe(false);
  });

  it("maskelerken yalnız ilk ve son 4 karakteri gösterir", () => {
    expect(maskIban("TR330006100519786457841326")).toBe("TR33••••••••••••••••1326");
    expect(maskIban("TR12")).toBe("••••");
    expect(maskIban(null)).toBe("");
  });
});

describe("payoutProfileState — ödeme bilgisi eksikleri", () => {
  it("IBAN yönteminde geçerli IBAN + hesap sahibi ister", () => {
    expect(
      payoutProfileState({
        method: "iban",
        accountHolder: "Ayşe Yılmaz",
        iban: "TR330006100519786457841326",
      }),
    ).toEqual({ ready: true, missing: [] });

    expect(payoutProfileState({ method: "iban", accountHolder: "Ayşe" })).toEqual({
      ready: false,
      missing: ["IBAN"],
    });
  });

  it("geçersiz IBAN'ı 'eksik' olarak raporlar (sessizce kabul etmez)", () => {
    const state = payoutProfileState({
      method: "iban",
      accountHolder: "Ayşe",
      iban: "TR330006100519786457841327",
    });
    expect(state.ready).toBe(false);
    expect(state.missing.join(" ")).toContain("mod-97");
  });

  it("Wise yönteminde e-posta VEYA IBAN ister, ikisi de yoksa engeller", () => {
    expect(
      payoutProfileState({ method: "wise", accountHolder: "Ayşe", wiseEmail: "ayse@ornek.com" }),
    ).toEqual({ ready: true, missing: [] });

    const missing = payoutProfileState({ method: "wise", accountHolder: "Ayşe" });
    expect(missing.ready).toBe(false);
    expect(missing.missing.join(" ")).toContain("Wise e-postası");
  });

  it("yöntem seçilmemişse ve hesap sahibi yoksa ikisini de bildirir", () => {
    const state = payoutProfileState({});
    expect(state.ready).toBe(false);
    expect(state.missing).toEqual(["ödeme yöntemi", "hesap sahibi adı"]);
  });

  it("'other' yönteminde hedef bilgisi serbest, hesap sahibi zorunlu", () => {
    expect(payoutProfileState({ method: "other", accountHolder: "Ayşe" }).ready).toBe(true);
    expect(payoutProfileState({ method: "other" }).missing).toEqual(["hesap sahibi adı"]);
  });

  it("vergi no OPSİYONELDİR: şirket olmayan affiliate ödeme almaya devam eder", () => {
    // Alan hiç gönderilmese de kayıt "hazır" sayılır (zod şeması da opsiyonel).
    expect(
      payoutProfileState({
        method: "iban",
        accountHolder: "Ayşe Yılmaz",
        iban: "TR330006100519786457841326",
      }).ready,
    ).toBe(true);
    // Boş/null vergi no da engellemez.
    expect(payoutProfileState({ method: "other", accountHolder: "Ayşe", taxId: "" }).ready).toBe(
      true,
    );
    expect(payoutProfileState({ method: "other", accountHolder: "Ayşe", taxId: null }).ready).toBe(
      true,
    );
    // "Eksik" listesine vergi no HİÇBİR yöntemde girmez (ödeme bloke edilmez).
    for (const state of [payoutProfileState({}), payoutProfileState({ method: "wise" })]) {
      expect(state.missing.join(" ").toLowerCase()).not.toContain("vergi");
    }
  });
});

describe("CSV üretimi (ödeme listesi)", () => {
  const payRow = {
    email: "ayse@ornek.com",
    method: "wise",
    accountHolder: "Ayşe Yılmaz",
    iban: "TR33 0006 1005 1978 6457 8413 26",
    wiseEmail: "ayse@ornek.com",
    taxId: "1234567890",
    payableCents: 12000,
    payableCount: 4,
    oldestPayableAt: "2026-08-01T10:00:00.000Z",
    missing: [] as string[],
  };

  it("virgül/tırnak içeren alanları kaçırır (satır kayması olmaz)", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('de" quote')).toBe('"de"" quote"');
    expect(csvCell("satır\nsonu")).toBe('"satır\nsonu"');
    expect(csvCell("düz")).toBe("düz");
    expect(csvCell(null)).toBe("");
  });

  it("tutarları ondalık olarak yazar", () => {
    expect(centsToDecimal(12000)).toBe("120.00");
    expect(centsToDecimal(1)).toBe("0.01");
    expect(centsToDecimal(Number.NaN)).toBe("0.00");
  });

  it("başlık + ödenecek satırları yazar, eşik altını ATLAR", () => {
    const csv = buildPayoutRunCsv(
      [payRow, { ...payRow, email: "kucuk@ornek.com", payableCents: 7400 }],
      { generatedAt: "2026-10-13T12:00:00.000Z" },
    );
    const lines = csv.trimEnd().split("\n");
    expect(lines).toHaveLength(2); // başlık + 1 satır
    expect(lines[0]).toBe(PAYOUT_CSV_HEADER.join(","));
    expect(lines[1]).toContain("PAY-20261013-AYSE");
    expect(lines[1]).toContain("120.00");
    // IBAN normalleştirilmiş (boşluksuz) yazılır.
    expect(lines[1]).toContain("TR330006100519786457841326");
    expect(csv).not.toContain("kucuk@ornek.com");
  });

  it("ödeme bilgisi eksikse satırı silmez, `eksik_bilgi` sütununda bildirir", () => {
    const csv = buildPayoutRunCsv([{ ...payRow, missing: ["IBAN"] }], {
      generatedAt: "2026-10-13T12:00:00.000Z",
    });
    expect(csv).toContain("IBAN");
    expect(csv.trimEnd().split("\n")).toHaveLength(2);
  });

  it("vergi no girilmemişse CSV'de boş kalır, satır yine yazılır", () => {
    const csv = buildPayoutRunCsv([{ ...payRow, taxId: null }], {
      generatedAt: "2026-10-13T12:00:00.000Z",
    });
    const cells = csv.trimEnd().split("\n")[1]!.split(",");
    // Sütun sırası PAYOUT_CSV_HEADER ile hizalı: `vergi_no` = 7. sütun (index 6).
    expect(PAYOUT_CSV_HEADER[6]).toBe("vergi_no");
    expect(cells[6]).toBe("");
    // Tutar sütunu yerinde kalır (boş sütun satırı kaydırmaz).
    expect(cells[7]).toBe("120.00");
  });

  it("referans deterministiktir ve aynı gün için aynıdır", () => {
    expect(payoutReference("ayse@ornek.com", "2026-10-13T12:00:00.000Z")).toBe("PAY-20261013-AYSE");
    expect(payoutReference(null, "2026-10-13T12:00:00.000Z")).toBe("PAY-20261013-AFFILIATE");
  });

  it("özet: affiliate sayısı, toplam ve eksik bilgili satır sayısı", () => {
    const summary = payoutRunSummary([
      payRow,
      { ...payRow, email: "b@ornek.com", payableCents: 8000, missing: ["IBAN"] },
      { ...payRow, email: "c@ornek.com", payableCents: 100, payableCount: 1 },
    ]);
    expect(summary.affiliates).toBe(2);
    expect(summary.totalCents).toBe(20000);
    expect(summary.blockedCount).toBe(1);
  });
});

describe("shouldNotifyCommission — e-posta kararı", () => {
  it("yeni yazılmış pending komisyon için gönderir", () => {
    expect(
      shouldNotifyCommission({
        result: "ok",
        status: "pending",
        eventType: "transaction.completed",
      }),
    ).toBe(true);
  });

  it("tekrarlanan olay (duplicate) veya ödenmiş/mahsup satır için GÖNDERMEZ", () => {
    expect(shouldNotifyCommission({ result: "duplicate", status: "pending" })).toBe(false);
    expect(shouldNotifyCommission({ result: "ok", status: "reversed" })).toBe(false);
    expect(shouldNotifyCommission({ result: "ok", status: "paid" })).toBe(false);
    expect(shouldNotifyCommission({ result: null, status: "pending" })).toBe(false);
  });

  it("transaction dışı olaylarda göndermez", () => {
    expect(
      shouldNotifyCommission({
        result: "ok",
        status: "pending",
        eventType: "subscription.updated",
      }),
    ).toBe(false);
  });
});
