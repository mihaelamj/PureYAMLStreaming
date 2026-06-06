# PureYAMLStreaming

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

## Relationship To PureYAML

`PureYAML` remains the dependency-free core package. This package is the
incubator for file, byte, and async streaming APIs. Stable pieces can move back
into PureYAML later once the API and memory behavior are proven.
