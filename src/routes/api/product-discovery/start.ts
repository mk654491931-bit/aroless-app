import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { guardAuthed, jsonError, readJsonBody } from "@/lib/api-guard.server";
import { deductFinderCredit } from "@/lib/credits.server";
import { recordUsageWithToken } from "@/lib/usage.server";
import {
  buildIdempotencyKey,
  idempotencyBucket,
  toJobView,
  type DiscoveryJobView,
} from "@/lib/discovery-jobs.shared";
import {
  createJob,
  deleteJob,
  getJobOwned,
  markJobCharged,
  reserveJobCharge,
} from "@/lib/discovery-jobs.server";
import {
  isQstashConfigured,
  isSignatureVerificationConfigured,
  publishDiscoveryJob,
} from "@/lib/qstash.server";

/**
 * POST /api/product-discovery/start
 *
 * The only place a Product Discovery credit is ever spent.
 *
 * Flow (all of it synchronous and fast — no pipeline work happens here):
 *   auth → validate → idempotent job row → reserve charge (CAS) → charge once
 *   → enqueue on QStash → 202 with a job id.
 *
 * Because it returns in milliseconds, Cloudflare can never answer 524 for it.
 *
 * Idempotency: `(user_id, idempotency_key)` is unique, and the charge itself is
 * a compare-and-swap on `billing_state`. A double click, a retried fetch or two
 * concurrent replicas therefore produce exactly one job and exactly one charge.
 */
export const maxDuration = 30;

const StartBody = z.object({
  niche: z.string().trim().min(2).max(80),
  targetCountry: z.string().trim().min(2).max(8).optional(),
});

function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Origin QStash should call back into. Env first, request origin as fallback. */
function publicOrigin(request: Request): string {
  const configured = (process.env["APP_URL"] ?? process.env["VITE_APP_URL"] ?? "").trim();
  if (configured) return configured.replace(/\/$/, "");
  return new URL(request.url).origin;
}

export const Route = createFileRoute("/api/product-discovery/start")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const guard = await guardAuthed(request, "product-discovery-start", 6, 60);
        if ("response" in guard) return guard.response;

        const body = await readJsonBody<unknown>(request);
        if (!body) return jsonError(400, "Geçersiz veya çok büyük istek.");

        const parsed = StartBody.safeParse(body);
        if (!parsed.success) {
          return jsonError(400, "Niş en az 2 karakter olmalı.");
        }
        const niche = parsed.data.niche;
        const targetCountry = (parsed.data.targetCountry ?? "GLOBAL").toUpperCase();

        // The queue is required: without it there is no way to run the pipeline
        // outside the client's HTTP connection, and pretending otherwise would
        // just recreate the 524 this endpoint exists to remove. The client falls
        // back to the live streaming endpoint instead.
        //
        // Signature keys are required too: enqueuing a job the worker must then
        // reject (because it cannot verify the delivery) would strand a paid job
        // in `queued` until it timed out. Both halves of the integration must be
        // configured before a single credit is spent.
        if (!isQstashConfigured() || !isSignatureVerificationConfigured()) {
          return json(503, {
            error: "Arka plan kuyruğu yapılandırılmadı.",
            code: "QUEUE_UNAVAILABLE",
            fallback: { mode: "streaming", url: "/api/public/hot-products?stream=1" },
          });
        }

        const token = bearerToken(request);
        const idempotencyKey = buildIdempotencyKey({
          niche,
          targetCountry,
          bucket: idempotencyBucket(),
        });

        const outcome = await createJob({
          userId: guard.userId,
          niche,
          targetCountry,
          idempotencyKey,
        });
        if (!outcome.job) {
          return jsonError(503, "İş kaydı oluşturulamadı, lütfen tekrar deneyin.");
        }
        const job = outcome.job;

        // Reuse path: an identical, still-running job already exists.
        if (!outcome.created) {
          const existing = await getJobOwned(job.id, guard.userId);
          if (existing && (existing.status === "running" || existing.status === "queued")) {
            return json(202, {
              jobId: existing.id,
              reused: true,
              statusUrl: `/api/product-discovery/status?jobId=${existing.id}`,
              job: toJobView(existing),
            });
          }
          if (existing && existing.status === "completed") {
            return json(200, {
              jobId: existing.id,
              reused: true,
              statusUrl: `/api/product-discovery/status?jobId=${existing.id}`,
              job: toJobView(existing),
            });
          }
          // A failed/canceled row: fall through and re-run it with a fresh key.
          await deleteJob(job.id);
          const retried = await createJob({
            userId: guard.userId,
            niche,
            targetCountry,
            idempotencyKey: `${idempotencyKey}:r${Date.now()}`,
          });
          if (!retried.job) {
            return jsonError(503, "İş kaydı oluşturulamadı, lütfen tekrar deneyin.");
          }
          return await chargeAndQueue(request, retried.job.id, guard.userId, token);
        }

        return await chargeAndQueue(request, job.id, guard.userId, token);
      },
    },
  },
});

/**
 * Charges exactly once, then enqueues.
 *
 * Ordering matters: the row must exist (and be reserved) before the credit is
 * spent, so an interrupted request can never leave a charge with no job, and a
 * concurrent request can never spend a second credit.
 */
async function chargeAndQueue(
  request: Request,
  jobId: string,
  userId: string,
  token: string,
): Promise<Response> {
  const reserved = await reserveJobCharge(jobId);

  if (!reserved) {
    // Someone already charged this job (or it is terminal). Never charge again;
    // just make sure it is queued.
    const existing = await getJobOwned(jobId, userId);
    if (!existing) return jsonError(404, "İş bulunamadı.");
    if (existing.status === "completed" || existing.status === "failed") {
      return json(200, {
        jobId: existing.id,
        reused: true,
        statusUrl: `/api/product-discovery/status?jobId=${existing.id}`,
        job: toJobView(existing),
      });
    }
    await enqueue(request, existing.id);
    return json(202, {
      jobId: existing.id,
      reused: true,
      statusUrl: `/api/product-discovery/status?jobId=${existing.id}`,
      job: toJobView(existing),
    });
  }

  const credit = await deductFinderCredit(token);
  if (!credit.ok) {
    // Roll the row back so the same idempotency key stays usable and the user
    // is never left with a job they cannot retry.
    await deleteJob(jobId);
    const status = credit.error === "NO_CREDITS" ? 402 : credit.error === "AUTH" ? 401 : 503;
    return json(status, { error: credit.message, code: credit.error });
  }

  await markJobCharged(jobId);
  await recordUsageWithToken(token, "product_finder");

  const queued = await enqueue(request, jobId);
  if (!queued) {
    // The credit is already spent but nothing will run it — undo the charge.
    const { finishJob, refundJob } = await import("@/lib/discovery-jobs.server");
    await finishJob(jobId, "failed", null, "enqueue_failed");
    await refundJob(jobId);
    return jsonError(503, "İş kuyruğa alınamadı, krediniz iade edildi.");
  }

  const row = await getJobOwned(jobId, userId);
  return json(202, {
    jobId,
    reused: false,
    statusUrl: `/api/product-discovery/status?jobId=${jobId}`,
    ...(row ? { job: toJobView(row) as DiscoveryJobView } : {}),
  });
}

async function enqueue(request: Request, jobId: string): Promise<boolean> {
  const origin = publicOrigin(request);
  const result = await publishDiscoveryJob({
    jobId,
    workerUrl: `${origin}/api/product-discovery/worker`,
  });
  if (result.ok) return true;
  console.error("[product-discovery/start] enqueue failed", result.reason);
  return false;
}
