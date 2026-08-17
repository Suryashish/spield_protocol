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
      <div className="app-shell flex min-h-screen items-center justify-center bg-canvas p-6 text-foreground">
        <div className="panel w-full max-w-md rounded-2xl p-6 text-center shadow-lift">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-ember/10 text-ember-text">
            <AlertTriangle size={22} />
          </div>
          <h2 className="font-display text-[19px] font-medium tracking-[-0.02em]">Something went wrong</h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
            The interface hit an unexpected error. Your transaction may still have
            gone through — refresh to see the latest on-chain state.
          </p>
          {this.state.error.message && (
            <p className="well mt-4 break-words rounded-lg p-3 text-left font-mono text-[11.5px] leading-relaxed text-muted-foreground">
              {this.state.error.message}
            </p>
          )}
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={this.reset}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-4 py-2 text-[13.5px] font-medium shadow-float-sm transition-all duration-200 ease-vault hover:-translate-y-px hover:border-line-strong"
            >
              <RotateCcw size={14} />
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="cta-glow inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[13.5px] font-medium text-primary-foreground transition-all duration-200 ease-vault hover:-translate-y-px hover:brightness-[1.06]"
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
