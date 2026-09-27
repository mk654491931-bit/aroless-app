/**
 * POST /api/product-discovery/start — Product Discovery hattını BAŞLATIR.
 *
 * SORUMLULUK (ve SADECE bu):
 *   1. Oturumu doğrular (`requireUser`) — kimse başkasının işini başlatamaz.
 *   2. Girdiyi zod ile doğrular.
 *   3. Krediyi **idempotent** düşer (QStash retry → tek düşüm).
 *   4. İş kaydını oluşturur ve SAHİPLİĞİ KALICI OLARAK yazar.
 *   5. İlk adımı (`scrape_filter`) QStash'e kuyruğa alır.
 *
 * ASENKRON SÖZLEŞME: Bu uç HIZLI döner (200) ve ağır iş yapmaz. Kullanıcı
 * `runId` alır ve ilerlemeyi ayrı bir uçtan izler. Vercel Hobby'de 10 sn'lik
 * fonksiyon sınırı aşılmaz.
 *
 * $0 MALİYET: İlk adım (`scrape_filter`) saf kod olduğu için kazıma + ön
 * filtreleme hiç token harcamaz. AI yalnız sonraki iki adımda çalışır.
 */
import { createFileRoute } from "@tanstack/react-router";

import { requireUser } from "@/lib/api-guard.server";
import {
  chargeOnce,
  noCreditsResponse,
  creditUnavailableResponse,
} from "@/lib/credit-charge.server";
import { enqueueDiscoveryStep } from "@/lib/product-discovery-qstash.server";
import { rememberOwnership, jsonResponse } from "@/lib/product-discovery-security.server";
import { ProductDiscoveryInputSchema } from "@/lib/product-discovery.types";

function json(payload: unknown, status = 200): Response {
  return jsonResponse(payload, status, { "Cache-Control": "no-store" });
}

export const Route = createFileRoute("/api/product-discovery/start")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // 1) OTURUM
        const guard = await requireUser(request);
        if ("response" in guard) return guard.response;
        const { userId, token } = guard;

        // 2) GİRDİ DOĞRULAMA
        const body = (await request.json().catch(() => null)) as unknown;
        const parsed = ProductDiscoveryInputSchema.safeParse(body);
        if (!parsed.success) {
          return json(
            { error: "Geçersiz arama girdisi.", issues: parsed.error.issues.map((i) => i.message) },
            400,
          );
        }
        const input = parsed.data;

        // 3) İŞ KİMLİĞİ — kredi kilidi ve QStash dedupe anahtarı budur.
        const runId = crypto.randomUUID();

        // 4) KREDİ — idempotent. Aynı `runId` ikinci kez gelirse düşmez.
        const charge = await chargeOnce({
          userId,
          token,
          feature: "agent-pipeline",
          chargeKey: `discovery:${runId}`,
        });
        if (!charge.ok) {
          return charge.reason === "NO_CREDITS"
            ? noCreditsResponse(1, "agent-pipeline")
            : creditUnavailableResponse();
        }

        // 5) SAHİPLİK — her adımda doğrulanacak kalıcı kayıt.
        rememberOwnership({ runId, userId, createdAt: new Date().toISOString() });

        // 6) İLK ADIMI KUYRUĞA AL. Kuyruk bozuşsa kredi iade edilir —
        //    kullanıcı, çalışmayan bir iş için ödemiş olmamalı.
        const queued = await enqueueDiscoveryStep({
          runId,
          userId,
          input,
          step: "scrape_filter",
          products: [],
          progress: 10,
        });

        if (!queued.ok) {
          const { refundFeatureCredits } = await import("@/lib/credit-charge.server");
          await refundFeatureCredits(userId, charge.charged, "queue_failed");
          return json(
            {
              error: "İş kuyruğa alınamadı; jeton iade edildi.",
              code: "QUEUE_FAILED",
              detail: queued.error,
            },
            503,
          );
        }

        return json(
          {
            ok: true,
            runId,
            status: "queued",
            charged: charge.charged,
            alreadyCharged: charge.alreadyCharged,
            steps: ["scrape_filter", "gemini", "deep", "final"],
          },
          200,
        );
      },
    },
  },
});
