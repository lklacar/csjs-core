#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
RUNTIME_DIR="$PROJECT_ROOT/game/dist/runtime"

rm -rf "$RUNTIME_DIR"
docker build \
  --file "$PROJECT_ROOT/game/client/Dockerfile" \
  --target runtime-export \
  --output "type=local,dest=$RUNTIME_DIR" \
  "$PROJECT_ROOT"

CSJS_RUNTIME_SOURCE_DIR="$RUNTIME_DIR" pnpm --dir "$PROJECT_ROOT/game/client" build

echo "CSJS WebAssembly client build completed."
