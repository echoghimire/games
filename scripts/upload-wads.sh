#!/usr/bin/env bash
# Downloads the Freedoom game data (BSD licensed) and uploads the WADs to the
# R2 bucket the arena Worker serves them from. Pass --local to fill the local
# dev bucket used by `npm run dev:arena` instead of the real one.
set -euo pipefail

VERSION=0.13.0
BUCKET=ktm-arena-wads
root="$(cd "$(dirname "$0")/.." && pwd)"
dir="$root/wads/$VERSION"
mode="--remote"
[[ "${1:-}" == "--local" ]] && mode="--local"

mkdir -p "$dir"
cd "$dir"
base="https://github.com/freedoom/freedoom/releases/download/v$VERSION"
[[ -f freedoom1.wad ]] || { curl -fL -o freedoom.zip "$base/freedoom-$VERSION.zip" && unzip -jo freedoom.zip '*.wad' && rm freedoom.zip; }
[[ -f freedm.wad ]] || { curl -fL -o freedm.zip "$base/freedm-$VERSION.zip" && unzip -jo freedm.zip '*.wad' && rm freedm.zip; }

for wad in freedm.wad freedoom1.wad freedoom2.wad; do
  npx wrangler r2 object put "$BUCKET/$VERSION/$wad" --file "$wad" \
    --content-type application/octet-stream -c "$root/apps/arena/wrangler.jsonc" $mode $([[ $mode == --local ]] && echo --persist-to "$root/.wrangler/state")
done
