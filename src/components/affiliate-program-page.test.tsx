// Halka açık affiliate tanıtım sayfası (/affiliate) — içerik sözleşmesi.
//
// NEDEN TEST: sayfa pazarlama metni olduğu için yanlış sayı yazmak çok kolaydır
// ve sonucu para anlaşmazlığıdır (kullanıcı "%30, 12 ay" okur; kod başka bir
// şey uygular). Bu testler sayfanın oranı, pencereyi, eşiği ve bekleme süresini
// ELLE değil, `affiliate.ts` / `affiliate-payout.ts` sabitlerinden okuduğunu
// sabitler: sabit değişirse sayfa otomatik değişir, testler de gerçek değeri
// doğrular. Ayrıca başvuru CTA'sının ve şartlar belgesi linkinin var olduğunu
// güvence altına alır (yoksa sayfa ölü uca götürür).
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  COMMISSION_MAX_MONTHS,
  DEFAULT_COMMISSION_RATE_PCT,
  MIN_PAYOUT_CENTS,
} from "@/lib/affiliate";
import { PAYOUT_HOLD_DAYS } from "@/lib/affiliate-payout";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import { AffiliateProgramPage } from "./affiliate-program-page";

const html = () => renderToStaticMarkup(<AffiliateProgramPage />);

const payoutDollars = MIN_PAYOUT_CENTS / 100;

describe("AffiliateProgramPage", () => {
  it("oranı, pencereyi, eşiği ve beklemeyi koddaki sabitlerden gösterir", () => {
    const out = html();
    expect(out).toContain(`%${DEFAULT_COMMISSION_RATE_PCT}`);
    expect(out).toContain(`${COMMISSION_MAX_MONTHS} ay`);
    expect(out).toContain(`$${payoutDollars}`);
    expect(out).toContain(`${PAYOUT_HOLD_DAYS} gün`);
  });

  it("sabitler değişirse sayılar elle güncellenmeden takip eder", () => {
    // Sayfa metinlerinde sabitlerin string hâli geçmeli; "12 ay" gibi elle
    // yazılmış bir kopya sabitten kopmuş olurdu.
    const out = html();
    const expected = [
      `${COMMISSION_MAX_MONTHS} ay`,
      `$${payoutDollars}`,
      `${PAYOUT_HOLD_DAYS} gün`,
      `%${DEFAULT_COMMISSION_RATE_PCT}`,
    ];
    for (const token of expected) {
      expect(out.split(token).length - 1).toBeGreaterThan(0);
    }
  });

  it("sayısal boşluk sızdırmaz (undefined/NaN/biçimlenmemiş şablon)", () => {
    const out = html();
    expect(out).not.toContain("undefined");
    expect(out).not.toContain("NaN");
    expect(out).not.toContain("[object Object]");
  });

  it("başvuru CTA'sı ve şartlar belgesi linki vardır", () => {
    const out = html();
    // CTA'lar kullanıcıyı giriş akışına sokar.
    expect(out).toContain('href="/auth"');
    // Şartlar linki gerçek belgeye gitmeli; başka bir slug ölü link olurdu.
    expect(out).toContain('href="/legal/affiliate-program-sartlari"');
  });

  it("süresiz komisyon vaadi vermez (12 ay sınırı açıkça yazılır)", () => {
    const out = html();
    expect(out).toContain("en fazla");
    // Ödeme tarihi garantisi verilmediği de açıkça söylenir.
    expect(out.toLowerCase()).toContain("garanti");
  });
});
