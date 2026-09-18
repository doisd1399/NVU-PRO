import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error in component tree:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="flex flex-col items-center justify-center p-8 bg-red-50 text-red-700 rounded-lg max-w-lg mx-auto mt-10">
          <h2 className="text-xl font-bold mb-2">Algo deu errado</h2>
          <p className="text-sm mb-4 text-center">
            Ocorreu um erro de renderização neste componente. A administração já
            foi notificada (log no console).
          </p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
          >
            Tentar Restaurar
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
