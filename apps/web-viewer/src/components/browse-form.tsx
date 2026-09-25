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
  networks,
} from "miden-source-code-verification-utils/networks";
import {
  detectNetwork,
  parseResourceId,
  RESOURCE_ID_PATTERN,
} from "miden-source-code-verification-utils/resource-id";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

// The viewer page for a Resource ID on `networkId`, or null when the value
// isn't a valid Resource ID. Addresses link by the hex account ID they encode,
// so each account has a single URL.
function resourcePath(value: string, networkId: string): string | null {
  const resource = parseResourceId(value);
  if (!resource) {
    return null;
  }
  return resource.kind === "note"
    ? `/${networkId}/verified-notes/${resource.noteId}`
    : `/${networkId}/verified-accounts/${resource.accountId}`;
}

// Same design as web-verifier's VerifyForm, but it links to the resource's
// viewer page instead of submitting anything.
export function BrowseForm() {
  const navigate = useNavigate();
  const [resourceId, setResourceId] = useState("");
  const [network, setNetwork] = useState<string | null>(DEFAULT_NETWORK);

  // Null while the Resource ID is empty or malformed, which disables the CTA.
  const path = network ? resourcePath(resourceId, network) : null;

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
            <Field>
              <FieldLabel htmlFor="resource-id">Resource ID</FieldLabel>
              <Input
                id="resource-id"
                placeholder="Account ID, account address, or note ID"
                pattern={RESOURCE_ID_PATTERN}
                value={resourceId}
                onChange={(event) => {
                  const value = event.target.value;
                  setResourceId(value);
                  const detected = detectNetwork(value);
                  if (detected) setNetwork(detected);
                }}
                // Not a <form>: Base UI's Select renders a hidden text input,
                // which stops Enter from submitting one.
                onKeyDown={(event) => {
                  if (event.key === "Enter" && path) navigate(path);
                }}
              />
              <FieldDescription>The account or note to view.</FieldDescription>
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
