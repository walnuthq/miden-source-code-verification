import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

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
