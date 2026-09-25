import { type ReactNode, useMemo, useState } from "react";

import { EditorTabs } from "@/components/source-code/editor-tabs";
import { FileExplorer } from "@/components/source-code/file-explorer";
import { buildFileTree, type SourceFile } from "@/lib/source-files";

// A package's sources, after repo.sourcify.dev's contract source view: the file
// tree on the left, the open files as tabs on the right. Each instance keeps its
// own tabs, so an account's components don't share them. `action` sits on the
// right of the heading.
export function SourceCode({
  files,
  entryPath,
  action,
}: {
  files: SourceFile[];
  entryPath: string | null;
  action?: ReactNode;
}) {
  const [openPaths, setOpenPaths] = useState(() =>
    entryPath ? [entryPath] : [],
  );
  const [activePath, setActivePath] = useState(entryPath);
  const tree = useMemo(
    () => buildFileTree(files.map((file) => file.path)),
    [files],
  );

  const openFile = (path: string) => {
    if (!openPaths.includes(path)) {
      setOpenPaths([...openPaths, path]);
    }
    setActivePath(path);
  };

  // Closing the active tab activates the one that takes its place, or the new
  // last one.
  const closeFile = (path: string) => {
    const index = openPaths.indexOf(path);
    const remaining = openPaths.filter((openPath) => openPath !== path);
    setOpenPaths(remaining);
    if (path === activePath) {
      setActivePath(remaining[Math.min(index, remaining.length - 1)] ?? null);
    }
  };

  const openFiles = openPaths.flatMap(
    (path) => files.find((file) => file.path === path) ?? [],
  );

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">Source Code</h4>
        {action}
      </div>
      {files.length === 0 ? (
        <p className="border p-6 text-center text-xs text-muted-foreground">
          No source files to display.
        </p>
      ) : (
        <div className="grid border bg-background md:h-[36rem] md:grid-cols-[16rem_minmax(0,1fr)]">
          <FileExplorer
            tree={tree}
            activePath={activePath}
            onOpen={openFile}
            className="max-h-56 border-b md:max-h-none md:border-r md:border-b-0"
          />
          <EditorTabs
            openFiles={openFiles}
            activePath={activePath}
            onSelect={setActivePath}
            onClose={closeFile}
            className="h-[28rem] md:h-auto"
          />
        </div>
      )}
    </section>
  );
}
