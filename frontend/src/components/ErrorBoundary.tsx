import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * App-wide error boundary.
 *
 * Without this, any render-time exception (e.g. a panel choking on freshly
 * refreshed on-chain state right after a transaction) unmounts the whole React
 * tree, leaving a blank page — what users perceive as "it just stops everything
 * down" with no success popup. Here we catch it, keep the app alive, and offer a
 * one-click recovery so a successful tx is never followed by a dead screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface to the console for debugging; the UI stays usable regardless.
    console.error('Uncaught render error:', error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="dark flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-lg">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-500">
            <AlertTriangle size={22} />
          </div>
          <h2 className="text-lg font-semibold">Something went wrong</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            The interface hit an unexpected error. Your transaction may still have
            gone through — refresh to see the latest on-chain state.
          </p>
          {this.state.error.message && (
            <p className="mt-3 break-words rounded-lg bg-muted/40 p-2.5 text-left font-mono text-xs text-muted-foreground">
              {this.state.error.message}
            </p>
          )}
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={this.reset}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-muted/30 px-4 py-2 text-sm font-semibold transition-colors hover:bg-muted/60"
            >
              <RotateCcw size={14} />
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90"
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
