// ============================================================================
// LANSMAN UYGUNLUĞU — "bu ürün GERÇEKTEN atılabilir mi?" (saf fonksiyon).
//
// NEDEN VAR (ölçülen boşluk, 2026-10-16):
//   Hat ürünleri talep/marj/rekabet kanıtıyla sıralıyordu ama "bunu bugün
//   başlatabilir miyim?" sorusunu YANITLAMIYORDU. Ölçülen üç somut eksik:
//     • MOQ (minimum sipariş) → ilk siparişin SERMAYESİ. Ölçülmüş 1.480 adetlik
//       MOQ, "$18 FOB, %60 marj" kadar önemli bir lansman engelidir.
//     • Rakip yoğunluğu → kohort verisi sunucuda VARDI ama karara girmiyordu.
//     • Fiyat tabanı → $12 altı fiyat zaten puan cezası alıyordu; lansman
//       kararında da açıkça kapı olmalı.
//
// SÖZLEŞME (`winner-criteria.ts` ile aynı dürüstlük kuralı):
//   • Üç durum vardır: `pass`, `fail`, `unknown`. ÖLÇÜLMEMİŞ bir alan ASLA
//     `fail` ya da `pass` DEĞİLDİR — "bilmiyoruz" ile "kötü" farklıdır.
//   • Her sayı ölçümden gelir; eşikler AÇIK POLİTİKADIR (ölçüm değil) ve
//     burada isimli sabitlerdir ki kullanıcı hangi politikayla karar
//     verildiğini görebilsin.
//   • `launchable` yalnız (a) hiç `fail` yok, (b) tedarik+fiyat+marj üçünden
//     en az üçü `pass` iken `true` olur. Tek zayıf kanıtla "atılabilir" demek
//     bu dosyanın var oluş sebebini çürütürdü.
// ============================================================================

import { z } from "zod";

import { measuredMoney } from "./economics-evidence";

/* --------------------------------------------------------------- Politika */

/**
 * Brüt marj tabanı (%, kargo/komisyon ÖNCESİ).
 *
 * POLİTİKA, ÖLÇÜM DEĞİL: brüt marjın yarısına kadarı kargo + pazaryeri komisyonu
 * + reklamla gider. %40'ın altında kalan brüt marj, bu üç kalemin ardından
 * test bütçesi bırakmaz. Ölçülen marj bu eşiğin altındaysa ürün `fail` olur.
 */
export const LAUNCH_MIN_GROSS_MARGIN_PCT = 40;

/** İlk sipariş sermayesi tavanı (USD). POLİTİKA: test bütçesi sınırı. */
export const LAUNCH_MAX_FIRST_ORDER_USD = 1_500;

/**
 * Satış fiyatı tabanı (USD).
 *
 * POLİTİKA: `winner-score.ts` $12 altı fiyata zaten ceza yazıyor; reklam
 * maliyetini karşılaması için lansman kapısı $15 ister.
 */
export const LAUNCH_MIN_PRICE_USD = 15;

/**
 * Aynı kohortta kabul edilen azami benzer rakip satır sayısı.
 *
 * ÖLÇÜMÜN TANIMI (uydurma değil): aynı kısa liste havuzunda bu ürünle AYIRT
 * EDİCİ kelimelerinin çoğunu paylaşan DİĞER aday satırı sayısı. Sayı hat
 * tarafından ölçülür ve ürünle birlikte taşınır.
 */
export const LAUNCH_MAX_COMPETITORS = 12;

/* ------------------------------------------------------------------ Tipler */

export type LaunchGateId = "sourcing" | "firstOrder" | "price" | "margin" | "competition";
export type LaunchGateState = "pass" | "fail" | "unknown";

/**
 * Kararın ZOD ŞEMASI — kanıt katmanlar arasında bu şemayla taşınır.
 *
 * NEDEN ŞEMA (ölçülen hata sınıfı: `supplier-economics.ts` başlığında belgeli):
 * zod tanımadığı alanı DÜŞÜRÜR. Şemada olmayan bir karar, `NormalizedProduct`
 * veya `DiscoveryWinner` katmanından geçerken sessizce kaybolur ve arayüz
 * "lansman kararı hesaplanmadı" sanır.
 */
export const LaunchGateSchema = z.object({
  id: z.enum(["sourcing", "firstOrder", "price", "margin", "competition"]),
  label: z.string(),
  state: z.enum(["pass", "fail", "unknown"]),
  value: z.string(),
  detail: z.string(),
});

export const LaunchReadinessSchema = z.object({
  launchable: z.boolean(),
  gates: z.array(LaunchGateSchema),
  passed: z.number().int().min(0),
  failed: z.number().int().min(0),
  unknown: z.number().int().min(0),
  blockers: z.array(z.string()),
  firstOrderUsd: z.number().nullable(),
  summary: z.string(),
});

export type LaunchGate = z.infer<typeof LaunchGateSchema>;
export type LaunchReadiness = z.infer<typeof LaunchReadinessSchema>;

/** Karar için gereken ölçümler — hepsi üründen gelir, hiçbiri uydurulmaz. */
export type LaunchInput = {
  /** Ölçülen perakende satış fiyatı. */
  priceUsd: number | null;
  /** Ölçülen brüt marj (%), kargo/komisyon öncesi. */
  grossMarginPct: number | null;
  /** Ölçülen toptan (FOB) birim fiyat. */
  supplierPriceUsd: number | null;
  /** FOB bandının üst ucu — varsa sermaye hesabında KONSERVATİF uç budur. */
  supplierPriceHighUsd?: number | null;
  /** Ölçülen minimum sipariş adedi. */
  moqUnits?: number | null;
  /** MOQ birimi ("pieces", "sets"…); yalnız metin içindir. */
  moqUnit?: string;
  /** Aynı kohortta ölçülen benzer rakip satır sayısı. `null` = ölçülmedi. */
  cohortCompetitors?: number | null;
};

const NOT_MEASURED = "—";

const money = (value: number): string =>
  `$${value.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`;

/** Ölçülmüş para alanını okur; geçersizse `null`. */
const usd = (value: number | null | undefined): number | null => measuredMoney(value);

function num(value: number | null | undefined): number | null {
  const n = Number(value);
  return value === null || value === undefined || !Number.isFinite(n) ? null : n;
}

/**
 * Ölçülen tedarik + fiyat verisinden lansman kararını üretir.
 *
 * Kapıların SIRASI kullanıcının soru sırasıdır: tedarik var mı → sermaye
 * yeter mi → fiyat/marj çalışır mı → rekabet bırakıyor mu.
 */
export function assessLaunch(input: LaunchInput): LaunchReadiness {
  const price = num(input.priceUsd);
  const margin = num(input.grossMarginPct);
  const unit = usd(input.supplierPriceUsd);
  const unitHigh = usd(input.supplierPriceHighUsd) ?? unit;
  const moq = num(input.moqUnits);
  const competitors = num(input.cohortCompetitors);

  // Sermaye: MOQ × FOB. Aralıkta ÜST uç kullanılır — alt uç yalnız en yüksek
  // miktar kademesinde geçerlidir ve iyimser bir sermaye rakamı, kullanıcıyı
  // gerçekte karşılayamayacağı bir siparişe yönlendirirdi.
  const firstOrderUsd =
    moq !== null && unitHigh !== null ? Math.round(moq * unitHigh * 100) / 100 : null;

  const gates: LaunchGate[] = [];

  gates.push(
    unit !== null
      ? {
          id: "sourcing",
          label: "Tedarik",
          state: "pass",
          value:
            unitHigh !== null && unitHigh !== unit
              ? `${money(unit)}–${money(unitHigh)}`
              : money(unit),
          detail: "Toptan (FOB) birim fiyat ölçüldü; alış maliyeti biliniyor.",
        }
      : {
          id: "sourcing",
          label: "Tedarik",
          state: "unknown",
          value: NOT_MEASURED,
          detail: "Bu ürüne eşleşen toptan teklif bulunamadı; alış maliyeti ölçülmedi.",
        },
  );

  gates.push(
    firstOrderUsd === null
      ? {
          id: "firstOrder",
          label: "İlk sipariş",
          state: "unknown",
          value: NOT_MEASURED,
          detail:
            moq === null
              ? "MOQ (minimum sipariş adedi) ölçülmedi; ilk sipariş sermayesi hesaplanamaz."
              : "MOQ ölçüldü ama birim fiyat yok; sermaye hesaplanamaz.",
        }
      : firstOrderUsd <= LAUNCH_MAX_FIRST_ORDER_USD
        ? {
            id: "firstOrder",
            label: "İlk sipariş",
            state: "pass",
            value: money(firstOrderUsd),
            detail: `${moq} ${input.moqUnit || "adet"} × ${money(unitHigh ?? 0)} — ölçülen MOQ ile test siparişi bütçeye sığıyor.`,
          }
        : {
            id: "firstOrder",
            label: "İlk sipariş",
            state: "fail",
            value: money(firstOrderUsd),
            detail: `${moq} ${input.moqUnit || "adet"} × ${money(unitHigh ?? 0)} = ${money(firstOrderUsd)}; politika tavanı ${money(LAUNCH_MAX_FIRST_ORDER_USD)}. Tedarikçiden daha küçük MOQ istenmeli.`,
          },
  );

  gates.push(
    price === null
      ? {
          id: "price",
          label: "Satış fiyatı",
          state: "unknown",
          value: NOT_MEASURED,
          detail: "Kaynakta fiyat yoktu; fiyat konumu ve marj sağlığı değerlendirilemez.",
        }
      : price >= LAUNCH_MIN_PRICE_USD
        ? {
            id: "price",
            label: "Satış fiyatı",
            state: "pass",
            value: money(price),
            detail: `Reklam maliyetini karşılayan taban ${money(LAUNCH_MIN_PRICE_USD)} üzerinde.`,
          }
        : {
            id: "price",
            label: "Satış fiyatı",
            state: "fail",
            value: money(price),
            detail: `${money(price)} < ${money(LAUNCH_MIN_PRICE_USD)} tabanı — trafik maliyeti marjı yer.`,
          },
  );

  gates.push(
    margin === null
      ? {
          id: "margin",
          label: "Brüt marj",
          state: "unknown",
          value: NOT_MEASURED,
          detail: "Toptan fiyat ya da satış fiyatı ölçülmediği için marj hesaplanamadı.",
        }
      : margin >= LAUNCH_MIN_GROSS_MARGIN_PCT
        ? {
            id: "margin",
            label: "Brüt marj",
            state: "pass",
            value: `%${Math.round(margin)}`,
            detail: `Kargo/komisyon ÖNCESİ ölçülen brüt marj; taban %${LAUNCH_MIN_GROSS_MARGIN_PCT}.`,
          }
        : {
            id: "margin",
            label: "Brüt marj",
            state: "fail",
            value: `%${Math.round(margin)}`,
            detail: `Kargo/komisyon öncesi %${Math.round(margin)} < %${LAUNCH_MIN_GROSS_MARGIN_PCT} tabanı — kargo ve komisyon sonrası pay kalmaz.`,
          },
  );

  gates.push(
    competitors === null
      ? {
          id: "competition",
          label: "Rakip yoğunluğu",
          state: "unknown",
          value: NOT_MEASURED,
          detail: "Kohort karşılaştırması yapılmadı; benzer aday sayısı ölçülmedi.",
        }
      : competitors <= LAUNCH_MAX_COMPETITORS
        ? {
            id: "competition",
            label: "Rakip yoğunluğu",
            state: "pass",
            value: `${competitors} benzer`,
            detail: `Aynı havuzda ${competitors} benzer aday ölçüldü (tavan ${LAUNCH_MAX_COMPETITORS}).`,
          }
        : {
            id: "competition",
            label: "Rakip yoğunluğu",
            state: "fail",
            value: `${competitors} benzer`,
            detail: `Aynı havuzda ${competitors} benzer aday var (tavan ${LAUNCH_MAX_COMPETITORS}) — aynı teklifi herkes satıyor.`,
          },
  );

  const passed = gates.filter((g) => g.state === "pass").length;
  const failedGates = gates.filter((g) => g.state === "fail");
  const unknown = gates.filter((g) => g.state === "unknown").length;
  const sourcing = gates.find((g) => g.id === "sourcing")!.state === "pass";
  const marginState = gates.find((g) => g.id === "margin")!.state;

  // Karar kuralı (dosya başındaki sözleşme): engel yok + alış maliyeti ve marj
  // ölçülmüş + en az üç kapı geçmiş.
  const launchable = failedGates.length === 0 && sourcing && marginState === "pass" && passed >= 3;

  const blockers = failedGates.map((g) => `${g.label}: ${g.value}`);
  const summary = launchable
    ? `Atılabilir — ${passed}/${gates.length} kapı geçti` +
      (firstOrderUsd !== null ? ` (ilk sipariş ≈ ${money(firstOrderUsd)})` : "") +
      (unknown > 0 ? `; ${unknown} kapı ölçülmedi.` : ".")
    : failedGates.length > 0
      ? `Atılamaz — engel: ${blockers.join(", ")}.`
      : `Kanıt eksik — ${unknown} kapı ölçülmedi (${gates
          .filter((g) => g.state === "unknown")
          .map((g) => g.label.toLowerCase())
          .join(", ")}).`;

  return {
    launchable,
    gates,
    passed,
    failed: failedGates.length,
    unknown,
    blockers,
    firstOrderUsd,
    summary,
  };
}
