import {
  Bug,
  CalendarCheck,
  Download,
  FileBox,
  Fingerprint,
  Library,
  Package,
  SquareFunction,
} from "lucide-react";
import { buttonVariants } from "miden-source-code-verification-ui";

import { CopyButton } from "@/components/copy-button";
import { type DetailField, DetailsList } from "@/components/details-card";
import type { PackageDependency } from "@/lib/api-registry.server";
import type { PackageProcedure } from "@/lib/procedure-signatures";
import { maspFileName, packageMaspUrl } from "@/lib/source-files";

// A verified package's details: its name, commitment, its compiled MASP (and
// debug build, when there is one) to download, the procedures it installs, the
// packages it was compiled against and when and from where it was verified,
// laid out like the resource's details above it.
export function PackageHeader({
  networkId,
  name,
  commitment,
  hasDebugBuild,
  procedures,
  dependencies,
  verifiedAt,
  source,
}: {
  networkId: string;
  name: string;
  commitment: string;
  hasDebugBuild: boolean;
  procedures: PackageProcedure[];
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
      value: <code className="font-mono break-all">{maspFileName(name)}</code>,
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
          {maspFileName(name, { debug: true })}
        </code>
      ),
      action: (
        <MaspDownloadButton
          href={packageMaspUrl({ networkId, commitment, debug: true })}
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
// which is what the account's code holds.
function ProcedureList({ procedures }: { procedures: PackageProcedure[] }) {
  return (
    <ul className="flex flex-col">
      {procedures.map(({ name, signature, digest }) => (
        <li key={digest} className="flex items-center gap-1">
          <code className="font-mono wrap-break-word">{signature}</code>
          <CopyButton value={digest} label={`Copy ${name} digest`} />
        </li>
      ))}
    </ul>
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
