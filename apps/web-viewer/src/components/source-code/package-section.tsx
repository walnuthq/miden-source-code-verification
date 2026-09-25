import { DownloadSourcesButton } from "@/components/source-code/download-sources-button";
import { SourceCode } from "@/components/source-code/source-code";
import { type PackageSources, sourcesArchiveName } from "@/lib/source-files";

// One verified package of a resource: each component of an account, or a
// note's package, headed by its name under the page's packages heading.
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
    <section>
      <h3 className="font-mono text-sm font-semibold md:text-base">
        {pkg.name}
      </h3>
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
    </section>
  );
}
