import { Navbar } from "miden-source-code-verification-ui";

import { VerifyForm } from "@/components/verify-form/verify-form";

// `ready` is false while the Miden SDK WASM is still initializing (when App is
// rendered as MidenProvider's `loadingComponent`, outside the Miden context) and
// true once it's ready (when App is rendered as the provider's children). It
// gates the form's address validation, which depends on the SDK.
export function App({ ready = false }: { ready?: boolean }) {
  return (
    <div className="min-h-svh bg-muted/20">
      <Navbar title="Miden Source Code Verification Web Verifier" />
      <VerifyForm ready={ready} />
    </div>
  );
}

export default App;
