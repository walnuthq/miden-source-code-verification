import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Separator,
} from "miden-source-code-verification-ui";
import { useId } from "react";

import { DownloadSourcesButton } from "@/components/source-code/download-sources-button";
import { PackageHeader } from "@/components/source-code/package-header";
import { SourceCode } from "@/components/source-code/source-code";
import { type PackageSources, sourcesArchiveName } from "@/lib/source-files";

// One verified package of a resource: each component of an account, or a
// note's package. A card per package, so it's clear where one ends and the next
// begins: its name as the header, then its details and its source code.
export function PackageSection({
  pkg,
  networkId,
  resourceId,
}: {
  pkg: PackageSources;
  networkId: string;
  resourceId: string;
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId}>
      <Card className="gap-0 py-0">
        <CardHeader className="border-b pt-(--card-spacing)">
          <CardTitle>
            <h3 id={titleId} className="font-mono text-sm md:text-base">
              {pkg.name}
            </h3>
          </CardTitle>
        </CardHeader>
        <PackageHeader
          name={pkg.name}
          digest={pkg.digest}
          procedures={pkg.procedures}
          dependencies={pkg.dependencies}
          verifiedAt={pkg.verifiedAt}
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
