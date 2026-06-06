import Foundation

extension PureYAMLStreaming {
    /// Bounded UTF-8 chunk reader with byte-accurate mark tracking.
    public struct ChunkedUTF8Reader: Sendable {
        private var source: Source
        private let chunkSize: Int
        private var pendingBytes: [UInt8] = []
        private var markStorage = StreamingMark.start
        private var previousWasCarriageReturn = false

        public init(fileURL: URL, chunkSize: Int = 64 * 1024) throws {
            guard chunkSize > 0 else {
                throw StreamingError.invalidChunkSize(chunkSize)
            }
            self.source = .file(try FileHandle(forReadingFrom: fileURL))
            self.chunkSize = chunkSize
        }

        public init(data: Data, chunkSize: Int = 64 * 1024) throws {
            guard chunkSize > 0 else {
                throw StreamingError.invalidChunkSize(chunkSize)
            }
            self.source = .data(data, offset: 0)
            self.chunkSize = chunkSize
        }

        public var mark: StreamingMark {
            markStorage
        }

        /// Reads the next valid UTF-8 chunk. A multibyte scalar split at a chunk
        /// boundary is carried to the next read.
        public mutating func readChunk() throws -> String? {
            while true {
                let bytes = try readRawBytes()
                if bytes.isEmpty {
                    guard !pendingBytes.isEmpty else {
                        return nil
                    }
                    return try decodePendingAtEnd()
                }

                let combined = pendingBytes + bytes
                let splitIndex = validPrefixLength(in: combined)
                let prefix = Array(combined.prefix(splitIndex))
                pendingBytes = Array(combined.dropFirst(splitIndex))

                guard pendingBytes.count < 4 else {
                    throw StreamingError.invalidUTF8(
                        line: markStorage.line,
                        column: markStorage.column,
                        index: markStorage.index,
                    )
                }

                guard !prefix.isEmpty else {
                    continue
                }

                guard let chunk = String(bytes: prefix, encoding: .utf8) else {
                    throw StreamingError.invalidUTF8(
                        line: markStorage.line,
                        column: markStorage.column,
                        index: markStorage.index,
                    )
                }
                advanceMark(over: chunk)
                return chunk
            }
        }

        private mutating func readRawBytes() throws -> [UInt8] {
            switch source {
            case let .file(handle):
                let data = try handle.read(upToCount: chunkSize) ?? Data()
                return Array(data)
            case let .data(data, offset):
                guard offset < data.count else {
                    return []
                }
                let end = min(offset + chunkSize, data.count)
                source = .data(data, offset: end)
                return Array(data[offset ..< end])
            }
        }

        private mutating func decodePendingAtEnd() throws -> String? {
            guard let chunk = String(bytes: pendingBytes, encoding: .utf8) else {
                throw StreamingError.invalidUTF8(
                    line: markStorage.line,
                    column: markStorage.column,
                    index: markStorage.index,
                )
            }
            pendingBytes.removeAll(keepingCapacity: true)
            advanceMark(over: chunk)
            return chunk.isEmpty ? nil : chunk
        }

        private func validPrefixLength(in bytes: [UInt8]) -> Int {
            guard !bytes.isEmpty else {
                return 0
            }

            var index = bytes.count
            let lowerBound = max(0, bytes.count - 4)
            while index >= lowerBound {
                if String(bytes: bytes.prefix(index), encoding: .utf8) != nil {
                    return index
                }
                if index == 0 {
                    break
                }
                index -= 1
            }
            return 0
        }

        private mutating func advanceMark(over chunk: String) {
            for scalar in chunk.unicodeScalars {
                markStorage.index += scalar.utf8.count
                switch scalar.value {
                case 13:
                    markStorage.line += 1
                    markStorage.column = 1
                    previousWasCarriageReturn = true
                case 10:
                    if previousWasCarriageReturn {
                        previousWasCarriageReturn = false
                    } else {
                        markStorage.line += 1
                        markStorage.column = 1
                    }
                default:
                    previousWasCarriageReturn = false
                    markStorage.column += 1
                }
            }
        }
    }
}

extension PureYAMLStreaming.ChunkedUTF8Reader {
    private enum Source: @unchecked Sendable {
        case file(FileHandle)
        case data(Data, offset: Int)
    }
}
