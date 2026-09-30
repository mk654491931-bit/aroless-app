/**
 * POST /api/product-discovery/start — Product Discovery hattını BAŞLATIR.
 *
 * SORUMLULUK (ve SADECE bu):
 *   1. Oturumu doğrular (`requireUser`) — kimse başkasının işini başlatamaz.
 *   2. Girdiyi zod ile doğrular.
 *   3. Krediyi **idempotent** düşer (QStash retry → tek düşüm).
 *   4. İş kaydını DB'de oluşturur — SAHİPLİĞİN KALICI KAYDI buradadır.
 *   5. İlk adımı (`scrape_filter`) QStash'e kuyruğa alır.
 *
 * ASENKRON SÖZLEŞME: Bu uç HIZLI döner (200) ve ağır iş yapmaz. Kullanıcı
 * `runId` alır ve ilerlemeyi `/api/product-discovery/stream` ucundan izler.
 * Vercel Hobby'de 10 sn'lik fonksiyon sınırı aşılmaz.
 *
 * KREDİ SIRASI (kullanıcı parasını koruyan sıra):
 *   düş → kayıt aç → kuyruğa al.
 * Kayıt `charged_credits` ile açıldığı için, sonraki her adım kredinin
 * ALINDIĞINI ve daha önce iade EDİLMEDİĞİNİ satırdan görebilir. Herhangi bir
 * adımda iş çökerse `failAndRefund` krediyi tam olarak bir kez iade eder.
 * Kuyruk başarısız olursa aynı yol işler: kullanıcı çalışmayan bir iş için
 * ödemiş olmaz.
 *
 * $0 MALİYET: İlk adım (`scrape_filter`) saf kod olduğu için kazıma + ön
 * filtreleme hiç token harcamaz. AI yalnız sonraki iki adımda çalışır.
 */
import { createFileRoute } from "@tanstack/react-router";

import { requireUser } from "@/lib/api-guard.server";
import { appOrigin, DISCOVERY_MAX_BUDGET_MS } from "@/lib/discovery-jobs.server";
import {
  chargeOnce,
  noCreditsResponse,
  creditUnavailableResponse,
  refundFeatureCredits,
} from "@/lib/credit-charge.server";
import { enqueueDiscoveryStep } from "@/lib/product-discovery-qstash.server";
import { jsonResponse } from "@/lib/product-discovery-security.server";
import { createDiscoveryJob, failAndRefund } from "@/lib/product-discovery-jobs.server";
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

        // 3) İŞ KİMLİĞİ — kredi kilidi, DB kaydı ve QStash dedupe anahtarı budur.
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

        // 5) KALICI İŞ KAYDI — sahiplik ve iade hakkı buradan okunur.
        //    `charged_credits` yazıldığı için bir sonraki adım, kredinin bu iş
        //    için alındığını görebilir (bellek taşımıyoruz).
        try {
          await createDiscoveryJob({
            runId,
            userId,
            input,
            chargedCredits: charge.charged,
          });
        } catch (error) {
          // Kayıt açılamadıysa kredi havada kalır → hemen iade et.
          await refundFeatureCredits(userId, charge.charged, "job_row_failed");
          return json(
            {
              error: "İş kaydı oluşturulamadı; jeton iade edildi.",
              code: "JOB_ROW_FAILED",
              detail: error instanceof Error ? error.message : "unknown",
            },
            503,
          );
        }

        // 6) İLK ADIMI KUYRUĞA AL. Kuyruk bozuşsa kredi iade edilir —
        //    kullanıcı, çalışmayan bir iş için ödemiş olmamalı.
        const queued = await enqueueDiscoveryStep({
          runId,
          userId,
          input,
          step: "scrape_filter",
          products: [],
          progress: 10,
          // Adres kendi isteğimizden türetilir; QStash geri çağrısı internete
          // açık olmak zorundadır, localhost olamaz.
          origin: appOrigin(request),
          // BÜTÜN ZİNCİRİN BİTİŞ ANI — SÖZ BURADA VERİLİR.
          //
          // Ölçülen hata: bu uç `deadlineAtMs` taşımıyordu. Zincir sözünü
          // yalnız `startDiscoveryRun` sunucu fonksiyonu veriyordu; bu HTTP
          // ucundan başlatılan koşularda sınır YOKTU, yani "280 saniyede
          // bitmeli" sözü tutulmuyor ve hat kendi hızında uzayabiliyordu.
          // Tek kaynak: `DISCOVERY_MAX_BUDGET_MS` (280 sn söz − dönüş payı).
          deadlineAtMs: Date.now() + DISCOVERY_MAX_BUDGET_MS,
        });

        if (!queued.ok) {
          await failAndRefund(runId, `queue_failed: ${queued.error}`, (amount) =>
            refundFeatureCredits(userId, amount, "queue_failed"),
          );
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
            stream: `/api/product-discovery/stream?runId=${runId}`,
          },
          200,
        );
      },
    },
  },
});
