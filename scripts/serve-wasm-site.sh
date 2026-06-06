#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${1:-8080}"

cd "$ROOT_DIR/WasmSite"
python3 -m http.server "$PORT"
