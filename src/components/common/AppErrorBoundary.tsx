import React from "react";

type AppErrorBoundaryState = {
  hasError: boolean;
  retryCount: number;
  errorName?: string;
};

const getSafeRouteLabel = () => {
  if (typeof window === "undefined") return "server";
  const pathname = window.location.pathname || "/";
  return pathname
    .replace(/\/(admin\/driver|driver|admin\/contract|admin\/job)\/[^/]+/g, "/$1/:id")
    .replace(/\/{2,}/g, "/");
};

/**
 * This is a last-resort render boundary, not an authentication boundary.
 * Session restoration and authorization are handled by AppContext/ProtectedRoute.
 * Keeping that distinction explicit prevents a component or lazy-route exception
 * from misleading users into restarting a valid session.
 */
export class AppErrorBoundary extends React.Component<
  React.PropsWithChildren,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { hasError: false, retryCount: 0 };

  static getDerivedStateFromError(): Partial<AppErrorBoundaryState> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const errorName = error?.name || "Error";
    const errorMessage = error?.message || "unknown-render-error";
    const route = getSafeRouteLabel();

    // Keep diagnostics local and non-secret: route class, error type/message and
    // React's component stack are enough to root-cause a render failure without
    // serializing auth tokens, profile data or Firestore documents.
    console.error("[NVU] Falha de renderização não relacionada à sessão", {
      route,
      errorName,
      errorMessage,
      componentStack: info.componentStack,
    });

    this.setState({ errorName });
  }

  private retry = () => {
    this.setState((current) => ({
      hasError: false,
      retryCount: current.retryCount + 1,
      errorName: undefined,
    }));
  };

  private reload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return (
        <React.Fragment key={this.state.retryCount}>
          {this.props.children}
        </React.Fragment>
      );
    }

    return (
      <main className="min-h-screen bg-slate-50 px-6 dark:bg-[#09090b] flex items-center justify-center">
        <section
          className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-white/10 dark:bg-[#151921]"
          role="alert"
          aria-live="assertive"
        >
          <div className="mb-3 text-lg font-bold tracking-[0.22em] text-slate-900 dark:text-white">
            NVU
          </div>
          <h1 className="text-base font-semibold text-slate-900 dark:text-white">
            Não foi possível abrir este conteúdo
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            Ocorreu uma falha inesperada de renderização. Sua sessão não foi
            alterada. Tente abrir esta tela novamente.
          </p>
          <div className="mt-5 grid gap-2">
            <button
              type="button"
              onClick={this.retry}
              className="h-11 w-full rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition-transform active:scale-[0.98] dark:bg-white dark:text-slate-900"
            >
              Tentar novamente
            </button>
            <button
              type="button"
              onClick={this.reload}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-white/10 dark:bg-transparent dark:text-slate-200 dark:hover:bg-white/5"
            >
              Recarregar aplicativo
            </button>
          </div>
        </section>
      </main>
    );
  }
}
