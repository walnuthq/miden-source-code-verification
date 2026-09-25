import { strToU8, type Zippable, zipSync } from "fflate";

// A package's sources as a zip, every file under a `<package name>/` folder so
// extracting it doesn't spill into the current directory. Loaded on demand by
// the Download Sources button, which keeps fflate out of the page's bundle.
export function zipSources(
  packageName: string,
  files: Record<string, string>,
): Uint8Array {
  const entries: Zippable = {};
  for (const [path, content] of Object.entries(files)) {
    entries[`${packageName}/${path}`] = strToU8(content);
  }
  return zipSync(entries);
}
