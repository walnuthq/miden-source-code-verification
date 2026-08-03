import { Loader2 } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Navbar,
} from "miden-source-code-verification-ui";
import { useEffect, useState } from "react";

import { OverallStatus } from "@/components/overall-status";
import { ServiceCard } from "@/components/service-card";
import type { StatusSnapshot } from "@/lib/types";

// api-docs owns the root of the Pages site; this page lives one level under it.
const DOCS_URL = "/miden-source-code-verification/";

type LoadState =
  | { phase: "loading" }
  | { phase: "ready"; snapshot: StatusSnapshot }
  | { phase: "error"; message: string };

export function App() {
  const [state, setState] = useState<LoadState>({ phase: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    // Written by scripts/probe.ts at build time into public/, so Vite copies it
    // into dist/ next to index.html. Same-origin, so no CORS involved.
    fetch(`${import.meta.env.BASE_URL}status.json`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} fetching status.json`);
        }
        return (await response.json()) as StatusSnapshot;
      })
      .then((snapshot) => setState({ phase: "ready", snapshot }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setState({
          phase: "error",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      });

    return () => controller.abort();
  }, []);

  return (
    <div className="min-h-svh bg-muted/20">
      <Navbar
        title="Miden Source Code Verification Status"
        homeHref={DOCS_URL}
      />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
        {state.phase === "loading" && (
          <div className="flex items-center justify-center gap-2 py-16 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading status…
          </div>
        )}

        {state.phase === "error" && (
          <Alert variant="destructive">
            <AlertTitle>Status unavailable</AlertTitle>
            <AlertDescription>
              Could not load the latest status snapshot. {state.message}
            </AlertDescription>
          </Alert>
        )}

        {state.phase === "ready" && (
          <>
            <OverallStatus
              checkedAt={state.snapshot.checkedAt}
              services={state.snapshot.services}
            />
            <div className="flex flex-col gap-4">
              {state.snapshot.services.map((service) => (
                <ServiceCard key={service.id} service={service} />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Checks run hourly from GitHub Actions, using the same fixtures as
              the test suite. This page is a snapshot from the last run, not a
              live probe.
            </p>
          </>
        )}
      </main>
    </div>
  );
}

export default App;
