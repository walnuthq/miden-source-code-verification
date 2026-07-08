import { Address } from "@miden-sdk/miden-sdk";
import { CircleAlert, CircleCheck, Loader2, TriangleAlert } from "lucide-react";
import { type SyntheticEvent, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ImportSources } from "@/components/verify-form/import-sources";
import { SettingsDialog } from "@/components/verify-form/settings-dialog";
import type { ProjectFiles } from "@/lib/collect-project-files";
import { API_REGISTRY_URL } from "@/lib/constants";

const networks = [
  { label: "Devnet", value: "mdev" },
  { label: "Testnet", value: "mtst" },
  // { label: "Mainnet", value: "mm" },
];

const networkValues = new Set(networks.map((network) => network.value));

// A Resource ID is valid when it is one of:
//  - an account ID in hex: "0x" followed by 30 hex digits
//  - a note ID in hex: "0x" followed by 64 hex digits
//  - a bech32 account address (validated via Address.fromBech32)
const ACCOUNT_ID_REGEX = /^0x[0-9a-fA-F]{30}$/;
const NOTE_ID_REGEX = /^0x[0-9a-fA-F]{64}$/;
// HTML `pattern` shape check for native validation. The bech32 alternative only
// matches the address *shape* (HRP "1" data charset); the authoritative
// checksum check still happens in `isValidAddress`.
const RESOURCE_ID_PATTERN =
  "0x[0-9a-fA-F]{30}|0x[0-9a-fA-F]{64}|[a-z]+1[02-9ac-hj-np-z]{6,}";

// Whether the value parses as a valid Miden Account address (bech32 + checksum).
// `Address.fromBech32` lives in the Miden SDK WASM, so this can only run once the
// SDK is ready — `ready` guards against calling into uninitialized WASM.
function isValidAddress(value: string, ready: boolean): boolean {
  if (!ready) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    Address.fromBech32(trimmed).free();
    return true;
  } catch {
    return false; // not an address (hex ID, note ID, partial input, …)
  }
}

// Whether the value is a valid Resource ID (hex account/note ID or address).
function isValidResourceId(value: string, ready: boolean): boolean {
  const trimmed = value.trim();
  return (
    ACCOUNT_ID_REGEX.test(trimmed) ||
    NOTE_ID_REGEX.test(trimmed) ||
    isValidAddress(trimmed, ready)
  );
}

// If the value is a valid Miden Account address, return the network prefix
// encoded in it (e.g. "mtst" / "mdev"); otherwise null. The Address object does
// not expose its network, but a bech32 string's HRP is everything before the
// "1" separator (the bech32 data charset excludes "1", so there is exactly one).
function detectNetwork(value: string, ready: boolean): string | null {
  const trimmed = value.trim();
  if (!isValidAddress(trimmed, ready)) return null;
  const prefix = trimmed.slice(0, trimmed.lastIndexOf("1")).toLowerCase();
  return networkValues.has(prefix) ? prefix : null;
}

// The API expects `accountId` in canonical hex form. A hex ID is sent as-is; a
// bech32 address is decoded to its embedded account ID (may throw on bad input).
function toHexAccountId(value: string): string {
  const trimmed = value.trim();
  if (ACCOUNT_ID_REGEX.test(trimmed)) return trimmed;
  const address = Address.fromBech32(trimmed);
  const accountId = address.accountId();
  const hex = accountId.toString();
  accountId.free();
  address.free();
  return hex;
}

// Outcome of a verification request, rendered as an Alert below the button.
type VerifyResult =
  | { status: "success" | "warning"; kind: "account" | "note" }
  | { status: "error"; message: string };

export function VerifyForm({ ready }: { ready: boolean }) {
  // Read `resource` / `network` query params once on mount to seed the form.
  const [params] = useState(() => new URLSearchParams(window.location.search));
  // The verification server endpoint, configurable via the Settings dialog.
  const [verifierUrl, setVerifierUrl] = useState(API_REGISTRY_URL);
  const [resourceId, setResourceId] = useState(
    () => params.get("resource") ?? "",
  );
  const [network, setNetwork] = useState<string | null>(() => {
    const value = params.get("network");
    return value && networkValues.has(value) ? value : "mtst";
  });
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

  // The form is valid when the Resource ID is well-formed and at least one
  // source file was imported. Network and Entrypoint always have valid defaults.
  const isFormValid =
    isValidResourceId(resourceId, ready) && Object.keys(files).length > 0;

  const onSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isFormValid || verifying || !network) return;

    // A 64-hex-digit ID is a note; anything else valid is an account.
    const isNote = NOTE_ID_REGEX.test(resourceId.trim());
    const endpoint = isNote ? "verified-notes" : "verified-accounts";
    const idField = isNote ? "noteId" : "accountId";
    const kind = isNote ? "note" : "account";

    setVerifying(true);
    setResult(null);
    try {
      const idValue = isNote ? resourceId.trim() : toHexAccountId(resourceId);
      const response = await fetch(`${verifierUrl}/v1/${network}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [idField]: idValue,
          files,
          entrypoint,
          source: "miden-source-code-verification-web-verifier",
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? `Request failed (${response.status})`);
      }
      setResult({ status: data.verified ? "success" : "warning", kind });
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
            Verify Contracts &amp; Notes
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
              <Field>
                <FieldLabel htmlFor="resource-id">Resource ID</FieldLabel>
                <Input
                  id="resource-id"
                  placeholder="Account ID, account address, or note ID"
                  required
                  pattern={RESOURCE_ID_PATTERN}
                  value={resourceId}
                  onChange={(event) => {
                    const value = event.target.value;
                    setResourceId(value);
                    const detected = detectNetwork(value, ready);
                    if (detected) setNetwork(detected);
                  }}
                />
                <FieldDescription>
                  The account or note to verify.
                </FieldDescription>
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
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
