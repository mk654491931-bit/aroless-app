// ============================================================================
// Vendor-neutral client error reporting.
//
// Replaces the editor-specific reporter. Call sites do not care where errors
// end up, so the sink is an optional global: attach a real provider (Sentry,
// Logtail, an /api route) by assigning window.__arolessErrorSink once at
// startup, and nothing else has to change.
//
// Reporting must never throw. An error inside the error reporter turns a
// recoverable boundary into a blank page.
// ============================================================================

export type ErrorSeverity = "error" | "warning" | "info";

export type ErrorReportOptions = {
  mechanism?: "manual" | "onerror" | "unhandledrejection" | "react_error_boundary";
  handled?: boolean;
  severity?: ErrorSeverity;
};

export type ErrorSink = {
  captureException?: (
    error: unknown,
    context?: Record<string, unknown>,
    options?: ErrorReportOptions,
  ) => void;
};

declare global {
  interface Window {
    __arolessErrorSink?: ErrorSink;
  }
}

/**
 * Loaders and server functions commonly throw a raw Response, whose String()
 * form is the useless "[object Response]". Pull out something diagnosable.
 */
export function describeError(error: unknown): string {
  if (error instanceof Response) {
    return `Response ${error.status}${error.url ? ` at ${error.url}` : ""}`;
  }
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

export function reportClientError(
  error: unknown,
  context: Record<string, unknown> = {},
  options: ErrorReportOptions = {},
): void {
  if (typeof window === "undefined") return;

  const payload = {
    message: describeError(error),
    stack: error instanceof Error ? error.stack : undefined,
    route: window.location.pathname,
    ...context,
  };

  try {
    window.__arolessErrorSink?.captureException?.(error, payload, {
      mechanism: "manual",
      handled: true,
      severity: "error",
      ...options,
    });
  } catch {
    /* a broken sink must not escalate into a blank page */
  }

  // Always leave a breadcrumb in the console: with no sink attached this is the
  // only record, and production React does not re-throw boundary-caught errors
  // to window.onerror.
  try {
    console.error("[aroless]", payload.message, payload);
  } catch {
    /* ignore */
  }
}
