import rust from "@shikijs/langs/rust";
import toml from "@shikijs/langs/toml";
import githubDark from "@shikijs/themes/github-dark";
import githubLight from "@shikijs/themes/github-light";
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

import type { SourcePackage } from "@/lib/api-registry.server";
import { packageProcedures } from "@/lib/procedure-signatures";
import {
  filterSourceFiles,
  findEntryFile,
  type PackageSources,
} from "@/lib/source-files";
import { formatUtcTimestamp } from "@/lib/timestamps";

// Created on first use and kept for the life of the server instance (Node
// process or Worker isolate): compiling the grammars is the expensive part.
// Only the two languages and themes the pages need are bundled, and the
// JavaScript regex engine replaces Shiki's default Oniguruma WASM one, which
// Workers can't instantiate from bytes.
let highlighter: Promise<HighlighterCore> | undefined;

function getHighlighter() {
  highlighter ??= createHighlighterCore({
    themes: [githubLight, githubDark],
    langs: [rust, toml],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighter;
}

// A package's sources as its Source Code section renders them: the displayed
// files, highlighted here so no highlighter ships to the browser, plus every
// raw file for the download. The package's compiled `.masp` is left out.
// Both themes are emitted as CSS variables only, picked in index.css by the
// app's theme. Shiki escapes the source text, so the HTML is safe to inject even
// though anyone can submit sources for verification.
export async function loadPackageSources(
  { name, digest, files, manifest }: SourcePackage,
  // The record verifying the package against the resource: an account's
  // component, or the note itself.
  { createdAt, source }: { createdAt: string; source: string },
): Promise<PackageSources> {
  const { codeToHtml } = await getHighlighter();
  const displayedFiles = filterSourceFiles(files);
  const entryPath = findEntryFile(displayedFiles, name);
  return {
    name,
    digest,
    procedures: packageProcedures({ manifest, files, entryPath }),
    verifiedAt: formatUtcTimestamp(createdAt),
    source,
    // Only what the page shows; the manifest's `kind` stays on the server.
    dependencies: manifest.dependencies.map(({ name, version, digest }) => ({
      name,
      version,
      digest,
    })),
    files: Object.keys(displayedFiles)
      .sort()
      .map((path) => ({
        path,
        html: codeToHtml(displayedFiles[path], {
          lang: path.endsWith(".rs") ? "rust" : "toml",
          themes: { light: "github-light", dark: "github-dark" },
          defaultColor: false,
        }),
      })),
    entryPath,
    rawFiles: files,
  };
}
