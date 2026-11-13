#!/bin/sh
# The real rustc. For crates built for Wasm, replaces cargo's `-C metadata`
# value with one derived from the crate's name and version only.
REAL=$(ls /usr/local/rustup/toolchains/*/bin/rustc)
case " $* " in
  *" --target wasm32"*" --crate-name "*|*" --crate-name "*" --target wasm32"*)
    name=$(printf '%s\n' "$*" | sed -n 's/.*--crate-name \([^ ]*\).*/\1/p')
    stable=$(printf '%s %s' "$name" "$CARGO_PKG_VERSION" | sha256sum | cut -c1-16)
    n=$#; i=0
    while [ $i -lt $n ]; do
      a=$1; shift; i=$((i+1))
      case "$a" in metadata=*) a="metadata=$stable" ;; esac
      set -- "$@" "$a"
    done ;;
esac
exec "$REAL" "$@"
