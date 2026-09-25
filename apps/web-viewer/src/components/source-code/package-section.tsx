import { DownloadSourcesButton } from "@/components/source-code/download-sources-button";
import { SourceCode } from "@/components/source-code/source-code";
import { type PackageSources, sourcesArchiveName } from "@/lib/source-files";

// One verified package of a resource: each component of an account, or a
// note's package, headed by its name (the page's h1 is the resource ID).
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
    <section className="mt-8">
      <h2 className="font-mono text-base font-semibold md:text-lg">
        {pkg.name}
      </h2>
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
