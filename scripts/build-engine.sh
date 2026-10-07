#!/usr/bin/env bash
# Builds the Doom engine (engine/) to WebAssembly and copies it into the arena
# Worker's static assets. Needs Emscripten (emcc/emmake/emconfigure on PATH,
# e.g. `source /path/to/emsdk/emsdk_env.sh`) plus autoconf, automake, make.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
build="$(mktemp -d)"
trap 'rm -rf "$build"' EXIT

# Build out of tree so autotools output never lands in the repo.
cp -R "$root/engine/." "$build/"
cd "$build"
emconfigure autoreconf -fi
ac_cv_exeext=".html" emconfigure ./configure --host=none-none-none
emmake make -j"$(nproc 2>/dev/null || echo 4)"

mkdir -p "$root/apps/arena/public/engine"
cp src/websockets-doom.js src/websockets-doom.wasm "$root/apps/arena/public/engine/"
echo "Engine copied to apps/arena/public/engine/"
