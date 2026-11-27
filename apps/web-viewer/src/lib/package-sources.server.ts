import toml from "@shikijs/langs/toml";
import githubDark from "@shikijs/themes/github-dark";
import githubLight from "@shikijs/themes/github-light";
import type { Package } from "miden-source-code-verification-utils/api-registry";
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

import { masmGrammar } from "@/lib/masm/grammar";
import { packageProcedures } from "@/lib/procedure-signatures";
import { filterSourceFiles, findEntryFile, type PackageSources } from "@/lib/source-files";
import { formatUtcTimestamp } from "@/lib/timestamps";

// Created on first use and kept for the life of the server instance (Node
// process or Worker isolate): compiling the grammars is the expensive part.
// Only the two languages and two themes the pages need are bundled (MASM's
// grammar is this repo's own, `masm/grammar.ts`), and the JavaScript regex
// engine replaces Shiki's default Oniguruma WASM one, which Workers can't
// instantiate from bytes.
let highlighter: Promise<HighlighterCore> | undefined;

function getHighlighter() {
  highlighter ??= createHighlighterCore({
    themes: [githubLight, githubDark],
    langs: [masmGrammar, toml],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighter;
}

// The language a displayed file is highlighted as: the only other files shown
// are manifests (see `isDisplayedSourceFile`).
const languageOf = (path: string) => (path.endsWith(".masm") ? "masm" : "toml");

// A package's sources as its Source Code section renders them: the displayed
// files, highlighted here so no highlighter ships to the browser, plus every
// raw file for the download.
// Both themes are emitted as CSS variables only, picked in index.css by the
// app's theme. Shiki escapes the source text, so the HTML is safe to inject even
// though anyone can submit sources for verification.
export async function loadPackageSources(
  { name, commitment, files, manifest, readOnly, parameters }: Package,
  // The record verifying the package against the resource: an account's
  // component, or the note itself.
  { createdAt, source }: { createdAt: string; source: string },
): Promise<PackageSources> {
  const { codeToHtml } = await getHighlighter();
  const displayedFiles = filterSourceFiles(files);
  const entryPath = findEntryFile(displayedFiles, name);
  return {
    name,
    commitment,
    procedures: packageProcedures({ manifest, readOnly, parameters }),
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
          lang: languageOf(path),
          themes: { light: "github-light", dark: "github-dark" },
          defaultColor: false,
        }),
      })),
    entryPath,
    rawFiles: files,
  };
}
