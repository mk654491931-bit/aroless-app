import { Component, type ErrorInfo, type ReactElement, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

/**
 * Inline fallback UI for streamed sections.
 *
 * Two flavours, because a stream can end in two non-fatal ways:
 *  • `warning` — the run hit the gateway budget and returned partial data.
 *  • `error`   — something actually broke; offer a retry.
 */
export function StreamNotice({
  tone,
  message,
  detail,
  onRetry,
  className = "",
}: {
  tone: "warning" | "error";
  message: string;
  detail?: string;
  onRetry?: () => void;
  className?: string;
}): ReactElement {
  const isError = tone === "error";
  return (
    <div
      role={isError ? "alert" : "status"}
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 text-[11px] ${
        isError
          ? "border-[oklch(0.68_0.20_25)]/45 bg-[oklch(0.68_0.20_25)]/10 text-foreground"
          : "border-amber-400/40 bg-amber-500/10 text-foreground"
      } ${className}`}
    >
      <span className="flex min-w-0 items-start gap-2">
        <AlertTriangle
          size={13}
          className={`mt-0.5 shrink-0 ${isError ? "text-[oklch(0.75_0.18_25)]" : "text-amber-400"}`}
        />
        <span className="min-w-0">
          <span className="block font-semibold">{message}</span>
          {detail ? <span className="block text-muted-foreground">{detail}</span> : null}
        </span>
      </span>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 font-semibold hover:bg-white/10"
        >
          <RefreshCw size={11} /> Tekrar dene
        </button>
      ) : null}
    </div>
  );
}

type BoundaryProps = {
  children: ReactNode;
  /** Shown in the fallback, e.g. "Canlı fırsat akışı". */
  label?: string;
  /** Retry hook — usually the react-query `refetch`. */
  onRetry?: () => void;
  className?: string;
};

type BoundaryState = { error: Error | null };

/**
 * Keeps a crashed stream render (malformed partial payload, aborted fetch, …)
 * from blanking the whole page: the section falls back to a retryable notice
 * while the rest of the dashboard keeps working.
 */
export class StreamErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[stream] render failed", error, info.componentStack);
  }

  private readonly retry = (): void => {
    this.setState({ error: null });
    this.props.onRetry?.();
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <StreamNotice
        tone="error"
        message={`${this.props.label ?? "Akış"} görüntülenemedi.`}
        detail={error.message}
        onRetry={this.retry}
        {...(this.props.className ? { className: this.props.className } : {})}
      />
    );
  }
}
