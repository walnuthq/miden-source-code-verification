import {
  CalendarCheck,
  Fingerprint,
  Library,
  Package,
  SquareFunction,
} from "lucide-react";

import { CopyButton } from "@/components/copy-button";
import { type DetailField, DetailsList } from "@/components/details-card";
import type { PackageDependency } from "@/lib/api-registry.server";
import type { PackageProcedure } from "@/lib/procedure-signatures";

// A verified package's details: its name, digest, the procedures it installs,
// the packages it was compiled against and when it was verified, laid out like
// the resource's details above it.
export function PackageHeader({
  name,
  digest,
  procedures,
  dependencies,
  verifiedAt,
}: {
  name: string;
  digest: string;
  procedures: PackageProcedure[];
  dependencies: PackageDependency[];
  verifiedAt: string;
}) {
  const fields: DetailField[] = [
    { label: "Package Name", icon: Package, value: name },
    {
      label: "Package Digest",
      icon: Fingerprint,
      value: digest,
      copyable: true,
    },
  ];
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
  fields.push({ label: "Verified at", icon: CalendarCheck, value: verifiedAt });
  return <DetailsList fields={fields} />;
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
