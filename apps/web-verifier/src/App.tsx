import { Footer, Navbar } from "miden-source-code-verification-ui";

import { VerifyForm } from "@/components/verify-form/verify-form";
import { WEB_VIEWER_URL } from "@/lib/constants";

export function App() {
  return (
    <div className="flex min-h-svh flex-col bg-muted/20">
      <Navbar
        title="Miden Source Code Verification Web Verifier"
        link={{ label: "Browse Registry", href: WEB_VIEWER_URL }}
      />
      <VerifyForm />
      <Footer />
    </div>
  );
}

export default App;
