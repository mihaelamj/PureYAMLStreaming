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

## WASM Browser Benchmark Site

Live site:

`https://mihaelamj.github.io/PureYAMLStreaming/`

Build the Swift WASI benchmark executable and copy it into the static test site:

```sh
bash scripts/build-wasm-site.sh
```

The build script requires `npm` so it can stage the pinned browser WASI shim as
a local `WasmSite/vendor/` asset. The deployed page does not import the shim from
a runtime CDN.

Serve the site locally:

```sh
bash scripts/serve-wasm-site.sh
```

Then open `http://localhost:8080` and click **Run Buffered Benchmark** or
**Run True Streaming Benchmark**. The page loads
`pureyaml-streaming-wasm-smoke.wasm`, lets you choose from 10+ public
multi-megabyte YAML files, and reports fetch time, Swift parse time,
throughput, document count, stdout JSON, and a timestamped run log.

Inside Swift, `SwiftWASIHTTPClient.HostHTTPClient` models that host-provided
HTTP response. The benchmark then parses the response body through
`PureYAMLStreaming.ChunkedUTF8Reader` and `ResumableDocumentScanner`, reporting
chunk count, chunk size, scanner document-source emissions, fetch time, parse
time, throughput, document count, and stdout JSON.

The buffered benchmark fetches the selected YAML file in JavaScript before
invoking the WASM guest. It keeps `SwiftWASIHTTPClient.HostHTTPClient` in the
loop to model the host-response boundary.

The experimental true-streaming benchmark requires `crossOriginIsolated`,
`SharedArrayBuffer`, `Worker`, and `Atomics.wait`. A same-origin COOP/COEP
service worker enables that mode on localhost and GitHub Pages. In this path,
the main thread reads `fetch().body` with a `ReadableStream` reader, writes each
network chunk into a `SharedArrayBuffer` ring buffer, and a Worker-owned WASI
runtime serves those bytes through a blocking custom stdin `fd_read`. Swift then
parses stdin with `ChunkedUTF8Reader` without calling `readDataToEndOfFile()`.

## Relationship To PureYAML

`PureYAML` remains the dependency-free core package. This package is the
incubator for file, byte, and async streaming APIs. Stable pieces can move back
into PureYAML later once the API and memory behavior are proven.
