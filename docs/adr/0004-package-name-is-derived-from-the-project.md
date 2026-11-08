# api-compile's answers carry no package name; the registry derives it from the project

The registry stores each package under its name, the `[package]` name of the project's `Cargo.toml`. It reads that name itself: `openProject` in `packages/utils/src/project.ts` validates the submitted project and returns its name, and both apps open the project through it. Adding `name` to api-compile's answers was proposed in PR #89 and again in PR #93, and rejected both times: the registry already holds the project it forwarded, so a `name` on the wire would be a second source for a fact both sides read from the same file.

## Considered Options

- **api-compile returns `name` with the package.** Rejected twice, PRs #89 and #93.
