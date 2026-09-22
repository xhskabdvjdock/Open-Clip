import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import "./index.css";
import App from "./App";
import Picker from "./Picker";
import { StoreProvider } from "./lib/store";
import { AppearanceProvider } from "./lib/appearance";

/** Synchronous label detection via Tauri internals (no chunk loading). */
function syncLabel(): string | null {
  try {
    const h = window.location.hash || window.location.search;
    if (h.includes("picker")) return "picker";
  } catch {
    /* ignore */
  }
  try {
    const w = window as unknown as {
      __TAURI_INTERNALS__?: {
        metadata?: { currentWindow?: { label?: string } };
      };
    };
    const label = w.__TAURI_INTERNALS__?.metadata?.currentWindow?.label;
    if (label === "picker" || label === "quick-picker") return "picker";
    if (typeof label === "string" && label.length > 0) return "main";
  } catch {
    /* ignore */
  }
  return null;
}

async function detectLabelAsync(): Promise<string> {
  try {
    const mod = await import("@tauri-apps/api/window");
    const label = mod.getCurrentWindow().label;
    if (label === "picker" || label === "quick-picker") return "picker";
  } catch {
    /* not in Tauri or old API */
  }
  return "main";
}

function removeBoot() {
  document.getElementById("boot")?.remove();
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };

  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  componentDidCatch() {
    removeBoot();
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: 24,
            fontFamily: "sans-serif",
            fontSize: 14,
            color: "#111",
            background: "#fff",
            height: "100%",
          }}
          role="alert"
        >
          <p style={{ fontWeight: 600 }}>Open Clip failed to start</p>
          <pre
            style={{
              marginTop: 8,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              color: "#b91c1c",
            }}
          >
            {this.state.error}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

function Root() {
  // Prefer the synchronous answer so first paint never waits on a chunk.
  const [label, setLabel] = React.useState<string | null>(() => syncLabel());

  React.useEffect(() => {
    document.body.classList.toggle("picker", label === "picker");
    if (label === "picker")
      document.documentElement.setAttribute("data-window", "picker");
    removeBoot();
  }, [label]);

  React.useEffect(() => {
    if (label === null) void detectLabelAsync().then(setLabel);
  }, [label]);

  if (!label) return null;
  return (
    <StoreProvider>
      <AppearanceProvider>{label === "picker" ? <Picker /> : <App />}</AppearanceProvider>
    </StoreProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </React.StrictMode>,
);
