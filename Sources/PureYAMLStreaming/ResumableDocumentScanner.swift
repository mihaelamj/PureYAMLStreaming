import Foundation

extension PureYAMLStreaming {
    /// Resumable document-boundary scanner.
    ///
    /// This is intentionally a document-token scanner, not yet a YAML grammar
    /// token scanner. It proves chunked input and document-at-a-time parsing
    /// while the lower-level token scanner remains incubating.
    public struct ResumableDocumentScanner: Sendable {
        private var pendingLine = ""
        private var currentDocument = ""
        private var hasCurrentDocumentContent = false
        private var line = 1

        public init() {}

        public mutating func consume(_ chunk: String) throws -> [String] {
            var documents: [String] = []
            pendingLine.append(chunk)

            while let newlineRange = pendingLine.rangeOfCharacter(from: .newlines) {
                let lineText = String(pendingLine[..<newlineRange.lowerBound])
                let newline = String(pendingLine[newlineRange])
                pendingLine.removeSubrange(..<newlineRange.upperBound)
                try consumeLine(lineText + newline, documents: &documents)
                line += 1
            }

            return documents
        }

        public mutating func consumeToken(_ chunk: String) throws -> [StreamingToken] {
            try consume(chunk).map(StreamingToken.documentSource)
        }

        public mutating func finish() throws -> String? {
            if !pendingLine.isEmpty {
                var ignored: [String] = []
                try consumeLine(pendingLine, documents: &ignored)
                pendingLine.removeAll(keepingCapacity: true)
            }
            defer {
                currentDocument.removeAll(keepingCapacity: true)
                hasCurrentDocumentContent = false
            }
            return currentDocument.isEmpty ? nil : currentDocument
        }

        private mutating func consumeLine(
            _ sourceLine: String,
            documents: inout [String],
        ) throws {
            if isDocumentStart(sourceLine), hasCurrentDocumentContent {
                documents.append(currentDocument)
                currentDocument = sourceLine
                hasCurrentDocumentContent = true
                return
            }

            currentDocument.append(sourceLine)
            if hasSemanticContent(sourceLine) {
                hasCurrentDocumentContent = true
            }
        }

        private func isDocumentStart(_ sourceLine: String) -> Bool {
            let trimmedNewline = sourceLine.trimmingCharacters(in: .newlines)
            guard trimmedNewline.hasPrefix("---") else {
                return false
            }
            let markerEnd = trimmedNewline.index(trimmedNewline.startIndex, offsetBy: 3)
            if markerEnd != trimmedNewline.endIndex {
                let next = trimmedNewline[markerEnd]
                guard next == " " || next == "\t" || next == "#" else {
                    return false
                }
            }
            return trimmedNewline.prefix(3) == "---"
        }

        private func hasSemanticContent(_ sourceLine: String) -> Bool {
            let trimmed = sourceLine.trimmingCharacters(in: .whitespacesAndNewlines)
            return !trimmed.isEmpty && !trimmed.hasPrefix("#")
        }
    }
}
