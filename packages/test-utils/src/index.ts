import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

// On-chain resource fixtures — the account/note IDs, their expected code roots,
// and the serialized resources used to verify without hitting the network. Both
// the api-compile test suite and the status-page probe read them from here, so a
// change to the dataset reaches both at once.
export * from "./fixtures.ts";
export * from "./request.ts";

export const readProjectFiles = async (rootDir: string) => {
  const entries = await readdir(rootDir, {
    recursive: true,
    withFileTypes: true,
  });
  const files = await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isFile()) return;
      const full = path.join(entry.parentPath, entry.name);
      const rel = path.relative(rootDir, full);
      if (rel.includes("target/") || rel.includes(".DS_Store")) return;
      return { path: rel, content: await readFile(full, "utf8") };
    }),
  );
  return files
    .filter((file) => file !== undefined)
    .reduce<Record<string, string>>((previousValue, currentValue) => {
      previousValue[currentValue.path] = currentValue.content;
      return previousValue;
    }, {});
};

// One file of a project read by `readProjectFiles`. Throws if the project has
// no such file.
export const projectFile = (files: Record<string, string>, path: string) => {
  const content = files[path];
  if (content === undefined) {
    throw new Error(`The project has no ${path}`);
  }
  return content;
};

// Rewrites one file of a project in place, e.g. to make its sources differ
// before sending it. Throws if the project has no such file.
export const editProjectFile = (
  files: Record<string, string>,
  path: string,
  edit: (content: string) => string,
) => {
  files[path] = edit(projectFile(files, path));
};
