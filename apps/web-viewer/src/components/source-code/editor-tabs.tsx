import { X } from "lucide-react";
import { buttonVariants, cn } from "miden-source-code-verification-ui";
import { useId } from "react";

import { FileIcon } from "@/components/source-code/file-icon";
import type { SourceFile } from "@/lib/source-files";

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const dirname = (path: string) => path.slice(0, path.lastIndexOf("/") + 1);

// The open files as tabs, over the active one's highlighted code. Each tab is a
// select button with a sibling close button (a close button inside the tab
// would nest buttons).
export function EditorTabs({
  openFiles,
  activePath,
  onSelect,
  onClose,
  className,
}: {
  openFiles: SourceFile[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  className?: string;
}) {
  const id = useId();
  const panelId = `${id}-panel`;
  const activeIndex = openFiles.findIndex((file) => file.path === activePath);
  const activeFile = openFiles[activeIndex];

  return (
    <div className={cn("flex min-h-0 min-w-0 flex-col", className)}>
      <div
        role="tablist"
        aria-label="Open files"
        className="flex h-8 shrink-0 overflow-x-auto border-b bg-muted/50"
      >
        {openFiles.map(({ path }, index) => {
          const isActive = index === activeIndex;
          const name = basename(path);
          // Like VS Code, tell apart open files sharing a name (the lib.rs of
          // each crate in an upload) by their directory.
          const isAmbiguous = openFiles.some(
            (file) => file.path !== path && basename(file.path) === name,
          );
          return (
            <div
              key={path}
              className={cn(
                "flex shrink-0 items-center border-r",
                isActive && "bg-background",
              )}
            >
              <button
                type="button"
                role="tab"
                id={`${id}-tab-${index}`}
                aria-selected={isActive}
                aria-controls={panelId}
                title={path}
                onClick={() => onSelect(path)}
                className={cn(
                  "flex h-full items-center gap-1.5 pr-1 pl-3 text-xs whitespace-nowrap outline-none focus-visible:ring-1 focus-visible:ring-ring/50",
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <FileIcon path={path} className="size-3.5" />
                {name}
                {isAmbiguous && (
                  <span className="text-muted-foreground">{dirname(path)}</span>
                )}
              </button>
              <button
                type="button"
                aria-label={`Close ${path}`}
                onClick={() => onClose(path)}
                className={cn(
                  buttonVariants({ variant: "ghost", size: "icon-xs" }),
                  "mr-1",
                )}
              >
                <X />
              </button>
            </div>
          );
        })}
      </div>
      {activeFile ? (
        <div
          role="tabpanel"
          id={panelId}
          aria-labelledby={`${id}-tab-${activeIndex}`}
          className="min-h-0 flex-1 overflow-auto text-xs leading-5"
          // Shiki's output, rendered on the server with the source text escaped
          // (see package-sources.server.ts).
          // biome-ignore lint/security/noDangerouslySetInnerHtml: see above
          dangerouslySetInnerHTML={{ __html: activeFile.html }}
        />
      ) : (
        <p className="flex flex-1 items-center justify-center p-6 text-xs text-muted-foreground">
          Select a file in the explorer.
        </p>
      )}
    </div>
  );
}
