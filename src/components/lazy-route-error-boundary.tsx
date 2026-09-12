import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, Home, RefreshCw } from "lucide-react";
import { isStaleChunkError, reloadOnceForStaleChunk } from "@/lib/deploy-race-recovery";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Boundary around the router outlet. The global document listener handles the
 * pre-hydration case; this boundary handles a lazy route that rejects after
 * React has mounted (including the second failure after the reload guard has
 * reached its cap).
 */
export class LazyRouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[lazy-route] route failed to load", error, info.componentStack);
    if (isStaleChunkError(error)) reloadOnceForStaleChunk(error);
  }

  private readonly retry = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;

    const chunkFailure = isStaleChunkError(this.state.error);
    return (
      <div className="flex min-h-[50vh] items-center justify-center px-4 py-16">
        <div
          className="w-full max-w-lg rounded-2xl border border-white/10 bg-(--surface)/90 p-6 text-center shadow-2xl"
          role="alert"
        >
          <AlertTriangle className="mx-auto h-8 w-8 text-amber-400" />
          <h2 className="mt-4 text-lg font-semibold">
            {chunkFailure ? "Yeni sürüm yüklenemedi" : "Sayfa yüklenemedi"}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {chunkFailure
              ? "Bu sekme eski bir uygulama dosyasını kullanıyor olabilir. Sayfayı yenileyerek güncel sürümü alabilirsin."
              : "Beklenmeyen bir hata oluştu. Tekrar deneyebilir veya ana sayfaya dönebilirsin."}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <RefreshCw size={14} /> Güncel sürümü yükle
            </button>
            <button
              type="button"
              onClick={this.retry}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium hover:bg-white/10"
            >
              Tekrar dene
            </button>
            <a
              href="/"
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium hover:bg-white/10"
            >
              <Home size={14} /> Ana sayfa
            </a>
          </div>
        </div>
      </div>
    );
  }
}
