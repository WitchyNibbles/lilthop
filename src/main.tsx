import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import "@fontsource-variable/atkinson-hyperlegible-next/wght.css";
import "@fontsource-variable/atkinson-hyperlegible-mono/wght.css";
import "./styles/tokens.css";
import "./styles/type.css";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/live.css";
import "./styles/practice.css";
import "./styles/home.css";
import "./styles/onboarding.css";
import "./styles/progress.css";
import "./styles/recordings.css";
import "./styles/settings.css";

const root = document.getElementById("root");
if (root === null) throw new Error("index.html has no #root element");

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
