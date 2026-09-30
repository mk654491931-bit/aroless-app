// ============================================================================
// DİLİM BÜTÇESİ — 10 SN'LİK İŞLEMLER (birim testleri, ağ yok).
//
// Sözleşme: her QStash teslimatı en fazla BİR dilim kadar çalışır, dilim
// bütçesi makul sınırlara kırpılır, zincir sözü dilimleme yüzünden uzamaz ve
// dilim defteri gecikmiş/erken teslimatları doğru şekilde reddeder.
// ============================================================================
import { describe, expect, it } from "vitest";

import {
  decideSliceClaim,
  DEFAULT_SLICE_MS,
  discoverySliceMs,
  lastStepSlice,
  MAX_SLICE_MS,
  MAX_STEP_SLICES,
  MIN_SLICE_MS,
  readSliceBook,
  readSliceState,
  sliceDeadlineAt,
  sliceDeliveryTimeoutSeconds,
  sliceWorkMs,
  writeSliceState,
} from "./product-discovery-slices.server";

describe("dilim bütçesi", () => {
  it("varsayılan dilim 10 saniyedir (kullanıcının istediği kural)", () => {
    expect(DEFAULT_SLICE_MS).toBe(10_000);
    expect(discoverySliceMs({})).toBe(DEFAULT_SLICE_MS);
  });

  it("işe ayrılan süre dilimden KÜÇÜKTÜR (yanıt + kuyruk payı)", () => {
    // Dilim tam sınırda biterse ara nokta yazımı ve sıradaki yayın platform
    // kesmesinden sonra kalır; zincir tam o halkada kopar.
    const work = sliceWorkMs({});
    expect(work).toBeLessThan(DEFAULT_SLICE_MS);
    expect(work).toBeGreaterThan(DEFAULT_SLICE_MS / 2);
  });

  it("ortam değişkeniyle ayarlanır ama güvenli aralığa KIRPILIR", () => {
    expect(discoverySliceMs({ DISCOVERY_SLICE_MS: "6000" })).toBe(6_000);
    // Çok küçük değer: bir model çağrısı bile sığmaz.
    expect(discoverySliceMs({ DISCOVERY_SLICE_MS: "200" })).toBe(MIN_SLICE_MS);
    // Çok büyük değer: dilimlemenin amacı kaybolur (sunucusuz tavan geri gelir).
    expect(discoverySliceMs({ DISCOVERY_SLICE_MS: "600000" })).toBe(MAX_SLICE_MS);
    expect(discoverySliceMs({ DISCOVERY_SLICE_MS: "abc" })).toBe(DEFAULT_SLICE_MS);
  });

  it("dilim bitişi zincirin mutlak sözünü AŞAMAZ", () => {
    const now = 1_000_000;
    const chainDeadline = now + 4_000;
    expect(sliceDeadlineAt({ now, chainDeadlineAt: chainDeadline, env: {} })).toBe(chainDeadline);
    expect(sliceDeadlineAt({ now, env: {} })).toBe(now + sliceWorkMs({}));
    // Zincir sözü yoksa yalnız dilim sınırı geçerlidir.
    expect(sliceDeadlineAt({ now, chainDeadlineAt: Number.POSITIVE_INFINITY, env: {} })).toBe(
      now + sliceWorkMs({}),
    );
  });

  it("QStash teslimat penceresi dilim başına KISADIR (platformu zorlamayız)", () => {
    // Eskiden her teslimat 298 sn bekliyordu: ölmüş bir fonksiyonun arkasında
    // dakikalarca durmak demekti.
    expect(sliceDeliveryTimeoutSeconds({})).toBeLessThan(60);
    expect(sliceDeliveryTimeoutSeconds({})).toBeGreaterThanOrEqual(
      Math.ceil(DEFAULT_SLICE_MS / 1000),
    );
  });

  it("adım sonsuz dilim üretemez (son dilim adımı bitirir)", () => {
    expect(lastStepSlice(MAX_STEP_SLICES - 1)).toBe(true);
    expect(lastStepSlice(MAX_STEP_SLICES)).toBe(true);
    expect(lastStepSlice(0)).toBe(false);
    expect(lastStepSlice(MAX_STEP_SLICES - 2)).toBe(false);
  });
});

describe("dilim defteri", () => {
  it("boş/bozuk defter 'hiç koşmadı' demektir (ilerleme kaybı, sonsuz döngüden iyidir)", () => {
    expect(readSliceState(undefined, "deep").next).toBe(0);
    expect(readSliceState({ deep: { next: -5 } }, "deep").next).toBe(0);
    expect(readSliceState({ deep: { next: 2.7 } }, "deep").next).toBe(2);
  });

  it("yazma saf kalır ve kısmi durumu korur", () => {
    const first = writeSliceState(undefined, "deep", { next: 1, partial: { done: ["cfo"] } });
    expect(first["deep"]).toEqual({ next: 1, partial: { done: ["cfo"] } });
    const second = writeSliceState(first, "deep", { next: 2 });
    expect(second["deep"]).toEqual({ next: 2, partial: { done: ["cfo"] } });
    // Özgün defter DEĞİŞMEZ (yan etki yok).
    expect(first["deep"]?.next).toBe(1);
  });

  it("ara noktadan okunan defter temizlenir (bozuk adımlar atılır)", () => {
    expect(readSliceBook(undefined)).toBeUndefined();
    expect(readSliceBook([])).toBeUndefined();
    expect(readSliceBook({ deep: { next: 0 } })).toBeDefined();
    const book = readSliceBook({ deep: { next: 3, partial: { a: 1 } }, bozuk: "x" });
    expect(book?.["deep"]).toEqual({ next: 3, partial: { a: 1 } });
    expect(book?.["bozuk"]).toBeUndefined();
  });
});

describe("dilim sahipliği (gecikmiş/erken teslimat)", () => {
  it("ilk dilim her zaman koşabilir (sahipliği CAS belirler)", () => {
    expect(decideSliceClaim(0, 0)).toBe("run");
    expect(decideSliceClaim(5, 0)).toBe("run");
  });

  it("tam sıradaki dilim koşar", () => {
    expect(decideSliceClaim(1, 1)).toBe("run");
    expect(decideSliceClaim(7, 7)).toBe("run");
  });

  it("GEÇ kalmış tekrar teslimat hiçbir şey yapmaz (iş ikiye katlanmaz)", () => {
    expect(decideSliceClaim(3, 2)).toBe("already-done");
    expect(decideSliceClaim(9, 2)).toBe("already-done");
  });

  it("ERKEN gelen teslimat beklemede kalır (sıra bozulmaz)", () => {
    expect(decideSliceClaim(1, 2)).toBe("not-yet");
    expect(decideSliceClaim(0, 4)).toBe("not-yet");
  });
});
