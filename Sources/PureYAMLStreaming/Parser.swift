import Foundation
import PureYAML

extension PureYAMLStreaming {
    /// Chunked YAML stream parser that emits complete documents as they finish.
    public struct Parser: Sendable {
        public var chunkSize: Int
        public var pureParser: PureYAML.Parsing.Parser

        public init(
            chunkSize: Int = 64 * 1024,
            pureParser: PureYAML.Parsing.Parser = .init(),
        ) {
            self.chunkSize = chunkSize
            self.pureParser = pureParser
        }

        /// Parses documents from a file and calls `body` once per completed document.
        ///
        /// This API retains only the current source document, parser state, and any
        /// values PureYAML must build for that document. It does not retain prior
        /// documents unless the caller does.
        public func parseDocuments(
            from url: URL,
            _ body: (PureYAML.Stream.Document) throws -> Void,
        ) throws {
            var reader = try ChunkedUTF8Reader(fileURL: url, chunkSize: chunkSize)
            try parseDocuments(from: &reader, body)
        }

        /// Parses documents from UTF-8 data and calls `body` once per completed document.
        public func parseDocuments(
            data: Data,
            _ body: (PureYAML.Stream.Document) throws -> Void,
        ) throws {
            var reader = try ChunkedUTF8Reader(data: data, chunkSize: chunkSize)
            try parseDocuments(from: &reader, body)
        }

        /// Convenience API that collects every streamed document.
        ///
        /// This forfeits the streaming memory benefit by retaining all documents.
        public func collectDocuments(from url: URL) throws -> [PureYAML.Stream.Document] {
            var documents: [PureYAML.Stream.Document] = []
            try parseDocuments(from: url) { document in
                documents.append(document)
            }
            return documents
        }

        /// Convenience API that collects every streamed document from data.
        public func collectDocuments(data: Data) throws -> [PureYAML.Stream.Document] {
            var documents: [PureYAML.Stream.Document] = []
            try parseDocuments(data: data) { document in
                documents.append(document)
            }
            return documents
        }

        private func parseDocuments(
            from reader: inout ChunkedUTF8Reader,
            _ body: (PureYAML.Stream.Document) throws -> Void,
        ) throws {
            var scanner = ResumableDocumentScanner()
            var nextIndex = 0

            while let chunk = try reader.readChunk() {
                let completed = try scanner.consume(chunk)
                for source in completed {
                    try emit(source, index: &nextIndex, body)
                }
            }

            if let source = try scanner.finish(), !source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                try emit(source, index: &nextIndex, body)
            }
        }

        private func emit(
            _ source: String,
            index: inout Int,
            _ body: (PureYAML.Stream.Document) throws -> Void,
        ) throws {
            let documents = try pureParser.parseStream(source)
            for document in documents {
                try body(.init(index: index, value: document.value))
                index += 1
            }
        }
    }
}
