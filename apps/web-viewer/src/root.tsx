import {
  Navbar,
  ThemeProvider,
  ThemeScript,
} from "miden-source-code-verification-ui";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

import { ErrorPage } from "@/components/error-page";
import { WEB_VERIFIER_URL } from "@/lib/constants";
import type { Route } from "./+types/root";
import "./index.css";

export const meta: Route.MetaFunction = () => [
  { title: "Miden Source Code Verification Web Viewer" },
];

// Shared by every page, including the error boundary, so the navbar and theme
// toggle are always there.
export function Layout({ children }: { children: React.ReactNode }) {
  return (
    // ThemeScript sets the theme class on <html> before hydration.
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="UTF-8" />
        <link rel="icon" type="image/x-icon" href="/favicon.ico" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <ThemeScript />
        <Meta />
        <Links />
      </head>
      <body>
        <ThemeProvider>
          <div className="min-h-svh bg-muted/20">
            <Navbar
              title="Miden Source Code Verification Web Viewer"
              link={{ label: "Verify", href: WEB_VERIFIER_URL }}
            />
            {children}
          </div>
        </ThemeProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <ErrorPage error={error} />;
}
