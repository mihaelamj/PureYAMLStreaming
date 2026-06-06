#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDK_ID="${PUREYAML_STREAMING_WASM_SDK:-swift-6.3.2-RELEASE_wasm}"
SWIFT_SELECTOR="${PUREYAML_STREAMING_WASM_SWIFT_SELECTOR:-+6.3.2}"
PRODUCT="pureyaml-streaming-wasm-smoke"
SITE_DIR="$ROOT_DIR/WasmSite"
VENDOR_DIR="$SITE_DIR/vendor/browser_wasi_shim"

swift_command() {
  if command -v swiftly >/dev/null 2>&1; then
    swiftly run swift "$@" "$SWIFT_SELECTOR"
  else
    swift "$@"
  fi
}

if ! swift_command sdk list | grep -qx "$SDK_ID"; then
  echo "wasm: missing Swift SDK '$SDK_ID'" >&2
  echo "wasm: install the SDK or set PUREYAML_STREAMING_WASM_SDK" >&2
  exit 2
fi

swift_command build \
  --package-path "$ROOT_DIR" \
  --swift-sdk "$SDK_ID" \
  -c release \
  --product "$PRODUCT"

BIN_PATH="$(swift_command build \
  --package-path "$ROOT_DIR" \
  --swift-sdk "$SDK_ID" \
  -c release \
  --show-bin-path)"
WASM_PATH="$BIN_PATH/$PRODUCT.wasm"
STAGED_WASM="$SITE_DIR/$PRODUCT.wasm"

if command -v wasm-opt >/dev/null 2>&1; then
  wasm-opt -Oz --strip-debug --strip-producers "$WASM_PATH" -o "$STAGED_WASM"
else
  cp "$WASM_PATH" "$STAGED_WASM"
fi

gzip -9 -c "$STAGED_WASM" > "$STAGED_WASM.gz"

if command -v npm >/dev/null 2>&1; then
  TMP_NPM_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_NPM_DIR"' EXIT
  (
    cd "$TMP_NPM_DIR"
    npm init -y >/dev/null
    npm install @bjorn3/browser_wasi_shim@0.3.0 >/dev/null
  )
  rm -rf "$VENDOR_DIR"
  mkdir -p "$VENDOR_DIR"
  cp "$TMP_NPM_DIR/node_modules/@bjorn3/browser_wasi_shim/dist/"*.js "$VENDOR_DIR/"
else
  echo "wasm: npm is required to vendor browser_wasi_shim" >&2
  exit 2
fi

echo "WASM test site ready:"
echo "  $SITE_DIR/index.html"
echo "  $STAGED_WASM.gz"
echo
echo "Serve it with:"
echo "  bash scripts/serve-wasm-site.sh"
