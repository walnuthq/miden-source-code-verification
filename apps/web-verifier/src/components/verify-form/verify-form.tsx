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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "miden-source-code-verification-ui";
import {
  DEFAULT_NETWORK,
  getNetworkName,
  networks,
} from "miden-source-code-verification-utils/networks";
import {
  detectNetwork,
  parseResourceId,
  RESOURCE_ID_PATTERN,
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
const DEFAULT_SOURCE = "miden-source-code-verification-web-verifier";

export function VerifyForm() {
  // Read `resource` / `network` / `source` query params once on mount to seed
  // the form.
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
  const [network, setNetwork] = useState<string | null>(() => {
    const value = params.get("network");
    return value && getNetworkName(value) ? value : DEFAULT_NETWORK;
  });
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

  const onImport = ({ files, entrypoints }: ProjectFiles) => {
    setFiles(files);
    setEntrypoints(entrypoints);
    setEntrypoint(entrypoints.length > 0 ? entrypoints[0] : ".");
  };

  // Null while the Resource ID is malformed. The form is valid when it is
  // well-formed and at least one source file was imported. Network and
  // Entrypoint always have valid defaults.
  const resource = parseResourceId(resourceId);
  const isFormValid = resource !== null && Object.keys(files).length > 0;
  const isResourceInvalid =
    resourceTouched && resourceId.trim() !== "" && resource === null;

  // A 64-hex-digit ID is a note; anything else is treated as an account.
  const kind = resource?.kind ?? "account";

  const onSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isFormValid || verifying || !network) return;

    const isNote = resource.kind === "note";
    const endpoint = isNote ? "verified-notes" : "verified-accounts";
    const idField = isNote ? "noteId" : "accountId";
    // The API expects `accountId` in canonical hex form, which is what
    // `parseResourceId` resolves an address to.
    const idValue = isNote ? resource.noteId : resource.accountId;

    setVerifying(true);
    setResult(null);
    try {
      const response = await fetch(`${verifierUrl}/v1/${network}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [idField]: idValue,
          files,
          entrypoint,
          source,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? `Request failed (${response.status})`);
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
    }
  };

  return (
    <main className="flex justify-center px-4 py-10">
      <Card className="w-full max-w-2xl border-t-4 border-t-primary">
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
              <Field data-invalid={isResourceInvalid}>
                <FieldLabel htmlFor="resource-id">Resource ID</FieldLabel>
                <Input
                  id="resource-id"
                  placeholder="Account ID, account address, or note ID"
                  required
                  pattern={RESOURCE_ID_PATTERN}
                  value={resourceId}
                  aria-invalid={isResourceInvalid}
                  onBlur={() => setResourceTouched(true)}
                  onChange={(event) => {
                    const value = event.target.value;
                    setResourceId(value);
                    const detected = detectNetwork(value);
                    if (detected) setNetwork(detected);
                  }}
                />
                <FieldDescription>
                  The account or note to verify.
                </FieldDescription>
                {isResourceInvalid && (
                  <FieldError>
                    Not a valid account ID, account address or note ID.
                  </FieldError>
                )}
              </Field>

              <Field>
                <FieldLabel htmlFor="network">Network</FieldLabel>
                <Select
                  items={networks}
                  value={network}
                  onValueChange={(value) => setNetwork(value)}
                >
                  <SelectTrigger id="network" className="w-full">
                    <SelectValue placeholder="Select network" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {networks.map((network) => (
                        <SelectItem key={network.value} value={network.value}>
                          {network.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
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
                  Verifying…
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
