#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
CLIENT_DIR="$PROJECT_ROOT/game/client"
RUNTIME_SOURCE_DIR="${CSJS_RUNTIME_SOURCE_DIR:-$PROJECT_ROOT/game/dist/runtime}"
RUNTIME_DIST_DIR="$CLIENT_DIR/dist/runtime"

artifacts=(
  xash.js
  xash.wasm
  filesystem_stdio.so
  libref_gles3compat.so
  client_emscripten_wasm32.wasm
  menu_emscripten_wasm32.wasm
  extras.pk3
)

for artifact in "${artifacts[@]}"; do
  if [[ ! -f "$RUNTIME_SOURCE_DIR/$artifact" ]]; then
    echo "Missing '$RUNTIME_SOURCE_DIR/$artifact'. Run 'make client' from the project root." >&2
    exit 1
  fi
done

rm -rf "$CLIENT_DIR/dist"
pnpm --dir "$CLIENT_DIR" exec tsc --project "$CLIENT_DIR/tsconfig.json"
node "$SCRIPT_DIR/prepare-runtime.mjs" "$RUNTIME_SOURCE_DIR" "$RUNTIME_DIST_DIR"
