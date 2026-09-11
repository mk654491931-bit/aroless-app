import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  claimJob,
  createJob,
  deleteJob,
  findJobByKey,
  finishJob,
  getJobAny,
  getJobOwned,
  isUuid,
  markJobCharged,
  readJobTransient,
  refundJob,
  reserveJobCharge,
  writeJobProgress,
} from "./discovery-jobs.server";
import type { DiscoveryJobRow } from "./discovery-jobs.shared";

const ORIGINAL_URL = process.env["SUPABASE_URL"];
const ORIGINAL_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"];

beforeAll(() => {
  process.env["SUPABASE_URL"] = "https://example.supabase.co";
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = "service-role-test-key";
  // No Upstash config on purpose: every Redis path must degrade to the durable row.
  delete process.env["UPSTASH_REDIS_REST_URL"];
  delete process.env["UPSTASH_REDIS_REST_TOKEN"];
});

afterAll(() => {
  if (ORIGINAL_URL === undefined) delete process.env["SUPABASE_URL"];
  else process.env["SUPABASE_URL"] = ORIGINAL_URL;
  if (ORIGINAL_KEY === undefined) delete process.env["SUPABASE_SERVICE_ROLE_KEY"];
  else process.env["SUPABASE_SERVICE_ROLE_KEY"] = ORIGINAL_KEY;
});

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

function row(overrides: Partial<DiscoveryJobRow> = {}): DiscoveryJobRow {
  return {
    id: JOB_ID,
    user_id: USER_ID,
    status: "queued",
    stage: "queued",
    progress: 0,
    niche: "glassware",
    target_country: "US",
    result: null,
    error: null,
    billing_state: "pending",
    attempts: 0,
    created_at: "2026-09-12T00:00:00.000Z",
    updated_at: "2026-09-12T00:00:00.000Z",
    finished_at: null,
    ...overrides,
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Call = { url: string; method: string; body: unknown; headers: Record<string, string> };

/** Records every request so idempotency can be asserted from the call log. */
function recorder(handler: (call: Call, index: number) => Response | undefined): {
  fetchImpl: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    const result = handler(call, calls.length - 1);
    if (!result) throw new Error(`unexpected call ${call.method} ${call.url}`);
    return result;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("isUuid", () => {
  it("accepts real uuids and rejects anything else", () => {
    expect(isUuid(JOB_ID)).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid("11111111-1111-4111-8111-11111111111")).toBe(false);
  });
});

describe("createJob idempotency (no double charge)", () => {
  it("inserts once and reports created", async () => {
    const { fetchImpl, calls } = recorder((call) =>
      call.method === "GET" ? json([]) : json([row()]),
    );

    const outcome = await createJob(
      { userId: USER_ID, niche: "glassware", targetCountry: "US", idempotencyKey: "pd:x:US:1" },
      fetchImpl,
    );

    expect(outcome.created).toBe(true);
    expect(outcome.job?.id).toBe(JOB_ID);
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST"]);
    const posted = calls[1]!.body as Record<string, unknown>;
    expect(posted["billing_state"]).toBe("pending");
    expect(posted["user_id"]).toBe(USER_ID);
  });

  it("reuses an existing job for the same key and never inserts a second row", async () => {
    const { fetchImpl, calls } = recorder((call) =>
      call.method === "GET" ? json([row()]) : json([]),
    );

    const outcome = await createJob(
      { userId: USER_ID, niche: "glassware", targetCountry: "US", idempotencyKey: "pd:x:US:2" },
      fetchImpl,
    );

    expect(outcome.created).toBe(false);
    expect(outcome.job?.id).toBe(JOB_ID);
    // Only the lookup ran: a retried `start` can never create a second job.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("GET");
  });

  it("re-reads and reuses the winner when the unique constraint loses a race", async () => {
    let gets = 0;
    const { fetchImpl } = recorder((call) => {
      if (call.method === "GET") {
        gets += 1;
        return json(gets === 1 ? [] : [row()]);
      }
      return json({ message: "duplicate key value violates unique constraint" }, 409);
    });

    const outcome = await createJob(
      { userId: USER_ID, niche: "glassware", targetCountry: "US", idempotencyKey: "pd:x:US:3" },
      fetchImpl,
    );

    expect(outcome.created).toBe(false);
    expect(outcome.job?.id).toBe(JOB_ID);
  });

  it("scopes the idempotency lookup to the owner", async () => {
    const { fetchImpl, calls } = recorder(() => json([]));
    await findJobByKey(USER_ID, "pd:x:US:4", fetchImpl);
    expect(calls[0]!.url).toContain(`user_id=eq.${encodeURIComponent(USER_ID)}`);
    expect(calls[0]!.url).toContain("idempotency_key=eq.pd%3Ax%3AUS%3A4");
  });

  it("reports a storage failure without inventing a job", async () => {
    const outcome = await createJob(
      { userId: USER_ID, niche: "glassware", targetCountry: "US", idempotencyKey: "pd:x:US:5" },
      (async () => {
        throw new Error("network down");
      }) as typeof fetch,
    );
    expect(outcome.job).toBeNull();
    expect(outcome.created).toBe(false);
  });
});

describe("billing compare-and-swap", () => {
  it("wins only when the row is still pending", async () => {
    const { fetchImpl, calls } = recorder(() => json([{ id: JOB_ID }]));
    expect(await reserveJobCharge(JOB_ID, fetchImpl)).toBe(true);
    expect(calls[0]!.url).toContain("billing_state=eq.pending");
    expect((calls[0]!.body as Record<string, unknown>)["billing_state"]).toBe("reserved");
  });

  it("loses the race when another replica already reserved it", async () => {
    const { fetchImpl } = recorder(() => json([]));
    expect(await reserveJobCharge(JOB_ID, fetchImpl)).toBe(false);
  });

  it("marks charged only after the credit RPC succeeded", async () => {
    const { fetchImpl, calls } = recorder(() => json(null));
    expect(await markJobCharged(JOB_ID, fetchImpl)).toBe(true);
    expect((calls[0]!.body as Record<string, unknown>)["billing_state"]).toBe("charged");
  });
});

describe("ownership (IDOR)", () => {
  it("refuses to read a non-uuid or a foreign job", async () => {
    const { fetchImpl, calls } = recorder(() => json([]));
    expect(await getJobOwned("nope", USER_ID, fetchImpl)).toBeNull();
    expect(calls).toHaveLength(0); // no query is even attempted

    expect(await getJobOwned(JOB_ID, USER_ID, fetchImpl)).toBeNull();
    expect(calls[0]!.url).toContain(`user_id=eq.${encodeURIComponent(USER_ID)}`);
  });

  it("returns the owner's row", async () => {
    const { fetchImpl } = recorder(() => json([row()]));
    expect((await getJobOwned(JOB_ID, USER_ID, fetchImpl))?.id).toBe(JOB_ID);
  });

  it("lets the worker read without an ownership filter", async () => {
    const { fetchImpl, calls } = recorder(() => json([row()]));
    expect((await getJobAny(JOB_ID, fetchImpl))?.id).toBe(JOB_ID);
    expect(calls[0]!.url).not.toContain("user_id=eq");
  });
});

describe("claim / finish / refund (retry safety)", () => {
  it("parses a won claim", async () => {
    const { fetchImpl, calls } = recorder(() =>
      json([{ claimed: true, status: "running", attempts: 1 }]),
    );
    const claim = await claimJob(JOB_ID, fetchImpl);
    expect(claim).toEqual({ ok: true, claimed: true, status: "running", attempts: 1 });
    expect(calls[0]!.url).toContain("/rpc/claim_product_discovery_job");
  });

  it("parses a lost claim for a duplicate delivery", async () => {
    const { fetchImpl } = recorder(() =>
      json([{ claimed: false, status: "running", attempts: 2 }]),
    );
    const claim = await claimJob(JOB_ID, fetchImpl);
    expect(claim.claimed).toBe(false);
  });

  it("reports storage as unavailable instead of claiming a job", async () => {
    const { fetchImpl } = recorder(() => json({ message: "boom" }, 500));
    const claim = await claimJob(JOB_ID, fetchImpl);
    expect(claim.ok).toBe(false);
    expect(claim.claimed).toBe(false);
  });

  it("finishes a job and clears the transient Redis key", async () => {
    const { fetchImpl, calls } = recorder(() => json(true));
    expect(await finishJob(JOB_ID, "completed", null, null, fetchImpl)).toBe(true);
    expect(calls[0]!.url).toContain("/rpc/finish_product_discovery_job");
    expect((calls[0]!.body as Record<string, unknown>)["_status"]).toBe("completed");
  });

  it("refunds only when the RPC confirms a real charge", async () => {
    const ok = recorder(() => json(true));
    expect(await refundJob(JOB_ID, ok.fetchImpl)).toBe(true);

    const no = recorder(() => json(false));
    expect(await refundJob(JOB_ID, no.fetchImpl)).toBe(false);

    const broken = recorder(() => json({}, 500));
    expect(await refundJob(JOB_ID, broken.fetchImpl)).toBe(false);
  });

  it("deletes an unchargeable job so the key can be retried", async () => {
    const { fetchImpl, calls } = recorder(() => json(null));
    await deleteJob(JOB_ID, fetchImpl);
    expect(calls[0]!.method).toBe("DELETE");
    expect(calls[0]!.url).toContain(`id=eq.${JOB_ID}`);
  });
});

describe("progress with Redis unavailable", () => {
  it("falls back to the durable row with the stage and clamped progress", async () => {
    const calls: Call[] = [];
    const stub = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      return json(null);
    }) as typeof fetch;

    // `writeJobProgress` persists through the durable row with the global fetch.
    vi.stubGlobal("fetch", stub);
    try {
      await expect(
        writeJobProgress(JOB_ID, { stage: "council", progress: 55 }, { persist: true }),
      ).resolves.toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("PATCH");
    const body = calls[0]!.body as Record<string, unknown>;
    expect(body["stage"]).toBe("council");
    expect(body["progress"]).toBe(55);
  });

  it("returns null instead of throwing when Redis is not configured", async () => {
    await expect(readJobTransient(JOB_ID)).resolves.toBeNull();
  });
});
