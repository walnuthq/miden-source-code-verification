#!/usr/bin/env bash
# Reads into the page cache what the first build after a container start reads.
#
#   preload-first-build <target dir> <cargo home>
#
# A container starts with nothing of the image in memory, and the first build
# then reads about 510 MB off a cold disk (this script, which reads whole
# files, about 700 MiB): the compiler (rustc's two shared
# libraries are half of it), the host's standard library, which every build
# script and procedural macro links, cargo-miden, and the view of the warm
# cache at <target dir> and <cargo home>. The server runs this once at
# startup, so that a build that comes a few seconds later finds those files in
# memory, and ends it when the first build starts (compile.ts). It only reads:
# run as root, at the lowest CPU and disk priority, it changes nothing.
#
# The list follows what a counter-contract release build was measured to read
# (ADR 0006, step seven), not everything a build may read: the dev-profile
# dependencies the image still warms and the toolchain's other tools stay cold. A path that isn't
# there is skipped; reading nothing at all is the one failure.
set -uo pipefail
target_dir=$1 cargo_home=$2

files() {
  for toolchain in "${RUSTUP_HOME:-}"/toolchains/*; do
    printf '%s\0' "$toolchain/bin/cargo" "$toolchain/bin/rustc"
    find "$toolchain/lib" -maxdepth 1 -type f -name "*.so*" -print0
    # Only the host's directory has a `bin`: its linkers, next to its
    # standard library.
    for host_bin in "$toolchain"/lib/rustlib/*/bin; do
      find "$host_bin" "${host_bin%/bin}/lib" -type f -print0
    done
  done
  for tool in rustup cargo-miden miden-package-metadata; do
    if path=$(command -v "$tool"); then
      printf '%s\0' "$path"
    fi
  done
  # The release profile's half of the view: the Wasm dependencies a project
  # compiles against, the procedural macros it loads, and the small files
  # cargo checks every dependency's freshness with.
  find "$target_dir/wasm32-wasip2/release" -type f \
    "(" -name "*.rmeta" -o -name "*.rlib" ")" -print0
  find "$target_dir/release" -type f -name "*.so" -print0
  find "$target_dir/release" "$target_dir/wasm32-wasip2/release" -type f \
    ! -name "*.rmeta" ! -name "*.rlib" ! -name "*.so" \
    ! -name build_script_build -print0
  find "$cargo_home/.global-cache" "$cargo_home/registry/index" -type f -print0
  # Each crate's manifest, through the view's symbolic link to its sources.
  find -L "$cargo_home/registry/src" -mindepth 3 -maxdepth 3 \
    -name Cargo.toml -print0
}

# The whole script, the walks included, at the lowest priority; the disk's
# only where its scheduler has an idle class to give.
renice -n 19 $$ >/dev/null 2>&1
ionice -c 3 -p $$ 2>/dev/null
bytes=$(files 2>/dev/null | xargs -0 -r cat 2>/dev/null | wc -c)
if ((bytes == 0)); then
  echo "nothing to read under ${RUSTUP_HOME:-an unset RUSTUP_HOME}, $target_dir or $cargo_home" >&2
  exit 1
fi
echo "$bytes"
