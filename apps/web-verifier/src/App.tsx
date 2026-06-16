import { Navbar } from "@/components/navbar";
import { VerifyForm } from "@/components/verify-form/verify-form";

export function App() {
  return (
    <div className="min-h-svh bg-muted/20">
      <Navbar />
      <VerifyForm />
    </div>
  );
}

export default App;
