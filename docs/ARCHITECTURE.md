# Streaming Architecture

PureYAMLStreaming separates three concerns:

1. `ChunkedUTF8Reader` pulls bounded byte chunks from a file or data source and
   tracks byte offsets plus line and column marks.
2. `ResumableDocumentScanner` consumes chunks, detects top-level YAML document
   boundaries, and emits one document source at a time.
3. `Parser` parses each emitted document through PureYAML and hands completed
   documents to the caller.

```mermaid
flowchart TD
    fileSource["File or Data"] --> chunkedReader["Chunked UTF8 Reader"]
    chunkedReader --> documentScanner["Resumable Document Scanner"]
    documentScanner --> pureParser["PureYAML Parser"]
    pureParser --> documentSink["Document Sink"]
```

## Why Document Streaming First

PureYAML's internal parser already avoids retaining the full token and event
arrays, but the public boundary is still a complete `String`. A fully resumable
YAML token scanner needs careful handling for quoted scalars, block scalars,
comments, indentation, CRLF, Unicode, tags, anchors, and merge keys.

Document streaming is the safe first milestone: it proves file/chunk IO,
document-at-a-time memory behavior, and API ergonomics without forking the YAML
grammar implementation.

## Future Event Streaming

The next scanner milestone should replace `ResumableDocumentScanner` with a
token-level scanner that can suspend and resume inside any YAML token. That
scanner can then feed a public event sink directly.

The intended final shape is:

```mermaid
flowchart TD
    bytes["Async Bytes"] --> utf8Reader["Chunked UTF8 Reader"]
    utf8Reader --> tokenScanner["Resumable Token Scanner"]
    tokenScanner --> eventParser["Token Event Parser"]
    eventParser --> eventSink["Event Sink"]
    eventParser --> documentComposer["Optional Document Composer"]
```
