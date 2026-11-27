#!/usr/bin/env bash
# Makes apps/api-compile/miden-standards a verbatim copy of the MASM of the
# `miden-standards` crate the helper tools lock (crates/Cargo.lock), and
# regenerates packages/test-utils/src/standard-fixtures.ts from that crate, then
# checks `standard-components` lists every component the copy holds.
# Run it after every bump of the crate, then the api-compile suite.
#
# Reads the crate from cargo's registry: `cargo metadata` downloads it first
# if it isn't there yet. Touches no network beyond that.
set -euo pipefail

api_compile=$(cd "$(dirname "$0")/.." && pwd)
repo=$(cd "$api_compile/../.." && pwd)
crates=$api_compile/crates
mirror=$api_compile/miden-standards
fixtures=$repo/packages/test-utils/src/standard-fixtures.ts

# The crate's source directory and version, as the workspace resolves it.
read -r version crate_dir < <(
  cargo metadata --format-version 1 --manifest-path "$crates/Cargo.toml" |
    node -e '
      let input = "";
      process.stdin.on("data", (chunk) => (input += chunk));
      process.stdin.on("end", () => {
        const found = JSON.parse(input).packages.filter((p) => p.name === "miden-standards");
        if (found.length !== 1) {
          console.error(`expected one miden-standards package, found ${found.length}`);
          process.exit(1);
        }
        const [pkg] = found;
        console.log(pkg.version, require("node:path").dirname(pkg.manifest_path));
      });
    '
)

rm -rf "$mirror/asm"
cp -R "$crate_dir/asm" "$mirror/asm"
echo "$version" >"$mirror/VERSION"

cargo run --release --quiet --manifest-path "$crates/Cargo.toml" \
  -p generate-fixtures --bin standard-fixtures -- \
  --standards-dir "$mirror" --out "$fixtures"
pnpm --dir "$repo" exec oxfmt "$fixtures" >/dev/null
# The standard components miden-import names and the verifier refuses to verify
# alone are every one the copy holds: fails on one they don't list.
cargo test --release --quiet --manifest-path "$crates/Cargo.toml" -p standard-components

echo "miden-standards $version copied to $mirror; fixtures written to $fixtures"
