import { Component, type ErrorInfo, type ReactNode } from "react";
import { translator } from "./i18n";

interface ErrorBoundaryProps {
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
}

/** Sits above the app state, so it reads the language the app last set on the page. */
const pageTranslator = () =>
  translator(document.documentElement.lang === "es" ? "es" : "en");

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    const t = pageTranslator();
    return (
      <main className="crash">
        <h1>{t("error.title")}</h1>
        <details className="crash-details">
          <summary>{t("error.details")}</summary>
          <pre>{error.message}</pre>
        </details>
        <button
          className="btn"
          onClick={() => this.setState({ error: null })}
          type="button"
        >
          {t("error.retry")}
        </button>
      </main>
    );
  }
}
