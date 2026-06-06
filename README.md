# PureYAMLStreaming

[![macOS](https://img.shields.io/github/actions/workflow/status/mihaelamj/PureYAMLStreaming/macos.yml?branch=main&label=macOS)](https://github.com/mihaelamj/PureYAMLStreaming/actions/workflows/macos.yml)
[![Linux](https://img.shields.io/github/actions/workflow/status/mihaelamj/PureYAMLStreaming/linux.yml?branch=main&label=Linux)](https://github.com/mihaelamj/PureYAMLStreaming/actions/workflows/linux.yml)
[![Windows](https://img.shields.io/github/actions/workflow/status/mihaelamj/PureYAMLStreaming/windows.yml?branch=main&label=Windows)](https://github.com/mihaelamj/PureYAMLStreaming/actions/workflows/windows.yml)
[![WASM](https://img.shields.io/github/actions/workflow/status/mihaelamj/PureYAMLStreaming/wasm.yml?branch=main&label=WASM)](https://github.com/mihaelamj/PureYAMLStreaming/actions/workflows/wasm.yml)
[![WASM Site](https://img.shields.io/github/actions/workflow/status/mihaelamj/PureYAMLStreaming/wasm-site.yml?branch=main&label=WASM%20Site)](https://github.com/mihaelamj/PureYAMLStreaming/actions/workflows/wasm-site.yml)

Experimental full-streaming incubator for PureYAML.

This package is intentionally separate from `PureYAML` while the chunked input,
document streaming, and eventual event streaming APIs settle. It depends on
PureYAML for the stable model and parser semantics, then adds streaming input
adapters around that stable core.

## Status

Prototype.

The current implementation streams YAML input in chunks, detects
document-boundary candidates, and emits one parsed `PureYAML.Stream.Document` at
a time. That gives bounded memory for multi-document streams where each document
fits in memory.

It is not yet a token-level YAML scanner. A future milestone will replace the
document-boundary scanner with a resumable token scanner that can feed
event-level consumers directly.

## Memory Contract

- `parseDocuments` is bounded by the largest current document plus parser state.
- `collectDocuments` is a convenience helper and retains all returned documents.
- Anchors, aliases, merge keys, and `PureYAML.Model.Value` construction can
  require retaining semantic state until the current document is complete.
- Future event-level APIs should be lower memory than document-level APIs, but
  they still cannot promise constant memory for every YAML feature.

## Example

```swift
import Foundation
import PureYAMLStreaming

let url = URL(fileURLWithPath: "stream.yaml")
let parser = PureYAMLStreaming.Parser()

try parser.parseDocuments(from: url) { document in
    print("document", document.index, document.value)
}
```

## WASM Browser Smoke Site

Live site:

`https://mihaelamj.github.io/PureYAMLStreaming/`

Build the Swift WASI smoke executable and copy it into the static test site:

```sh
bash scripts/build-wasm-site.sh
```

Serve the site locally:

```sh
bash scripts/serve-wasm-site.sh
```

Then open `http://localhost:8080` and click **Run WASM Test**. The page loads
`pureyaml-streaming-wasm-smoke.wasm`, runs a chunked document-stream parse in
the browser through a WASI shim, captures stdout, and renders pass/fail.

## Relationship To PureYAML

`PureYAML` remains the dependency-free core package. This package is the
incubator for file, byte, and async streaming APIs. Stable pieces can move back
into PureYAML later once the API and memory behavior are proven.
