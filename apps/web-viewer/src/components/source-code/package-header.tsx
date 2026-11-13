import {
  Bug,
  CalendarCheck,
  CircleHelp,
  Database,
  Download,
  Eye,
  FileBox,
  Fingerprint,
  Inbox,
  Library,
  Package,
  SquareFunction,
} from "lucide-react";
import {
  Badge,
  buttonVariants,
  cn,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "miden-source-code-verification-ui";
import { maspDownloadName } from "miden-source-code-verification-utils/api-registry";
import type {
  NoteStorageField,
  StorageSlotSchema,
} from "miden-source-code-verification-utils/manifest";
import { type ComponentProps, Fragment, type ReactNode } from "react";

import { CopyButton } from "@/components/copy-button";
import { type DetailField, DetailsList } from "@/components/details-card";
import type { PackageDependency } from "@/lib/api-registry.server";
import type { PackageProcedure } from "@/lib/procedure-signatures";
import { packageMaspUrl } from "@/lib/source-files";

// A verified package's details: its name, commitment, its compiled MASP (and
// debug build, when there is one) to download, the procedures it installs, the
// storage it declares (an account component's slots, a note's inputs), the
// packages it was compiled against and when and from where it was verified,
// laid out like the resource's details above it.
export function PackageHeader({
  networkId,
  name,
  commitment,
  hasDebugBuild,
  procedures,
  storageSlots,
  noteStorageFields,
  dependencies,
  verifiedAt,
  source,
}: {
  networkId: string;
  name: string;
  commitment: string;
  hasDebugBuild: boolean;
  procedures: PackageProcedure[];
  storageSlots: StorageSlotSchema[];
  noteStorageFields: NoteStorageField[];
  dependencies: PackageDependency[];
  verifiedAt: string;
  source: string;
}) {
  const fields: DetailField[] = [
    { label: "Package Name", icon: Package, value: name },
    {
      label: "Package Commitment",
      icon: Fingerprint,
      value: commitment,
      copyable: true,
    },
    {
      label: "Package MASP",
      icon: FileBox,
      value: (
        <code className="font-mono break-all">
          {maspDownloadName(name, commitment)}
        </code>
      ),
      action: (
        <MaspDownloadButton href={packageMaspUrl({ networkId, commitment })} />
      ),
    },
  ];
  // The same sources built with the dev profile, whose debug info names
  // call-trace frames. It isn't what was verified, so it gets its own row.
  if (hasDebugBuild) {
    fields.push({
      label: "Package Debug MASP",
      icon: Bug,
      value: (
        <code className="font-mono break-all">
          {maspDownloadName(name, commitment, "debug")}
        </code>
      ),
      action: (
        <MaspDownloadButton
          href={packageMaspUrl({ networkId, commitment, variant: "debug" })}
          label="Download debug MASP"
        />
      ),
    });
  }
  if (procedures.length > 0) {
    fields.push({
      label: "Package Procedures",
      icon: SquareFunction,
      value: <ProcedureList procedures={procedures} />,
    });
  }
  if (storageSlots.length > 0) {
    fields.push({
      label: "Storage Slots",
      icon: Database,
      value: <StorageSlotTable slots={storageSlots} />,
    });
  }
  if (noteStorageFields.length > 0) {
    fields.push({
      label: "Note Storage",
      icon: Inbox,
      value: <NoteStorageTable fields={noteStorageFields} />,
    });
  }
  if (dependencies.length > 0) {
    fields.push({
      label: "Package Dependencies",
      icon: Library,
      value: <DependencyList dependencies={dependencies} />,
    });
  }
  fields.push({
    label: "Verified at",
    icon: CalendarCheck,
    value: (
      <>
        {verifiedAt}{" "}
        {/* Kept on one line so a narrow screen wraps it whole rather than
            at the hyphen of a source like `web-verifier`. */}
        <span className="whitespace-nowrap text-muted-foreground">
          (source: {source})
        </span>
      </>
    ),
  });
  return <DetailsList fields={fields} />;
}

// Saves the compiled package as `fileName`. A link rather than a button, as
// the file is served by the web-viewer itself.
// A plain link to the registry: its `Content-Disposition` makes the browser
// save the file, under the package's name, rather than navigate to it.
function MaspDownloadButton({
  href,
  label = "Download MASP",
}: {
  href: string;
  label?: string;
}) {
  return (
    <a
      href={href}
      className={buttonVariants({ variant: "outline", size: "sm" })}
    >
      <Download data-icon="inline-start" />
      {label}
    </a>
  );
}

// Each procedure as its Rust signature; its copy button copies the digest,
// which is what the account's code holds. Whether it is read-only sits at the
// right end, in line with the download buttons above.
function ProcedureList({ procedures }: { procedures: PackageProcedure[] }) {
  return (
    <ul className="flex flex-col">
      {procedures.map(({ name, signature, digest, readOnly }) => (
        <li key={digest} className="flex items-center gap-1">
          <code className="min-w-0 font-mono wrap-break-word">{signature}</code>
          <CopyButton value={digest} label={`Copy ${name} digest`} />
          <ReadOnlyBadge readOnly={readOnly} />
        </li>
      ))}
    </ul>
  );
}

// Only a read-only procedure, or one that can't be told, gets a badge: most
// procedures change state, and a badge on each would say nothing.
function ReadOnlyBadge({ readOnly }: { readOnly: boolean | null }) {
  if (readOnly === false) {
    return null;
  }
  return readOnly ? (
    <Badge
      variant="secondary"
      className="ml-auto"
      title="Nothing this procedure can reach changes state"
    >
      <Eye />
      Read-only
    </Badge>
  ) : (
    <Badge
      variant="outline"
      className="ml-auto text-muted-foreground"
      title="Can't tell whether this procedure changes state: it makes a dynamic call, a direct syscall, or calls a procedure from another package"
    >
      <CircleHelp />
      Unknown
    </Badge>
  );
}

// An account component's storage slots, in slot order, as its account
// component metadata declares them: each slot's name, whether it holds a value
// or a map and of what types, and its description. The Description column
// shows only when a slot has one.
function StorageSlotTable({ slots }: { slots: StorageSlotSchema[] }) {
  const described = slots.some(({ description }) => description);
  return (
    <SchemaTable
      headings={["Slot", "Kind", "Type", ...(described ? ["Description"] : [])]}
    >
      {slots.map((slot) => (
        <TableRow key={slot.name}>
          <SchemaCell className="font-mono wrap-break-word">
            <SlotName name={slot.name} />
          </SchemaCell>
          <SchemaCell>
            <Badge variant="outline">{slot.type}</Badge>
          </SchemaCell>
          <SchemaCell className="font-mono">
            {slot.type === "map" ? (
              `${slot.keyType} → ${slot.valueType}`
            ) : (
              <>
                {slot.valueType}
                {slot.defaultValue && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <span title={slot.defaultValue}>
                      default {shortWord(slot.defaultValue)}
                    </span>
                    <CopyButton
                      value={slot.defaultValue}
                      label={`Copy ${slot.name} default value`}
                    />
                  </span>
                )}
              </>
            )}
          </SchemaCell>
          {described && <SchemaCell>{slot.description}</SchemaCell>}
        </TableRow>
      ))}
    </SchemaTable>
  );
}

// A slot's full name, which can wrap after each `::` of its path rather than
// within a word.
function SlotName({ name }: { name: string }) {
  return name.split("::").map((part, index) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: the parts never reorder.
    <Fragment key={index}>
      {index > 0 && (
        <>
          ::
          <wbr />
        </>
      )}
      {part}
    </Fragment>
  ));
}

// A word's 32-byte hex shortened to its ends, e.g. `0x01000000…00000000`: the
// whole of it is in the title and the copy button.
const shortWord = (word: string) =>
  word.length > 20 ? `${word.slice(0, 10)}…${word.slice(-8)}` : word;

// A note's storage fields, its inputs, in the order their felts take in the
// note's storage: each field's WIT name and type, the felts it takes
// ("varies" for an option or a variant whose cases differ), and its
// description, a column that shows only when a field has one.
function NoteStorageTable({ fields }: { fields: NoteStorageField[] }) {
  const described = fields.some(({ description }) => description);
  return (
    <SchemaTable
      headings={[
        "Field",
        "Type",
        "Felts",
        ...(described ? ["Description"] : []),
      ]}
    >
      {fields.map((field) => (
        <TableRow key={field.name}>
          <SchemaCell className="font-mono wrap-break-word">
            {field.name}
          </SchemaCell>
          <SchemaCell className="font-mono">{field.type}</SchemaCell>
          <SchemaCell className="tabular-nums">
            {field.width ?? (
              <span className="text-muted-foreground">varies</span>
            )}
          </SchemaCell>
          {described && <SchemaCell>{field.description}</SchemaCell>}
        </TableRow>
      ))}
    </SchemaTable>
  );
}

// A storage schema's table, compact enough to sit in a details row: its first
// column lines up with the other rows' values, and the cells wrap rather than
// scroll, as a slot name or a description can be long.
function SchemaTable({
  headings,
  children,
}: {
  headings: string[];
  children: ReactNode;
}) {
  return (
    <Table className="text-sm">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {headings.map((heading) => (
            <TableHead
              key={heading}
              className="h-8 font-normal text-muted-foreground first:pl-0"
            >
              {heading}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>{children}</TableBody>
    </Table>
  );
}

function SchemaCell({ className, ...props }: ComponentProps<"td">) {
  return (
    <TableCell
      className={cn("align-top whitespace-normal first:pl-0", className)}
      {...props}
    />
  );
}

// Each dependency as `name@version`; its copy button copies the digest, which
// is what pins the exact build.
function DependencyList({
  dependencies,
}: {
  dependencies: PackageDependency[];
}) {
  return (
    <ul className="flex flex-col">
      {dependencies.map(({ name, version, digest }) => (
        <li key={digest} className="flex items-center gap-1">
          <span className="font-mono break-all">
            {name}@{version}
          </span>
          <CopyButton value={digest} label={`Copy ${name} digest`} />
        </li>
      ))}
    </ul>
  );
}
