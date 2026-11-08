// ============================================================================
// TEK PARA BİRİMİ SÖZLEŞMESİ (saf; ağ/AI/DB YOK)
//
// NEDEN VAR (ölçülen hata, 2026-11-08):
//   Aynı para metni farklı parserlarda farklı sayı üretiyordu:
//     measuredMoney("₺12.033,41")      → 12033.41
//     parseMoneyNum("₺12.033,41")       → 12.03341
//     deep-dive-complete.num(...)       → 12.033
//   Sonuç: aynı ürünün kartında $12.033,41, $12,03 ve $12,033 görülebiliyordu.
//
// KURAL:
//   • Ayırıcının anlamı KONUMDAN çıkarılır (son ayırıcı ondalık; 3 haneli tek
//     ayırıcı binlik). Ülkeye özel varsayım yapılmaz.
//   • Para birimi metinden okunur; okunamıyorsa `null` döner. Yerel tutarı USD
//     sanmayız.
//   • Sıfır/negatif tutar `parseAmount` için geçersizdir; net kâr gibi işaretli
//     alanlar `parseNumber` kullanır.
// ============================================================================

/** Sembol → ISO kodu. SIRA ÖNEMLİ: `R$` `$`dan, `TL`/`₺` ayrı denenir. */
export const CURRENCY_BY_SYMBOL: Readonly<Record<string, string>> = {
  "R$": "BRL",
  "zł": "PLN",
  CA$: "CAD",
  "C$": "CAD",
  A$: "AUD",
  "S$": "SGD",
  "NT$": "TWD",
  "MX$": "MXN",
  "HK$": "HKD",
  TL: "TRY",
  "₺": "TRY",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
  "円": "JPY",
  "₹": "INR",
  "₩": "KRW",
  $: "USD",
};

const MONEY_SYMBOLS = Object.keys(CURRENCY_BY_SYMBOL);

const ISO_CODES = [
  "USD",
  "TRY",
  "EUR",
  "GBP",
  "JPY",
  "INR",
  "BRL",
  "PLN",
  "KRW",
  "CAD",
  "AUD",
  "MXN",
  "SEK",
  "SGD",
  "AED",
  "SAR",
  "TWD",
  "HKD",
] as const;

/**
 * Sayıyı okur; işaret/ondalık/binlik ayırıcısını KONUMDAN çıkarır.
 * Geçersiz/boş girdi `null` — 0 uydurulmaz.
 */
export function parseNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;

  const cleaned = raw
    .replace(/[\s\u00A0\u202F]/g, "")
    .replace(/[^0-9.,-]/g, "");
  if (!cleaned) return null;

  const negative = cleaned.startsWith("-") || cleaned.includes("-");
  const unsigned = cleaned.replace(/-/g, "");
  if (!unsigned || !/\d/.test(unsigned)) return null;

  const separators = (unsigned.match(/[.,]/g) ?? []).length;
  const lastDot = unsigned.lastIndexOf(".");
  const lastComma = unsigned.lastIndexOf(",");
  let normalized: string;

  if (separators === 0) {
    normalized = unsigned;
  } else if (lastDot >= 0 && lastComma >= 0) {
    // İKİ ayırıcı varsa SONUNCUSU ondalıktır (uluslararası kural).
    normalized =
      lastComma > lastDot
        ? unsigned.replace(/\./g, "").replace(",", ".")
        : unsigned.replace(/,/g, "");
  } else {
    const separator = lastDot >= 0 ? "." : ",";
    const parts = unsigned.split(separator);
    const tail = parts[parts.length - 1] ?? "";
    // Tek ayırıcı + 1-2 hane = ondalık ("27,99"); 3+ hane/çoklu ayırıcı =
    // binlik ("4,180" JPY, "1.299" TR, "12,34,567" INR).
    if (parts.length === 2 && tail.length > 0 && tail.length <= 2) {
      normalized = separator === "." ? unsigned : unsigned.replace(",", ".");
    } else {
      normalized = parts.join("");
    }
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/** Pozitif para tutarı; geçersiz/0/negatif/absürt büyük değer `null`. */
export function parseAmount(raw: unknown): number | null {
  const value = parseNumber(raw);
  if (value === null || value <= 0 || value >= 100_000_000) return null;
  return Math.round(value * 100) / 100;
}

/**
 * Metindeki para birimini okur. Sembol önceliklidir; yoksa ISO kodu aranır.
 * Hiçbiri yoksa `null` — "USD varsayalım" YOK.
 */
export function detectCurrency(text: unknown): string | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const src = text.trim();

  // Semboller: R$ / CA$ gibi çok harfliler tek `$`dan önce gelmeli.
  for (const symbol of MONEY_SYMBOLS) {
    if (symbol === "$" && /R\$|CA\$|C\$|A\$|S\$|NT\$|MX\$|HK\$/.test(src)) continue;
    if (src.includes(symbol)) return CURRENCY_BY_SYMBOL[symbol] ?? null;
  }

  const upper = src.toUpperCase();
  for (const code of ISO_CODES) {
    if (new RegExp(`(^|[^A-Z])${code}([^A-Z]|$)`).test(upper)) return code;
  }
  return null;
}

/**
 * Metinden ÖLÇÜLMÜŞ tutar + para birimi. Sembol sayının önünde/arkasında
 * olabilir; aynı metinde birden çok tutar varsa METİNDEKİ EN ERKEN tutar
 * kazanır (listede güncel fiyat ilk yazılır). Para birimi yoksa `null`.
 */
export function parseMoneyText(text: unknown): { amount: number; currency: string } | null {
  if (typeof text !== "string") return null;
  const src = text;

  let best: { at: number; amount: number; currency: string } | null = null;
  for (const symbol of MONEY_SYMBOLS) {
    const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const after = new RegExp(`${escaped}\\s*([0-9][0-9.,\\u00A0 ]{0,15})`);
    const before = new RegExp(`([0-9][0-9.,\\u00A0 ]{0,15})\\s*${escaped}`);
    const mAfter = after.exec(src);
    const mBefore = before.exec(src);
    const candidates: { match: RegExpExecArray; at: number }[] = [];
    if (mAfter) candidates.push({ match: mAfter, at: mAfter.index });
    if (mBefore) candidates.push({ match: mBefore, at: mBefore.index });
    for (const { match, at } of candidates) {
      const amount = parseAmount(match[1]);
      const currency = CURRENCY_BY_SYMBOL[symbol];
      if (amount === null || !currency) continue;
      if (!best || at < best.at) best = { at, amount, currency };
    }
  }
  if (best) return { amount: best.amount, currency: best.currency };

  // Sembolsüz ama ISO kodlu metin: "12.033,41 TRY", "USD 12.99".
  const currency = detectCurrency(src);
  if (!currency) return null;
  const amount = parseAmount(src);
  return amount === null ? null : { amount, currency };
}

/** Sayısal para alanları için güvenli varsayılan: geçersizse 0. */
export function parseMoneyNumber(value: unknown): number {
  return parseNumber(value) ?? 0;
}
