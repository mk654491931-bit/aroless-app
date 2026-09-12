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
  const msg = typeof error === "string" ? error : (error?.message ?? "");
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
 * Attempts to refund a credit on error. Fire-and-forget — never throws.
 */
export async function tryRefundCredit(
  supabase: {
    from: (table: string) => {
      update: (vals: Record<string, number>) => {
        eq: (col: string, val: string) => Promise<unknown>;
      };
    };
  },
  userId: string,
  currentCredits: number,
): Promise<void> {
  try {
    await supabase
      .from("profiles")
      .update({ credits: currentCredits + 1 })
      .eq("id", userId);
  } catch {
    /* kredi iadesi başarısız olsa da akış bozulmaz */
  }
}
