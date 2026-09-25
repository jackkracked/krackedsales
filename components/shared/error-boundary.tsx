"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Rendered instead of the crashed subtree. Receives a reset() to retry and the error
   *  itself, so a fallback can name the actual fault instead of saying "something failed".
   *  Callers that only need reset can ignore the second argument. */
  fallback: (reset: () => void, error: Error) => ReactNode;
  /** When any value here changes, the boundary clears its error and re-renders
   *  children, so switching to a healthy item recovers from a bad one automatically.
   *  Elements MUST be primitives: they are compared with Object.is, so an object or array
   *  literal would differ on every parent render and re-attempt the crashed child each time. */
  resetKeys?: ReadonlyArray<unknown>;
  /** Optional label for the console log, to locate crashes in production. */
  label?: string;
  /**
   * Absorb the FIRST failure silently and re-render the subtree once before showing the
   * fallback. For a subtree whose crash is transient (a value read while its query was still
   * in flight, a cold request that succeeds on retry), the rep should never see an error at
   * all. A deterministic crash simply fails again and falls through to the fallback, so this
   * costs one extra render and cannot loop: the allowance is spent until `resetKeys` change.
   */
  autoRetryOnce?: boolean;
}

interface ErrorBoundaryState {
  error: Error | null;
  /** Whether the one silent retry has been spent for the current resetKeys. */
  retried: boolean;
}

/**
 * Local error boundary. Contains a render crash to one subtree (e.g. a single
 * conversation thread) so one bad record can never take down the whole page — or
 * trap the user on a screen that re-crashes the moment it reopens.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, retried: false };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Always logged, including the absorbed first failure, so a transient crash still leaves
    // a trace to diagnose rather than disappearing because the retry happened to succeed.
    // componentStack included deliberately: for a hooks-order crash the message alone does not
    // say which component broke, and that is exactly the class of bug this boundary caught.
    console.error(`[ErrorBoundary${this.props.label ? ` ${this.props.label}` : ""}]`, error, info.componentStack);
    if (this.props.autoRetryOnce && !this.state.retried) {
      this.setState({ error: null, retried: true });
    }
  }

  componentDidUpdate(prev: ErrorBoundaryProps) {
    // Auto-recover when the caller's reset keys change (e.g. a different conversation).
    if (!shallowEqual(prev.resetKeys, this.props.resetKeys)) {
      // A different item is a fresh subject: clear the error AND restore the retry allowance,
      // otherwise the second bad record in a session would never get its silent retry.
      if (this.state.error || this.state.retried) this.setState({ error: null, retried: false });
    }
  }

  reset = () => this.setState({ error: null });


  render() {
    if (this.state.error) return this.props.fallback(this.reset, this.state.error);
    return this.props.children;
  }
}

function shallowEqual(a?: ReadonlyArray<unknown>, b?: ReadonlyArray<unknown>): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => Object.is(v, b[i]));
}
