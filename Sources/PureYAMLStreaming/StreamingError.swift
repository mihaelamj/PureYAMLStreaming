import PureYAML

extension PureYAMLStreaming {
    /// Errors from the chunked streaming layer before or around PureYAML parsing.
    public enum StreamingError: Error, Equatable, Sendable, CustomStringConvertible {
        case invalidUTF8(line: Int, column: Int, index: Int)
        case invalidChunkSize(Int)
        case nestedDocumentStart(line: Int, column: Int)

        public var description: String {
            switch self {
            case let .invalidUTF8(line, column, index):
                "invalid UTF-8 at line \(line), column \(column), byte \(index)"
            case let .invalidChunkSize(size):
                "chunk size must be greater than zero, got \(size)"
            case let .nestedDocumentStart(line, column):
                "document start marker found inside an open collection at line \(line), column \(column)"
            }
        }
    }
}
