import { Component, type ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: (error: Error, retry: () => void) => ReactNode;
  onError?: (error: Error) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error Boundary - Bileşen ağacındaki hataları yakalar ve gösterir
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error("Error Boundary caught:", error);
    this.props.onError?.(error);
  }

  retry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      return (
        this.props.fallback?.(this.state.error, this.retry) || (
          <div className="p-4 rounded-lg border border-red-500/30 bg-red-500/5">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-red-700">Bir şey yanlış gitti</h3>
                <p className="text-sm text-red-600 mt-1">{this.state.error.message}</p>
                {this.state.error.stack && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-medium text-red-700/80 select-none">
                      Teknik detay
                    </summary>
                    <pre className="mt-1 max-h-40 overflow-auto rounded bg-black/25 p-2 text-[10px] leading-relaxed text-red-500 whitespace-pre-wrap">
                      {this.state.error.stack}
                    </pre>
                  </details>
                )}
                <button
                  onClick={this.retry}
                  className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-red-700 hover:text-red-800"
                >
                  <RefreshCw size={14} /> Tekrar deneyin
                </button>
              </div>
            </div>
          </div>
        )
      );
    }

    return this.props.children;
  }
}
