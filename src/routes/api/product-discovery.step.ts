/**
 * POST /api/product-discovery/step — QStash adım işçisi (İMZA DOĞRULAMALI).
 *
 * ZINCIR:
 *   /start ──► step(scrape_filter) ──► step(gemini) ──► step(deep) ──► step(final)
 *
 * GÜVENLİK (3 katman, hepsi fail-closed):
 *   1. QStash JWS imzası doğrulanır (`verifyQStashSignature`). İmzasız istek
 *      401 alır. Bu, uç noktayı sahte iş tetiklemeye karşı korur.
 *   2. Gövde `DiscoveryStepPayloadSchema` ile doğrulanır (zod) — beklenmeyen
 *      alan/tür reddedilir.
 *   3. `runId` sahipliği doğrulanır: işi başlatan `userId` ile adımdaki
 *      `userId` eşleşmezse 403.
 *
 * $0 MALİYET: `scrape_filter` saf koddur (0 token). `gemini` ve `deep`
 * adımları AI çağırır; önceki adımın kanıtı zaten Top-75/Top-15'e
 * indirilmiştir.
 */
import { createFileRoute } from "@tanstack/react-router";

import { DiscoveryStepPayloadSchema } from "@/lib/product-discovery.types";
import {
  jsonResponse,
  signatureRejection,
  verifyOwnership,
  verifyQStashSignature,
  recallOwnership,
} from "@/lib/product-discovery-security.server";
import {
  runDeepAnalysisStep,
  runFinalRankStep,
  runGeminiShortlistStep,
  runScrapeFilterStep,
} from "@/lib/product-discovery-pipeline.server";
import { enqueueDiscoveryStep } from "@/lib/product-discovery-qstash.server";

async function handleStep(request: Request, step: string): Promise<Response> {
  // 1) İMZA — ham gövde üzerinden doğrulanır (parse ÖNCE yapılmaz).
  const raw = await request.text();
  const signature =
    request.headers.get("upstash-signature") ??
    new URL(request.url).searchParams.get("upstash-signature");
  const verified = await verifyQStashSignature(raw, signature);
  if (!verified.ok) {
    console.warn(`[discovery] imza reddi: ${verified.reason}`);
    return signatureRejection(verified);
  }

  // 2) ŞEMA
  const parsed = DiscoveryStepPayloadSchema.safeParse(verified.body);
  if (!parsed.success) {
    return jsonResponse({ error: "Geçersiz adım gövdesi.", issues: parsed.error.issues }, 400);
  }
  const payload = parsed.data;

  // 3) SAHİPLİK — runId'yi başlatan kullanıcı ile eşleşmeli.
  //    (Kalıcı depoda `searches` kaydından okunur; bellek içi kayıt testler ve
  //    tek-fonksiyon koşuları için yedektir.)
  const ownership = recallOwnership(payload.runId);
  if (ownership) {
    const owned = verifyOwnership(ownership, payload.userId);
    if (!owned.ok) {
      console.warn(`[discovery] sahiplik reddi: ${owned.reason}`);
      return jsonResponse({ error: "Bu işe erişim yok." }, 403);
    }
  } else if ((process.env["NODE_ENV"] ?? "production") === "production") {
    // Üretimde sahiplik kaydı YOKSA kabul etme: bilinmeyen runId ile iş
    // çalıştırılması, sahte tetikleme riskini geri getirirdi.
    return jsonResponse({ error: "İş kaydı bulunamadı." }, 403);
  }

  const { input } = payload;

  switch (step) {
    case "scrape_filter": {
      // AI YOK — saf kod. Kaynaklar fail-soft, her biri kendi tavanında.
      const result = await runScrapeFilterStep(input.niche, input.country, input.platform);
      if (!result.ok) return jsonResponse(result, 500);
      // Bir sonraki adımı kuyruğa al — YALNIZCA ürün varsa.
      if (result.next === "gemini_shortlist" && result.products.length > 0) {
        await enqueueDiscoveryStep({
          runId: payload.runId,
          userId: payload.userId,
          input,
          step: "gemini",
          products: result.products as never,
          progress: 45,
        });
      } else if (result.products.length === 0) {
        // Aday yoksa iş biter: kredi iade edilir, sahte sonuç üretilmez.
        return jsonResponse({ ...result, next: "done" }, 200);
      }
      return jsonResponse({ ...result, next: "queued:gemini" }, 200);
    }

    case "gemini": {
      // AI #1 — Gemini kısa listesi (Top 75 → 15).
      const products = payload.batch as never;
      const result = await runGeminiShortlistStep(products, input.niche);
      if (!result.ok) return jsonResponse(result, 500);
      if (result.products.length === 0) {
        return jsonResponse({ ...result, next: "done" }, 200);
      }
      await enqueueDiscoveryStep({
        runId: payload.runId,
        userId: payload.userId,
        input,
        step: "deep",
        products: result.products as never,
        progress: 70,
      });
      return jsonResponse({ ...result, next: "queued:deep" }, 200);
    }

    case "deep": {
      // AI #2 — 14 ajan derin analizi.
      const products = payload.batch as never;
      const result = await runDeepAnalysisStep(products, input.niche, async (rows) => {
        // 14 ajan burada koşar. Mevcut konsey yürütücüsüne bağlanır.
        const { runCouncilOnProducts } = await import("@/lib/product-discovery-council.server");
        return runCouncilOnProducts(rows);
      });
      if (!result.ok) return jsonResponse(result, 500);
      // Nihai sıralama saf kod — hemen aynı adımda biter.
      const final = runFinalRankStep(result.consensus as never, input.topN);
      return jsonResponse({ ...final, progress: 100 }, 200);
    }

    case "final": {
      const final = runFinalRankStep(payload.batch as never, input.topN);
      return jsonResponse({ ...final, progress: 100 }, 200);
    }

    default:
      return jsonResponse({ error: `Bilinmeyen adım: ${step}` }, 400);
  }
}

export const Route = createFileRoute("/api/product-discovery/step")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const step = new URL(request.url).searchParams.get("step") ?? "scrape_filter";
        return handleStep(request, step);
      },
    },
  },
});
