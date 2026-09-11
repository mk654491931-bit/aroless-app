// ============================================================================
// QStash (server only) — signed background delivery for async Product Discovery
//
// The 100s Cloudflare wall makes an in-request pipeline impossible. `start`
// therefore enqueues the job on QStash and answers immediately with a job id;
// QStash then calls the worker endpoint with a signed request, off the client's
// HTTP connection entirely.
//
// Two responsibilities:
//   • `publishDiscoveryJob` — enqueue, with retries so a cold or failed worker
//     is retried by the queue instead of silently losing a paid job.
//   • `verifyQstashSignature` — reject anything that is not a genuine QStash
//     delivery. A public worker endpoint that skips this is an open door: it
//     would let anyone trigger (and consume) paid pipelines.
//
// Both degrade safely: `isQstashConfigured()` is false until the user pastes
// credentials, and the API reports that state instead of pretending to queue.
// ============================================================================

/** QStash request timeout for the worker call. Must stay under the function limit. */
export const WORKER_TIMEOUT = "240s";

/**
 * Queue retries.
 *
 * The worker is idempotent, so a retry is always safe. When another worker
 * still holds a live lease the worker answers 429 ("busy, retry later") — with
 * enough retries one of them eventually lands after the lease expires and the
 * job finishes, instead of being abandoned in `running`.
 */
export const WORKER_RETRIES = 5;

type QstashClient = {
  publishJSON(request: {
    url: string;
    body: unknown;
    retries?: number;
    timeout?: string;
    delay?: string;
  }): Promise<{ messageId?: string }>;
};

let client: QstashClient | null | undefined;

function readEnv(name: string): string {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

/** The queue needs a publish token; the worker needs both signing keys. */
export function isQstashConfigured(): boolean {
  return Boolean(readEnv("QSTASH_TOKEN"));
}

/** Signature verification is only possible when both keys are present. */
export function isSignatureVerificationConfigured(): boolean {
  return Boolean(readEnv("QSTASH_CURRENT_SIGNING_KEY") && readEnv("QSTASH_NEXT_SIGNING_KEY"));
}

async function getClient(): Promise<QstashClient | null> {
  if (client !== undefined) return client;
  if (!isQstashConfigured()) {
    client = null;
    return client;
  }
  try {
    const { Client } = await import("@upstash/qstash");
    client = new Client({ token: readEnv("QSTASH_TOKEN") }) as unknown as QstashClient;
  } catch (error) {
    console.error("[qstash] client unavailable", error);
    client = null;
  }
  return client;
}

export type PublishResult =
  | { ok: true; messageId: string }
  | { ok: false; reason: "unconfigured" | "publish_failed"; message: string };

/**
 * Enqueues one job.
 *
 * `body` carries only the job id — never the user's access token — so a leaked
 * queue message cannot be used to act as the user. The worker re-derives every
 * privileged value from the job row.
 */
export async function publishDiscoveryJob(input: {
  jobId: string;
  workerUrl: string;
  delaySeconds?: number;
}): Promise<PublishResult> {
  const qstash = await getClient();
  if (!qstash) {
    return {
      ok: false,
      reason: "unconfigured",
      message:
        "Kuyruk yapılandırılmadı (QSTASH_TOKEN eksik). İş oluşturulmadı ve kredi harcanmadı.",
    };
  }

  try {
    const response = await qstash.publishJSON({
      url: input.workerUrl,
      body: { jobId: input.jobId },
      retries: WORKER_RETRIES,
      timeout: WORKER_TIMEOUT,
      ...(input.delaySeconds && input.delaySeconds > 0
        ? { delay: `${Math.floor(input.delaySeconds)}s` }
        : {}),
    });
    return { ok: true, messageId: String(response?.messageId ?? "") };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[qstash] publish failed", message);
    return { ok: false, reason: "publish_failed", message };
  }
}

export type VerifyResult =
  { ok: true } | { ok: false; reason: "unconfigured" | "missing_signature" | "invalid_signature" };

/**
 * Verifies the `Upstash-Signature` header against the raw request body.
 *
 * The raw body is required (not `JSON.parse` output) because the signature is
 * computed over the exact bytes QStash sent.
 */
export async function verifyQstashSignature(
  signature: string | null,
  rawBody: string,
  url?: string,
): Promise<VerifyResult> {
  if (!isSignatureVerificationConfigured()) return { ok: false, reason: "unconfigured" };
  if (!signature) return { ok: false, reason: "missing_signature" };

  try {
    const { Receiver } = await import("@upstash/qstash");
    const receiver = new Receiver({
      currentSigningKey: readEnv("QSTASH_CURRENT_SIGNING_KEY"),
      nextSigningKey: readEnv("QSTASH_NEXT_SIGNING_KEY"),
    });
    const valid = await receiver.verify({
      signature,
      body: rawBody,
      ...(url ? { url } : {}),
    });
    return valid ? { ok: true } : { ok: false, reason: "invalid_signature" };
  } catch (error) {
    console.error("[qstash] signature verification failed", error);
    return { ok: false, reason: "invalid_signature" };
  }
}
