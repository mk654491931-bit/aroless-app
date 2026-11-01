// ============================================================================
// ÖLÇÜLMÜŞ KAZANANLAR — İSTEĞE BAĞLI AI SIRALAMASI.
//
// Ürün bulucunun DB'siz yolu (`findMeasuredWinners`) gerçek kaynak satırlarını
// döndürür ama sıralamayı deterministik ön skorla yapar. Kullanıcı tüm ücretsiz
// API'lerin ürün bulmada da kullanılmasını istedi: bu modül, aynı GERÇEK
// satırlar arasından modelin seçim yapmasını sağlar.
//
// SINIRLAR (uydurma yasağı):
//   • Modele yalnız kazınmış satırlar verilir; serbest metin üretmesi istenmez.
//   • Model yalnız `index` + kısa gerekçe döner. Başlık/fiyat modelden ALINMAZ.
//   • Geçersiz indeks, tekrar veya liste dışı seçim atılır.
//   • Model çökerse `null` döner; çağıran deterministik sıralamada kalır.
// ============================================================================

import { callAiMesh, extractJson } from "./ai.server";
import { anyAiKeyConfigured } from "./ai-keys.server";
import type { NormalizedProduct } from "./product-discovery.types";
import type { MeasuredRerank } from "./measured-winners";

/** İsteme girecek en fazla aday — ücretsiz modellerin bağlamını şişirmemek için. */
const MAX_CANDIDATES = 30;

function candidateKey(p: NormalizedProduct): string {
  return p.fingerprint || p.name.toLocaleLowerCase("tr-TR");
}

function compactLine(p: NormalizedProduct, index: number): string {
  const price = p.priceUsd === null ? "fiyat yok" : `$${p.priceUsd.toFixed(2)}`;
  const rating =
    p.rating === null
      ? "puan yok"
      : `${p.rating.toFixed(1)}★${p.ratingCount !== null ? ` (${p.ratingCount})` : ""}`;
  const sales = p.salesVolume === null ? "satış yok" : `satış ${p.salesVolume}`;
  const views = p.viewed90d === null ? "görüntülenme yok" : `görüntülenme ${p.viewed90d}`;
  const sources = p.sources.length ? `${p.sources.length} kaynak` : "tek kaynak";
  return (
    `${index}. ${p.name.slice(0, 90)} | ${price} | ${rating} | ${sales} | ` +
    `${views} | ${sources} | ön skor ${Math.round(p.preScore)}`
  );
}

/**
 * Gerçek satırlar arasından ticari potansiyeli yüksek olanları seçer.
 *
 * @param deadlineAt Bu çağrının mutlak bitiş anı (epoch ms). Ürün bulucu
 *   zincirinin geri kalanına yer bırakmak için kısa tutulur.
 */
export async function rerankMeasuredWithAi(
  products: readonly NormalizedProduct[],
  niche: string,
  topN: number,
  deadlineAt: number,
): Promise<MeasuredRerank | null> {
  if (!anyAiKeyConfigured() || products.length === 0) return null;

  const candidates = [...products]
    .filter((p) => p.name.trim().length >= 3)
    .sort(
      (a, b) =>
        b.preScore - a.preScore ||
        b.dataCompleteness - a.dataCompleteness ||
        b.sources.length - a.sources.length,
    )
    .slice(0, MAX_CANDIDATES);
  if (candidates.length === 0) return null;

  const roster = candidates.map(compactLine).join("\n");
  const prompt = [
    "Sen deneyimli bir e-ticaret ürün alıcısısın. Aşağıdaki GERÇEK kaynak satırları arasından",
    `"${niche}" nişi için ticari potansiyeli en yüksek ${Math.max(1, topN)} ürünü seç.`,
    "Yalnız verilen satırları kullan; yeni ürün, fiyat veya satış rakamı UYDURMA.",
    "Satış hacmi, görüntülenme, puan ve kaynak doğrulaması güçlü olanları ödüllendir.",
    "Yanıt YALNIZ şu JSON olsun:",
    '{"picks":[{"index":1,"reason":"en fazla 12 kelime"}]}',
    "",
    roster,
  ].join("\n");

  try {
    const text = await callAiMesh(prompt, {
      temperature: 0.2,
      grounded: false,
      deadlineAt,
    });
    const parsed = extractJson<{ picks?: unknown[] }>(text, { picks: [] });
    const raw = Array.isArray(parsed.picks) ? parsed.picks.slice(0, 60) : [];
    const order: string[] = [];
    const reasons = new Map<string, string>();
    for (const item of raw) {
      const row = item as { index?: unknown; reason?: unknown };
      const index = Number(row?.index);
      if (!Number.isInteger(index) || index < 1 || index > candidates.length) continue;
      const product = candidates[index - 1];
      if (!product) continue;
      const key = candidateKey(product);
      if (reasons.has(key)) continue;
      const reason = String(row?.reason ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 160);
      order.push(key);
      if (reason) reasons.set(key, reason);
      if (order.length >= Math.max(1, topN)) break;
    }
    if (!order.length) return null;
    return { order, reasons };
  } catch {
    // Model/anahtar yoksa ürün araması durmaz; deterministik sıralama kalır.
    return null;
  }
}
