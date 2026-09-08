// ============================================================================
// Centralized error handling helpers for server functions.
//
// Every server function repeats the same NO_CREDITS / JWT / generic error
// pattern. These helpers extract the common logic so each function stays short
// and consistent.
// ============================================================================

/**
 * Checks a Supabase RPC result for the no-credits error.
 * Returns true if the error means the user has no credits left.
 */
export function isNoCreditsError(error: { message?: string } | null | undefined): boolean {
  return !!error && String(error.message).includes("no_credits");
}

/**
 * Checks if an error message is a JWT-related issue (clock skew, expired token).
 */
export function isJwtError(error: Error | string | null | undefined): boolean {
  const msg = typeof error === "string" ? error : error?.message ?? "";
  return /jwt/i.test(msg);
}

/**
 * Wraps a server function handler with consistent error classification.
 * Maps raw errors into user-friendly messages with optional credit refund.
 */
export function classifyServerError(error: unknown): {
  type: "no_credits" | "jwt" | "unknown";
  message: string;
  shouldRefund: boolean;
} {
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error ?? "Unknown error");

  if (msg.includes("NO_CREDITS") || msg.includes("no_credits")) {
    return {
      type: "no_credits",
      message: "Out of credits — upgrade to keep going.",
      shouldRefund: false,
    };
  }

  if (/jwt/i.test(msg)) {
    return {
      type: "jwt",
      message: "Session expired — please refresh the page.",
      shouldRefund: true,
    };
  }

  return {
    type: "unknown",
    message: msg,
    shouldRefund: false,
  };
}

/**
 * Minimal structural shape of the Supabase clients we accept. Deliberately
 * loose so both the user-scoped browser/server client and the admin client fit
 * without importing the SDK types here.
 */
type RefundCapableClient = {
  rpc?: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ error: { message?: string; code?: string } | null }>;
  from: (table: string) => {
    update: (vals: Record<string, number>) => {
      eq: (col: string, val: string) => Promise<unknown>;
    };
  };
};

export type RefundOptions = {
  /** Search credits to give back (profiles.credits). Defaults to 1. */
  search?: number;
  /** Simulation credits to give back (profiles.sim_credits). */
  sim?: number;
  /** Free-text reason, stored on the audit row. */
  reason?: string;
  /**
   * Stable key for the failed operation. Passing one makes the refund
   * idempotent: a retried handler cannot pay the same credit back twice.
   */
  idempotencyKey?: string;
};

/**
 * Attempts to refund a credit on error. Fire-and-forget — never throws.
 *
 * Prefers the server-side refund_engine_credits() RPC, which is bounded,
 * idempotent and audited. Falls back to the legacy direct column UPDATE when
 * that function is not deployed yet, so this helper behaves correctly both
 * before and after the credit-column lock migration is applied.
 */
export async function tryRefundCredit(
  supabase: RefundCapableClient,
  userId: string,
  currentCredits: number,
  opts: RefundOptions = {},
): Promise<void> {
  const search = Math.max(0, Math.round(opts.search ?? 1));
  const sim = Math.max(0, Math.round(opts.sim ?? 0));
  if (search === 0 && sim === 0) return;

  try {
    if (typeof supabase.rpc === "function") {
      const { error } = await supabase.rpc("refund_engine_credits", {
        _search_credits: search,
        _sim_credits: sim,
        _reason: opts.reason ?? "engine_failure",
        _idempotency_key: opts.idempotencyKey ?? null,
      });
      if (!error) return;

      // PGRST202 = function not found in the schema cache. Anything else is a
      // real failure (cap reached, duplicate key) and must NOT be retried via
      // the legacy path, or the cap would be trivially bypassable.
      if (error.code !== "PGRST202" && !/does not exist|could not find/i.test(error.message ?? "")) {
        return;
      }
    }

    // Legacy path — direct column write. Only reachable while the RPC is absent.
    await supabase
      .from("profiles")
      .update({ credits: currentCredits + search })
      .eq("id", userId);
  } catch {
    /* kredi iadesi başarısız olsa da akış bozulmaz */
  }
}
