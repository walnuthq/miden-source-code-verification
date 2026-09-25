import { Download } from "lucide-react";
import { Button } from "miden-source-code-verification-ui";

// Zips a package's sources in the browser and saves them as `fileName`.
export function DownloadSourcesButton({
  packageName,
  files,
  fileName,
}: {
  packageName: string;
  files: Record<string, string>;
  fileName: string;
}) {
  const download = async () => {
    const { zipSources } = await import("@/lib/sources-archive");
    const archive = zipSources(packageName, files);
    // fflate types its output over ArrayBufferLike, which Blob rejects in case
    // it is shared memory; zipSync always allocates a plain ArrayBuffer.
    const url = URL.createObjectURL(
      new Blob([archive as Uint8Array<ArrayBuffer>], {
        type: "application/zip",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    // Deferred: revoking in the same task can cancel the download in Firefox.
    setTimeout(() => URL.revokeObjectURL(url));
  };

  return (
    <Button variant="outline" size="sm" onClick={download}>
      <Download data-icon="inline-start" />
      Download Sources
    </Button>
  );
}
