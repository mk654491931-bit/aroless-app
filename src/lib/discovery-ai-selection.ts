// ============================================================================
// AI SEÇİM ÇIKTISININ DOĞRULANMASI — saf (ağ YOK, AI YOK).
//
// ANA İLKE (§15, §20, §32):
//   "AI PRODUCT DATA ÜRETMEZ. AI PRODUCT DATA'YI ANALİZ EDER."
//
// Yani modelin döndürdüğü ham JSON'a ASLA güvenilmez. Model YALNIZCA mevcut
// adayların KİMLİKLERİNİ seçebilir; başlık, fiyat, görsel, adres gibi ürün
// alanlarını yazma hakkı yoktur. Yazarsa o alanlar ÇÖPE ATILIR.
//
// DOĞRULAMA KURALLARI:
//   • `productId` girdi listesinde YOKSA  → reddedilir (halüsinasyon).
//   • `productId` TEKRARLANIRSA            → ilk kabul edilir, kalanı elenir.
//   * `score` 0-100 dışındaysa             → reddedilir (bozuk puan).
//   • `reasoning` boşsa                    → kabul edilir ama gerekçe boş kalır.
//   • Şema tutmuyorsa                      → TAMAMEN reddedilir, hat yedeğe düşer.
//
// ÇIKTI YALNIZCA `selection`/`score`/`reasoning` taşır. `resolveSelection`
// ürün verisini MODELDEN ALMAZ: kimliği girdi listesinde arar ve girdideki
// GERÇEK kaydı döner. Kayıt yoksa o seçim düşer — uydurma ürün üretilmez.
// ============================================================================

import { z } from "zod";

/* ------------------------------------------------------------- Şemalar */

/**
 * Modelin döndürmesi beklenen SEÇİM şekli.
 *
 * ALAN ADLARI DIŞARI SÖZLEŞMEDİR: istem (`buildSelectionPrompt`'ın gömüldüğü
 * metin) ve bu şema AYNI söz dizimini konuşmalıdır. Daha önce bu hatta tam
 * olarak bu sınıf hata düştü (istem "numara listesi" diyordu, doğrulayıcı
 * `{picks:[…]}` bekliyordu) ve model talimatı İZLEDİĞİ için Gemini hiçbir zaman
 * seçim yapamıyordu.
 */
export const AiSelectionSchema = z.object({
  /** Girdi listesindeki GERÇEK ürün kimlikleri. */
  productId: z.string().min(1),
  /** 0-100 arası puan. */
  score: z.number().finite().min(0).max(100),
  /** Kısa gerekçe. Model üretir ama ürün VERİSİ üretmez. */
  reasoning: z.string().default(""),
});

export type AiSelection = z.infer<typeof AiSelectionSchema>;

/** Model yanıtının tamamı: seçim listesi. */
export const AiSelectionResponseSchema = z.object({
  picks: z.array(AiSelectionSchema).min(1),
});
export type AiSelectionResponse = z.infer<typeof AiSelectionResponseSchema>;

/** Doğrulama sonucu — kabul edilenler ve NEDEN reddedildikleri. */
export type AiSelectionValidation<T> = {
  /** Girdi listesindeki GERÇEK kayıtlarla eşleşen seçimler (sıra korunur). */
  accepted: Array<{ selection: AiSelection; record: T }>;
  /** Reddedilen seçimlerin gerekçeleri — panelde ve logda görünür. */
  rejected: Array<{ productId: string; reason: string }>;
  /** Model yanıtı şemaya uydu mu. UyMADIYSA `accepted` boştur. */
  schemaOk: boolean;
};

/**
 * Model seçimini GERÇEK aday listesine karşı doğrular.
 *
 * @param parsed model yanıtının `parseLooseJson` sonrası hâli
 * @param candidates girdideki ürünler; `productId` alanları KİMLİK anahtarıdır
 */
export function validateAiSelection<T extends { productId: string }>(
  parsed: unknown,
  candidates: readonly T[],
  options: { limit?: number } = {},
): AiSelectionValidation<T> {
  const rejected: AiSelectionValidation<T>["rejected"] = [];

  const response = AiSelectionResponseSchema.safeParse(parsed);
  if (!response.success) {
    return {
      accepted: [],
      rejected: [
        { productId: "*", reason: "Model yanıtı şemaya uymuyor (picks/score eksik ya da hatalı)." },
      ],
      schemaOk: false,
    };
  }

  const byId = new Map<string, T>();
  for (const candidate of candidates) {
    const id = String(candidate.productId ?? "").trim();
    if (id && !byId.has(id)) byId.set(id, candidate);
  }

  const accepted: AiSelectionValidation<T>["accepted"] = [];
  const seen = new Set<string>();
  const limit = Math.max(1, options.limit ?? candidates.length);

  for (const selection of response.data.picks) {
    const id = selection.productId.trim();
    // EN KRİTİK KURAL — HALÜSİNASYON KAPISI:
    // Modelin uydurduğu bir kimlik listeye giremez. Girdide olmayan bir ürün
    // "AI buldu" diye üretilmez; o satır kayıt dışıdır.
    const record = byId.get(id);
    if (!record) {
      rejected.push({
        productId: id,
        reason: "Girdi listesinde olmayan kimlik (halüsinasyon) — reddedildi.",
      });
      continue;
    }
    if (seen.has(id)) {
      // Tekrar eden kimlik "düzeltilir": ilki korunur, kalanı atılır. Aynı ürün
      // iki kez sayılmaz (QStash mükerrer teslimatı gibi).
      rejected.push({ productId: id, reason: "Mükerrer seçim — ilk kabul edildi." });
      continue;
    }
    if (accepted.length >= limit) {
      rejected.push({ productId: id, reason: `Seçim üst sınırı (${limit}) aşıldı — elendi.` });
      continue;
    }
    seen.add(id);
    accepted.push({ selection, record });
  }

  return { accepted, rejected, schemaOk: true };
}

/**
 * Model seçimini GERÇEK kayıtlara çevirir.
 *
 * DÖNEN DEĞER HER ZAMAN GİRDİDEKİ GERÇEK KAYDIN KENDİSİDİR — modelden
 * gelen hiçbir ürün alanı (başlık/fiyat/görsel/adres) kopyalanmaz. Model
 * yalnız `score` ve `reasoning` katkısı verir; o ikisi de ayrı alanda taşınır.
 *
 * Bu, "AI seçsin, VERİTABANI versin" kuralının tek uygulama noktasıdır (§20).
 */
export function resolveSelection<T extends { productId: string }>(
  parsed: unknown,
  candidates: readonly T[],
  options: { limit?: number } = {},
): {
  products: T[];
  analysis: Array<{ productId: string; score: number; reasoning: string }>;
  rejected: AiSelectionValidation<T>["rejected"];
  schemaOk: boolean;
} {
  const result = validateAiSelection(parsed, candidates, options);
  return {
    products: result.accepted.map((entry) => entry.record),
    analysis: result.accepted.map((entry) => ({
      productId: entry.record.productId,
      score: Math.round(entry.selection.score),
      reasoning: entry.selection.reasoning,
    })),
    rejected: result.rejected,
    schemaOk: result.schemaOk,
  };
}

/**
 * AJAN ÇIKTISI KORUMASI (§18) — "agent ürün verisini değiştiremez".
 *
 * Ajan "bu ürünün fiyatı 29,99" diyebilir; kaynak veri 24,99 ise 24,99
 * KULLANILIR. Bu tek noktada sağlanır: kaynak alanlar açıkça yeniden yazılır,
 * ajanın getirdiği değerler yalnız `analysis` altında kalır.
 */
export function mergeAgentAnalysis<T extends Record<string, unknown>>(
  sourceRecord: T,
  agentAnalysis: { score?: number | null; reasoning?: string | null } = {},
): T & { analysis: { score: number | null; reasoning: string } } {
  const score =
    typeof agentAnalysis.score === "number" &&
    Number.isFinite(agentAnalysis.score) &&
    agentAnalysis.score >= 0 &&
    agentAnalysis.score <= 100
      ? Math.round(agentAnalysis.score)
      : null;
  const reasoning =
    typeof agentAnalysis.reasoning === "string" ? agentAnalysis.reasoning.trim() : "";
  return {
    ...sourceRecord,
    analysis: { score, reasoning },
  };
}

/** Aday listesinin sırasını koruyan deterministik seçim (AI yok / AI boz döndü). */
export function deterministicSelection<T>(
  candidates: readonly T[],
  limit: number,
  scoreOf?: (candidate: T) => number,
): T[] {
  const ranked = [...candidates].sort((a, b) => {
    const delta = (scoreOf?.(b) ?? 0) - (scoreOf?.(a) ?? 0);
    return delta !== 0
      ? delta
      : String((a as { productId?: string }).productId ?? "").localeCompare(
          String((b as { productId?: string }).productId ?? ""),
        );
  });
  return ranked.slice(0, Math.max(0, limit));
}
