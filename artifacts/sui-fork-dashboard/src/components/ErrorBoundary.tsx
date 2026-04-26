import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error("ErrorBoundary caught:", error, info);
    }
  }

  reset = () => {
    this.setState({ error: null });
  };

  reload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-red-500/30 bg-red-500/5 p-6 text-center">
          <AlertTriangle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-white mb-1">
            Something went wrong on this page
          </h2>
          <p className="text-sm text-zinc-400 mb-4">
            The dashboard caught an unexpected error so the rest of the app
            keeps working. You can try this page again or refresh.
          </p>
          {import.meta.env.DEV && (
            <pre className="text-left text-xs text-red-300 bg-black/40 rounded p-3 mb-4 overflow-auto max-h-40">
              {this.state.error.message}
            </pre>
          )}
          <div className="flex gap-2 justify-center">
            <button
              onClick={this.reset}
              className="px-3 py-1.5 text-xs rounded-md bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25"
              data-testid="button-error-retry"
            >
              Try again
            </button>
            <button
              onClick={this.reload}
              className="px-3 py-1.5 text-xs rounded-md bg-zinc-800 border border-zinc-700 text-zinc-200 hover:bg-zinc-700 inline-flex items-center gap-1.5"
              data-testid="button-error-reload"
            >
              <RefreshCw className="w-3 h-3" /> Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
