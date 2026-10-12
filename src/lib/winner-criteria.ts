// ============================================================================
// KAZANAN KRİTERİ VEKTÖRÜ + SAYI DENETİMİ (saf fonksiyonlar; ağ/AI/DB YOK)
//
// NEDEN VAR: üründe TEK bir `winner_score` var ve kullanıcı "neden bu kazanan?"
// sorusunun cevabını göremiyor. Skor, ölçülmüş ve ölçülmemiş alanları aynı
// sayıda eritiyor; oysa kararın denetlenebilir olması için hangi KRİTERİN
// gerçekten ölçüldüğü ayrı ayrı görünmelidir.
//
// ÖLÇÜLEN HATA SINIFI (2026-10-03, `economics-evidence.ts` dosyasında belgeli):
// boş ölçüm dolu sayı gibi gösterildiğinde ("0% marj", "$0 maliyet") karar
// saçmalıyordu. Burada tersi yapılır: ölçülmeyen kriter `unmeasured` işaretlenir
// ve arayüz "—" gösterir; 0 UYDURULMAZ.
//
// "REKABET" KRİTERİ NEDEN YOK: kart düzeyinde rakip sayısı ÖLÇÜLMÜYOR (kohort
// verisi kısa listede taşınmıyor). Ölçülmeyen bir kriteri vektöre koymak,
// kullanıcıya "rekabeti analiz ettik" demek olurdu — bu dosyanın kuralı bunu
// yasaklar. Rekabet yerine ölçülen `rating` kriteri vardır.
// ============================================================================

export type CriterionId = "price" | "demand" | "rating" | "margin" | "supply" | "image";

export type Criterion = {
  id: CriterionId;
  /** Kullanıcıya görünen kısa etiket. */
  label: string;
  status: "measured" | "unmeasured";
  /** Ölçülmüş değerin okunabilir hâli ("144 adet satıldı"); ölçülmediyse "—". */
  value: string;
  /** Bu kriter neden bu durumda (gerekçe). */
  detail: string;
  /** Kanıt kaynağı — ölçülmüşse dolu. */
  evidence: { source: string; url: string } | null;
};

export type CriteriaVerdict = "kanitli" | "kismi" | "zayif";

export type CriteriaReport = {
  criteria: Criterion[];
  measured: number;
  total: number;
  /** Ölçülmeyen kriter oranı (0-1) — kabul kriteri: <%20 hedefi. */
  unmeasuredRate: number;
  verdict: CriteriaVerdict;
  /** Kararın tek cümlelik, ÖLÇÜME dayalı özeti. */
  summary: string;
};

export type WinnerCriteriaInput = {
  name: string;
  priceUsd: number | null;
  rating: number | null;
  ratingCount: number | null;
  salesVolume: number | null;
  viewed90d: number | null;
  imageUrl: string;
  sourceUrl: string;
  sources: readonly string[];
  /** Ölçülmüş marj (brüt ya da net) — `null` ise ölçülmedi. */
  marginPct: number | null;
  /** Ölçülmüş tedarik (toptan) fiyatı — `null` ise ölçülmedi. */
  supplierPriceUsd: number | null;
};

const NOT_MEASURED = "—";

function num(v: number | null | undefined): number | null {
  const n = Number(v);
  return v !== null && v !== undefined && Number.isFinite(n) ? n : null;
}

function fmt(n: number): string {
  return n.toLocaleString("tr-TR");
}

/**
 * Ürünü 6 ölçülmüş kriter üzerinden değerlendirir.
 *
 * DÖNEN `verdict`, "kazanan" iddiasının DENETLENEBİLİRLİĞİDİR:
 *   kanitli → 5-6 kriter ölçüldü · kismi → 3-4 · zayif → 0-2
 * Yani skor yüksek olsa bile kanıt zayıfsa arayüz bunu söyler.
 */
export function winnerCriteria(input: WinnerCriteriaInput): CriteriaReport {
  const source = input.sources[0] ?? "bilinmiyor";
  const price = num(input.priceUsd);
  const rating = num(input.rating);
  const ratingCount = num(input.ratingCount);
  const sold = num(input.salesVolume);
  const viewed = num(input.viewed90d);
  const margin = num(input.marginPct);
  const supplier = num(input.supplierPriceUsd);

  const criteria: Criterion[] = [];

  criteria.push(
    price !== null && price > 0
      ? {
          id: "price",
          label: "Satış fiyatı",
          status: "measured",
          value: `$${price}`,
          detail: "Kaynak sayfasından okundu.",
          evidence: { source, url: input.sourceUrl },
        }
      : {
          id: "price",
          label: "Satış fiyatı",
          status: "unmeasured",
          value: NOT_MEASURED,
          detail: "Kaynakta fiyat yoktu; marj ve fiyat konumu hesaplanamaz.",
          evidence: null,
        },
  );

  const demandValue =
    sold !== null && sold > 0
      ? `${fmt(sold)} adet satıldı`
      : ratingCount !== null && ratingCount > 0
        ? `${fmt(ratingCount)} değerlendirme`
        : viewed !== null && viewed > 0
          ? `${fmt(viewed)} görüntülenme`
          : null;
  criteria.push(
    demandValue
      ? {
          id: "demand",
          label: "Talep kanıtı",
          status: "measured",
          value: demandValue,
          detail: "Gerçek satış/değerlendirme/görüntülenme sayısı ölçüldü.",
          evidence: { source, url: input.sourceUrl },
        }
      : {
          id: "demand",
          label: "Talep kanıtı",
          status: "unmeasured",
          value: NOT_MEASURED,
          detail: "Satış, değerlendirme veya görüntülenme sayısı ölçülmedi.",
          evidence: null,
        },
  );

  criteria.push(
    rating !== null && rating > 0
      ? {
          id: "rating",
          label: "Puan",
          status: "measured",
          value: `${rating}/5`,
          detail: ratingCount !== null && ratingCount > 0 ? "Puan + değerlendirme sayısı birlikte." : "Puan okundu, değerlendirme sayısı listede yok.",
          evidence: { source, url: input.sourceUrl },
        }
      : {
          id: "rating",
          label: "Puan",
          status: "unmeasured",
          value: NOT_MEASURED,
          detail: "Liste sayfası sayısal puan vermedi (uydurulmaz).",
          evidence: null,
        },
  );

  criteria.push(
    margin !== null && margin > 0
      ? {
          id: "margin",
          label: "Marj",
          status: "measured",
          value: `%${Math.round(margin)}`,
          detail: "Satış fiyatı ile ölçülen toptan fiyatın aritmetiği (brüt).",
          evidence: { source, url: input.sourceUrl },
        }
      : {
          id: "margin",
          label: "Marj",
          status: "unmeasured",
          value: NOT_MEASURED,
          detail: "Toptan fiyat ölçülmediği için marj hesaplanamadı.",
          evidence: null,
        },
  );

  criteria.push(
    supplier !== null && supplier > 0
      ? {
          id: "supply",
          label: "Tedarik",
          status: "measured",
          value: `$${supplier}`,
          detail: "Toptan teklif eşleşti; birim maliyet biliniyor.",
          evidence: { source, url: input.sourceUrl },
        }
      : {
          id: "supply",
          label: "Tedarik",
          status: "unmeasured",
          value: NOT_MEASURED,
          detail: "Eşleşen toptan teklif yok; tedarik kanıtı yok.",
          evidence: null,
        },
  );

  // Görsel kriteri: ÖLÇÜLMÜŞ bir fotoğraf adresi var mı? (Yer tutucu/logo
  // üretilmediği için "adres var" demek "gerçek fotoğraf geldi" demektir.)
  const image = input.imageUrl.trim() !== "";
  criteria.push(
    image
      ? {
          id: "image",
          label: "Görsel",
          status: "measured",
          value: "doğrulandı",
          detail: "Ürünün kendi sayfasından/kaynağından gelen gerçek fotoğraf.",
          evidence: { source, url: input.imageUrl },
        }
      : {
          id: "image",
          label: "Görsel",
          status: "unmeasured",
          value: NOT_MEASURED,
          detail: "Doğrulanmış ürün fotoğrafı yok; yer tutucu gösterilmez.",
          evidence: null,
        },
  );

  const measured = criteria.filter((c) => c.status === "measured").length;
  const total = criteria.length;
  const unmeasuredRate = (total - measured) / total;
  const verdict: CriteriaVerdict = measured >= 5 ? "kanitli" : measured >= 3 ? "kismi" : "zayif";
  const missing = criteria.filter((c) => c.status === "unmeasured").map((c) => c.label);
  const summary =
    verdict === "kanitli"
      ? `${measured}/${total} kriter ölçüldü — karar denetlenebilir.`
      : `${measured}/${total} kriter ölçüldü; eksik: ${missing.join(", ")}.`;

  return { criteria, measured, total, unmeasuredRate, verdict, summary };
}

/**
 * SAYI DENETİMİ — metindeki her sayı ölçülmüş bir kanıta dayanmalı.
 *
 * NEDEN: kullanıcıya gösterilen bir cümle "%42 marj" diyorsa, o %42'nin
 * kaynağında ÖLÇÜLMÜŞ bir marj olmalı. Aksi hâlde cümle, uydurulmuş bir sayıyla
 * karar veriyormuş izlenimi yaratır. Kural (test edilebilir): bir cümledeki
 * TÜM sayılar izinli listeye (ölçülmüş değerler + küçük tolerans) uymalı;
 * uymayan cümle DÜŞÜRÜLÜR ve gerekçesiyle birlikte döner.
 */
/** Metrik adları — sayının ÖNÜNDE gelirse o sayı bir iddiadır. */
const METRIC_BEFORE = /(marj|k[âa]r|kazan[çc]|fiyat|maliyet|ciro|gelir|roas|skor|puan|toptan|stok|indirim|komisyon)/i;
/** Ölçü birimleri — sayının ARKASINDA gelirse o sayı bir iddiadır. */
const UNIT_AFTER = /^\s*(%|adet|sold|sat[ıi][şs]|sipari[şs]|değerlendirme|puan|görüntülenme|dolar|usd|tl|₺|k[âa]r)/i;

/**
 * Bir sayı SAYI İDDİASI mı, yoksa zaman/ölçü ifadesi mi?
 *
 * ÖLÇÜLEN AYRIŞTIRMA HATASI (bu fonksiyonun ilk sürümü): "son 90 günde 144 adet"
 * cümlesinde `90` da iddia sanılıyordu, çünkü pencere komşu sayının birimini
 * (") görüyordu. Sonuç: kanıtlı cümle düşürülüyordu. Kural artık yönlü:
 * metrik adı sayının ÖNÜNDE, ölçü birimi ARKASINDA olmalı; yüzde işareti
 * her koşulda iddiadır.
 */
function isNumericClaim(
  sentence: string,
  index: number,
  matchText: string,
  suffix: string,
): boolean {
  if (suffix.trim() === "%") return true;
  const before = sentence.slice(Math.max(0, index - 16), index);
  if (METRIC_BEFORE.test(before)) return true;
  const after = sentence.slice(index + matchText.length, index + matchText.length + 14);
  return UNIT_AFTER.test(after);
}

export function auditNumericClaims(
  text: string,
  allowedValues: readonly number[],
): { kept: string; dropped: string[] } {
  const allowed = allowedValues.filter((n) => Number.isFinite(n));
  const sentences = String(text ?? "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const sentence of sentences) {
    const claims: number[] = [];
    for (const m of sentence.matchAll(/(\d+(?:[.,]\d+)?)\s*(%?)/g)) {
      const index = m.index ?? 0;
      if (!isNumericClaim(sentence, index, m[0], m[2] ?? "")) continue;
      const value = Number(m[1].replace(",", "."));
      if (Number.isFinite(value)) claims.push(value);
    }
    const ok = claims.every((n) => allowed.some((a) => Math.abs(a - n) <= Math.max(0.5, a * 0.02)));
    if (ok) kept.push(sentence);
    else dropped.push(sentence);
  }
  return { kept: kept.join(" "), dropped };
}

/** Ekranda gösterilecek kriter listesinden yalnız ölçülenleri süzer. */
export function measuredCriteria(report: CriteriaReport): Criterion[] {
  return report.criteria.filter((c) => c.status === "measured");
}
