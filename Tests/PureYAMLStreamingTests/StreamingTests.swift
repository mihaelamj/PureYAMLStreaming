import Foundation
import PureYAML
@testable import PureYAMLStreaming
import Testing

@Suite("PureYAML Streaming")
struct StreamingTests {
    @Test("chunked reader preserves UTF-8 split across chunks")
    func chunkedReaderPreservesSplitUTF8() throws {
        var reader = try PureYAMLStreaming.ChunkedUTF8Reader(
            data: Data("aé\nb".utf8),
            chunkSize: 2,
        )

        var chunks: [String] = []
        while let chunk = try reader.readChunk() {
            chunks.append(chunk)
        }

        #expect(chunks.joined() == "aé\nb")
        #expect(reader.mark == .init(line: 2, column: 2, index: 5))
    }

    @Test("document scanner emits documents across chunk boundaries")
    func scannerEmitsDocumentsAcrossChunks() throws {
        var scanner = PureYAMLStreaming.ResumableDocumentScanner()
        var documents: [String] = []

        documents += try scanner.consume("---\na: 1\n--")
        documents += try scanner.consume("-\nb: 2\n")
        if let final = try scanner.finish() {
            documents.append(final)
        }

        #expect(documents == ["---\na: 1\n", "---\nb: 2\n"])
    }

    @Test("parser streams documents in order")
    func parserStreamsDocumentsInOrder() throws {
        let yaml = Data(
            """
            ---
            name: one
            ---
            name: two
            """.utf8,
        )
        let parser = PureYAMLStreaming.Parser(chunkSize: 5)
        let documents = try parser.collectDocuments(data: yaml)

        #expect(documents.count == 2)
        #expect(documents[0].index == 0)
        #expect(documents[1].index == 1)
        #expect(stringValue("name", in: documents[0].value) == "one")
        #expect(stringValue("name", in: documents[1].value) == "two")
    }

    @Test("streaming matches PureYAML on Geekbench fixtures")
    func streamingMatchesGeekbenchFixtures() throws {
        let fixtureRoot = geekbenchFixtureRoot()
        guard FileManager.default.fileExists(atPath: fixtureRoot.path) else {
            return
        }

        let files = try FileManager.default.contentsOfDirectory(
            at: fixtureRoot,
            includingPropertiesForKeys: nil,
        ).filter { url in
            url.pathExtension == "yaml" || url.pathExtension == "yml"
        }

        #expect(files.count >= 100)

        let streamingParser = PureYAMLStreaming.Parser(chunkSize: 31)
        let pureParser = PureYAML.Parsing.Parser()
        for file in files {
            let data = try Data(contentsOf: file)
            var streamed: [PureYAML.Model.Value] = []
            try streamingParser.parseDocuments(from: file) { document in
                streamed.append(document.value)
            }
            let direct = try pureParser.parseStream(String(decoding: data, as: UTF8.self)).map(\.value)
            #expect(streamed == direct)
        }
    }

    @Test("parser streams generated large file without collecting documents")
    func parserStreamsGeneratedLargeFileWithoutCollectingDocuments() throws {
        let fileURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("pureyaml-stream-\(UUID().uuidString).yaml")
        try writeGeneratedStream(to: fileURL, documentCount: 5_000)
        defer {
            try? FileManager.default.removeItem(at: fileURL)
        }

        let parser = PureYAMLStreaming.Parser(chunkSize: 37)
        var count = 0
        var firstName: String?
        var lastName: String?

        try parser.parseDocuments(from: fileURL) { document in
            let name = stringValue("name", in: document.value)
            if count == 0 {
                firstName = name
            }
            lastName = name
            #expect(document.index == count)
            count += 1
        }

        #expect(count == 5_000)
        #expect(firstName == "doc-0")
        #expect(lastName == "doc-4999")
    }

    private func stringValue(_ key: String, in value: PureYAML.Model.Value) -> String? {
        guard case let .mapping(mapping) = value,
              case let .string(string)? = mapping[key]
        else {
            return nil
        }
        return string
    }

    private func geekbenchFixtureRoot() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("PureYAMLGeekbench")
            .appendingPathComponent("Fixtures")
            .appendingPathComponent("real-yaml")
    }

    private func writeGeneratedStream(to fileURL: URL, documentCount: Int) throws {
        FileManager.default.createFile(atPath: fileURL.path, contents: nil)
        let handle = try FileHandle(forWritingTo: fileURL)
        defer {
            try? handle.close()
        }

        for index in 0 ..< documentCount {
            let document = """
            ---
            name: doc-\(index)
            enabled: \(index.isMultiple(of: 2) ? "true" : "false")
            nested:
              index: \(index)
              tags:
                - real
                - streaming
                - chunk-\(index % 17)

            """
            try handle.write(contentsOf: Data(document.utf8))
        }
    }
}
