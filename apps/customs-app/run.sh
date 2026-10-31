#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  bun install
fi
if [ "${1:-}" = "dev" ]; then
  exec bun run dev
fi
bun run build
exec bun run start
