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
 * Brüt marj tabanı (%, kargo/komisyon ÖNCESİ) — **%60**.
 *
 * POLİTİKA, ÖLÇÜM DEĞİL ve ARAŞTIRMAYLA SEÇİLDİ: toptan ekonomisinde yaygın
 * ölçüt "iniş maliyetinin 2,5-3 KATI satış fiyatı"dır; 3 kat = %67 brüt marj.
 * %40'lık eski taban yalnız "sıfırın üstünde" diyordu ve reklam + kargo +
 * komisyon sonrası pay bırakmıyordu. Eşik altındaki ölçülmüş ürün `fail` olur.
 */
export const LAUNCH_MIN_GROSS_MARGIN_PCT = 60;

/**
 * SİPARİŞ BAŞINA REKLAM BÜTÇESİ TABANI (USD) — "hesaplanan katkı CAC'ı taşır mı?".
 *
 * ÖLÇÜLMÜŞ BENCHMARK: Meta reklamlarında medyan CPA ≈ **$38,99** (Triple Whale
 * ölçüm örneklemi, Ağu 2025 – Tem 2026). Bu yüzden kural, ölçülen katkının
 * (perakende − toptan) reklam edinme maliyetini KARŞILAMASINI ister:
 * $35 tabanı, $39'luk medyana göre bırakılmış güvenli marjdır.
 *
 * POLİTİKADIR AMA ARİTMETİĞİ ÖLÇÜMDÜR: her iki taraf da ölçülen fiyatlardan
 * gelir; bu sabit yalnız eşiği belirler. Ücretsiz/organik trafikle satış
 * yapılacaksa bu kapı fazla katı olabilir — gerekçesi kart ipucunda yazar.
 */
export const LAUNCH_MIN_AD_BUDGET_USD = 35;

/**
 * MEVZUAT / IP VETO KELİMELERİ — başlık metninde taranır.
 *
 * NEDEN SADECE VETO YÖNÜNDE: bu bir SÖZCÜK TARAMASIDIR, hukuki kontrol değil.
 * Kelime bulunmazsa bu "risk yok" DEMEK DEĞİLDİR, yalnız "bu listede kelime
 * yok" demektir (kapı detayı bunu açıkça söyler). Ama bulunursa ürün lansmana
 * uygun SAYILMAZ: ölçülemez bir hukuki riski "yüksek marj" puanıyla ezmek,
 * kullanıcıyı mağaza kapatma riskine sokardı.
 *
 * KATEGORİLER (araştırmada yüksek riskli sınıflar): mevzuata tabi ürünler
 * (pil/lityum, kozmetik, takviye, ilaç, lazer, medikal), çocuk ürünleri,
 * silah/kesici ve taklit ifadeleri (replica/1:1/dupe).
 */
export const LAUNCH_RISK_PATTERN =
  /(pil\b|battery|lityum|lithium|li-ion|vape|elektronik sigara|kozmetik|cosmetic|serum|krem\b|cream\b|supplement|takviye|vitamin|ilaç|drug\b|lazer|laser|medikal|medical|inhaler|bebek|baby|çocuk oyunca|kids toy|replica|1:1\b|dupe\b|knife|bıçak|tabanca|firearm|ammo|silah\b)/i;

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

export type LaunchGateId =
  "sourcing" | "firstOrder" | "adBudget" | "price" | "margin" | "competition" | "risk";
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
  id: z.enum(["sourcing", "firstOrder", "adBudget", "price", "margin", "competition", "risk"]),
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
  /**
   * Ürün başlığı — mevzuat/IP veto taraması için. Zorunlu değil: başlık
   * verilmezse risk kapısı `unknown` olur (uydurma yok).
   */
  name?: string;
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
  /**
   * TEDARİK KANITININ TÜRÜ — kanıtın GÜCÜNÜ taşıyan alan.
   *
   *  • `"product"` — teklif bu ÜRÜNÜN kendi ayırt edici kelimelerini taşıyor
   *    (birebir/çok yakın eşleşme): alış maliyeti biliniyor.
   *  • `"niche"` — birebir teklif YOK; fiyat AYNI NİŞTEN ölçülen banttan
   *    geliyor. Bu bir PROXY'dir, bu ürünün fiyatı DEĞİLDİR.
   *
   * NEDEN AYRI DURUM (araştırma + ölçüm, 2026-10-16): kaynak araştırması, bir
   * kategori/niş bandının ürünün maliyeti yerine sessizce konmasının hatalı
   * lansman kararı ürettiğini söylüyor ("do not silently substitute its median
   * for the item's cost"); ölçüm de bunu doğruluyor — canlı koşuda 30 adayın
   * 13'ü yalnız niş bandıyla fiyatlanmıştı ve bu adaylar "atılabilir"
   * sayılıyordu. Proxy tedarik, ölçülmüş tedarikle AYNI sayılmaz.
   *
   * Tanımsız (`undefined`) ise `"product"` kabul edilir: bu alan eklenmeden
   * ÖNCE yazılmış kayıtlarda kanıt yalnız birebir eşleşmeyle üretilebiliyordu
   * (`supplierMatchKind()` ile aynı kural).
   */
  supplierMatchKind?: "product" | "niche" | null;
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
  // Proxy YALNIZ ölçülmüş bir band varsa anlamlıdır; band yoksa zaten
  // "tedarik ölçülmedi" durumudur.
  const proxySourcing = input.supplierMatchKind === "niche" && unit !== null;

  // Sermaye: MOQ × FOB. Aralıkta ÜST uç kullanılır — alt uç yalnız en yüksek
  // miktar kademesinde geçerlidir ve iyimser bir sermaye rakamı, kullanıcıyı
  // gerçekte karşılayamayacağı bir siparişe yönlendirirdi.
  const firstOrderUsd =
    moq !== null && unitHigh !== null ? Math.round(moq * unitHigh * 100) / 100 : null;

  /**
   * MOQ ve FOB aralığı NİŞ BANDINDAN geldiyse bunu İLK SİPARİŞ kapısında
   * açıkça söyler (MOQ teklife özel bir alandır; proxy'de ürüne ait değildir).
   */
  const proxyNote = proxySourcing
    ? " Not: MOQ ve fiyat aynı nişteki bir tedarikçiden ölçüldü — bu ürünün kendi teklifi değil."
    : "";

  const gates: LaunchGate[] = [];

  gates.push(
    unit === null
      ? {
          id: "sourcing",
          label: "Tedarik",
          state: "unknown",
          value: NOT_MEASURED,
          detail: "Bu ürüne eşleşen toptan teklif bulunamadı; alış maliyeti ölçülmedi.",
        }
      : proxySourcing
        ? {
            // NİŞ BANDI = PROXY. Ölçüm var ama ÜRÜNE ait değil; bu yüzden
            // `pass` DEĞİL `unknown`dur ve `launchable` olamaz.
            id: "sourcing",
            label: "Tedarik",
            state: "unknown",
            value: `${money(unit)} çevresi (niş bandı)`,
            detail:
              "Bu ürüne ait toptan teklif bulunamadı. Gösterilen fiyat AYNI NİŞTEN ölçülen banttır (proxy) ve bu ürünün maliyeti DEĞİLDİR. ",
          }
        : {
            id: "sourcing",
            label: "Tedarik",
            state: "pass",
            value:
              unitHigh !== null && unitHigh !== unit
                ? `${money(unit)}–${money(unitHigh)}`
                : money(unit),
            detail: "Toptan (FOB) birim fiyat ölçüldü; alış maliyeti biliniyor.",
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
            detail:
              `${moq} ${input.moqUnit || "adet"} × ${money(unitHigh ?? 0)} — ölçülen MOQ ile test siparişi bütçeye sığıyor.` +
              proxyNote,
          }
        : {
            id: "firstOrder",
            label: "İlk sipariş",
            state: "fail",
            value: money(firstOrderUsd),
            detail:
              `${moq} ${input.moqUnit || "adet"} × ${money(unitHigh ?? 0)} = ${money(firstOrderUsd)}; politika tavanı ${money(LAUNCH_MAX_FIRST_ORDER_USD)}. Tedarikçiden daha küçük MOQ istenmeli.` +
              proxyNote,
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

  // 6) REKLAM BÜTÇESİ KAPISI — "hesaplanan katkı reklam edinme maliyetini
  //    karşılıyor mu?". Katkı = perakende − toptan (aralıkta KONSERVATİF üst
  //    uç). İki ölçüm de yoksa kapı `unknown`dur.
  const contribution = price !== null && unitHigh !== null ? price - unitHigh : null;
  gates.push(
    contribution === null
      ? {
          id: "adBudget",
          label: "Reklam bütçesi",
          state: "unknown",
          value: NOT_MEASURED,
          detail:
            "Katkı (perakende − toptan) hesaplanamadı: iki ölçümden biri yok. Ücretsiz trafikle de satılabilir.",
        }
      : contribution >= LAUNCH_MIN_AD_BUDGET_USD
        ? {
            id: "adBudget",
            label: "Reklam bütçesi",
            state: "pass",
            value: money(Math.round(contribution * 100) / 100),
            detail: `Sipariş başına katkı ${money(Math.round(contribution * 100) / 100)} ≥ ${money(LAUNCH_MIN_AD_BUDGET_USD)} tabanı (Meta medyan CPA ≈ $38,99) — ücretli trafik kaldırılabilir.`,
          }
        : {
            id: "adBudget",
            label: "Reklam bütçesi",
            state: "fail",
            value: money(Math.round(contribution * 100) / 100),
            detail: `Sipariş başına katkı ${money(Math.round(contribution * 100) / 100)} < ${money(LAUNCH_MIN_AD_BUDGET_USD)}: ücretli trafikle edinme maliyetini karşılamaz (barındırma/organik trafik istisnası olabilir).`,
          },
  );

  // 7) MEVZUAT/IP VETOSU — ölçülen BAŞLIK metninde kelime taraması.
  //    Veto yönündedir: kelime bulunursa lansmana uygun SAYILMAZ. Kelime
  //    bulunmaması hukuki temizlik DEMEK DEĞİLDİR (detay bunu söyler).
  const name = String(input.name ?? "").trim();
  gates.push(
    name === ""
      ? {
          id: "risk",
          label: "Mevzuat/IP",
          state: "unknown",
          value: NOT_MEASURED,
          detail: "Ürün adı verilmediği için risk taraması yapılamadı.",
        }
      : LAUNCH_RISK_PATTERN.test(name)
        ? {
            id: "risk",
            label: "Mevzuat/IP",
            state: "fail",
            value: name.match(LAUNCH_RISK_PATTERN)?.[0] ?? "risk",
            detail:
              "Ürün adı mevzuata tabi/taklit riskli bir kategoriye düşüyor (pil, kozmetik, takviye, çocuk, lazer, kesici, replica…). Onay/ruhsat veya tedarikçi dokümanı olmadan lansmana uygun değil.",
          }
        : {
            id: "risk",
            label: "Mevzuat/IP",
            state: "pass",
            value: "kelime yok",
            detail:
              "Yasaklı kategori sözlüğünde kelime bulunmadı — bu bir SÖZCÜK TARAMASIDIR, hukuki temizlik garantisi değil.",
          },
  );

  const passed = gates.filter((g) => g.state === "pass").length;
  const failedGates = gates.filter((g) => g.state === "fail");
  const unknown = gates.filter((g) => g.state === "unknown").length;
  const stateOf = (id: LaunchGateId): LaunchGateState =>
    gates.find((gate) => gate.id === id)!.state;

  // Karar kuralı: engel yok + DÖRT ÇEKİRDEK kapı ölçülmüş ve geçmiş
  // (tedarik · fiyat · marj · reklam bütçesi). Ölçülmemiş tek şey ilk sipariş
  // sermayesi, rekabet veya risk taraması olabilir; bunlar "bilinmiyor" kalır
  // ve engel SAYILMAZ ama kararın geçmesini de SAĞLAMAZ.
  //
  // NİŞ PROXY'Sİ GEÇMEZ: `tedarik` kapısı niş bandında `unknown` olduğu için
  // proxy ile fiyatlanan aday yukarıdaki kuralın dışında kalır ve
  // "atılabilir" SAYILMAZ (araştırma: go/no-go kararı ürünün KENDİ maliyetini
  // ister; kategori medyanı onun yerine konmaz).
  const launchable =
    failedGates.length === 0 &&
    stateOf("sourcing") === "pass" &&
    stateOf("price") === "pass" &&
    stateOf("margin") === "pass" &&
    stateOf("adBudget") === "pass";

  const blockers = failedGates.map((g) => `${g.label}: ${g.value}`);
  const summary = launchable
    ? `Atılabilir — ${passed}/${gates.length} kapı geçti` +
      (firstOrderUsd !== null ? ` (ilk sipariş ≈ ${money(firstOrderUsd)})` : "") +
      (unknown > 0 ? `; ${unknown} kapı ölçülmedi.` : ".")
    : failedGates.length > 0
      ? `Atılamaz — engel: ${blockers.join(", ")}.`
      : proxySourcing
        ? `Kanıt eksik — tedarik yalnız NİŞ BANDIYLA ölçüldü (proxy; bu ürünün kendi toptan fiyatı yok) ve ${unknown} kapı ölçülmedi (${gates
            .filter((g) => g.state === "unknown")
            .map((g) => g.label.toLowerCase())
            .join(", ")}).`
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
