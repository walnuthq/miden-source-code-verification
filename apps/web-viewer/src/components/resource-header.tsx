import { CopyButton } from "@/components/copy-button";

// Top of a verified resource page (and of its "not verified" 404 page): the
// resource ID with a copy button, then its network, after repo.sourcify.dev's
// contract header.
export function ResourceHeader({
  id,
  networkName,
}: {
  id: string;
  networkName: string;
}) {
  return (
    <div className="mt-3 mb-2">
      <div className="flex items-center gap-2">
        <h1 className="font-mono text-base font-bold break-all md:text-2xl">
          {id}
        </h1>
        <CopyButton value={id} />
      </div>
      <p className="mt-1 text-sm text-muted-foreground md:text-base">
        on {networkName}
      </p>
    </div>
  );
}
