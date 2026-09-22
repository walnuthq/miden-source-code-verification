import { Navbar } from "miden-source-code-verification-ui";

import { VerifyForm } from "@/components/verify-form/verify-form";

export function App() {
  return (
    <div className="min-h-svh bg-muted/20">
      <Navbar title="Miden Source Code Verification Web Verifier" />
      <VerifyForm />
    </div>
  );
}

export default App;
