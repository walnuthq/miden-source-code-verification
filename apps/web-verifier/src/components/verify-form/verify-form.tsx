import {
  CircleAlert,
  CircleCheck,
  Info,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
  Button,
  buttonVariants,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
} from "miden-source-code-verification-ui";
import {
  getNetwork,
  type NetworkId,
} from "miden-source-code-verification-utils/networks";
import {
  addressNetwork,
  parseResourceId,
  RESOURCE_ID_PATTERN,
  resourceIdError,
} from "miden-source-code-verification-utils/resource-id";
import { type SyntheticEvent, useState } from "react";

import { ImportSources } from "@/components/verify-form/import-sources";
import { SettingsDialog } from "@/components/verify-form/settings-dialog";
import type { ProjectFiles } from "@/lib/collect-project-files";
import { API_REGISTRY_URL, WEB_VIEWER_URL } from "@/lib/constants";

// Outcome of a verification request, rendered as an Alert below the button.
// `viewerUrl` is the resource's page on the web-viewer.
type VerifyResult =
  | { status: "success"; kind: "account" | "note"; viewerUrl: string }
  | { status: "warning"; kind: "account" | "note" }
  | { status: "error"; message: string };

// Identifies the client that originated a verification request. Overridable via
// the `source` query param; falls back to this when unset.
const DEFAULT_SOURCE = "web-verifier";

// A busy verifier answers 503 with `Retry-After`. Wait that long (within
// bounds) and resubmit, up to MAX_BUSY_RETRIES times.
const MAX_BUSY_RETRIES = 3;
const DEFAULT_RETRY_AFTER_SECONDS = 30;
const MAX_RETRY_AFTER_SECONDS = 120;

const retryAfterSeconds = (header: string | null) => {
  const seconds = Number(header);
  if (header === null || !Number.isFinite(seconds) || seconds < 1) {
    return DEFAULT_RETRY_AFTER_SECONDS;
  }
  return Math.min(Math.ceil(seconds), MAX_RETRY_AFTER_SECONDS);
};

// Messages for failures that aren't about the submitted sources.
const UNAVAILABLE_MESSAGES: Record<number, string> = {
  502: "The verifier could not reach the compiler. Please try again later.",
  503: "The verifier is busy. Please try again in a few minutes.",
  504: "The verifier took too long to answer. Please try again later.",
};

// The network is picked in the navbar, so it comes from `App`.
export function VerifyForm({
  network,
  onNetworkChange,
}: {
  network: NetworkId;
  onNetworkChange: (network: NetworkId) => void;
}) {
  // Read `resource` / `source` query params once on mount to seed the form.
  const [params] = useState(() => new URLSearchParams(window.location.search));
  // The verification server endpoint, configurable via the Settings dialog.
  const [verifierUrl, setVerifierUrl] = useState(API_REGISTRY_URL);
  const [resourceId, setResourceId] = useState(
    () => params.get("resource") ?? "",
  );
  // Whether to report a malformed Resource ID: once the field is left, or right
  // away for one seeded from the URL, which the user never typed.
  const [resourceTouched, setResourceTouched] = useState(() =>
    params.has("resource"),
  );
  // Optional override for the request `source`; defaults to DEFAULT_SOURCE.
  const [source] = useState(() => params.get("source") || DEFAULT_SOURCE);
  // Filtered project sources and the entrypoints found within them, kept for
  // the verification step.
  const [files, setFiles] = useState<Record<string, string>>({});
  const [entrypoints, setEntrypoints] = useState<string[]>([]);
  // The project to verify within the imported sources. Defaults to "." (the
  // root) when there are zero or one entrypoints; otherwise the user picks one.
  const [entrypoint, setEntrypoint] = useState<string>(".");
  // Whether a verification request is in flight, and the last result (kept until
  // the next Verify click — not cleared on input edits).
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  // Seconds left before resubmitting to a busy verifier, null otherwise.
  const [retryIn, setRetryIn] = useState<number | null>(null);

  const countdown = async (seconds: number) => {
    for (let left = seconds; left > 0; left--) {
      setRetryIn(left);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    setRetryIn(null);
  };

  const onImport = ({ files, entrypoints }: ProjectFiles) => {
    setFiles(files);
    setEntrypoints(entrypoints);
    setEntrypoint(entrypoints.length > 0 ? entrypoints[0] : ".");
  };

  // Null while the Resource ID is malformed. The form is valid when it is
  // well-formed, not an address on another network, and at least one source
  // file was imported. Entrypoint always has a valid default.
  const resource = parseResourceId(resourceId);
  const resourceError = resourceIdError(resourceId, network);
  const isFormValid =
    resource !== null &&
    resourceError === null &&
    Object.keys(files).length > 0;
  // A malformed value waits until the field is left; an address on another
  // network shows right away, with a button to switch when it's served.
  const shownResourceError =
    resourceError && (resourceTouched || resourceError.isWrongNetwork)
      ? resourceError.message
      : null;
  const switchTo = shownResourceError
    ? addressNetwork(resourceId, network)
    : null;

  // A 64-hex-digit ID is a note; anything else is treated as an account.
  const kind = resource?.kind ?? "account";

  const onSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isFormValid || verifying) return;

    const isNote = resource.kind === "note";
    const endpoint = isNote ? "verified-notes" : "verified-accounts";
    const idField = isNote ? "noteId" : "accountId";
    // The API expects `accountId` in canonical hex form, which is what
    // `parseResourceId` resolves an address to.
    const idValue = isNote ? resource.noteId : resource.accountId;

    setVerifying(true);
    setResult(null);
    try {
      const request = () =>
        fetch(`${verifierUrl}/v1/${network}/${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            [idField]: idValue,
            files,
            entrypoint,
            source,
          }),
        });
      let response = await request();
      for (
        let retry = 1;
        response.status === 503 && retry <= MAX_BUSY_RETRIES;
        retry++
      ) {
        await countdown(retryAfterSeconds(response.headers.get("Retry-After")));
        response = await request();
      }
      // Error pages from a proxy in front of the verifier are not JSON.
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          UNAVAILABLE_MESSAGES[response.status] ??
            data?.error ??
            `Request failed (${response.status})`,
        );
      }
      setResult(
        data.verified
          ? {
              status: "success",
              kind,
              viewerUrl: `${WEB_VIEWER_URL}/${network}/${endpoint}/${idValue}`,
            }
          : { status: "warning", kind },
      );
    } catch (error) {
      setResult({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Verification request failed",
      });
    } finally {
      setVerifying(false);
      setRetryIn(null);
    }
  };

  return (
    <main className="flex justify-center px-4 py-10">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="text-center text-xl">
            Verify Accounts &amp; Notes
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex justify-end">
            <SettingsDialog
              verifierUrl={verifierUrl}
              onVerifierUrlChange={setVerifierUrl}
            />
          </div>

          <form className="flex flex-col gap-6" onSubmit={onSubmit}>
            <FieldGroup>
              <Field data-invalid={shownResourceError !== null}>
                <FieldLabel htmlFor="resource-id">Resource ID</FieldLabel>
                <Input
                  id="resource-id"
                  placeholder="Account ID, account address, or note ID"
                  required
                  pattern={RESOURCE_ID_PATTERN}
                  value={resourceId}
                  aria-invalid={shownResourceError !== null}
                  onBlur={() => setResourceTouched(true)}
                  onChange={(event) => setResourceId(event.target.value)}
                />
                <FieldDescription>
                  The account or note to verify.
                </FieldDescription>
                {shownResourceError && (
                  <FieldError>
                    {shownResourceError}
                    {switchTo && (
                      <>
                        {" "}
                        <button
                          type="button"
                          className="underline underline-offset-4"
                          onClick={() => onNetworkChange(switchTo)}
                        >
                          Switch to {getNetwork(switchTo).label}
                        </button>
                      </>
                    )}
                  </FieldError>
                )}
              </Field>
            </FieldGroup>

            <ImportSources
              files={files}
              entrypoints={entrypoints}
              entrypoint={entrypoint}
              onImport={onImport}
              onEntrypointChange={setEntrypoint}
            />

            <Button
              type="submit"
              className="w-full"
              disabled={!isFormValid || verifying}
            >
              {verifying ? (
                <>
                  <Loader2 className="animate-spin" />
                  {retryIn === null
                    ? "Verifying…"
                    : `Verifier busy, retrying in ${retryIn}s…`}
                </>
              ) : (
                "Verify Resource"
              )}
            </Button>

            {result?.status === "success" && (
              <Alert className="border-green-600/50 text-green-700 dark:border-green-500/50 dark:text-green-400">
                <CircleCheck />
                <AlertTitle>Verified</AlertTitle>
                <AlertDescription className="text-green-700/90 dark:text-green-400/90">
                  This {result.kind} was successfully verified.
                </AlertDescription>
                <AlertAction>
                  <a
                    href={result.viewerUrl}
                    className={buttonVariants({
                      size: "xs",
                      variant: "outline",
                    })}
                  >
                    View source
                  </a>
                </AlertAction>
              </Alert>
            )}

            {result?.status === "warning" && (
              <Alert className="border-amber-600/50 text-amber-700 dark:border-amber-500/50 dark:text-amber-400">
                <TriangleAlert />
                <AlertTitle>Not verified</AlertTitle>
                <AlertDescription className="text-amber-700/90 dark:text-amber-400/90">
                  This {result.kind} could not be verified.
                </AlertDescription>
              </Alert>
            )}

            {result?.status === "error" && (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertTitle>Verification failed</AlertTitle>
                <AlertDescription>{result.message}</AlertDescription>
              </Alert>
            )}

            <Alert className="border-blue-600/50 text-blue-700 dark:border-blue-500/50 dark:text-blue-400">
              <Info />
              <AlertTitle>Upload source code to verify this {kind}</AlertTitle>
              <AlertDescription className="text-blue-700/90 dark:text-blue-400/90">
                Select the folder of the Rust project to verify. If the project
                has local dependencies, select the parent directory containing
                both the project and its dependencies, then choose the project
                as the entrypoint.
              </AlertDescription>
            </Alert>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
