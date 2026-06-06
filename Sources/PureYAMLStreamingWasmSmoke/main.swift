import Foundation
import PureYAML
import PureYAMLStreaming
import WASIHTTPClient

struct SmokeResult: Encodable {
    var ok: Bool
    var transport: String
    var httpStatusCode: Int?
    var inputByteCount: Int
    var chunkSize: Int
    var chunkCount: Int
    var maxChunkByteCount: Int
    var stdinReadCount: Int
    var maxStdinReadByteCount: Int
    var scannerDocumentSourceCount: Int
    var documentCount: Int
    var firstName: String?
    var lastName: String?
    var parseMilliseconds: Double
    var message: String
}

struct ParseStats {
    var inputByteCount = 0
    var chunkCount = 0
    var maxChunkByteCount = 0
    var stdinReadCount = 0
    var maxStdinReadByteCount = 0
    var scannerDocumentSourceCount = 0
    var documentCount = 0
    var firstName: String?
    var lastName: String?
}

let fallbackYAML = Data(
    """
    ---
    name: browser-0
    enabled: true
    nested:
      index: 0
    ---
    name: browser-1
    enabled: false
    nested:
      index: 1
    ---
    name: browser-2
    enabled: true
    nested:
      index: 2
    """.utf8,
)

do {
    let arguments = Array(CommandLine.arguments.dropFirst())
    let isStreamingStdin = arguments.first == "--stream-stdin"
    let transport: String
    let statusCode: Int?
    let stats: ParseStats
    let chunkSize = 31
    let parseStart = Date()

    if isStreamingStdin {
        statusCode = arguments.dropFirst().dropFirst().first.flatMap(Int.init) ?? 200
        transport = "SharedArrayBuffer fd_read stdin"
        stats = try parseInstrumentedDocuments(fileHandle: FileHandle.standardInput, chunkSize: chunkSize)
    } else if let hostRequestURL = arguments.first.flatMap(URL.init(string:)) {
        let hostStatusCode = arguments.dropFirst().first.flatMap(Int.init)
        let hostBody = FileHandle.standardInput.readDataToEndOfFile()
        let responseStatusCode = hostStatusCode ?? 200
        let client = HostHTTPClient { request in
            guard request.method == .get else {
                throw HTTPClientError.connectionFailed("benchmark only supports GET")
            }
            guard request.url == hostRequestURL else {
                throw HTTPClientError.connectionFailed("host response did not match requested URL")
            }
            return HTTPResponse(statusCode: responseStatusCode, body: hostBody)
        }
        let response = try await client.get(hostRequestURL)
        guard 200 ..< 300 ~= response.statusCode else {
            throw HTTPClientError.connectionFailed("host returned HTTP \(response.statusCode)")
        }
        transport = "SwiftWASIHTTPClient.HostHTTPClient"
        statusCode = response.statusCode
        stats = try parseInstrumentedDocuments(data: response.body, chunkSize: chunkSize)
    } else {
        transport = "embedded fallback"
        statusCode = nil
        stats = try parseInstrumentedDocuments(data: fallbackYAML, chunkSize: chunkSize)
    }
    let parseMilliseconds = Date().timeIntervalSince(parseStart) * 1_000
    let ok = stats.documentCount > 0
    let result = SmokeResult(
        ok: ok,
        transport: transport,
        httpStatusCode: statusCode,
        inputByteCount: stats.inputByteCount,
        chunkSize: chunkSize,
        chunkCount: stats.chunkCount,
        maxChunkByteCount: stats.maxChunkByteCount,
        stdinReadCount: stats.stdinReadCount,
        maxStdinReadByteCount: stats.maxStdinReadByteCount,
        scannerDocumentSourceCount: stats.scannerDocumentSourceCount,
        documentCount: stats.documentCount,
        firstName: stats.firstName,
        lastName: stats.lastName,
        parseMilliseconds: parseMilliseconds,
        message: ok ? "PureYAMLStreaming WASM parse passed" : "PureYAMLStreaming WASM parse found no documents",
    )
    print(try renderJSON(result))
} catch {
    let result = SmokeResult(
        ok: false,
        transport: "failed",
        httpStatusCode: nil,
        inputByteCount: 0,
        chunkSize: 0,
        chunkCount: 0,
        maxChunkByteCount: 0,
        stdinReadCount: 0,
        maxStdinReadByteCount: 0,
        scannerDocumentSourceCount: 0,
        documentCount: 0,
        firstName: nil,
        lastName: nil,
        parseMilliseconds: 0,
        message: String(describing: error),
    )
    print((try? renderJSON(result)) ?? #"{"ok":false,"message":"failed to render error"}"#)
}

func parseInstrumentedDocuments(data: Data, chunkSize: Int) throws -> ParseStats {
    var reader = try PureYAMLStreaming.ChunkedUTF8Reader(data: data, chunkSize: chunkSize)
    return try parseInstrumentedDocuments(reader: &reader)
}

func parseInstrumentedDocuments(fileHandle: FileHandle, chunkSize: Int) throws -> ParseStats {
    var reader = try PureYAMLStreaming.ChunkedUTF8Reader(fileHandle: fileHandle, chunkSize: chunkSize)
    return try parseInstrumentedDocuments(reader: &reader)
}

func parseInstrumentedDocuments(reader: inout PureYAMLStreaming.ChunkedUTF8Reader) throws -> ParseStats {
    var scanner = PureYAMLStreaming.ResumableDocumentScanner()
    let pureParser = PureYAML.Parsing.Parser()
    var stats = ParseStats()

    while let chunk = try reader.readChunk() {
        let byteCount = Data(chunk.utf8).count
        stats.inputByteCount += byteCount
        stats.chunkCount += 1
        stats.maxChunkByteCount = max(stats.maxChunkByteCount, byteCount)
        stats.stdinReadCount += 1
        stats.maxStdinReadByteCount = max(stats.maxStdinReadByteCount, byteCount)
        let completedSources = try scanner.consume(chunk)
        stats.scannerDocumentSourceCount += completedSources.count
        for source in completedSources {
            try emitDocuments(from: source, parser: pureParser, stats: &stats)
        }
    }

    if let source = try scanner.finish(), !source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        stats.scannerDocumentSourceCount += 1
        try emitDocuments(from: source, parser: pureParser, stats: &stats)
    }

    return stats
}

func emitDocuments(
    from source: String,
    parser: PureYAML.Parsing.Parser,
    stats: inout ParseStats,
) throws {
    let documents = try parser.parseStream(source)
    for document in documents {
        let name = stringValue("name", in: document.value)
        if stats.documentCount == 0 {
            stats.firstName = name
        }
        stats.lastName = name
        stats.documentCount += 1
    }
}

func stringValue(_ key: String, in value: PureYAML.Model.Value) -> String? {
    guard case let .mapping(mapping) = value,
          case let .string(string)? = mapping[key]
    else {
        return nil
    }
    return string
}

func renderJSON<Value: Encodable>(_ value: Value) throws -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    return String(decoding: try encoder.encode(value), as: UTF8.self)
}
