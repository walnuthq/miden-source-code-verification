import {
  AtSign,
  ExternalLink,
  Globe,
  Hash,
  type LucideIcon,
} from "lucide-react";
import { Card, Separator } from "miden-source-code-verification-ui";
import { Fragment } from "react";

import { CopyButton } from "@/components/copy-button";

type Field = {
  label: string;
  icon: LucideIcon;
  value: string;
  // Hex IDs and addresses: monospaced, with a copy button.
  copyable?: boolean;
  href?: string;
};

// Top of a verified resource page (and of its "not verified" 404 page), after
// MidenScan's overview: the resource kind as the page's h1 ("Verified …" unless
// it's the 404 page), then its details
// as label/value rows. An account is identified first by its address, then by
// its hex ID. With `explorerUrl`, that first identifier links to the resource
// on the network's block explorer.
export function ResourceHeader({
  kind,
  id,
  networkName,
  address,
  explorerUrl,
  verified = false,
}: {
  kind: "account" | "note";
  id: string;
  networkName: string;
  address?: string;
  explorerUrl?: string;
  verified?: boolean;
}) {
  const label = kind === "account" ? "Account" : "Note";
  const fields: Field[] = [
    ...(address
      ? [{ label: `${label} Address`, icon: AtSign, value: address }]
      : []),
    { label: `${label} ID`, icon: Hash, value: id },
  ].map((field, index) => ({
    ...field,
    copyable: true,
    href: index === 0 ? explorerUrl : undefined,
  }));
  fields.push({ label: "Network", icon: Globe, value: networkName });

  return (
    <header className="mt-3 mb-2 flex flex-col gap-3">
      <h1 className="text-lg font-semibold md:text-xl">
        {verified ? `Verified ${label}` : label}
      </h1>
      <Card className="gap-0 py-0">
        <dl>
          {fields.map((field, index) => (
            <Fragment key={field.label}>
              {index > 0 && <Separator />}
              <ResourceField field={field} />
            </Fragment>
          ))}
        </dl>
      </Card>
    </header>
  );
}

function ResourceField({ field }: { field: Field }) {
  const { label, icon: Icon, value, copyable, href } = field;
  return (
    <div className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[12rem_1fr] sm:items-center sm:gap-4">
      <dt className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4 shrink-0" />
        {label}
      </dt>
      <dd className="flex min-h-7 min-w-0 items-center gap-1">
        <span className={copyable ? "font-mono break-all" : undefined}>
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              title="View on explorer"
              className="text-primary underline-offset-4 hover:underline"
            >
              {value}
              <ExternalLink className="ml-1 inline size-3.5 align-baseline" />
            </a>
          ) : (
            value
          )}
        </span>
        {copyable && <CopyButton value={value} />}
      </dd>
    </div>
  );
}
