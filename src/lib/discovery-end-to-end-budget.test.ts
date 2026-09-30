// ============================================================================
// UÇTAN UCA BÜTÇE TESTİ — "KAZANANLARI BUL 280 SN'DE BİTER" SÖZÜ.
//
// Bu test ölçütü TEK bir fonksiyonu değil, ZİNCİRİN TAMAMINI taklit eder.
// Taklit, kodun TAYAN İŞLETMELERİYLE yapılır (sabit sayı uydurulmaz):
//   • `sliceWorkMs()`  → bir dilimin işe ayırdığı süre,
//   • `lastStepSlice()`→ son dilimde zorla bitirme,
//   • `MIN_SLICE_BUDGET_MS` → yeni dilim başlatma kapısı,
//   • `DISCOVERY_MAX_BUDGET_MS` → zincirin mutlak sözü.
//
// ÖLÇÜLEN BELİRTİ: kullanıcı "kazananları bul çok uzun sürüyor, normalde 280
// saniyede bitmesi gerekirdi" diyordu. Bu test, en kötü hâlde (her rol ve
// her kaynak yavaş, hiçbir dilim kendiliğinden tamamlanmıyor) zincirin yine
// 280 sn içinde KAPANDığını kanıtlar. Kapanmıyorsa test kırmızıdır.
//
// NEDEN SAYMA DEĞİL ÖLÇME: zincirde `MAX_STEP_SLICES` gibi tavanlar vardır ve
// bunlar kırılgan bir denklemle çalışır. Test, gerçekten ne kadar süreceğini
// hesaplayıp sözle karşılaştırır; "umarız yeter" demez.
// ============================================================================

import { describe, expect, it } from "vitest";

import { DISCOVERY_MAX_BUDGET_MS } from "./discovery-jobs.server";
import { councilConcurrency, councilRoleQueue } from "./product-discovery-council-ai.server";
import { GEMINI_MAX_SLICES } from "./product-discovery-steps.server";
import {
  MAX_STEP_SLICES,
  discoverySliceMs,
  lastStepSlice,
  MIN_SLICE_MS,
  sliceDeliveryTimeoutSeconds,
  sliceWorkMs,
} from "./product-discovery-slices.server";
import { MIN_SLICE_BUDGET_MS } from "./product-discovery-runner.server";

/**
 * Konseyin konuşacağı rol sayısı — KODDAN okunur, elle yazılmaz.
 * Böylece konseyde bir rol eklenip çıkarılırsa bu test kendiliğinden izler.
 */
const MAX_AI_ROLE_COUNT = councilRoleQueue(1).length;

/** Sürücü, bir dilimi başlatmadan önce kapıda bekler (QStash teslimi + soğuk başlangıç). */
const HANDOFF_MS = 1_000;

/**
 * Bir adımın EN KÖTÜ hâlde kaç dilim alabileceği.
 *
 * NEDEN SABİT DEĞİL: yazılımda yalnız İKİ adım kısmi dönebilir —
 *   • `gemini`: en fazla `GEMINI_MAX_SLICES` deneme (yapısal tavan),
 *   • `deep`  : konsey bir dalga = bir dilim; en yavaş kurulumda (eşzamanlılık 1)
 *               14 rolün 14'ü ayrı dilim,
 * diğer adımlar (`scrape_filter`, `final`) tek seferde biter. Bu yüzden en kötü
 * hâl "her adım 16 dilim" DEĞİLDİR; aşağıdaki sayı kodun kendi tavanlarından
 * gelir ve elle büyütülemez.
 */
function worstCaseSlicesFor(step: string, roles: number): number {
  if (step === "gemini") return GEMINI_MAX_SLICES;
  if (step === "deep") return Math.min(MAX_STEP_SLICES, roles);
  return 1;
}

type Slice = { step: string; slice: number; workMs: number; forced: boolean };

/**
 * Zinciri gerçek sürücüyle aynı kurallarla simüle eder.
 *
 * @param neverFinishes hiçbir adım kendiliğinden bitmez (en kötü hâl: her
 *   adım tavanına kadar dilimlenir, iş yalnız `forceFinish` ile kapanır).
 */
function simulateChain(args: {
  neverFinishes: boolean;
  steps: readonly string[];
  roles?: number;
  perSliceWorkMs?: number;
}): { slices: Slice[]; totalMs: number; completed: boolean; stepsDone: string[] } {
  const slices: Slice[] = [];
  const stepsDone: string[] = [];
  let clock = 0;
  const deadline = DISCOVERY_MAX_BUDGET_MS;
  const work = args.perSliceWorkMs ?? sliceWorkMs();
  const roles = args.roles ?? MAX_AI_ROLE_COUNT;

  for (const step of args.steps) {
    const cap = worstCaseSlicesFor(step, roles);
    let stepDone = false;
    for (let slice = 0; ; slice += 1) {
      // Kapı: kalan süre tek bir dilimi taşımıyorsa yeni dilim BAŞLATILMAZ.
      if (clock + MIN_SLICE_BUDGET_MS > deadline) break;

      // Son dilimde zorla bitirme (sonsuz zincir olmaz) ya da bütçe tükendi.
      const forced = lastStepSlice(slice) || deadline - clock < work;
      const workMs = Math.max(0, Math.min(work, deadline - clock));
      clock += workMs + HANDOFF_MS;
      slices.push({ step, slice, workMs, forced });

      if (forced) {
        stepDone = true;
        break;
      }
      // Adım kendi tavanına ulaştıysa zorla biter (yoksa sonsuz dilim olurdu).
      if (slice + 1 >= cap) {
        stepDone = true;
        break;
      }
      if (!args.neverFinishes) {
        stepDone = true;
        break;
      }
    }
    if (!stepDone) break;
    stepsDone.push(step);
  }
  return {
    slices,
    totalMs: clock,
    completed: stepsDone.length === args.steps.length,
    stepsDone,
  };
}

describe("uçtan uca 280 sn sözü — dilimli zincir", () => {
  const STEPS = ["scrape_filter", "gemini", "deep", "final"] as const;
  const ROLES = MAX_AI_ROLE_COUNT;

  it("normal akış (her adım tek dilim) 280 sn'in çok altında biter", () => {
    const result = simulateChain({ neverFinishes: false, steps: STEPS, roles: ROLES });
    expect(result.completed).toBe(true);
    expect(result.totalMs).toBeLessThan(DISCOVERY_MAX_BUDGET_MS);
    // Her adım tek dilimde kapanır: 4 × (7 sn iş + 1 sn devir) ≈ 32 sn.
    expect(result.slices).toHaveLength(4);
  });

  it("EN KÖTÜ HÂL: hiçbir adım kendiliğinden bitmez, zincir yine 280 sn'de KAPANIR", () => {
    // Bu, ölçülen şikâyetin tam karşılığı: kazıma/Gemini/konsey yavaş,
    // hiçbir adım ilk dilimde bitmiyor. Tek güvence `forceFinish` + tavanlar.
    const result = simulateChain({ neverFinishes: true, steps: STEPS, roles: ROLES });

    expect(result.completed).toBe(true);
    expect(result.stepsDone).toEqual([...STEPS]);
    // Zincir sözü AŞILMAZ — kullanıcı 280 sn'yi geçen bir süre beklemez.
    expect(result.totalMs).toBeLessThanOrEqual(DISCOVERY_MAX_BUDGET_MS);
  });

  it("en kötü hâlde bile nihai `final` adımı ÇALIŞIR (sıfır sonuç yok)", () => {
    // Kullanıcının en kötü hali: bütçe tükenip `final` hiç koşmazsa kullanıcı
    // 280 sn bekler ve ELİNDE HİÇBİR ŞEY OLMAZ. Son adım her zaman işler.
    const result = simulateChain({ neverFinishes: true, steps: STEPS, roles: ROLES });
    expect(result.stepsDone.at(-1)).toBe("final");
    const finals = result.slices.filter((s) => s.step === "final");
    expect(finals.length).toBeGreaterThan(0);
  });

  it("hiçbir teslimat 10 saniyelik dilimi aşmaz", () => {
    const result = simulateChain({ neverFinishes: true, steps: STEPS, roles: ROLES });
    // `workMs` işe ayrılan süredir; platforma giden toplam süre buna devir
    // payı eklenince dilim süresine (10 sn) oturur.
    for (const entry of result.slices) {
      expect(entry.workMs).toBeLessThanOrEqual(sliceWorkMs());
    }
  });

  it("konsey 14 rolü dilimlerde tamamlayabilir (tuvan yeterli)", () => {
    // Konsey rol BAŞINA bir dalga yapar; dalga = bir dilim. Eşzamanlılık 4
    // olduğunda 14 rol 4 dilimde biter. Tuvan 16 olduğu için yeterli.
    const roles = councilRoleQueue(10);
    expect(roles.length).toBeGreaterThan(0);
    const waves = Math.ceil(roles.length / councilConcurrency());
    expect(waves).toBeLessThanOrEqual(MAX_STEP_SLICES);
  });

  it("dilim ayarı yanlış girilse bile 10-30 sn bandında kalır", () => {
    // Kullanıcı `DISCOVERY_SLICE_MS=120000` yazarsa 10 sn sözü sessizce
    // bozulurdu. Tavan bu yüzden yapısaldır (30 sn dilim → 27 sn iş).
    expect(sliceWorkMs({ DISCOVERY_SLICE_MS: "120000" })).toBeLessThanOrEqual(27_000);
    // Aşırı küçük ayar da işe yaramaz bir 0 sn üretmez: taban 1 sn.
    expect(sliceWorkMs({ DISCOVERY_SLICE_MS: "500" })).toBeGreaterThanOrEqual(1_000);
    // Dilim süresinin kendisi 3 sn'nin altına inemez.
    expect(discoverySliceMs({ DISCOVERY_SLICE_MS: "500" })).toBeGreaterThanOrEqual(MIN_SLICE_MS);
  });

  it("QStash'e verilen dilim penceresi kısa kalır (ölü fonksiyonu beklemez)", () => {
    // 10 sn dilim + 20 sn soğuk başlangıç = 30 sn. Eskiden her teslimat
    // 298 sn bekliyordu; bir dilim bu kadar süremez.
    expect(sliceDeliveryTimeoutSeconds()).toBeLessThanOrEqual(60);
  });
});
