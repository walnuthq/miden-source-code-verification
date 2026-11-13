#!/usr/bin/env bash
# Lays the image's warm cache out as a view one build can start in.
#
#   lay-out-warm-cache <warm cache> <target dir> <cargo home> <uid:gid>
#
# <warm cache> holds `target` and `cargo-home`, root's and read-only to
# everyone else; the two other directories are replaced with a view of them
# for the build user <uid:gid>. Run as root: by the Dockerfile, for the view
# the image ships, and by the server after each build (compile.ts).
#
# A view is links to what a build only reads and copies of the rest:
# - hard links to the compiled dependencies under `target` and the downloaded
#   crates under `cargo-home`. Those are most of the cache's bytes, and a build
#   never changes one in place: rustc and the linker replace an output they
#   rebuild, which the build user may do in its own directories;
# - one symbolic link per crate to its sources. They are four fifths of the
#   cache's entries, so each crate's directory is shared whole;
# - copies of everything else (lock files, fingerprints, build script output,
#   the registry index), which cargo opens for writing.
# A linked file stays root's: the build user can read it and replace it in its
# own directory, never write it, so the warm cache can't change. Only a file
# that is root's and that no one else may write is hard-linked, whatever the
# test says: a link to anything else would be a way into the warm cache. The
# caller checks the same of the tree the symbolic links lead into.
set -euo pipefail
warm_cache=$1 target_dir=$2 cargo_home=$3 owner=$4

# lay_out <source> <destination> <symlink parents> <find test for hard links…>
# <symlink parents> is a `find` path pattern for the directories whose entries
# are each shared through a symbolic link (empty: none).
# 1. hard-link the tree, which also creates the directories with their modes
#    and timestamps. With directories to symlink, the directories outside them
#    are made first and `cp` gets the files there one by one instead of the
#    whole tree; each directory to symlink is made the build user's, holding
#    one link per entry: cargo unpacks a crate it downloads next to them;
# 2. replace every link that isn't to stay one with a copy (`cp -a` keeps the
#    timestamps cargo's fingerprints need). The link goes first, symbolic
#    links included: `cp` won't copy a file over a link to itself, and a
#    shared symbolic link would get its owner changed in the warm cache;
# 3. give the build user the directories and the copies.
lay_out() (
  source=$1 destination=$2 symlink_parents=$3
  shift 3
  linked=(-type f -user 0 ! -perm /022 "(" "$@" ")")
  copied=(! -type d ! "(" "${linked[@]}" ")")
  outside=(-path "$symlink_parents" -type d -prune -o)
  rm -rf "$destination"
  mkdir "$destination"
  cd "$source"
  if [[ -z $symlink_parents ]]; then
    cp -al . "$destination"
  else
    find . "${outside[@]}" -type d -print0 |
      (cd "$destination" && xargs -0 -r mkdir -p)
    find . "${outside[@]}" ! -type d -print0 |
      xargs -0 -r cp -al --parents -t "$destination"
    find . -path "$symlink_parents" -type d -prune -printf "%P\0" |
      while IFS= read -r -d "" dir; do
        mkdir -p "$destination/$dir"
        chown "$owner" "$destination/$dir"
        find "$source/$dir" -mindepth 1 -maxdepth 1 -print0 |
          xargs -0 -r ln -s -t "$destination/$dir"
      done
  fi
  find . "${outside[@]}" "${copied[@]}" -print0 |
    (cd "$destination" && xargs -0 -r rm -f)
  find . "${outside[@]}" "${copied[@]}" -print0 |
    xargs -0 -r cp -a --parents -t "$destination"
  find . "${outside[@]}" ! "(" "${linked[@]}" ")" -print0 |
    (cd "$destination" && xargs -0 -r chown -h "$owner")
)

lay_out "$warm_cache/target" "$target_dir" "" \
  -name "*.rlib" -o -name "*.rmeta" -o -name "*.so" -o -name build_script_build
# One directory per registry under `registry/src`, one directory per crate in
# it.
lay_out "$warm_cache/cargo-home" "$cargo_home" "./registry/src/*" \
  -path "./registry/cache/*"
