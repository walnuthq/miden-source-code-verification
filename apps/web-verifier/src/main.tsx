import { MidenProvider } from "@miden-sdk/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";
import { ThemeProvider } from "@/components/theme-provider.tsx";
import App from "./App.tsx";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider>
      <MidenProvider config={{ rpcUrl: "testnet", prover: "testnet" }}>
        <App />
      </MidenProvider>
    </ThemeProvider>
  </StrictMode>,
);
