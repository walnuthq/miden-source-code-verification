import { LinkIcon } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Separator,
} from "miden-source-code-verification-ui";
import { Link } from "react-router";

import { DownloadSourcesButton } from "@/components/source-code/download-sources-button";
import { PackageHeader } from "@/components/source-code/package-header";
import { SourceCode } from "@/components/source-code/source-code";
import { type PackageSources, sourcesArchiveName } from "@/lib/source-files";

// One verified package of a resource: each component of an account, or a
// note's package. A card per package, so it's clear where one ends and the next
// begins: its name as the header, then its details and its source code. The
// name doubles as the header's anchor (e.g. `#counter-contract`), so a link can
// point straight at one package; the card is outlined while it's the target.
export function PackageSection({
  pkg,
  networkId,
  resourceId,
}: {
  pkg: PackageSources;
  networkId: string;
  resourceId: string;
}) {
  return (
    <section aria-labelledby={pkg.name}>
      <Card className="gap-0 py-0 has-[h3:target]:ring-2 has-[h3:target]:ring-primary">
        <CardHeader className="border-b pt-(--card-spacing)">
          <CardTitle>
            <h3
              id={pkg.name}
              className="scroll-mt-8 font-mono text-sm md:text-base"
            >
              <Link
                to={`#${pkg.name}`}
                className="group inline-flex items-center gap-2 hover:underline"
              >
                {pkg.name}
                <LinkIcon
                  aria-hidden
                  className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                />
              </Link>
            </h3>
          </CardTitle>
        </CardHeader>
        <PackageHeader
          name={pkg.name}
          digest={pkg.digest}
          procedures={pkg.procedures}
          dependencies={pkg.dependencies}
          verifiedAt={pkg.verifiedAt}
          source={pkg.source}
        />
        <Separator />
        <CardContent className="py-(--card-spacing)">
          <SourceCode
            files={pkg.files}
            entryPath={pkg.entryPath}
            action={
              <DownloadSourcesButton
                packageName={pkg.name}
                files={pkg.rawFiles}
                fileName={sourcesArchiveName({
                  networkId,
                  id: resourceId,
                  packageName: pkg.name,
                })}
              />
            }
          />
        </CardContent>
      </Card>
    </section>
  );
}
