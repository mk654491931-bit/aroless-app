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
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" />
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-red-700">Bu bölüm yüklenemedi</h3>
                <p className="mt-1 text-sm text-red-600">
                  Beklenmeyen bir sorun oluştu. Lütfen tekrar deneyin.
                </p>
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
