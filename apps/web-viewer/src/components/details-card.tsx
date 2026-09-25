import { ExternalLink, type LucideIcon } from "lucide-react";
import { Card, Separator } from "miden-source-code-verification-ui";
import { Fragment, type ReactNode } from "react";

import { CopyButton } from "@/components/copy-button";

export type DetailField = {
  label: string;
  icon: LucideIcon;
  value: ReactNode;
  // Hex IDs, addresses and digests: monospaced, with a copy button.
  copyable?: boolean;
  href?: string;
};

// A card of label/value rows, after MidenScan's overview.
export function DetailsCard({ fields }: { fields: DetailField[] }) {
  return (
    <Card className="gap-0 py-0">
      <DetailsList fields={fields} />
    </Card>
  );
}

// The rows on their own, full-bleed, for a card that holds more than them (see
// `PackageSection`). From `sm` up the labels take a fixed-width column, sized so
// that with the row padding and the column gap the values line up with the
// editor beside a package's source code explorer, which sits inside its card's
// padding (see `SourceCode`, whose explorer column is 16rem). A label sits on
// the baseline of its value's first line, so it lines up with the first item
// of a list.
export function DetailsList({ fields }: { fields: DetailField[] }) {
  return (
    <dl>
      {fields.map((field, index) => (
        <Fragment key={field.label}>
          {index > 0 && <Separator />}
          <DetailRow field={field} />
        </Fragment>
      ))}
    </dl>
  );
}

function DetailRow({ field }: { field: DetailField }) {
  const { label, icon: Icon, value, copyable, href } = field;
  return (
    <div className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[15rem_1fr] sm:items-baseline sm:gap-4">
      {/* Baseline-aligned so the row aligns on the label's text: an icon has
          no baseline of its own, so it's centred on the text instead. */}
      <dt className="flex items-baseline gap-2 text-muted-foreground">
        <Icon className="size-4 shrink-0 self-center" />
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
        {copyable && typeof value === "string" && <CopyButton value={value} />}
      </dd>
    </div>
  );
}
