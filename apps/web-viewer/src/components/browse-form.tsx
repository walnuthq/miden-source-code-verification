import {
  Button,
  buttonVariants,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
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
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { useNetwork } from "@/lib/use-network";

// The viewer page for a Resource ID on `networkId`, or null when the value
// isn't a valid Resource ID (an address on another network included). Addresses link by the hex account ID they encode,
// so each account has a single URL.
function resourcePath(value: string, networkId: NetworkId): string | null {
  const resource = parseResourceId(value);
  if (!resource || resourceIdError(value, networkId)) {
    return null;
  }
  return resource.kind === "note"
    ? `/${networkId}/verified-notes/${resource.noteId}`
    : `/${networkId}/verified-accounts/${resource.accountId}`;
}

// Same design as web-verifier's VerifyForm, but it links to the resource's
// viewer page instead of submitting anything. The network is picked in the
// navbar.
export function BrowseForm() {
  const navigate = useNavigate();
  const [network, setNetwork] = useNetwork();
  const [resourceId, setResourceId] = useState("");
  // Whether to report a malformed Resource ID: once the field is left.
  const [resourceTouched, setResourceTouched] = useState(false);

  // Null while the Resource ID is empty, malformed or an address on another
  // network, which disables the CTA.
  const path = resourcePath(resourceId, network);
  // A malformed value waits until the field is left; an address on another
  // network shows right away, with a button to switch when it's served.
  const resourceError = resourceIdError(resourceId, network);
  const shownResourceError =
    resourceError && (resourceTouched || resourceError.isWrongNetwork)
      ? resourceError.message
      : null;
  const switchTo = shownResourceError
    ? addressNetwork(resourceId, network)
    : null;

  return (
    <main className="flex justify-center px-4 py-10">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="text-center text-xl">
            Browse Accounts &amp; Notes
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <FieldGroup>
            <Field data-invalid={shownResourceError !== null}>
              <FieldLabel htmlFor="resource-id">Resource ID</FieldLabel>
              <Input
                id="resource-id"
                placeholder="Account ID, account address, or note ID"
                pattern={RESOURCE_ID_PATTERN}
                value={resourceId}
                aria-invalid={shownResourceError !== null}
                onBlur={() => setResourceTouched(true)}
                onChange={(event) => setResourceId(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && path) navigate(path);
                }}
              />
              <FieldDescription>The account or note to view.</FieldDescription>
              {shownResourceError && (
                <FieldError>
                  {shownResourceError}
                  {switchTo && (
                    <>
                      {" "}
                      <button
                        type="button"
                        className="underline underline-offset-4"
                        onClick={() => setNetwork(switchTo)}
                      >
                        Switch to {getNetwork(switchTo).label}
                      </button>
                    </>
                  )}
                </FieldError>
              )}
            </Field>
          </FieldGroup>

          {/* A real link (new-tab clicks work) when there's a destination; a
              disabled button styled the same otherwise, since `disabled:`
              styles don't apply to <a>. */}
          {path ? (
            <Link to={path} className={cn(buttonVariants(), "w-full")}>
              View Resource
            </Link>
          ) : (
            <Button className="w-full" disabled>
              View Resource
            </Button>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
