# MASM builds run no project code, so they skip the build isolation

**Accepted** (2026-11-25). Supersedes [0006](0006-build-isolation.md) for MASM projects only: a Rust project is built as 0006 says until cargo leaves api-compile (`spec/remove-rust`, plan 08).

0006 isolates a build because compiling a Rust project runs that project's code (`build.rs`, procedural macros) as part of the build. A MASM project has no such code. `miden-assemble` parses its `miden-project.toml` and its modules, resolves their dependencies against the four packages compiled into the tool and against the project's own path dependencies, and writes one package. Nothing in the project is run, so nothing in it can write to disk, start a process, or open a connection. What 0006 builds to contain such code has nothing to contain here:

- **No build user, no one-at-a-time slot.** The tool runs as `api`, like the other helper tools. MASM builds have their own limiter (`ASSEMBLE_CONCURRENCY`, 4, and `ASSEMBLE_QUEUE_SIZE`, 16, then a `503`), apart from cargo's single slot, so a MASM build never waits behind a cargo build.
- **No warm cache, no view of it, no process sweep, no output checks.** The tool reads nothing outside the project and the packages compiled into it. The server writes the project to a fresh directory, names the package path outside the project root, and deletes the directory once the request is answered.
- **No retry, no second build.** An assembly takes some 20 ms and doesn't depend on the network. Its dev package carries the debug info and has the same procedure roots and commitment as a release assembly.

What is kept is what any parser of untrusted input needs:

- **Time.** One request's tools share a 90 s deadline (`ASSEMBLE_DEADLINE_MS`), the verifier's network call included, answered with a `504`: assembling takes milliseconds, so the deadline is for the verifier, which reads the resource from its network. Each tool also keeps the runner's own 60 s timeout.
- **Size.** The server's 1 MB limit on a request body bounds the project.
- **Confinement.** `miden-assemble` refuses a manifest that names a path outside the project root, a path the assembler would read as a URI, or a git dependency, and a project holding a symbolic link (`confine.rs`). It fails when a `miden-project.toml` sits above the project root, where the assembler would read it as a workspace.
- **Memory** is not bounded per build, only by the container's (6 GiB on `standard-2`): the helper-tool runner has no memory limit. Nothing measured so far comes near it.

## What remains exposed

The assembler is the input's only reader, and it runs as `api`, which owns the client stores. A bug in the assembler's parser that let crafted input run code would give that code what `api` can reach, which is more than `builder` can. This is the trade-off the decision makes: a fourth Rust program parsing untrusted text, against a second unprivileged user and the queue that goes with it for a build that runs no code. If such a bug is found, the fix is to give `miden-assemble` a user of its own, which needs no change to the routes.

## Considered Options

- **Run MASM builds through 0006's machinery.** Rejected: each would wait in cargo's single slot behind 1-10 s builds, and lay out and delete a 1.6 GB view it never reads, for a 20 ms assembly.
- **Assemble in the Node process.** Rejected: the assembler is a Rust library, and the helper tools are where the repo runs Rust ([0005](0005-cargo-miden-stays-off-the-helper-tool-runner.md) keeps only cargo-miden off their runner).
